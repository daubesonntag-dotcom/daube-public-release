#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST_AGENT = HERE / "direct-agent.py"
GPU_CANARY = Path(os.environ.get("DAUBE_VULKAN_CANARY", str(HERE / "daube-vulkan-compute-canary")))
INTAKE_URL = os.environ.get(
    "DAUBE_SOVEREIGN_GPU_INTAKE_URL",
    "https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-sovereign-gpu-direct-intake",
).rstrip("/")
LATEST = Path(os.environ.get("DAUBE_SOVEREIGN_HOME", str(Path.home() / ".local/share/daube-sovereign-host"))) / "latest-gpu-proof.json"


def load_host_agent():
    spec = importlib.util.spec_from_file_location("daube_sovereign_host_agent", HOST_AGENT)
    if spec is None or spec.loader is None:
        raise RuntimeError("host_agent_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_canary() -> dict[str, object]:
    if not GPU_CANARY.exists() or not os.access(GPU_CANARY, os.X_OK):
        raise RuntimeError("vulkan_compute_canary_missing")
    try:
        completed = subprocess.run(
            [str(GPU_CANARY)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("vulkan_compute_canary_timeout") from exc
    if completed.returncode != 0:
        code = (completed.stderr or "vulkan_compute_canary_failed").strip().splitlines()[-1][:120]
        raise RuntimeError(f"vulkan_compute_canary_failed_{completed.returncode}_{code}")
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("vulkan_compute_canary_output_missing")
    try:
        canary = json.loads(lines[-1])
    except json.JSONDecodeError as exc:
        raise RuntimeError("vulkan_compute_canary_output_invalid") from exc
    expected = [3657433178, 3657433435, 3657433692, 3657433949]
    if (
        canary.get("schema") != "daube.vulkan-compute-canary.v1"
        or canary.get("passed") is not True
        or canary.get("hardwareGpu") is not True
        or canary.get("softwareRenderer") is not False
        or canary.get("backend") != "vulkan"
        or canary.get("computeQueue") is not True
        or list(map(int, canary.get("observed", []))) != expected
    ):
        raise RuntimeError("vulkan_compute_canary_contract_failed")
    return canary


def submit(payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    request = urllib.request.Request(
        INTAKE_URL,
        data=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "daube-sovereign-gpu-agent/1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read(131072).decode())
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read(131072).decode())
        except Exception:
            body = {"ok": False, "code": f"http_{error.code}"}
        return error.code, body


def main() -> int:
    host = load_host_agent()
    host.require_runtime()
    if host.runtime_kind() != "android-termux":
        raise SystemExit("D'AUBE sovereign GPU agent currently admits Android/Termux for the zero-cash local lane.")
    public_pem, fingerprint = host.ensure_identity()
    canary = run_canary()
    observed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    attestation = {
        "schema": "daube.sovereign-gpu-direct-proof.v1",
        "hostId": f"sovereign-{fingerprint[:20]}",
        "runtimeKind": "android-termux",
        "observedAt": observed_at,
        "publicKeySha256": fingerprint,
        "canary": canary,
        "privateAssetsUsed": False,
        "paidSpendAuthorized": False,
    }
    payload = {
        "schema": "daube.sovereign-gpu-direct-submission.v1",
        "attestation": attestation,
        "publicKeyPem": public_pem,
        "signatureBase64": host.sign(attestation),
    }
    LATEST.parent.mkdir(parents=True, exist_ok=True)
    LATEST.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.chmod(LATEST, 0o600)
    status, response = submit(payload)
    summary = {
        "schema": "daube.sovereign-gpu-agent-result.v1",
        "httpStatus": status,
        "status": response.get("status", "UNKNOWN"),
        "code": response.get("code"),
        "hostId": attestation["hostId"],
        "deviceName": canary.get("deviceName"),
        "backend": "vulkan",
        "gpuComputePass": True,
        "gpuReady": response.get("gpuReady") is True,
        "oauthRequired": False,
        "paidSpendAuthorized": False,
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0 if status in (200, 201) and response.get("status") == "VERIFIED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
