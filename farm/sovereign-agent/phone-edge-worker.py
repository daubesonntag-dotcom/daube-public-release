#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import os
import secrets
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST_AGENT = HERE / "direct-agent.py"
BROKER_URL = os.environ.get(
    "DAUBE_SOVEREIGN_WORKER_URL",
    "https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-sovereign-worker",
).rstrip("/")
GPU_PROOF_BIN = Path(os.environ.get("DAUBE_GPU_PROOF_BIN", str(Path.home() / ".local/bin/daube-sovereign-gpu-proof")))
KERNEL_BIN = Path(os.environ.get("DAUBE_PHONE_GPU_KERNEL", str(HERE / "daube-vulkan-rgba-premultiply")))
PROFILE = "phone-edge-rgba-premultiply-v1"
KERNEL_ID = "rgba-premultiply-u8-v1"
MAX_INPUT_BYTES = 16 * 1024
MIN_BATTERY_PERCENT = int(os.environ.get("DAUBE_PHONE_GPU_MIN_BATTERY", "35"))
MAX_BATTERY_TEMP_C = float(os.environ.get("DAUBE_PHONE_GPU_MAX_BATTERY_TEMP_C", "42"))
HTTP_TIMEOUT = 15


def load_host_agent():
    spec = importlib.util.spec_from_file_location("daube_sovereign_host_agent", HOST_AGENT)
    if spec is None or spec.loader is None:
        raise RuntimeError("host_agent_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def battery_guard() -> dict[str, object]:
    percentage = None
    temperature = None
    charging = None
    try:
        completed = subprocess.run(["termux-battery-status"], check=False, capture_output=True, text=True, timeout=5)
        if completed.returncode == 0:
            data = json.loads(completed.stdout)
            percentage = int(data.get("percentage")) if data.get("percentage") is not None else None
            temperature = float(data.get("temperature")) if data.get("temperature") is not None else None
            charging = str(data.get("status", "")).upper() in {"CHARGING", "FULL"}
    except Exception:
        pass
    if percentage is None:
        try:
            percentage = int(Path("/sys/class/power_supply/battery/capacity").read_text().strip())
        except Exception:
            percentage = None
    if percentage is not None and percentage < MIN_BATTERY_PERCENT:
        raise RuntimeError(f"battery_below_floor:{percentage}")
    if temperature is not None and temperature > MAX_BATTERY_TEMP_C:
        raise RuntimeError(f"battery_temperature_above_ceiling:{temperature:.1f}")
    return {"percentage": percentage, "temperatureC": temperature, "charging": charging}


def signed_telemetry(safety: dict[str, object]) -> dict[str, object]:
    return {
        "schema": "daube.phone-edge-telemetry.v1",
        "batteryPercent": safety.get("percentage"),
        "temperatureC": safety.get("temperatureC"),
        "charging": safety.get("charging"),
        "observedAt": now_iso(),
        "profile": PROFILE,
        "kernelId": KERNEL_ID,
        "maxInputBytes": MAX_INPUT_BYTES,
        "minBatteryPercent": MIN_BATTERY_PERCENT,
        "maxBatteryTemperatureC": MAX_BATTERY_TEMP_C,
    }


def refresh_gpu_proof() -> None:
    if not GPU_PROOF_BIN.exists() or not os.access(GPU_PROOF_BIN, os.X_OK):
        raise RuntimeError("gpu_proof_binary_missing")
    completed = subprocess.run([str(GPU_PROOF_BIN)], check=False, capture_output=True, text=True, timeout=45)
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout or "gpu_proof_failed").strip().splitlines()[-1][:160]
        raise RuntimeError(f"gpu_proof_failed:{completed.returncode}:{message}")


def post_json(payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    request = urllib.request.Request(
        BROKER_URL,
        data=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "daube-phone-edge-worker/2"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            return response.status, json.loads(response.read(512 * 1024).decode())
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read(512 * 1024).decode())
        except Exception:
            body = {"ok": False, "code": f"http_{error.code}"}
        return error.code, body


def signed_request(host, public_pem: str, fingerprint: str, action: str, **extra: object) -> tuple[int, dict[str, object]]:
    claim: dict[str, object] = {
        "schema": "daube.sovereign-worker-claim.v1",
        "action": action,
        "hostId": f"sovereign-{fingerprint[:20]}",
        "observedAt": now_iso(),
        "nonce": secrets.token_hex(16),
        **extra,
    }
    payload = {"claim": claim, "publicKeyPem": public_pem, "signatureBase64": host.sign(claim)}
    return post_json(payload)


def decode_job(job: dict[str, object]) -> bytes:
    if job.get("profile") != PROFILE or job.get("kernelId") != KERNEL_ID:
        raise RuntimeError("job_profile_or_kernel_forbidden")
    if job.get("publicSafe") is not True or job.get("privateAssetsUsed") is not False or job.get("paidSpendAuthorized") is not False:
        raise RuntimeError("job_policy_invalid")
    raw = base64.b64decode(str(job.get("inputRgbaBase64", "")), validate=True)
    if len(raw) < 4 or len(raw) > MAX_INPUT_BYTES or len(raw) % 4:
        raise RuntimeError("job_input_size_invalid")
    if hashlib.sha256(raw).hexdigest() != str(job.get("inputSha256", "")):
        raise RuntimeError("job_input_hash_invalid")
    if int(job.get("inputBytes", 0)) != len(raw) or int(job.get("pixels", 0)) != len(raw) // 4:
        raise RuntimeError("job_input_metadata_invalid")
    return raw


def run_kernel(raw: bytes) -> tuple[bytes, dict[str, object], int]:
    if not KERNEL_BIN.exists() or not os.access(KERNEL_BIN, os.X_OK):
        raise RuntimeError("phone_gpu_kernel_binary_missing")
    with tempfile.TemporaryDirectory(prefix="daube-phone-gpu-") as temp_dir:
        input_path = Path(temp_dir) / "input.rgba"
        output_path = Path(temp_dir) / "output.rgba"
        input_path.write_bytes(raw)
        start = time.perf_counter()
        completed = subprocess.run([str(KERNEL_BIN), str(input_path), str(output_path)], check=False, capture_output=True, text=True, timeout=30)
        latency_ms = max(0, int((time.perf_counter() - start) * 1000))
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "kernel_failed").strip().splitlines()[-1][:160]
            raise RuntimeError(f"kernel_failed:{completed.returncode}:{detail}")
        lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
        if not lines:
            raise RuntimeError("kernel_receipt_missing")
        receipt = json.loads(lines[-1])
        if not (
            receipt.get("schema") == "daube.vulkan-rgba-premultiply-result.v1"
            and receipt.get("passed") is True
            and receipt.get("hardwareGpu") is True
            and receipt.get("softwareRenderer") is False
            and receipt.get("backend") == "vulkan"
            and receipt.get("kernelId") == KERNEL_ID
            and receipt.get("computeQueue") is True
        ):
            raise RuntimeError("kernel_receipt_invalid")
        device_name = str(receipt.get("deviceName", ""))
        if not device_name or any(token in device_name.lower() for token in ("llvmpipe", "lavapipe", "swiftshader", "software")):
            raise RuntimeError("software_renderer_forbidden")
        output = output_path.read_bytes()
        if len(output) != len(raw):
            raise RuntimeError("kernel_output_size_invalid")
        return output, receipt, latency_ms


