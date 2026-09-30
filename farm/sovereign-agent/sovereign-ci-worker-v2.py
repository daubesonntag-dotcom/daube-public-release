#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

HOME = Path(os.environ.get("DAUBE_SOVEREIGN_HOME", str(Path.home() / ".local/share/daube-sovereign-host")))
AGENT_PATH = Path(os.environ.get("DAUBE_SOVEREIGN_AGENT_PATH", str(Path.home() / ".local/lib/daube-sovereign-agent/direct-agent.py")))
BROKER_URL = os.environ.get("DAUBE_SOVEREIGN_CI_WORKER_URL", "https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-sovereign-ci-worker-v2").rstrip("/")
AGE_IDENTITY = Path(os.environ.get("DAUBE_SOVEREIGN_CI_AGE_IDENTITY", str(HOME / "ci" / "transport-age-identity.txt")))
AGE_RECIPIENT_FILE = Path(os.environ.get("DAUBE_SOVEREIGN_CI_AGE_RECIPIENT", str(HOME / "ci" / "transport-age-recipient.txt")))
PROFILE = "sovereign-node-package-smoke-v1"
COMMAND_ID = "node-test-explicit-paths-v1"
OUTER_JOB_SCHEMA = "daube.sovereign-ci-worker-job.v2"
CAPSULE_SCHEMA = "daube.sovereign-ci-source-capsule.v2"
RESULT_SCHEMA = "daube.sovereign-ci-worker-result.v2"
CLAIM_SCHEMA = "daube.sovereign-ci-worker-claim.v1"
CAPSULE_MANIFEST_PATH = ".daube/sovereign-ci-capsule.v2.json"
TARGETS = {
    "provider-fabric-smoke-v1": "3202b09c49f87fd733ad3afb84ac7be465b23301",
    "studio-runtime-smoke-v1": "ede6bb5d27cac26539b181330549f59dc6aff63a",
}
SHA1_RE = re.compile(r"^[a-f0-9]{40}$")
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
AGE_RECIPIENT_RE = re.compile(r"^age1[0-9a-z]{20,4096}$")
TEST_PATH_RE = re.compile(r"^tests/[A-Za-z0-9._/-]+\.test\.mjs$")
HTTP_TIMEOUT = 15
MAX_CIPHERTEXT_BYTES = 384 * 1024
MAX_TEST_PATHS = 256
SHA256_EMPTY = hashlib.sha256(b"").hexdigest()


