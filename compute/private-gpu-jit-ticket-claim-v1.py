#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import signal
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

BROKER_URL = os.environ.get("DAUBE_PRIVATE_GPU_JIT_BROKER_URL", "").strip()
OPERATION_ID = os.environ.get("DAUBE_PRIVATE_GPU_OPERATION_ID", "").strip()
LAUNCH_TICKET = os.environ.get("DAUBE_PRIVATE_GPU_LAUNCH_TICKET", "").strip()
MIN_VRAM_MB = int(os.environ.get("DAUBE_PRIVATE_GPU_MIN_VRAM_MB", "12000"))
MAX_RUN_SECONDS = int(os.environ.get("DAUBE_PRIVATE_GPU_MAX_RUN_SECONDS", "1800"))
BOOTSTRAP_REVISION = "8f935f0ac1561cf949e1c7f1b1702fd999c1a116"
BOOTSTRAP_BLOB_SHA1 = "e5f82859cce8c0289f2b57e3f7d2683a4ac42aa9"
BOOTSTRAP_URL = (
    "https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/"
    f"{BOOTSTRAP_REVISION}/compute/private-gpu-jit-host-v1.sh"
)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = urllib.request.build_opener(NoRedirect)

def fail(message: str) -> None:
    raise SystemExit(message)

if os.environ.get("DAUBE_ZERO_SPEND_MODE") != "1":
    fail("zero_spend_mode_required")
if os.environ.get("DAUBE_REMOTE_WORKFLOW_EXECUTION_CONSENT") != "1":
    fail("remote_workflow_execution_consent_required")
if os.environ.get("DAUBE_PRIVATE_CHECKOUT_ALLOWED", "0") != "0":
    fail("private_checkout_forbidden")
if platform.system() != "Linux" or platform.machine().lower() not in {"x86_64", "amd64"}:
    fail("linux_x64_required_before_ticket_claim")
if not BROKER_URL.startswith("https://"):
    fail("broker_url_rejected")
if not re.fullmatch(r"[A-Za-z0-9._:-]{8,96}", OPERATION_ID):
    fail("operation_id_invalid")
if not re.fullmatch(r"[A-Za-z0-9_-]{40,96}", LAUNCH_TICKET):
    fail("launch_ticket_invalid")
if not 1000 <= MIN_VRAM_MB <= 100000:
    fail("min_vram_invalid")
if not 60 <= MAX_RUN_SECONDS <= 3600:
    fail("max_run_seconds_invalid")

try:
    import torch
except Exception as exc:
    fail(f"pytorch_unavailable:{type(exc).__name__}")

if not torch.cuda.is_available() or torch.cuda.device_count() < 1:
    fail("cuda_unavailable_before_ticket_claim")

props = torch.cuda.get_device_properties(0)
vram_mb = int(props.total_memory // (1024 * 1024))
if vram_mb < MIN_VRAM_MB:
    fail(f"gpu_vram_below_floor:{vram_mb}<{MIN_VRAM_MB}")

try:
    nvidia = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=index,name,memory.total,driver_version", "--format=csv,noheader,nounits"],
        text=True,
        stderr=subprocess.STDOUT,
        timeout=15,
    ).strip().splitlines()[0]
except Exception as exc:
    fail(f"nvidia_smi_failed:{type(exc).__name__}")

torch.manual_seed(16062003)
a = torch.randn((512, 512), device="cuda", dtype=torch.float32)
b = torch.randn((512, 512), device="cuda", dtype=torch.float32)
c = a @ b
torch.cuda.synchronize()
source = f"{float(c[0,0].item()):.8f}:{float(c[-1,-1].item()):.8f}:{float(c.mean().item()):.8f}"
preclaim_sha256 = hashlib.sha256(source.encode("utf-8")).hexdigest()
print(json.dumps({
    "schema": "daube.external-gpu-preclaim-proof.v1",
    "state": "MEASURED_CUDA_BEFORE_ONE_TIME_TICKET_CLAIM",
    "nvidiaSmi": nvidia,
    "deviceName": torch.cuda.get_device_name(0),
    "vramMb": vram_mb,
    "computeCapability": f"{props.major}.{props.minor}",
    "cudaMatmulSha256": preclaim_sha256,
    "privateCheckoutAllowed": False,
    "privateProductionSecretsAllowed": False,
    "automaticPaidSpend": False,
}, sort_keys=True))

claim_body = json.dumps({
    "action": "claim-proof-ticket",
    "operationId": OPERATION_ID,
    "launchTicket": LAUNCH_TICKET,
}, separators=(",", ":")).encode("utf-8")
request = urllib.request.Request(
    BROKER_URL,
    data=claim_body,
    method="POST",
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "daube-external-private-gpu-ticket-claim-v1",
    },
)
try:
    with OPENER.open(request, timeout=30) as response:
        claim = json.loads(response.read().decode("utf-8"))
except urllib.error.HTTPError as exc:
    fail(f"jit_ticket_claim_http_{exc.code}")
except Exception as exc:
    fail(f"jit_ticket_claim_transport:{type(exc).__name__}")

LAUNCH_TICKET = ""
os.environ["DAUBE_PRIVATE_GPU_LAUNCH_TICKET"] = ""

if claim.get("ok") is not True or claim.get("action") != "claim-proof-ticket":
    fail("jit_ticket_claim_rejected")
required_labels = {
    "self-hosted", "linux", "x64", "daube-private-gpu-proof", "daube-cuda",
    "daube-zero-spend", "daube-ephemeral", "daube-public-safe-no-checkout",
}
if not required_labels.issubset(set(claim.get("labels") or [])):
    fail("jit_claim_labels_incomplete")

jit = str(claim.get("encodedJitConfig") or "")
if not 20 <= len(jit) <= 32768:
    fail("jit_claim_config_invalid")

with tempfile.TemporaryDirectory(prefix="daube-private-gpu-claim-") as temp:
    target = Path(temp) / "private-gpu-jit-host-v1.sh"
    try:
        with OPENER.open(BOOTSTRAP_URL, timeout=30) as response:
            bootstrap = response.read()
    except Exception as exc:
        fail(f"bootstrap_download_failed:{type(exc).__name__}")
    git_blob_sha1 = hashlib.sha1(
        f"blob {len(bootstrap)}\0".encode("utf-8") + bootstrap
    ).hexdigest()
    if git_blob_sha1 != BOOTSTRAP_BLOB_SHA1:
        fail("bootstrap_git_blob_sha1_mismatch")
    target.write_bytes(bootstrap)
    target.chmod(0o700)

    env = os.environ.copy()
    env.update({
        "DAUBE_ZERO_SPEND_MODE": "1",
        "DAUBE_REMOTE_WORKFLOW_EXECUTION_CONSENT": "1",
        "DAUBE_PRIVATE_CHECKOUT_ALLOWED": "0",
        "DAUBE_PRIVATE_GPU_MIN_VRAM_MB": str(MIN_VRAM_MB),
    })
    process = subprocess.Popen(
        ["bash", str(target)],
        stdin=subprocess.PIPE,
        text=True,
        env=env,
        shell=False,
        start_new_session=True,
    )
    assert process.stdin is not None
    process.stdin.write(jit + "\n")
    process.stdin.close()
    jit = ""
    try:
        status = process.wait(timeout=MAX_RUN_SECONDS)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
        fail("private_gpu_one_job_runner_timeout")

raise SystemExit(status)
