import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path


SECRET_PATTERNS = (
    ".env", "token", "secret", "credential", "private_key", "id_rsa", "id_ed25519", ".pem"
)
SKIP_PARTS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache"
}


def _now():
    return datetime.now(timezone.utc).isoformat()


def discover_checks(workspace: Path, contract: dict):
    workspace = Path(workspace)
    checks = []
    package = workspace / "package.json"
    if package.exists():
        try:
            data = json.loads(package.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        scripts = data.get("scripts") or {}
        for name in ("test", "lint", "typecheck", "build"):
            if name in scripts:
                checks.append(["npm", "run", name])

    python_markers = [
        workspace / "pytest.ini",
        workspace / "pyproject.toml",
        workspace / "tox.ini",
        workspace / "tests",
        workspace / "test",
    ]
    if any(path.exists() for path in python_markers):
        checks.append(["python3", "-m", "pytest", "-q"])
    return checks


def run_checks(workspace: Path, commands):
    workspace = Path(workspace)
    receipts = []
    for command in commands:
        started = _now()
        try:
            process = subprocess.run(
                command,
                cwd=workspace,
                capture_output=True,
                text=True,
                timeout=600,
                check=False,
            )
            receipts.append({
                "command": command,
                "cwd": str(workspace),
                "started_at": started,
                "finished_at": _now(),
                "exit_code": process.returncode,
                "stdout_excerpt": process.stdout[-4000:],
                "stderr_excerpt": process.stderr[-4000:],
            })
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            receipts.append({
                "command": command,
                "cwd": str(workspace),
                "started_at": started,
                "finished_at": _now(),
                "exit_code": 127 if isinstance(exc, FileNotFoundError) else 124,
                "stdout_excerpt": "",
                "stderr_excerpt": type(exc).__name__,
            })
    return receipts


def _secret_path(path: Path):
    low = "/".join(part.lower() for part in path.parts)
    name = path.name.lower()
    return (
        any(part in SKIP_PARTS for part in path.parts)
        or any(pattern in name or pattern in low for pattern in SECRET_PATTERNS)
    )


def inventory_artifacts(workspace: Path):
    workspace = Path(workspace)
    artifacts = []
    if not workspace.exists():
        return artifacts
    for path in sorted(candidate for candidate in workspace.rglob("*") if candidate.is_file()):
        relative = path.relative_to(workspace)
        if _secret_path(relative):
            continue
        data = path.read_bytes()
        artifacts.append({
            "path": relative.as_posix(),
            "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    return artifacts


def evaluate(check_receipts, artifacts):
    applicable = bool(check_receipts)
    commands_green = applicable and all(item.get("exit_code") == 0 for item in check_receipts)
    artifacts_present = bool(artifacts)
    return {
        "green": bool(commands_green and artifacts_present),
        "checks_applicable": applicable,
        "commands_green": commands_green,
        "artifacts_present": artifacts_present,
        "check_count": len(check_receipts),
        "artifact_count": len(artifacts),
    }


def execute_qa(workspace: Path, contract: dict):
    commands = discover_checks(workspace, contract)
    checks = run_checks(workspace, commands)
    artifacts = inventory_artifacts(workspace)
    report = evaluate(checks, artifacts)
    report["commands"] = checks
    report["artifacts"] = artifacts
    return report
