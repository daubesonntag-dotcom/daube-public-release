import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


CLASSIFICATIONS = {
    "PASS", "RETRYABLE_FAIL", "WAITING_FOR_INPUT", "HOLD_FOUNDER_GATE"
}


def _now():
    return datetime.now(timezone.utc).isoformat()


class CodexAdapter:
    runtime = "codex"
    executor_classes = {"implementation"}

    def __init__(self, executable: str):
        self.executable = executable

    def detect(self):
        path = Path(self.executable)
        if not path.exists() and shutil.which(self.executable) is None:
            return None
        return {"runtime": "codex", "executable": self.executable}

    def build_command(self, task: dict, workspace: Path, constraints: dict):
        workspace = Path(workspace).resolve()
        prompt = (
            "D'AUBE bounded implementation lane. "
            f"Task ID: {task.get('id', 'implementation')}. "
            f"Scope: {task.get('scope', '')}. "
            "Work only inside the provided workspace. "
            "Do not access marketplaces, contact clients, request or move money, "
            "change credentials, enable paid APIs, purchase anything, or declare "
            "delivery/revenue. Implement only the locked task and leave verifiable "
            "artifacts for independent QA."
        )
        return [
            self.executable,
            "exec",
            "--sandbox", "workspace-write",
            "--cd", str(workspace),
            prompt,
        ]

    def execute(self, task: dict, workspace: Path, constraints: dict):
        workspace = Path(workspace).resolve()
        workspace.mkdir(parents=True, exist_ok=True)
        started = _now()
        command = self.build_command(task, workspace, constraints)
        timeout = int(constraints.get("timeout_seconds", 1800))
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": os.environ.get("HOME", ""),
            "USER": os.environ.get("USER", ""),
            "LANG": os.environ.get("LANG", "C.UTF-8"),
        }
        try:
            process = subprocess.run(
                command,
                cwd=workspace,
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
            classification = self.classify_result({
                "returncode": process.returncode,
                "stdout": process.stdout,
                "stderr": process.stderr,
            })
            return {
                "runtime": "codex",
                "node_id": task.get("id", "implementation"),
                "started_at": started,
                "finished_at": _now(),
                "returncode": process.returncode,
                "classification": classification,
                "stdout_excerpt": process.stdout[-4000:],
                "stderr_excerpt": process.stderr[-4000:],
            }
        except subprocess.TimeoutExpired as exc:
            return {
                "runtime": "codex",
                "node_id": task.get("id", "implementation"),
                "started_at": started,
                "finished_at": _now(),
                "returncode": 124,
                "classification": "RETRYABLE_FAIL",
                "stdout_excerpt": (
                    (exc.stdout or "")[-4000:] if isinstance(exc.stdout, str) else ""
                ),
                "stderr_excerpt": "TIMEOUT",
            }

    def collect_evidence(self, result: dict, workspace: Path):
        return dict(result)

    def classify_result(self, result: dict):
        if result.get("returncode") == 0:
            return "PASS"
        text = f"{result.get('stdout', '')} {result.get('stderr', '')}".lower()
        if any(term in text for term in (
            "authentication required", "not logged in", "login required"
        )):
            return "HOLD_FOUNDER_GATE"
        if any(term in text for term in (
            "missing input", "need client", "credential required"
        )):
            return "WAITING_FOR_INPUT"
        return "RETRYABLE_FAIL"


def select_adapter(executor_class: str, which=shutil.which):
    if executor_class != "implementation":
        return None
    executable = which("codex")
    if not executable:
        return None
    return CodexAdapter(executable)
