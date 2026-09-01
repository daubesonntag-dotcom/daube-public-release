#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
import secrets
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
V1_PATH = HERE / "sovereign-kms-worker.py"
ACTIVATION_URL = os.environ.get(
    "DAUBE_SOVEREIGN_KMS_ACTIVATION_URL",
    "https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/erina-v8",
).rstrip("/")
ACTIVATION_SCHEMA = "daube.sovereign-kms-activation-claim.v1"
HTTP_TIMEOUT_SECONDS = 12
MAX_RESPONSE_BYTES = 256 * 1024


def load_v1():
    spec = importlib.util.spec_from_file_location("daube_sovereign_kms_v1", V1_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("kms_v1_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def post_activation(payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    request = urllib.request.Request(
        ACTIVATION_URL,
        data=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Cache-Control": "no-store",
            "User-Agent": "daube-sovereign-kms-worker/2",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read(MAX_RESPONSE_BYTES).decode("utf-8"))
            return response.status, body if isinstance(body, dict) else {"code": "activation_response_not_object"}
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read(MAX_RESPONSE_BYTES).decode("utf-8"))
        except Exception:
            body = {"code": f"http_{error.code}"}
        return error.code, body if isinstance(body, dict) else {"code": f"http_{error.code}"}


def signed_activation(host, public_pem: str, fingerprint: str, action: str, **extra: object) -> tuple[int, dict[str, object]]:
    claim: dict[str, object] = {
        "schema": ACTIVATION_SCHEMA,
        "action": action,
        "hostId": f"sovereign-{fingerprint[:20]}",
        "observedAt": now_iso(),
        "nonce": secrets.token_hex(16),
        **extra,
    }
    return post_activation({
        "claim": claim,
        "publicKeyPem": public_pem,
        "signatureBase64": host.sign(claim),
    })


def parse_expiry(value: object) -> float:
    text = str(value or "").strip()
    if not text:
        raise RuntimeError("activation_expiry_missing")
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except ValueError as exc:
        raise RuntimeError("activation_expiry_invalid") from exc


