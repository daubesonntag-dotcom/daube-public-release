#!/usr/bin/env python3
from __future__ import annotations

import base64
import ctypes
import ctypes.util
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import tempfile
import textwrap
import time
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path(os.environ.get("DAUBE_SOVEREIGN_HOME", str(Path.home() / ".local/share/daube-sovereign-host")))
KEY = HOME / "host-ed25519.pem"
RAW_KEY = HOME / "host-ed25519.raw"
PUB = HOME / "host-ed25519.pub.pem"
LATEST = HOME / "latest-direct-proof.json"
INTAKE_URL = os.environ.get(
    "DAUBE_SOVEREIGN_INTAKE_URL",
    "https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-sovereign-host-direct-intake",
).rstrip("/")
MAX_HTTP_SECONDS = 5


def run(*args: str, input_bytes: bytes | None = None) -> bytes:
    return subprocess.check_output(args, input=input_bytes, timeout=10)


def runtime_kind() -> str:
    prefix = os.environ.get("PREFIX", "")
    if "com.termux" in prefix or os.environ.get("TERMUX_VERSION"):
        return "android-termux"
    return "linux-host"


def _load_libcrypto() -> ctypes.CDLL | None:
    candidates: list[str] = []
    prefix = os.environ.get("PREFIX")
    if prefix:
        candidates.extend([f"{prefix}/lib/libcrypto.so", f"{prefix}/lib/libcrypto.so.3"])
    discovered = ctypes.util.find_library("crypto")
    if discovered:
        candidates.append(discovered)
    candidates.extend(["libcrypto.so.3", "libcrypto.so"])
    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            return ctypes.CDLL(candidate)
        except OSError:
            continue
    return None


def _configure_libcrypto(lib: ctypes.CDLL) -> int:
    try:
        lib.OBJ_sn2nid.argtypes = [ctypes.c_char_p]
        lib.OBJ_sn2nid.restype = ctypes.c_int
        nid = int(lib.OBJ_sn2nid(b"ED25519"))
    except AttributeError:
        nid = 1087
    if nid <= 0:
        nid = 1087

    lib.EVP_PKEY_new_raw_private_key.argtypes = [
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_size_t,
    ]
    lib.EVP_PKEY_new_raw_private_key.restype = ctypes.c_void_p
    lib.EVP_PKEY_get_raw_public_key.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_size_t),
    ]
    lib.EVP_PKEY_get_raw_public_key.restype = ctypes.c_int
    lib.EVP_PKEY_free.argtypes = [ctypes.c_void_p]
    lib.EVP_MD_CTX_new.restype = ctypes.c_void_p
    lib.EVP_MD_CTX_free.argtypes = [ctypes.c_void_p]
    lib.EVP_DigestSignInit.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
    ]
    lib.EVP_DigestSignInit.restype = ctypes.c_int
    lib.EVP_DigestSign.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_size_t),
        ctypes.c_void_p,
        ctypes.c_size_t,
    ]
    lib.EVP_DigestSign.restype = ctypes.c_int
    return nid


def _sign_with_pkey(lib: ctypes.CDLL, pkey: ctypes.c_void_p, message: bytes | None) -> tuple[bytes, bytes | None]:
    public_buffer = (ctypes.c_ubyte * 32)()
    public_length = ctypes.c_size_t(32)
    if lib.EVP_PKEY_get_raw_public_key(pkey, public_buffer, ctypes.byref(public_length)) != 1:
        raise RuntimeError("libcrypto could not derive Ed25519 public key.")
    public_key = bytes(public_buffer[: public_length.value])
    if message is None:
        return public_key, None

    ctx = lib.EVP_MD_CTX_new()
    if not ctx:
        raise RuntimeError("libcrypto could not allocate signing context.")
    try:
        if lib.EVP_DigestSignInit(ctx, None, None, None, pkey) != 1:
            raise RuntimeError("libcrypto Ed25519 signing initialization failed.")
        signature_buffer = (ctypes.c_ubyte * 64)()
        signature_length = ctypes.c_size_t(64)
        message_buffer = (ctypes.c_ubyte * len(message)).from_buffer_copy(message)
        if lib.EVP_DigestSign(
            ctx,
            signature_buffer,
            ctypes.byref(signature_length),
            message_buffer,
            len(message),
        ) != 1:
            raise RuntimeError("libcrypto Ed25519 signing failed.")
        signature = bytes(signature_buffer[: signature_length.value])
        if len(signature) != 64:
            raise RuntimeError("libcrypto returned an invalid Ed25519 signature length.")
        return public_key, signature
    finally:
        lib.EVP_MD_CTX_free(ctx)


