#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST_AGENT = HERE / "direct-agent.py"
HOME = Path(os.environ.get("DAUBE_SOVEREIGN_HOME", str(Path.home() / ".local/share/daube-sovereign-host")))
KMS_DIR = HOME / "kms"
ROOT_KEY = KMS_DIR / "root-rsa-3072.pem"
ROOT_PUBLIC = KMS_DIR / "root-rsa-3072.pub.pem"
BROKER_URL = os.environ.get(
    "DAUBE_SOVEREIGN_KMS_URL",
    "https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/forge-redis/kms/host",
).rstrip("/")
PROFILE = "sovereign-kms-unwrap-v1"
CLAIM_SCHEMA = "daube.sovereign-kms-host-claim.v1"
JOB_SCHEMA = "daube.sovereign-kms-unwrap-job.v1"
RESULT_SCHEMA = "daube.sovereign-kms-unwrap-result.v1"
ALGORITHM = "RSA-OAEP-SHA256"
KEY_ALIAS = "forge-secrets/sovereign"
KEY_VERSION = 1
ROOT_BITS = 3072
RESPONSE_BITS = 2048
DEK_BYTES = 32
CONTEXT_BYTES = 32
PACKED_BYTES = DEK_BYTES + CONTEXT_BYTES
HTTP_TIMEOUT_SECONDS = 12
POLL_SECONDS = float(os.environ.get("DAUBE_SOVEREIGN_KMS_POLL_SECONDS", "0.6"))
MAX_RESPONSE_BYTES = 256 * 1024
HEX64 = re.compile(r"^[a-f0-9]{64}$")
UUIDISH = re.compile(r"^[0-9a-fA-F-]{36}$")