def activate_root(kms, host, public_pem: str, fingerprint: str) -> dict[str, object]:
    status, response = signed_activation(
        host,
        public_pem,
        fingerprint,
        "challenge",
        profile=kms.PROFILE,
        keyAlias=kms.KEY_ALIAS,
        keyVersion=kms.KEY_VERSION,
        rootPrivateKeyExported=False,
        paidSpendAuthorized=False,
    )
    if status == 200 and response.get("status") == "ALREADY_ACTIVE":
        return {
            "status": "ALREADY_ACTIVE",
            "privateKeyPossessionVerified": True,
            "hardwareAttestationVerified": False,
        }
    if status not in (200, 201) or response.get("status") != "CHALLENGE_ISSUED":
        raise RuntimeError(f"activation_challenge_failed:{status}:{kms.safe_code(response.get('code'))}")

    challenge = response.get("challenge")
    if not isinstance(challenge, dict):
        raise RuntimeError("activation_challenge_missing")
    if (
        challenge.get("operation") != "activation_canary"
        or challenge.get("algorithm") != kms.ALGORITHM
        or challenge.get("keyAlias") != kms.KEY_ALIAS
        or int(challenge.get("keyVersion", 0)) != kms.KEY_VERSION
        or challenge.get("arbitraryCommand") is not None
        or challenge.get("privateAssetsUsed") is not False
        or challenge.get("paidSpendAuthorized") is not False
    ):
        raise RuntimeError("activation_challenge_contract_invalid")
    if parse_expiry(challenge.get("expiresAt")) <= time.time():
        raise RuntimeError("activation_challenge_expired")

    wrapped = base64.b64decode(str(challenge.get("wrappedChallenge", "")), validate=True)
    if len(wrapped) != kms.ROOT_BITS // 8:
        raise RuntimeError("activation_wrapped_challenge_size_invalid")
    packed = kms.rsa_oaep_decrypt(wrapped)
    try:
        if len(packed) != kms.PACKED_BYTES:
            raise RuntimeError("activation_plaintext_size_invalid")
        expected_context = bytes.fromhex(str(challenge.get("contextSha256", "")))
        if len(expected_context) != kms.CONTEXT_BYTES or bytes(packed[kms.DEK_BYTES:]) != expected_context:
            raise RuntimeError("activation_context_digest_mismatch")
        challenge_sha256 = hashlib.sha256(bytes(packed[:kms.DEK_BYTES])).hexdigest()
    finally:
        for index in range(len(packed)):
            packed[index] = 0

    complete_status, complete_response = signed_activation(
        host,
        public_pem,
        fingerprint,
        "complete",
        challengeId=str(challenge.get("challengeId", "")),
        challengeSha256=challenge_sha256,
        rootPrivateKeyExported=False,
        plaintextPersisted=False,
        paidSpendAuthorized=False,
    )
    if complete_status not in (200, 201) or complete_response.get("status") not in {"KEY_ACTIVATED", "ALREADY_ACTIVE"}:
        raise RuntimeError(f"activation_complete_failed:{complete_status}:{kms.safe_code(complete_response.get('code'))}")
    return {
        "status": complete_response.get("status"),
        "challengeId": complete_response.get("challengeId"),
        "privateKeyPossessionVerified": complete_response.get("privateKeyPossessionVerified") is True or complete_response.get("status") == "ALREADY_ACTIVE",
        "hardwareAttestationVerified": complete_response.get("hardwareAttestationVerified") is True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="D'AUBE sovereign KMS worker v2 with activation canary")
    parser.add_argument("--register-only", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--daemon", action="store_true")
    args = parser.parse_args()
    if sum(bool(value) for value in (args.register_only, args.once, args.daemon)) > 1:
        raise SystemExit("Choose only one of --register-only, --once or --daemon.")

    kms = load_v1()
    host = kms.load_host_agent()
    host.require_runtime()
    if host.runtime_kind() != "android-termux":
        raise SystemExit("D'AUBE Sovereign KMS worker v2 requires the paired Android/Termux sovereign host.")
    public_pem, fingerprint = host.ensure_identity()
    registration = kms.register(host, public_pem, fingerprint)
    activation = activate_root(kms, host, public_pem, fingerprint)
    summary: dict[str, object] = {
        "schema": "daube.sovereign-kms-worker-status.v2",
        "hostId": f"sovereign-{fingerprint[:20]}",
        "profile": kms.PROFILE,
        "registration": registration.get("status"),
        "activation": activation,
        "rootPrivateKeyExported": False,
        "paidSpendAuthorized": False,
    }
    if args.register_only:
        print(json.dumps(summary, ensure_ascii=False))
        return 0
    if args.once or not args.daemon:
        summary.update(kms.run_once(host, public_pem, fingerprint))
        print(json.dumps(summary, ensure_ascii=False))
        return 0

    while True:
        try:
            result = kms.run_once(host, public_pem, fingerprint)
            if result.get("status") != "NO_JOB":
                print(json.dumps({**summary, **result}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({**summary, "status": "DEGRADED", "errorCode": kms.safe_code(error)}, ensure_ascii=False), flush=True)
            time.sleep(min(5.0, max(1.0, kms.POLL_SECONDS * 2)))
        time.sleep(max(0.2, kms.POLL_SECONDS))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        kms = None
        try:
            kms = load_v1()
        except Exception:
            pass
        safe = kms.safe_code(error) if kms is not None else str(error).replace("\n", "_")[:180]
        print(json.dumps({
            "schema": "daube.sovereign-kms-worker-status.v2",
            "status": "FAILED_BEFORE_OR_OUTSIDE_JOB",
            "errorCode": safe,
            "rootPrivateKeyExported": False,
            "paidSpendAuthorized": False,
        }, ensure_ascii=False))
        raise SystemExit(2)