def _libcrypto_public_and_sign(seed: bytes, message: bytes | None = None) -> tuple[bytes, bytes | None]:
    if len(seed) != 32:
        raise RuntimeError("Ed25519 raw private key must be exactly 32 bytes.")
    lib = _load_libcrypto()
    if lib is None:
        raise RuntimeError("OpenSSL libcrypto is unavailable.")
    nid = _configure_libcrypto(lib)
    seed_buffer = (ctypes.c_ubyte * len(seed)).from_buffer_copy(seed)
    pkey = lib.EVP_PKEY_new_raw_private_key(nid, None, seed_buffer, len(seed))
    if not pkey:
        raise RuntimeError("libcrypto could not construct Ed25519 private key.")
    try:
        return _sign_with_pkey(lib, pkey, message)
    finally:
        lib.EVP_PKEY_free(pkey)


def _libcrypto_public_and_sign_pem(pem: bytes, message: bytes | None = None) -> tuple[bytes, bytes | None]:
    lib = _load_libcrypto()
    if lib is None:
        raise RuntimeError("OpenSSL libcrypto is unavailable.")
    _configure_libcrypto(lib)
    try:
        lib.BIO_new_mem_buf.argtypes = [ctypes.c_void_p, ctypes.c_int]
        lib.BIO_new_mem_buf.restype = ctypes.c_void_p
        lib.BIO_free.argtypes = [ctypes.c_void_p]
        lib.BIO_free.restype = ctypes.c_int
        lib.PEM_read_bio_PrivateKey.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.c_void_p,
            ctypes.c_void_p,
        ]
        lib.PEM_read_bio_PrivateKey.restype = ctypes.c_void_p
    except AttributeError as exc:
        raise RuntimeError("libcrypto PEM private-key APIs are unavailable.") from exc

    pem_buffer = ctypes.create_string_buffer(pem)
    bio = lib.BIO_new_mem_buf(pem_buffer, len(pem))
    if not bio:
        raise RuntimeError("libcrypto could not allocate PEM input buffer.")
    try:
        pkey = lib.PEM_read_bio_PrivateKey(bio, None, None, None)
        if not pkey:
            raise RuntimeError("libcrypto could not parse Ed25519 PEM private key.")
        try:
            return _sign_with_pkey(lib, pkey, message)
        finally:
            lib.EVP_PKEY_free(pkey)
    finally:
        lib.BIO_free(bio)


def _public_pem(raw_public: bytes) -> str:
    if len(raw_public) != 32:
        raise RuntimeError("Ed25519 public key must be exactly 32 bytes.")
    # RFC 8410 SubjectPublicKeyInfo prefix for id-Ed25519, followed by 32 raw key bytes.
    der = bytes.fromhex("302a300506032b6570032100") + raw_public
    encoded = base64.b64encode(der).decode("ascii")
    return "-----BEGIN PUBLIC KEY-----\n" + "\n".join(textwrap.wrap(encoded, 64)) + "\n-----END PUBLIC KEY-----\n"


def crypto_backend_available() -> bool:
    return shutil.which("openssl") is not None or _load_libcrypto() is not None


