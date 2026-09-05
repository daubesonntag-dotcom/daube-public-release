import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

VALID_STATES = {
    "READY_FOR_EXECUTOR", "PLANNING", "WAITING_FOR_INPUT", "EXECUTING_MESH",
    "QA_REVIEW", "RED_TEAM_REVIEW", "WORTH_THE_MONEY_REVIEW", "DELIVERY_READY",
    "RETRYABLE_FAIL", "QA_FAILED", "HOLD_FOUNDER_GATE",
}


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def atomic_write_json(path: Path, payload: dict):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def append_event(job_dir: Path, event: dict):
    path = Path(job_dir) / "events" / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")


def transition(job_dir: Path, state: str, *, reason=None, evidence=None):
    if state not in VALID_STATES:
        raise ValueError(f"INVALID_STATE:{state}")
    payload = {
        "version": "v9-daube-execution-mesh",
        "state": state,
        "updated_at": utc_now(),
        "reason": reason,
        "evidence": list(evidence or []),
    }
    atomic_write_json(Path(job_dir) / "v9-state.json", payload)
    append_event(job_dir, {"type": "STATE_TRANSITION", **payload})
    return payload
