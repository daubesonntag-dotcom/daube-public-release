#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST_AGENT = HERE / "direct-agent.py"
CAPABILITY_URL = os.environ.get(
    "DAUBE_MACHINE_NODE_CAPABILITY_URL",
    "https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-machine-node-capability",
).rstrip("/")
CLAIM_SCHEMA = "daube.machine-node-capability-claim.v1"
CHALLENGE_SCHEMA = "daube.machine-node-capability-challenge.v1"
RESULT_SCHEMA = "daube.machine-node-capability-result.v1"
HTTP_TIMEOUT = 15
MAX_ITERATIONS = 16384
HEX64 = re.compile(r"^[a-f0-9]{64}$")
NODE_DIGEST_SCRIPT = """const crypto=require('node:crypto');let b=Buffer.from(process.argv[1],'hex');const n=Number(process.argv[2]);if(!Number.isInteger(n)||n<256||n>16384)process.exit(64);for(let i=0;i<n;i++)b=crypto.createHash('sha256').update(b).digest();process.stdout.write(b.toString('hex'));"""


def load_host_agent():
    spec = importlib.util.spec_from_file_location("daube_sovereign_host_agent", HOST_AGENT)
    if spec is None or spec.loader is None:
        raise RuntimeError("host_agent_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def post_json(payload: dict[str, object]) -> tuple[int, dict[str, object]]:
    request = urllib.request.Request(
        CAPABILITY_URL,
        data=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "daube-machine-node-worker/2"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            return response.status, json.loads(response.read(128 * 1024).decode())
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read(128 * 1024).decode())
        except Exception:
            body = {"ok": False, "code": f"http_{error.code}"}
        return error.code, body


def signed_request(host, public_pem: str, fingerprint: str, action: str, **extra: object) -> tuple[int, dict[str, object]]:
    claim: dict[str, object] = {
        "schema": CLAIM_SCHEMA,
        "action": action,
        "hostId": f"sovereign-{fingerprint[:20]}",
        "observedAt": now_iso(),
        "nonce": secrets.token_hex(16),
        **extra,
    }
    payload = {"claim": claim, "publicKeyPem": public_pem, "signatureBase64": host.sign(claim)}
    return post_json(payload)


def validate_challenge(response: dict[str, object]) -> dict[str, object]:
    if response.get("ok") is not True or response.get("status") != "CHALLENGE_ISSUED":
        raise RuntimeError(f"challenge_failed:{response.get('code', 'invalid_response')}")
    challenge = response.get("challenge")
    if not isinstance(challenge, dict) or challenge.get("schema") != CHALLENGE_SCHEMA:
        raise RuntimeError("challenge_schema_invalid")
    challenge_id = str(challenge.get("challengeId", "")).lower()
    seed_hex = str(challenge.get("seedHex", "")).lower()
    iterations = int(challenge.get("iterations", 0))
    if not HEX64.fullmatch(challenge_id) or not HEX64.fullmatch(seed_hex):
        raise RuntimeError("challenge_identity_invalid")
    if iterations < 256 or iterations > MAX_ITERATIONS:
        raise RuntimeError("challenge_iterations_invalid")
    if challenge.get("commandsFixed") is not True or challenge.get("remoteShellAllowed") is not False or challenge.get("paidSpendAuthorized") is not False:
        raise RuntimeError("challenge_policy_invalid")
    return {"challengeId": challenge_id, "seedHex": seed_hex, "iterations": iterations}


def termux_tool(name: str) -> str:
    prefix = Path(os.environ.get("PREFIX", "")).resolve()
    if "com.termux" not in str(prefix):
        raise RuntimeError("termux_prefix_invalid")
    candidate = (prefix / "bin" / name).resolve()
    expected_root = (prefix / "bin").resolve()
    try:
        candidate.relative_to(expected_root)
    except ValueError as error:
        raise RuntimeError(f"fixed_tool_outside_termux_prefix:{name}") from error
    if not candidate.is_file() or not os.access(candidate, os.X_OK):
        raise RuntimeError(f"fixed_tool_missing:{name}")
    return str(candidate)


def run_fixed(argv: list[str], timeout: int = 10) -> str:
    completed = subprocess.run(argv, check=False, capture_output=True, text=True, timeout=timeout, shell=False)
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "command_failed").strip().splitlines()[-1][:160]
        raise RuntimeError(f"fixed_command_failed:{Path(argv[0]).name}:{completed.returncode}:{detail}")
    lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError(f"fixed_command_empty:{Path(argv[0]).name}")
    return lines[-1][:160]


