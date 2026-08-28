#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import platform
import re
import subprocess
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCHEMA = "daube.oracle-a1-attestation.v1"
PROVIDER_ID = "oracle-a1-free"
PROVIDER_FAMILY = "oracle-cloud"
EXPECTED_SHAPE = "VM.Standard.A1.Flex"
KEY_PATH = os.environ.get("DAUBE_PROVIDER_ATTESTATION_KEY", "/var/lib/daube/provider-attestation.key")
PUBLIC_KEY_PATH = os.environ.get("DAUBE_PROVIDER_ATTESTATION_PUBLIC_KEY", "/var/lib/daube/provider-attestation.pub")
TLS_HOST_PATH = os.environ.get("DAUBE_TLS_HOST_FILE", "/var/lib/daube/tls-hostname")
MAX_BODY = 4096
NONCE_RE = re.compile(r"^[A-Za-z0-9._:-]{16,200}$")
AUTO_TLS_RE = re.compile(r"^daube-(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.sslip\.io$", re.IGNORECASE)
OCI_IMDS_INSTANCE = "http://169.254.169.254/opc/v2/instance/"


def json_bytes(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def imds_json(url):
    request = urllib.request.Request(url, headers={"Authorization": "Bearer Oracle", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=2.5) as response:
        if response.status != 200:
            raise RuntimeError("oci_imds_http_error")
        return json.loads(response.read(256 * 1024).decode("utf-8"))


def callback_public_ip():
    try:
        with open(TLS_HOST_PATH, "r", encoding="utf-8") as handle:
            hostname = handle.read().strip()
    except OSError as error:
        raise RuntimeError("tls_hostname_unavailable") from error
    match = AUTO_TLS_RE.fullmatch(hostname)
    if not match:
        raise RuntimeError("tls_auto_hostname_required")
    octets = [int(value) for value in match.groups()]
    if any(value < 0 or value > 255 for value in octets):
        raise RuntimeError("tls_public_ip_invalid")
    return ".".join(str(value) for value in octets)


def oci_runtime_identity():
    instance = imds_json(OCI_IMDS_INSTANCE)
    if not isinstance(instance, dict):
        raise RuntimeError("oci_imds_payload_invalid")
    instance_id = str(instance.get("id") or "").strip()
    shape = str(instance.get("shape") or "").strip()
    region = str(instance.get("canonicalRegionName") or "").strip()
    availability_domain = str(instance.get("availabilityDomain") or "").strip()
    if not instance_id.startswith("ocid1.instance."):
        raise RuntimeError("oci_instance_ocid_invalid")
    if shape != EXPECTED_SHAPE:
        raise RuntimeError("oci_shape_mismatch")
    if not region:
        raise RuntimeError("oci_canonical_region_missing")
    return {
        "instance_id": instance_id,
        "shape": shape,
        "region": region,
        "availability_domain": availability_domain,
        "public_ip": callback_public_ip(),
    }


def sign_material(material):
    if not os.path.isfile(KEY_PATH) or not os.path.isfile(PUBLIC_KEY_PATH):
        raise RuntimeError("attestation_key_missing")
    result = subprocess.run(
        ["/usr/bin/openssl", "pkeyutl", "-sign", "-rawin", "-inkey", KEY_PATH],
        input=material,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=5,
        check=False,
    )
    if result.returncode != 0 or len(result.stdout) != 64:
        raise RuntimeError("attestation_sign_failed")
    with open(PUBLIC_KEY_PATH, "r", encoding="utf-8") as handle:
        public_key = handle.read().strip()
    if "BEGIN PUBLIC KEY" not in public_key or len(public_key) > 2048:
        raise RuntimeError("attestation_public_key_invalid")
    return public_key + "\n", base64.b64encode(result.stdout).decode("ascii")


class Handler(BaseHTTPRequestHandler):
    server_version = "daube-oracle-attestation/1"
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

    def do_POST(self):
        if self.path != "/v1/provider-attestation":
            self.send_json(404, {"error": "not_found"})
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
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "invalid_json"})
            return
        nonce = str(payload.get("nonce") if isinstance(payload, dict) else "")
        if not NONCE_RE.fullmatch(nonce):
            self.send_json(400, {"error": "nonce_invalid"})
            return
        try:
            identity = oci_runtime_identity()
            material_obj = {
                "schema": SCHEMA,
                "provider_id": PROVIDER_ID,
                "provider_family": PROVIDER_FAMILY,
                "instance_id": identity["instance_id"],
                "region": identity["region"],
                "shape": identity["shape"],
                "availability_domain": identity["availability_domain"],
                "public_ip": identity["public_ip"],
                "arch": platform.machine(),
                "cpu_logical": os.cpu_count(),
                "observed_at_unix": int(time.time()),
                "nonce": nonce,
                "paid_spend_authorized": False,
                "sovereign_local": False,
            }
            material = json_bytes(material_obj)
            public_key, signature = sign_material(material)
            self.send_json(200, {
                "schema": SCHEMA,
                "material": material.decode("utf-8"),
                "material_sha256": hashlib.sha256(material).hexdigest(),
                "public_key_pem": public_key,
                "signature_base64": signature,
            })
        except Exception as error:
            code = str(error) if re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", str(error)) else "attestation_unavailable"
            self.send_json(503, {"error": code})

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8792), Handler).serve_forever()
