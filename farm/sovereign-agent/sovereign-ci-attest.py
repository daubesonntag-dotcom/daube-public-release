#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

HOME = Path(os.environ.get("DAUBE_SOVEREIGN_HOME", str(Path.home() / ".local/share/daube-sovereign-host")))
AGENT_PATH = Path(os.environ.get(
    "DAUBE_SOVEREIGN_AGENT_PATH",
    str(Path.home() / ".local/lib/daube-sovereign-agent/direct-agent.py"),
))
RECEIPT = HOME / "ci" / "signed-readiness-receipt.json"


def load_agent():
    spec = importlib.util.spec_from_file_location("daube_sovereign_host_agent", AGENT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("sovereign_agent_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def version(command: list[str]) -> str | None:
    try:
        completed = subprocess.run(command, check=False, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    line = (completed.stdout or completed.stderr or "").strip().splitlines()
    return line[0][:180] if line else None


def probe_toolchain() -> dict[str, object]:
    observed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    commands = {
        "node": ["node", "--version"],
        "npm": ["npm", "--version"],
        "git": ["git", "--version"],
        "python": ["python", "--version"],
        "zstd": ["zstd", "--version"],
        "age": ["age", "--version"],
    }
    tools: dict[str, object] = {}
    all_ready = True
    for name, command in commands.items():
        executable = shutil.which(command[0])
        observed_version = version(command) if executable else None
        ready = bool(executable and observed_version)
        all_ready = all_ready and ready
        tools[name] = {
            "ready": ready,
            "version": observed_version,
        }
    return {
        "schema": "daube.sovereign-ci-toolchain-proof.v1",
        "ready": all_ready,
        "observedAt": observed_at,
        "runtimeKind": "android-termux",
        "tools": tools,
        "sourceTransport": {
            "mode": "encrypted-exact-command-closure",
            "githubCredentialRequiredOnHost": False,
            "cloudBearerCredentialRequiredOnHost": False,
            "inboundPortRequired": False,
        },
        "authority": {
            "paidSpendAuthorized": False,
            "productionMutationAuthorized": False,
            "credentialExportAuthorized": False,
            "mergeAdmissionAuthorized": False,
        },
    }


def main() -> int:
    agent = load_agent()
    agent.require_runtime()
    if agent.runtime_kind() != "android-termux":
        raise SystemExit("D'AUBE Sovereign CI readiness attestation requires Android/Termux.")

    public_pem, fingerprint = agent.ensure_identity()
    submission = agent.build_submission(public_pem, fingerprint)
    attestation = submission["attestation"]
    ci_toolchain = probe_toolchain()
    attestation["ciToolchain"] = ci_toolchain
    submission["signatureBase64"] = agent.sign(attestation)

    RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(RECEIPT.parent, 0o700)
    local_receipt = {
        "schema": "daube.sovereign-ci-signed-readiness-receipt.v1",
        "hostId": attestation["hostId"],
        "publicKeySha256": attestation["identity"]["publicKeySha256"],
        "ciToolchain": ci_toolchain,
        "signatureBase64": submission["signatureBase64"],
        "paidSpendAuthorized": False,
    }
    RECEIPT.write_text(json.dumps(local_receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(RECEIPT, 0o600)

    status, response = agent.submit(submission)
    result = {
        "schema": "daube.sovereign-ci-attestation-result.v1",
        "httpStatus": status,
        "status": response.get("status", "UNKNOWN"),
        "code": response.get("code"),
        "hostId": attestation["hostId"],
        "runtimeKind": attestation["runtimeKind"],
        "ciToolchainReady": ci_toolchain["ready"],
        "publicKeySha256": attestation["identity"]["publicKeySha256"],
        "paidSpendAuthorized": False,
        "nextGate": (
            "encrypted-exact-source-quick-green-receipt"
            if ci_toolchain["ready"] is True and response.get("status") == "VERIFIED"
            else "toolchain-or-host-admission"
        ),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if status in (200, 201) and response.get("status") == "VERIFIED" and ci_toolchain["ready"] is True:
        return 0
    if status == 409 and response.get("code") in {"host_key_not_registered", "host_key_not_active"}:
        return 3
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
