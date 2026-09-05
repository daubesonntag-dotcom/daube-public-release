import json
import os
import re
import subprocess
import time
from pathlib import Path

from evidence import canonical_state, resolve_project

ALLOWED_SERVICES = frozenset(
    {
        "daube-revenue-worker.service",
        "daube-freelancer-award-watcher.service",
        "daube-freelancer-executor.service",
        "daube-freelancer-money-closure.service",
    }
)
SECRET_KEYS = ("token", "secret", "password", "api_key", "apikey", "credential")
SECRET_VALUE_PATTERNS = [
    re.compile(r"(?i)(token|secret|password|api[_-]?key)\s*[=:]\s*([^\s]+)")
]


def atomic_json(path, obj):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, default=str) + "\n")
    os.replace(tmp, p)


def append_event(path, row):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a") as handle:
        handle.write(json.dumps(row, default=str) + "\n")


def _scrub(obj):
    if isinstance(obj, dict):
        return {
            key: ("[REDACTED]" if any(term in key.lower() for term in SECRET_KEYS) else _scrub(value))
            for key, value in obj.items()
        }
    if isinstance(obj, list):
        return [_scrub(value) for value in obj]
    if isinstance(obj, str):
        value = obj
        for pattern in SECRET_VALUE_PATTERNS:
            value = pattern.sub(lambda match: f"{match.group(1)}=[REDACTED]", value)
        return value
    return obj


def choose_action(snapshot: dict):
    return {
        "DISCOVERING": "daube-revenue-worker.service",
        "BID_SUBMITTED": "daube-freelancer-award-watcher.service",
        "AWARDED_ACCEPTED": "daube-freelancer-executor.service",
        "WAITING_INPUT": "daube-freelancer-award-watcher.service",
        "DELIVERY_READY": "daube-freelancer-money-closure.service",
        "DELIVERED": "daube-freelancer-money-closure.service",
        "REVISION_REQUIRED": "daube-freelancer-executor.service",
        "SETTLEMENT_PENDING": "daube-freelancer-money-closure.service",
    }.get(snapshot.get("state"))


def safe_start(service, starter):
    if service not in ALLOWED_SERVICES:
        return False
    return bool(starter(service))


def systemd_starter(service):
    """Best-effort acceleration only; existing timers remain the authority."""
    if service not in ALLOWED_SERVICES:
        return False
    result = subprocess.run(
        ["systemctl", "start", service],
        capture_output=True,
        text=True,
        timeout=180,
    )
    return result.returncode == 0


def discover_project_ids(roots):
    ids = set()
    jobs = Path(roots["jobs"])
    if jobs.is_dir():
        for path in jobs.iterdir():
            if path.is_dir() and path.name.isdigit():
                ids.add(int(path.name))
    for base_key in ("bid_receipts", "live_bid_receipts"):
        base = Path(roots.get(base_key, ""))
        if not base.is_dir():
            continue
        for path in base.glob("*.json"):
            try:
                obj = json.loads(path.read_text())
                project_id = int(obj.get("project_id") or 0)
                if project_id > 0:
                    ids.add(project_id)
            except Exception:
                continue
    return sorted(ids)


def run_once(root: Path, service_starter=systemd_starter, roots_override=None):
    root = Path(root)
    base = Path.home() / "daube-revenue-worker"
    roots = roots_override or {
        "jobs": base / "full-loop/jobs",
        "bid_receipts": base / "receipts",
        "live_bid_receipts": Path.home() / "daube-freelancer-live/receipts",
        "accept_receipts": base / "full-loop/receipts",
        "money_receipts": base / "full-loop/money-closure/receipts",
        "revenue_ledger": base / "full-loop/money-closure/revenue-ledger.jsonl",
    }
    projects = []
    started = set()
    for project_id in discover_project_ids(roots):
        evidence = resolve_project(project_id, roots)
        state = canonical_state(evidence)
        snapshot = _scrub({"project_id": project_id, "state": state, "evidence": evidence})
        action = choose_action(snapshot)
        started_ok = False
        if action and action not in started:
            started_ok = safe_start(action, service_starter)
            if started_ok:
                started.add(action)
        snapshot["action"] = action if started_ok else None
        atomic_json(root / "projects" / f"{project_id}.json", snapshot)
        if state == "FOUNDER_GATE":
            atomic_json(root / "founder-gates" / f"{project_id}.json", snapshot)
        projects.append(snapshot)
        append_event(
            root / "events.jsonl",
            {"at": time.time(), "project_id": project_id, "state": state, "action": snapshot["action"]},
        )
    summary = {
        "version": "v10-native-revenue-autopilot",
        "projects": len(projects),
        "states": {str(item["project_id"]): item["state"] for item in projects},
        "started_services": sorted(started),
        "at": time.time(),
    }
    atomic_json(root / "state.json", summary)
    return summary


if __name__ == "__main__":
    print(json.dumps(run_once(Path.home() / "daube-revenue-worker/v10"), indent=2))