def require_runtime() -> None:
    kind = runtime_kind()
    system = platform.system().lower()
    if kind == "android-termux":
        if system not in {"android", "linux"}:
            raise SystemExit(
                f"D'AUBE Android sovereign edge requires Android/Linux Termux runtime (observed: {system or 'unknown'})."
            )
    elif system != "linux":
        raise SystemExit(
            f"D'AUBE sovereign-local proof requires a Linux runtime (observed: {system or 'unknown'})."
        )
    if not crypto_backend_available():
        raise SystemExit("OpenSSL libcrypto or the openssl CLI is required for Ed25519.")
    HOME.mkdir(parents=True, exist_ok=True)
    os.chmod(HOME, 0o700)


def ensure_identity() -> tuple[str, str]:
    HOME.mkdir(parents=True, exist_ok=True)
    os.chmod(HOME, 0o700)

    # Preserve identity continuity. Once a key exists, never silently replace it
    # merely because a crypto frontend becomes unavailable or behaves differently.
    if RAW_KEY.exists():
        seed = RAW_KEY.read_bytes()
        raw_public, _ = _libcrypto_public_and_sign(seed)
        public_pem = _public_pem(raw_public)
        PUB.write_text(public_pem, encoding="utf-8")
    elif KEY.exists():
        openssl = shutil.which("openssl")
        public_pem: str | None = None
        if openssl is not None:
            try:
                run(openssl, "pkey", "-in", str(KEY), "-pubout", "-out", str(PUB))
                public_pem = PUB.read_text(encoding="utf-8")
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
                public_pem = None
        if public_pem is None:
            raw_public, _ = _libcrypto_public_and_sign_pem(KEY.read_bytes())
            public_pem = _public_pem(raw_public)
            PUB.write_text(public_pem, encoding="utf-8")
    elif _load_libcrypto() is not None:
        # Prefer a backend-neutral raw seed for fresh identities. Existing PEM
        # identities are preserved and remain fully supported.
        seed = os.urandom(32)
        RAW_KEY.write_bytes(seed)
        os.chmod(RAW_KEY, 0o600)
        raw_public, _ = _libcrypto_public_and_sign(seed)
        public_pem = _public_pem(raw_public)
        PUB.write_text(public_pem, encoding="utf-8")
    elif shutil.which("openssl") is not None:
        openssl = shutil.which("openssl")
        assert openssl is not None
        run(openssl, "genpkey", "-algorithm", "ED25519", "-out", str(KEY))
        os.chmod(KEY, 0o600)
        run(openssl, "pkey", "-in", str(KEY), "-pubout", "-out", str(PUB))
        public_pem = PUB.read_text(encoding="utf-8")
    else:
        raise RuntimeError("No usable Ed25519 backend is available.")

    os.chmod(PUB, 0o600)
    return public_pem, hashlib.sha256(public_pem.encode()).hexdigest()


def read_first(paths: list[str]) -> list[str]:
    values: list[str] = []
    for name in paths:
        try:
            value = Path(name).read_text(encoding="utf-8", errors="ignore").replace("\x00", "").strip()
            if value:
                values.append(value)
        except OSError:
            pass
    return values


def metadata_probe(url: str, headers: dict[str, str] | None = None) -> bool:
    try:
        req = urllib.request.Request(url, headers=headers or {}, method="GET")
        with urllib.request.urlopen(req, timeout=0.45) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def cloud_heuristic() -> dict[str, object]:
    signals = read_first(
        [
            "/sys/class/dmi/id/sys_vendor",
            "/sys/class/dmi/id/product_name",
            "/sys/class/dmi/id/board_vendor",
            "/proc/device-tree/model",
        ]
    )
    joined = " | ".join(signals).lower()
    patterns = [
        ("amazon-ec2", r"amazon ec2|amazon"),
        ("google-compute", r"google compute engine"),
        ("microsoft-azure", r"microsoft corporation.*virtual|virtual machine.*microsoft|azure"),
        ("oracle-cloud", r"oraclecloud|oracle cloud"),
        ("digitalocean", r"digitalocean"),
        ("hetzner", r"hetzner"),
        ("vultr", r"vultr"),
        ("linode", r"linode|akamai connected cloud"),
    ]
    provider = next((name for name, pattern in patterns if re.search(pattern, joined)), None)
    if provider is None and metadata_probe(
        "http://169.254.169.254/opc/v2/instance/", {"Authorization": "Bearer Oracle"}
    ):
        provider = "oracle-cloud"
    if provider is None and metadata_probe("http://169.254.169.254/latest/meta-data/instance-id"):
        provider = "amazon-ec2"
    if provider is None and metadata_probe(
        "http://metadata.google.internal/computeMetadata/v1/instance/id", {"Metadata-Flavor": "Google"}
    ):
        provider = "google-compute"
    if provider is None and metadata_probe(
        "http://169.254.169.254/metadata/instance?api-version=2021-02-01", {"Metadata": "true"}
    ):
        provider = "microsoft-azure"
    return {
        "detected": provider is not None,
        "providerHint": provider,
        "signalDigest": hashlib.sha256(joined.encode()).hexdigest(),
    }