def complete_with_retry(host, public_pem: str, fingerprint: str, job_id: str, result: dict[str, object]) -> dict[str, object]:
    last: tuple[int, dict[str, object]] | None = None
    for delay in (0, 1, 2):
        if delay:
            time.sleep(delay)
        last = signed_request(host, public_pem, fingerprint, "complete", jobId=job_id, result=result)
        status, body = last
        if status in (200, 201) and body.get("ok") is True:
            return body
        if status < 500:
            break
    assert last is not None
    raise RuntimeError(f"complete_failed:{last[0]}:{last[1].get('code', 'unknown')}")


def main() -> int:
    host = load_host_agent()
    host.require_runtime()
    if host.runtime_kind() != "android-termux":
        raise SystemExit("D'AUBE Phone Edge worker requires Android/Termux.")
    public_pem, fingerprint = host.ensure_identity()
    safety = battery_guard()
    telemetry = signed_telemetry(safety)
    refresh_gpu_proof()
    if not KERNEL_BIN.exists():
        print(json.dumps({"schema": "daube.phone-edge-worker-status.v1", "status": "GPU_PROOF_REFRESHED_KERNEL_NOT_INSTALLED", "safety": safety, "paidSpendAuthorized": False}, ensure_ascii=False))
        return 3

    status, response = signed_request(host, public_pem, fingerprint, "poll", telemetry=telemetry)
    if status != 200 or response.get("ok") is not True:
        raise RuntimeError(f"poll_failed:{status}:{response.get('code', 'unknown')}")
    if response.get("status") == "NO_JOB":
        print(json.dumps({"schema": "daube.phone-edge-worker-status.v1", "status": "NO_JOB", "safety": safety, "telemetrySigned": True, "paidSpendAuthorized": False}, ensure_ascii=False))
        return 0
    if response.get("status") != "JOB_LEASED":
        raise RuntimeError("poll_response_invalid")

    job = response.get("job")
    if not isinstance(job, dict):
        raise RuntimeError("job_manifest_missing")
    job_id = str(job.get("jobId", ""))
    host_id = f"sovereign-{fingerprint[:20]}"
    try:
        raw = decode_job(job)
        output, receipt, latency_ms = run_kernel(raw)
        result = {
            "schema": "daube.phone-edge-vulkan-result.v1",
            "jobId": job_id,
            "hostId": host_id,
            "status": "SUCCEEDED",
            "kernelId": KERNEL_ID,
            "backend": "vulkan",
            "deviceName": str(receipt.get("deviceName", ""))[:160],
            "outputRgbaBase64": base64.b64encode(output).decode(),
            "outputSha256": hashlib.sha256(output).hexdigest(),
            "latencyMs": latency_ms,
            "publicSafe": True,
            "privateAssetsUsed": False,
            "paidSpendAuthorized": False,
        }
    except Exception as error:
        result = {
            "schema": "daube.phone-edge-vulkan-result.v1",
            "jobId": job_id,
            "hostId": host_id,
            "status": "FAILED",
            "kernelId": KERNEL_ID,
            "backend": "vulkan",
            "errorClass": type(error).__name__,
            "errorCode": str(error)[:180],
            "privateAssetsUsed": False,
            "paidSpendAuthorized": False,
        }
    final = complete_with_retry(host, public_pem, fingerprint, job_id, result)
    print(json.dumps({"schema": "daube.phone-edge-worker-status.v1", "status": final.get("status"), "jobId": job_id, "resultStatus": result["status"], "safety": safety, "telemetrySigned": True, "paidSpendAuthorized": False}, ensure_ascii=False))
    return 0 if result["status"] == "SUCCEEDED" else 4


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"schema": "daube.phone-edge-worker-status.v1", "status": "FAILED_BEFORE_OR_OUTSIDE_JOB", "errorClass": type(error).__name__, "errorCode": str(error)[:200], "paidSpendAuthorized": False}, ensure_ascii=False))
        raise SystemExit(2)
