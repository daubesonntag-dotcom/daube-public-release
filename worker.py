#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import platform
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONTRACT = "daube.compute.v1"
PROVIDER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,119}$")
PROVIDER_ID = os.environ.get("DAUBE_WORKER_PROVIDER_ID", "oracle-a1-free").strip()
MAX_BODY = 64 * 1024
JOB_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,160}$")
SUPPORTED_WORKLOADS = {"runtime-probe"}
AUTH_TOKEN = os.environ.get("DAUBE_WORKER_AUTH_TOKEN", "")
RECEIPT_SECRET = os.environ.get("DAUBE_WORKER_RECEIPT_SECRET", "")


def json_bytes(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def signed_receipt(job_id, status, nonce):
    material = f"{CONTRACT}:{PROVIDER_ID}:{job_id}:{status}:{nonce}".encode("utf-8")
    signature = hmac.new(RECEIPT_SECRET.encode("utf-8"), material, hashlib.sha256).hexdigest()
    return f"dcr1.{PROVIDER_ID}.{job_id}.{signature}"


def safe_load_average():
    try:
        return list(os.getloadavg())
    except (AttributeError, OSError):
        return None


class Handler(BaseHTTPRequestHandler):
    server_version = "daube-worker/1"
    sys_version = ""

    def send_json(self, status_code, payload):
        body = json_bytes(payload)
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        if not AUTH_TOKEN:
            return False
        header = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not header.startswith(prefix):
            return False
        return hmac.compare_digest(header[len(prefix):], AUTH_TOKEN)

    def do_GET(self):
        if self.path != "/v1/capabilities":
            self.send_json(404, {"error": "not_found"})
            return
        self.send_json(200, {
            "schema": "daube.compute-worker-capabilities.v1",
            "provider_id": PROVIDER_ID,
            "contract_version": CONTRACT,
            "accelerators": ["cpu"],
            "workloads": sorted(SUPPORTED_WORKLOADS),
            "cpu_logical": os.cpu_count(),
            "arch": platform.machine(),
            "paid_spend_authorized": False,
            "sovereign_local": False,
        })

    def do_POST(self):
        if self.path != "/v1/compute/jobs":
            self.send_json(404, {"error": "not_found"})
            return
        if not self.authorized():
            self.send_json(401, {"error": "unauthorized"})
            return
        if not RECEIPT_SECRET:
            self.send_json(503, {"error": "receipt_secret_unbound"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "invalid_content_length"})
            return
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"error": "payload_too_large_or_empty"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "invalid_json"})
            return
        if not isinstance(body, dict):
            self.send_json(400, {"error": "invalid_payload"})
            return

        contract = body.get("contract_version")
        provider_target = body.get("provider_target")
        accelerator = body.get("accelerator")
        workload = str(body.get("workload") or "runtime-probe")
        job_id = str(body.get("job_id") or "")
        metadata = body.get("metadata") if isinstance(body.get("metadata"), dict) else {}
        nonce = str(metadata.get("_daube_receipt_nonce") or "")

        if contract != CONTRACT:
            self.send_json(409, {"error": "contract_mismatch"})
            return
        if provider_target != PROVIDER_ID:
            self.send_json(409, {"error": "provider_target_mismatch"})
            return
        if accelerator != "cpu":
            self.send_json(422, {"error": "accelerator_unsupported"})
            return
        if workload not in SUPPORTED_WORKLOADS:
            self.send_json(422, {"error": "workload_unsupported", "workload": workload})
            return
        if not JOB_ID_RE.fullmatch(job_id):
            self.send_json(400, {"error": "job_id_invalid"})
            return
        if not nonce or len(nonce) > 200 or any(c in nonce for c in "\r\n"):
            self.send_json(400, {"error": "receipt_nonce_invalid"})
            return

        started = time.time()
        status = "SUCCEEDED"
        result = {
            "kind": "runtime-probe",
            "arch": platform.machine(),
            "kernel": platform.release(),
            "cpu_logical": os.cpu_count(),
            "load_average": safe_load_average(),
            "observed_at_unix": int(time.time()),
        }
        self.send_json(200, {
            "contract_version": CONTRACT,
            "provider_id": PROVIDER_ID,
            "job_id": job_id,
            "status": status,
            "receipt_nonce": nonce,
            "provider_receipt": signed_receipt(job_id, status, nonce),
            "runtime_ms": max(0, int((time.time() - started) * 1000)),
            "result": result,
        })

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    if not PROVIDER_ID_RE.fullmatch(PROVIDER_ID):
        raise SystemExit("D'AUBE worker provider id is invalid")
    if len(AUTH_TOKEN) < 32 or len(RECEIPT_SECRET) < 32:
        raise SystemExit("D'AUBE worker secrets must each be at least 32 characters")
    ThreadingHTTPServer(("127.0.0.1", 8791), Handler).serve_forever()