def memory_mib() -> int:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) // 1024
    except OSError:
        pass
    return 0


def uptime_seconds() -> int:
    try:
        return int(float(Path("/proc/uptime").read_text().split()[0]))
    except Exception:
        return 0


def disk_free_mib() -> int:
    return int(shutil.disk_usage(str(HOME)).free // (1024 * 1024))


def cpu_canary() -> dict[str, object]:
    work_units = 100000
    digest = hashlib.sha256()
    start = time.perf_counter()
    for i in range(work_units):
        digest.update(f"daube-sovereign-{i}".encode())
    return {
        "passed": True,
        "workUnits": work_units,
        "elapsedMs": max(1, int((time.perf_counter() - start) * 1000)),
        "sha256": digest.hexdigest(),
    }


def storage_canary() -> dict[str, object]:
    payload = hashlib.sha256(b"daube-sovereign-storage-seed").digest() * 32768
    expected = hashlib.sha256(payload).hexdigest()
    with tempfile.NamedTemporaryFile(prefix="daube-sovereign-", dir=str(HOME), delete=False) as handle:
        path = Path(handle.name)
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        observed = hashlib.sha256(path.read_bytes()).hexdigest()
    finally:
        path.unlink(missing_ok=True)
    return {"passed": observed == expected, "bytes": len(payload), "sha256": observed}


def network_canary() -> dict[str, object]:
    req = urllib.request.Request(
        INTAKE_URL,
        headers={"Accept": "application/json", "User-Agent": "daube-sovereign-agent/4"},
    )
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=MAX_HTTP_SECONDS) as response:
            body = json.loads(response.read(65536).decode())
            return {
                "passed": response.status == 200 and body.get("live") is True,
                "httpStatus": response.status,
                "latencyMs": int((time.perf_counter() - start) * 1000),
            }
    except Exception as exc:
        return {
            "passed": False,
            "httpStatus": None,
            "latencyMs": int((time.perf_counter() - start) * 1000),
            "errorClass": type(exc).__name__,
        }


def canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _openssl_sign_pem_file(openssl: str, message: bytes) -> bytes:
    # Ed25519 is a one-shot algorithm. Some Android/Termux OpenSSL builds reject
    # stdin/pipes because pkeyutl cannot determine the message size. A real file
    # provides a stat-able length and avoids that implementation-specific failure.
    with tempfile.NamedTemporaryFile(prefix="daube-ed25519-msg-", dir=str(HOME), delete=False) as handle:
        path = Path(handle.name)
        handle.write(message)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        signature = run(
            openssl,
            "pkeyutl",
            "-sign",
            "-rawin",
            "-inkey",
            str(KEY),
            "-in",
            str(path),
        )
        if len(signature) != 64:
            raise RuntimeError("openssl returned an invalid Ed25519 signature length.")
        return signature
    finally:
        path.unlink(missing_ok=True)