def software_versions() -> tuple[str, str, str, str]:
    node = termux_tool("node")
    npm = termux_tool("npm")
    git = termux_tool("git")
    node_version = run_fixed([node, "--version"])
    npm_version = run_fixed([npm, "--version"])
    git_version = run_fixed([git, "--version"])
    match = re.match(r"^v?(\d+)(?:\.|$)", node_version)
    if not match or int(match.group(1)) < 22:
        raise RuntimeError(f"node22_required:{node_version}")
    return node, node_version, npm_version, git_version


def compute_node_digest(node: str, seed_hex: str, iterations: int) -> str:
    digest = run_fixed([node, "-e", NODE_DIGEST_SCRIPT, seed_hex, str(iterations)], timeout=30).lower()
    if not HEX64.fullmatch(digest):
        raise RuntimeError("node_digest_invalid")
    return digest


def build_result(host_id: str, challenge: dict[str, object], node_version: str, npm_version: str, git_version: str, digest: str) -> dict[str, object]:
    return {
        "schema": RESULT_SCHEMA,
        "challengeId": str(challenge["challengeId"]),
        "hostId": host_id,
        "status": "SUCCEEDED",
        "nodeVersion": node_version,
        "npmVersion": npm_version,
        "gitVersion": git_version,
        "digestSha256": digest,
        "privateAssetsUsed": False,
        "paidSpendAuthorized": False,
        "remoteShellUsed": False,
        "commandsFixed": True,
    }


def main() -> int:
    host = load_host_agent()
    host.require_runtime()
    if host.runtime_kind() != "android-termux":
        raise RuntimeError("android_termux_required")
    public_pem, fingerprint = host.ensure_identity()
    host_id = f"sovereign-{fingerprint[:20]}"

    status, response = signed_request(host, public_pem, fingerprint, "challenge")
    if status not in (200, 201):
        raise RuntimeError(f"challenge_http_failed:{status}:{response.get('code', 'unknown')}")
    challenge = validate_challenge(response)

    node, node_version, npm_version, git_version = software_versions()
    digest = compute_node_digest(node, str(challenge["seedHex"]), int(challenge["iterations"]))
    result = build_result(host_id, challenge, node_version, npm_version, git_version, digest)

    status, completion = signed_request(host, public_pem, fingerprint, "complete", result=result)
    if status not in (200, 201) or completion.get("ok") is not True or completion.get("status") != "VERIFIED":
        raise RuntimeError(f"completion_failed:{status}:{completion.get('code', 'unknown')}")
    print(json.dumps({
        "schema": "daube.machine-node-worker-status.v1",
        "status": "VERIFIED",
        "hostId": host_id,
        "challengeId": challenge["challengeId"],
        "capabilities": completion.get("capabilities"),
        "nodeVersion": node_version,
        "npmVersion": npm_version,
        "gitVersion": git_version,
        "toolRoot": "$PREFIX/bin",
        "remoteShellUsed": False,
        "privateAssetsUsed": False,
        "paidSpendAuthorized": False,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({
            "schema": "daube.machine-node-worker-status.v1",
            "status": "FAILED",
            "errorClass": type(error).__name__,
            "errorCode": str(error)[:180],
            "remoteShellUsed": False,
            "privateAssetsUsed": False,
            "paidSpendAuthorized": False,
        }, ensure_ascii=False))
        raise SystemExit(1)