def load_host_agent():
    spec = importlib.util.spec_from_file_location("daube_sovereign_host_agent", HOST_AGENT)
    if spec is None or spec.loader is None:
        raise RuntimeError("host_agent_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def require_openssl() -> str:
    binary = shutil.which("openssl")
    if not binary:
        raise RuntimeError("openssl_cli_required")
    return binary


def run_fixed(args: list[str], *, input_bytes: bytes | bytearray | None = None, timeout: int = 15) -> bytes:
    completed = subprocess.run(
        args,
        input=bytes(input_bytes) if input_bytes is not None else None,
        check=False,
        capture_output=True,
        timeout=timeout,
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip().splitlines()
        suffix = detail[-1][:120] if detail else "openssl_failed"
        raise RuntimeError(f"crypto_command_failed:{completed.returncode}:{suffix}")
    return completed.stdout


def ensure_root_key() -> tuple[str, str]:
    openssl = require_openssl()
    KMS_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(KMS_DIR, 0o700)
    if not ROOT_KEY.exists():
        temp = KMS_DIR / f"root-rsa-{secrets.token_hex(8)}.tmp"
        try:
            run_fixed([
                openssl,
                "genpkey",
                "-algorithm",
                "RSA",
                "-pkeyopt",
                f"rsa_keygen_bits:{ROOT_BITS}",
                "-out",
                str(temp),
            ], timeout=90)
            os.chmod(temp, 0o600)
            os.replace(temp, ROOT_KEY)
        finally:
            temp.unlink(missing_ok=True)
    os.chmod(ROOT_KEY, 0o600)
    public_pem = run_fixed([openssl, "pkey", "-in", str(ROOT_KEY), "-pubout"], timeout=10).decode("ascii")
    ROOT_PUBLIC.write_text(public_pem, encoding="ascii")
    os.chmod(ROOT_PUBLIC, 0o600)
    text = run_fixed([openssl, "pkey", "-in", str(ROOT_KEY), "-text", "-noout"], timeout=10).decode("utf-8", errors="replace")
    if f"({ROOT_BITS} bit" not in text and f"({ROOT_BITS} bits" not in text:
        raise RuntimeError("kms_root_key_size_invalid")
    return public_pem, hashlib.sha256(public_pem.encode("ascii")).hexdigest()


def post_json(path: str, payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    request = urllib.request.Request(
        f"{BROKER_URL}/{path}",
        data=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Cache-Control": "no-store",
            "User-Agent": "daube-sovereign-kms-worker/1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read(MAX_RESPONSE_BYTES).decode("utf-8"))
            return response.status, body if isinstance(body, dict) else {"error": "response_not_object"}
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read(MAX_RESPONSE_BYTES).decode("utf-8"))
        except Exception:
            body = {"error": f"http_{error.code}"}
        return error.code, body if isinstance(body, dict) else {"error": f"http_{error.code}"}


def signed_request(host, public_pem: str, fingerprint: str, action: str, **extra: object) -> tuple[int, dict[str, object]]:
    claim: dict[str, object] = {
        "schema": CLAIM_SCHEMA,
        "action": action,
        "hostId": f"sovereign-{fingerprint[:20]}",
        "observedAt": now_iso(),
        "nonce": secrets.token_hex(16),
        **extra,
    }
    payload = {
        "claim": claim,
        "publicKeyPem": public_pem,
        "signatureBase64": host.sign(claim),
    }
    return post_json(action, payload)


def register(host, public_pem: str, fingerprint: str) -> dict[str, object]:
    kms_public_pem, kms_public_sha256 = ensure_root_key()
    status, response = signed_request(
        host,
        public_pem,
        fingerprint,
        "register",
        profile=PROFILE,
        keyAlias=KEY_ALIAS,
        keyVersion=KEY_VERSION,
        kmsPublicKeyPem=kms_public_pem,
        kmsPublicKeySha256=kms_public_sha256,
        securityLevel="software-protected",
        rootPrivateKeyExported=False,
        paidSpendAuthorized=False,
    )
    if status not in (200, 201) or response.get("status") not in {"KEY_REGISTERED", "ALREADY_REGISTERED"}:
        raise RuntimeError(f"kms_register_failed:{status}:{safe_code(response.get('error'))}")
    return response


def parse_utc_epoch(value: object) -> float:
    text = str(value or "").strip()
    if not text:
        raise RuntimeError("kms_job_expiry_invalid")
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise RuntimeError("kms_job_expiry_invalid") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def validate_job(job: dict[str, object], host_id: str) -> None:
    if job.get("schema") != JOB_SCHEMA:
        raise RuntimeError("kms_job_schema_invalid")
    if job.get("targetHostId") != host_id:
        raise RuntimeError("kms_job_host_invalid")
    if job.get("operation") != "unwrap" or job.get("algorithm") != ALGORITHM:
        raise RuntimeError("kms_job_operation_invalid")
    if job.get("keyAlias") != KEY_ALIAS or int(job.get("keyVersion", 0)) != KEY_VERSION:
        raise RuntimeError("kms_job_key_descriptor_invalid")
    if int(job.get("dataKeyBytes", 0)) != DEK_BYTES:
        raise RuntimeError("kms_job_dek_size_invalid")
    if job.get("arbitraryCommand") is not None:
        raise RuntimeError("kms_job_arbitrary_command_forbidden")
    if job.get("privateAssetsUsed") is not False or job.get("paidSpendAuthorized") is not False:
        raise RuntimeError("kms_job_policy_invalid")
    if not UUIDISH.fullmatch(str(job.get("jobId", ""))):
        raise RuntimeError("kms_job_id_invalid")
    if not HEX64.fullmatch(str(job.get("contextSha256", ""))):
        raise RuntimeError("kms_job_context_invalid")
    if parse_utc_epoch(job.get("expiresAt")) <= time.time() - 2:
        raise RuntimeError("kms_job_expired")


def rsa_oaep_decrypt(ciphertext: bytes) -> bytearray:
    openssl = require_openssl()
    plaintext = run_fixed([
        openssl,
        "pkeyutl",
        "-decrypt",
        "-inkey",
        str(ROOT_KEY),
        "-pkeyopt",
        "rsa_padding_mode:oaep",
        "-pkeyopt",
        "rsa_oaep_md:sha256",
        "-pkeyopt",
        "rsa_mgf1_md:sha256",
    ], input_bytes=ciphertext, timeout=15)
    if len(plaintext) != PACKED_BYTES:
        raise RuntimeError("kms_unwrapped_payload_size_invalid")
    return bytearray(plaintext)


def rsa_oaep_encrypt_to_response(plaintext: bytearray, public_pem: str) -> bytes:
    openssl = require_openssl()
    if len(public_pem) > 8192 or "BEGIN PUBLIC KEY" not in public_pem or "PRIVATE KEY" in public_pem:
        raise RuntimeError("kms_response_public_key_invalid")
    with tempfile.NamedTemporaryFile(prefix="daube-kms-response-", suffix=".pem", mode="w", encoding="ascii", delete=False) as handle:
        path = Path(handle.name)
        handle.write(public_pem)
    try:
        output = run_fixed([
            openssl,
            "pkeyutl",
            "-encrypt",
            "-pubin",
            "-inkey",
            str(path),
            "-pkeyopt",
            "rsa_padding_mode:oaep",
            "-pkeyopt",
            "rsa_oaep_md:sha256",
            "-pkeyopt",
            "rsa_mgf1_md:sha256",
        ], input_bytes=plaintext, timeout=15)
    finally:
        path.unlink(missing_ok=True)
    if len(output) != RESPONSE_BITS // 8:
        raise RuntimeError("kms_response_ciphertext_size_invalid")
    return output


def execute_job(job: dict[str, object], host_id: str) -> dict[str, object]:
    validate_job(job, host_id)
    wrapped = base64.b64decode(str(job.get("wrappedDataKey", "")), validate=True)
    if len(wrapped) != ROOT_BITS // 8:
        raise RuntimeError("kms_wrapped_data_key_size_invalid")
    packed = rsa_oaep_decrypt(wrapped)
    try:
        expected_context = bytes.fromhex(str(job["contextSha256"]))
        if len(expected_context) != CONTEXT_BYTES or bytes(packed[DEK_BYTES:]) != expected_context:
            raise RuntimeError("kms_context_digest_mismatch")
        response_ciphertext = rsa_oaep_encrypt_to_response(packed, str(job.get("responsePublicKeyPem", "")))
        return {
            "schema": RESULT_SCHEMA,
            "jobId": str(job["jobId"]),
            "hostId": host_id,
            "status": "SUCCEEDED",
            "operation": "unwrap",
            "algorithm": ALGORITHM,
            "keyAlias": KEY_ALIAS,
            "keyVersion": KEY_VERSION,
            "contextSha256": str(job["contextSha256"]),
            "responseCiphertext": base64.b64encode(response_ciphertext).decode("ascii"),
            "plaintextPersisted": False,
            "rootPrivateKeyExported": False,
            "paidSpendAuthorized": False,
        }
    finally:
        for index in range(len(packed)):
            packed[index] = 0


def complete(host, public_pem: str, fingerprint: str, result: dict[str, object]) -> dict[str, object]:
    status, response = signed_request(host, public_pem, fingerprint, "complete", result=result)
    if status not in (200, 201) or response.get("status") not in {"RESULT_VERIFIED", "ALREADY_COMPLETED"}:
        raise RuntimeError(f"kms_complete_failed:{status}:{safe_code(response.get('error'))}")
    return response


def run_once(host, public_pem: str, fingerprint: str) -> dict[str, object]:
    status, response = signed_request(host, public_pem, fingerprint, "poll", profile=PROFILE)
    if status != 200:
        raise RuntimeError(f"kms_poll_failed:{status}:{safe_code(response.get('error'))}")
    if response.get("status") == "NO_JOB":
        return {"status": "NO_JOB", "retryAfterMilliseconds": response.get("retryAfterMilliseconds", 750)}
    if response.get("status") != "JOB_LEASED" or not isinstance(response.get("job"), dict):
        raise RuntimeError("kms_poll_response_invalid")
    job = response["job"]
    host_id = f"sovereign-{fingerprint[:20]}"
    try:
        result = execute_job(job, host_id)
    except Exception as error:
        result = {
            "schema": RESULT_SCHEMA,
            "jobId": str(job.get("jobId", "")),
            "hostId": host_id,
            "status": "FAILED",
            "operation": "unwrap",
            "algorithm": ALGORITHM,
            "keyAlias": KEY_ALIAS,
            "keyVersion": KEY_VERSION,
            "contextSha256": str(job.get("contextSha256", "")),
            "errorCode": safe_code(error),
            "plaintextPersisted": False,
            "rootPrivateKeyExported": False,
            "paidSpendAuthorized": False,
        }
    final = complete(host, public_pem, fingerprint, result)
    return {
        "status": final.get("status"),
        "jobId": result.get("jobId"),
        "resultStatus": result.get("status"),
    }


def safe_code(value: object) -> str:
    return re.sub(r"[^A-Za-z0-9_.:-]", "_", str(value or "unknown"))[:180]


def main() -> int:
    parser = argparse.ArgumentParser(description="D'AUBE fixed-profile sovereign KMS unwrap worker")
    parser.add_argument("--register-only", action="store_true")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--daemon", action="store_true")
    args = parser.parse_args()
    if sum(bool(value) for value in (args.register_only, args.once, args.daemon)) > 1:
        raise SystemExit("Choose only one of --register-only, --once or --daemon.")

    host = load_host_agent()
    host.require_runtime()
    if host.runtime_kind() != "android-termux":
        raise SystemExit("D'AUBE Sovereign KMS worker requires the paired Android/Termux sovereign host.")
    public_pem, fingerprint = host.ensure_identity()
    registration = register(host, public_pem, fingerprint)
    summary: dict[str, object] = {
        "schema": "daube.sovereign-kms-worker-status.v1",
        "hostId": f"sovereign-{fingerprint[:20]}",
        "profile": PROFILE,
        "registration": registration.get("status"),
        "rootPrivateKeyExported": False,
        "hardwareAttestationVerified": registration.get("hardwareAttestationVerified") is True,
        "paidSpendAuthorized": False,
    }
    if args.register_only:
        print(json.dumps(summary, ensure_ascii=False))
        return 0

    if args.once or not args.daemon:
        summary.update(run_once(host, public_pem, fingerprint))
        print(json.dumps(summary, ensure_ascii=False))
        return 0

    while True:
        try:
            result = run_once(host, public_pem, fingerprint)
            if result.get("status") != "NO_JOB":
                print(json.dumps({**summary, **result}, ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps({**summary, "status": "DEGRADED", "errorCode": safe_code(error)}, ensure_ascii=False), flush=True)
            time.sleep(min(5.0, max(1.0, POLL_SECONDS * 2)))
        time.sleep(max(0.2, POLL_SECONDS))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        print(json.dumps({
            "schema": "daube.sovereign-kms-worker-status.v1",
            "status": "FAILED_BEFORE_OR_OUTSIDE_JOB",
            "errorCode": safe_code(error),
            "rootPrivateKeyExported": False,
            "paidSpendAuthorized": False,
        }, ensure_ascii=False))
        raise SystemExit(2)