def sign(payload: dict[str, object]) -> str:
    message = canonical_json(payload)
    if RAW_KEY.exists():
        _, signature = _libcrypto_public_and_sign(RAW_KEY.read_bytes(), message)
        if signature is None:
            raise RuntimeError("libcrypto did not return a signature.")
        return base64.b64encode(signature).decode("ascii")

    if not KEY.exists():
        raise RuntimeError("Ed25519 private identity is missing.")

    openssl = shutil.which("openssl")
    if openssl is not None:
        try:
            signature = _openssl_sign_pem_file(openssl, message)
            return base64.b64encode(signature).decode("ascii")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, RuntimeError):
            # Do not rotate or replace an existing identity merely because the CLI
            # frontend is incompatible. Fall through to libcrypto using the same PEM.
            pass

    _, signature = _libcrypto_public_and_sign_pem(KEY.read_bytes(), message)
    if signature is None:
        raise RuntimeError("libcrypto did not return a PEM Ed25519 signature.")
    return base64.b64encode(signature).decode("ascii")


def build_submission(public_pem: str, fingerprint: str) -> dict[str, object]:
    observed_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cloud = cloud_heuristic()
    cpu = cpu_canary()
    storage = storage_canary()
    network = network_canary()
    canary = {
        "success": bool(cpu["passed"] and storage["passed"] and network["passed"]),
        "observedAt": observed_at,
        "cpu": cpu,
        "storage": storage,
        "network": network,
        "privateAssetsUsed": False,
        "paidSpendAuthorized": False,
    }
    host_id = f"sovereign-{fingerprint[:20]}"
    attestation = {
        "schema": "daube.sovereign-direct-proof.v2",
        "hostId": host_id,
        "observedAt": observed_at,
        "platform": "linux",
        "runtimeKind": runtime_kind(),
        "arch": platform.machine(),
        "kernelRelease": platform.release(),
        "ownerControlClaim": True,
        "sensitiveDataIncluded": False,
        "privateAssetsUsed": False,
        "paidSpendAuthorized": False,
        "capacity": {
            "cpuLogical": os.cpu_count() or 0,
            "memoryMiB": memory_mib(),
            "diskFreeMiB": disk_free_mib(),
            "uptimeSeconds": uptime_seconds(),
        },
        "cloudHeuristic": cloud,
        "identity": {
            "publicKeySha256": fingerprint,
            "hostnameSha256": hashlib.sha256(socket.gethostname().encode()).hexdigest(),
        },
        "canary": canary,
    }
    return {
        "schema": "daube.sovereign-direct-submission.v2",
        "attestation": attestation,
        "publicKeyPem": public_pem,
        "signatureBase64": sign(attestation),
    }


def submit(payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    req = urllib.request.Request(
        INTAKE_URL,
        data=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "daube-sovereign-agent/4",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=MAX_HTTP_SECONDS) as response:
            return response.status, json.loads(response.read(131072).decode())
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read(131072).decode())
        except Exception:
            body = {"ok": False, "code": f"http_{error.code}"}
        return error.code, body


def main() -> int:
    require_runtime()
    public_pem, fingerprint = ensure_identity()
    submission = build_submission(public_pem, fingerprint)
    LATEST.write_text(json.dumps(submission, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.chmod(LATEST, 0o600)
    status, response = submit(submission)
    summary = {
        "schema": "daube.sovereign-direct-agent-result.v2",
        "httpStatus": status,
        "status": response.get("status", "UNKNOWN"),
        "code": response.get("code"),
        "hostId": submission["attestation"]["hostId"],
        "runtimeKind": submission["attestation"]["runtimeKind"],
        "publicKeySha256": fingerprint,
        "cloudDetected": submission["attestation"]["cloudHeuristic"]["detected"],
        "canaryPass": submission["attestation"]["canary"]["success"],
        "nextGate": response.get("nextGate"),
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    if status in (200, 201) and response.get("status") == "VERIFIED":
        return 0
    if status == 409 and response.get("code") in ("host_key_not_registered", "host_key_not_active"):
        print(
            "PAIRING_REQUIRED: approve only this public-key fingerprint after confirming this exact device/host is directly controlled by D'AUBE/founder."
        )
        return 3
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