def load_agent():
    spec = importlib.util.spec_from_file_location("daube_sovereign_host_agent", AGENT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("sovereign_agent_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_iso_utc(value: object) -> float:
    text = str(value or "")
    try:
        instant = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise RuntimeError("job_expiry_invalid") from error
    if instant.tzinfo is None:
        raise RuntimeError("job_expiry_timezone_required")
    return instant.astimezone(timezone.utc).timestamp()


def stable_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_recipient() -> tuple[str, str]:
    recipient = AGE_RECIPIENT_FILE.read_text(encoding="utf-8").strip()
    if not AGE_RECIPIENT_RE.fullmatch(recipient):
        raise RuntimeError("age_recipient_invalid")
    if not AGE_IDENTITY.is_file() or AGE_IDENTITY.stat().st_mode & 0o077:
        raise RuntimeError("age_identity_permissions_invalid")
    return recipient, sha256_bytes(recipient.encode())


def require_tools() -> None:
    for tool in ("node", "rage", "zstd", "tar"):
        if shutil.which(tool) is None:
            raise RuntimeError(f"required_tool_missing:{tool}")


def post_json(payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    request = urllib.request.Request(
        BROKER_URL,
        data=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "daube-sovereign-ci-worker-v2/1"},
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


def signed_request(agent, public_pem: str, fingerprint: str, action: str, **extra: object) -> tuple[int, dict[str, object]]:
    claim: dict[str, object] = {
        "schema": CLAIM_SCHEMA,
        "action": action,
        "hostId": f"sovereign-{fingerprint[:20]}",
        "observedAt": now_iso(),
        "nonce": secrets.token_hex(16),
        **extra,
    }
    payload = {"claim": claim, "publicKeyPem": public_pem, "signatureBase64": agent.sign(claim)}
    return post_json(payload)


def normalize_test_paths(value: object) -> list[str]:
    if not isinstance(value, list) or len(value) < 1 or len(value) > MAX_TEST_PATHS:
        raise RuntimeError("capsule_test_paths_invalid")
    paths = sorted(set(str(item or "") for item in value))
    if len(paths) != len(value) or paths != value:
        raise RuntimeError("capsule_test_paths_not_canonical")
    for item in paths:
        if not TEST_PATH_RE.fullmatch(item) or ".." in item or item.startswith("/"):
            raise RuntimeError("capsule_test_path_forbidden")
    return paths


def normalize_source_path(value: object) -> str:
    path = str(value or "")
    if not path or len(path) > 512 or path.startswith(("/", "-")) or "\\" in path or "\x00" in path:
        raise RuntimeError("capsule_source_path_invalid")
    parts = path.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise RuntimeError("capsule_source_path_invalid")
    if path == CAPSULE_MANIFEST_PATH:
        raise RuntimeError("capsule_manifest_self_reference_forbidden")
    return path


def validate_outer_job(job: dict[str, object], manifest_digest: str, host_id: str, recipient_fingerprint: str) -> bytes:
    if job.get("schema") != OUTER_JOB_SCHEMA or job.get("profile") != PROFILE or job.get("commandId") != COMMAND_ID:
        raise RuntimeError("job_schema_profile_or_command_invalid")
    if str(job.get("targetHostId", "")) != host_id:
        raise RuntimeError("job_target_host_mismatch")
    if any(key in job for key in ("targetId", "sourceRevision", "treeSha", "testPaths", "sourceManifestDigest", "repository", "repositoryPath", "command", "shell", "argv")):
        raise RuntimeError("job_outer_metadata_or_command_forbidden")
    for key in ("recipientFingerprint", "capsuleDigest", "ciphertextSha256"):
        if not SHA256_RE.fullmatch(str(job.get(key, "")).lower()):
            raise RuntimeError(f"job_{key}_invalid")
    if str(job.get("recipientFingerprint", "")).lower() != recipient_fingerprint:
        raise RuntimeError("job_recipient_mismatch")
    if job.get("oneUse") is not True or job.get("repositoryMetadataExposed") is not False:
        raise RuntimeError("job_outer_privacy_invalid")
    if job.get("privateSourceEncrypted") is not True or job.get("privateSourcePlaintextInBroker") is not False:
        raise RuntimeError("job_private_source_boundary_invalid")
    if job.get("paidSpendAuthorized") is not False or job.get("productionMutationAuthorized") is not False or job.get("mergeAdmissionAuthorized") is not False:
        raise RuntimeError("job_authority_invalid")
    if not SHA256_RE.fullmatch(str(manifest_digest).lower()) or sha256_bytes(stable_json(job).encode()) != str(manifest_digest).lower():
        raise RuntimeError("job_manifest_digest_mismatch")
    try:
        ciphertext = base64.b64decode(str(job.get("ciphertextBase64", "")), validate=True)
    except Exception as error:
        raise RuntimeError("job_ciphertext_base64_invalid") from error
    expected_bytes = int(job.get("ciphertextBytes", 0))
    if len(ciphertext) < 1 or len(ciphertext) > MAX_CIPHERTEXT_BYTES or len(ciphertext) != expected_bytes:
        raise RuntimeError("job_ciphertext_size_mismatch")
    if sha256_bytes(ciphertext) != str(job.get("ciphertextSha256", "")).lower():
        raise RuntimeError("job_ciphertext_digest_mismatch")
    duration = int(job.get("maxDurationSeconds", 0))
    if duration < 10 or duration > 300:
        raise RuntimeError("job_duration_invalid")
    if parse_iso_utc(job.get("expiresAt")) <= time.time():
        raise RuntimeError("job_expired")
    return ciphertext


def run_stream(cipher_path: Path, tar_args: list[str], timeout: int = 45) -> subprocess.CompletedProcess[str]:
    with cipher_path.open("rb") as source:
        rage = subprocess.Popen(["rage", "-d", "-i", str(AGE_IDENTITY)], stdin=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert rage.stdout is not None
        zstd = subprocess.Popen(["zstd", "-q", "-d", "--stdout"], stdin=rage.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        rage.stdout.close()
        assert zstd.stdout is not None
        try:
            tar = subprocess.run(["tar", *tar_args], stdin=zstd.stdout, capture_output=True, text=True, timeout=timeout, check=False)
        finally:
            zstd.stdout.close()
        rage_stderr = rage.stderr.read().decode(errors="replace") if rage.stderr else ""
        zstd_stderr = zstd.stderr.read().decode(errors="replace") if zstd.stderr else ""
        rage_rc = rage.wait(timeout=5)
        zstd_rc = zstd.wait(timeout=5)
    if rage_rc != 0:
        raise RuntimeError(f"rage_decrypt_failed:{rage_stderr.strip()[-120:]}")
    if zstd_rc != 0:
        raise RuntimeError(f"zstd_decompress_failed:{zstd_stderr.strip()[-120:]}")
    if tar.returncode != 0:
        raise RuntimeError(f"tar_failed:{tar.stderr.strip()[-120:]}")
    return tar


def safe_archive_names(cipher_path: Path) -> list[str]:
    listing = run_stream(cipher_path, ["-tf", "-"])
    names = [line.strip() for line in listing.stdout.splitlines() if line.strip()]
    if not names or len(names) > 4097:
        raise RuntimeError("archive_file_count_invalid")
    for name in names:
        if "\\" in name or "\x00" in name:
            raise RuntimeError("archive_path_invalid")
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or name.startswith("/"):
            raise RuntimeError("archive_path_escape")
    return names


def extract_archive(cipher_path: Path, workspace: Path) -> None:
    safe_archive_names(cipher_path)
    run_stream(cipher_path, ["--no-same-owner", "--no-same-permissions", "--delay-directory-restore", "-xf", "-", "-C", str(workspace)])
    root = workspace.resolve()
    for path in workspace.rglob("*"):
        parent = path.parent.resolve()
        if root != parent and root not in parent.parents:
            raise RuntimeError("workspace_path_escape")
        mode = path.lstat().st_mode
        if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            raise RuntimeError("workspace_special_file_forbidden")


def load_and_verify_capsule(workspace: Path, expected_capsule_digest: str) -> dict[str, object]:
    manifest_path = workspace / CAPSULE_MANIFEST_PATH
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise RuntimeError("capsule_manifest_missing")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as error:
        raise RuntimeError("capsule_manifest_json_invalid") from error
    if not isinstance(manifest, dict) or manifest.get("schema") != CAPSULE_SCHEMA:
        raise RuntimeError("capsule_schema_invalid")
    capsule_digest = sha256_bytes(stable_json(manifest).encode())
    if capsule_digest != expected_capsule_digest.lower():
        raise RuntimeError("capsule_digest_mismatch")
    target_id = str(manifest.get("targetId", ""))
    source_revision = str(manifest.get("sourceRevision", "")).lower()
    tree_sha = str(manifest.get("treeSha", "")).lower()
    if TARGETS.get(target_id) != source_revision:
        raise RuntimeError("capsule_target_revision_forbidden")
    if not SHA1_RE.fullmatch(tree_sha):
        raise RuntimeError("capsule_tree_invalid")
    if manifest.get("profile") != PROFILE or manifest.get("commandId") != COMMAND_ID:
        raise RuntimeError("capsule_profile_or_command_invalid")
    authority = manifest.get("authority")
    if not isinstance(authority, dict) or any(authority.get(key) is not False for key in ("paidSpendAuthorized", "productionMutationAuthorized", "credentialExportAuthorized", "mergeAdmissionAuthorized", "arbitraryShellAuthorized")):
        raise RuntimeError("capsule_authority_invalid")
    test_paths = normalize_test_paths(manifest.get("testPaths"))
    raw_files = manifest.get("files")
    if not isinstance(raw_files, list) or len(raw_files) < 1 or len(raw_files) > 4096:
        raise RuntimeError("capsule_files_invalid")
    normalized_files: list[dict[str, object]] = []
    for entry in raw_files:
        if not isinstance(entry, dict):
            raise RuntimeError("capsule_file_entry_invalid")
        path = normalize_source_path(entry.get("path"))
        digest = str(entry.get("sha256", "")).lower()
        size = int(entry.get("bytes", -1))
        if not SHA256_RE.fullmatch(digest) or size < 0 or size > 16 * 1024 * 1024:
            raise RuntimeError("capsule_file_metadata_invalid")
        normalized_files.append({"path": path, "sha256": digest, "bytes": size})
    normalized_files.sort(key=lambda entry: str(entry["path"]))
    if normalized_files != raw_files or len({str(entry["path"]) for entry in normalized_files}) != len(normalized_files):
        raise RuntimeError("capsule_files_not_canonical")
    source_manifest_digest = sha256_bytes(stable_json({"files": normalized_files}).encode())
    if source_manifest_digest != str(manifest.get("sourceManifestDigest", "")).lower():
        raise RuntimeError("capsule_source_manifest_digest_mismatch")
    expected_paths = {str(entry["path"]) for entry in normalized_files} | {CAPSULE_MANIFEST_PATH}
    actual_paths = {path.relative_to(workspace).as_posix() for path in workspace.rglob("*") if path.is_file()}
    if actual_paths != expected_paths:
        raise RuntimeError("capsule_workspace_file_set_mismatch")
    for entry in normalized_files:
        path = workspace / str(entry["path"])
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("capsule_source_file_missing")
        data = path.read_bytes()
        if len(data) != int(entry["bytes"]) or sha256_bytes(data) != str(entry["sha256"]):
            raise RuntimeError("capsule_source_file_digest_mismatch")
    for test_path in test_paths:
        if test_path not in expected_paths:
            raise RuntimeError("capsule_test_path_missing")
    return {
        "capsuleDigest": capsule_digest,
        "targetId": target_id,
        "sourceRevision": source_revision,
        "treeSha": tree_sha,
        "sourceManifestDigest": source_manifest_digest,
        "testPaths": test_paths,
    }


def workspace_digest(workspace: Path) -> str:
    digest = hashlib.sha256()
    files = sorted((p for p in workspace.rglob("*") if p.is_file()), key=lambda p: p.relative_to(workspace).as_posix())
    if not files:
        raise RuntimeError("workspace_empty")
    for path in files:
        rel = path.relative_to(workspace).as_posix()
        digest.update(rel.encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).hexdigest().encode())
        digest.update(b"\n")
    return digest.hexdigest()


def run_tests(workspace: Path, runtime_root: Path, test_paths: list[str], timeout: int) -> tuple[int, bytes, bytes, list[str]]:
    argv = ["node", "--test", *test_paths]
    home = runtime_root / "home"
    tmp = runtime_root / "tmp"
    home.mkdir(parents=True, mode=0o700)
    tmp.mkdir(parents=True, mode=0o700)
    env = {"PATH": os.environ.get("PATH", ""), "HOME": str(home), "TMPDIR": str(tmp), "CI": "1", "NO_COLOR": "1", "LANG": os.environ.get("LANG", "C.UTF-8")}
    try:
        completed = subprocess.run(argv, cwd=workspace, env=env, capture_output=True, timeout=timeout, check=False)
        return completed.returncode, completed.stdout, completed.stderr, argv
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout if isinstance(error.stdout, bytes) else (error.stdout or "").encode()
        stderr = error.stderr if isinstance(error.stderr, bytes) else (error.stderr or "").encode()
        return 124, stdout, stderr + b"\nDAUBE_TIMEOUT\n", argv


def complete_with_retry(agent, public_pem: str, fingerprint: str, job_id: str, result: dict[str, object]) -> dict[str, object]:
    last: tuple[int, dict[str, object]] | None = None
    for delay in (0, 1, 2):
        if delay:
            time.sleep(delay)
        last = signed_request(agent, public_pem, fingerprint, "complete", jobId=job_id, result=result)
        status, body = last
        if status in (200, 201) and body.get("ok") is True:
            return body
        if status < 500:
            break
    assert last is not None
    raise RuntimeError(f"complete_failed:{last[0]}:{last[1].get('code', 'unknown')}")


def failure_result(job: dict[str, object], job_id: str, host_id: str, code: str) -> dict[str, object]:
    return {
        "schema": RESULT_SCHEMA,
        "jobId": job_id,
        "hostId": host_id,
        "capsuleDigest": str(job.get("capsuleDigest", "")),
        "capsuleVerified": False,
        "targetId": None,
        "sourceRevision": None,
        "treeSha": None,
        "sourceManifestDigest": None,
        "testPaths": [],
        "commandId": COMMAND_ID,
        "status": "FAILED",
        "failurePhase": "decrypt-materialize-or-capsule-verify",
        "errorCode": code[:180],
        "executedArgv": [],
        "packageScriptsExecuted": False,
        "arbitraryShellUsed": False,
        "workspaceMaterialized": False,
        "workspaceDigestBefore": None,
        "workspaceDigestAfter": None,
        "sourceMutated": False,
        "exitCode": 125,
        "stdoutDigest": SHA256_EMPTY,
        "stderrDigest": sha256_bytes(code.encode()),
        "workspaceScrubbed": True,
        "privateAssetsExported": False,
        "paidSpendAuthorized": False,
    }


def main() -> int:
    require_tools()
    _recipient, recipient_fingerprint = load_recipient()
    agent = load_agent()
    agent.require_runtime()
    if agent.runtime_kind() != "android-termux":
        raise SystemExit("D'AUBE Sovereign CI worker v2 requires Android/Termux.")
    public_pem, fingerprint = agent.ensure_identity()
    host_id = f"sovereign-{fingerprint[:20]}"
    status, response = signed_request(agent, public_pem, fingerprint, "poll")
    if status != 200 or response.get("ok") is not True:
        raise RuntimeError(f"poll_failed:{status}:{response.get('code', 'unknown')}")
    if response.get("status") == "NO_JOB":
        print(json.dumps({"schema": "daube.sovereign-ci-worker-v2-status.v1", "status": "NO_JOB", "hostId": host_id, "recipientFingerprint": recipient_fingerprint, "paidSpendAuthorized": False}))
        return 0
    if response.get("status") != "JOB_LEASED" or not isinstance(response.get("job"), dict):
        raise RuntimeError("poll_response_invalid")

    job = response["job"]
    job_id = str(job.get("jobId", ""))
    try:
        ciphertext = validate_outer_job(job, str(response.get("manifestDigest", "")), host_id, recipient_fingerprint)
        with tempfile.TemporaryDirectory(prefix="daube-sovereign-ci-v2-") as temp_dir:
            root = Path(temp_dir)
            cipher_path = root / "source.age"
            workspace = root / "workspace"
            runtime_root = root / "runtime"
            workspace.mkdir(mode=0o700)
            runtime_root.mkdir(mode=0o700)
            cipher_path.write_bytes(ciphertext)
            extract_archive(cipher_path, workspace)
            capsule = load_and_verify_capsule(workspace, str(job.get("capsuleDigest", "")))
            before = workspace_digest(workspace)
            exit_code, stdout, stderr, argv = run_tests(workspace, runtime_root, list(capsule["testPaths"]), int(job.get("maxDurationSeconds", 0)))
            after = workspace_digest(workspace)
            source_mutated = before != after
            passed = exit_code == 0 and not source_mutated
            result: dict[str, object] = {
                "schema": RESULT_SCHEMA,
                "jobId": job_id,
                "hostId": host_id,
                "capsuleDigest": capsule["capsuleDigest"],
                "capsuleVerified": True,
                "targetId": capsule["targetId"],
                "sourceRevision": capsule["sourceRevision"],
                "treeSha": capsule["treeSha"],
                "sourceManifestDigest": capsule["sourceManifestDigest"],
                "testPaths": capsule["testPaths"],
                "commandId": COMMAND_ID,
                "status": "SUCCEEDED" if passed else "FAILED",
                "failurePhase": None if passed else ("source-mutated" if source_mutated else "test"),
                "errorCode": None,
                "executedArgv": argv,
                "packageScriptsExecuted": False,
                "arbitraryShellUsed": False,
                "workspaceMaterialized": True,
                "workspaceDigestBefore": before,
                "workspaceDigestAfter": after,
                "sourceMutated": source_mutated,
                "exitCode": exit_code,
                "stdoutDigest": sha256_bytes(stdout),
                "stderrDigest": sha256_bytes(stderr),
                "workspaceScrubbed": False,
                "privateAssetsExported": False,
                "paidSpendAuthorized": False,
            }
        result["workspaceScrubbed"] = True
    except Exception as error:
        result = failure_result(job, job_id, host_id, f"{type(error).__name__}:{error}")

    final = complete_with_retry(agent, public_pem, fingerprint, job_id, result)
    print(json.dumps({
        "schema": "daube.sovereign-ci-worker-v2-status.v1",
        "status": final.get("status"),
        "jobId": job_id,
        "resultStatus": result["status"],
        "hostId": host_id,
        "recipientFingerprint": recipient_fingerprint,
        "paidSpendAuthorized": False,
    }, ensure_ascii=False))
    return 0 if result["status"] == "SUCCEEDED" else 4


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"schema": "daube.sovereign-ci-worker-v2-status.v1", "status": "FAILED_BEFORE_OR_OUTSIDE_JOB", "errorClass": type(error).__name__, "errorCode": str(error)[:180], "paidSpendAuthorized": False}, ensure_ascii=False))
        raise SystemExit(2)
