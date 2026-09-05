import json
from pathlib import Path

TERMINAL = {"FOUNDER_GATE", "SETTLED", "CLOSED_NO_REVENUE", "FAILED_CLOSED"}


def _read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return None


def _read_jsonl(path):
    rows = []
    p = Path(path)
    if not p.is_file():
        return rows
    for line in p.read_text().splitlines():
        try:
            rows.append(json.loads(line))
        except Exception:
            continue
    return rows


def _authoritative_for(obj, project_id, bid_id=None):
    if not isinstance(obj, dict) or obj.get("authoritative") is not True:
        return False
    try:
        if int(obj.get("project_id") or 0) != int(project_id):
            return False
        if bid_id is not None and int(obj.get("bid_id") or 0) != int(bid_id):
            return False
    except Exception:
        return False
    return True


def resolve_project(project_id: int, roots: dict[str, Path]) -> dict:
    pid = int(project_id)
    out = {"project_id": pid, "contradiction": False}
    jobdir = Path(roots["jobs"]) / str(pid)
    job = _read_json(jobdir / "job.json") if jobdir.is_dir() else None
    if isinstance(job, dict):
        if int(job.get("project_id") or 0) != pid:
            out["contradiction"] = True
        else:
            out["job"] = job
            out["bid_id"] = int(job.get("bid_id") or 0)
    bid_id = out.get("bid_id")

    bid = None
    for base in (Path(roots.get("bid_receipts", "")), Path(roots.get("live_bid_receipts", ""))):
        if not base.is_dir():
            continue
        for p in base.glob("*.json"):
            x = _read_json(p)
            if _authoritative_for(x, pid, bid_id if bid_id else None):
                bid = x
                break
        if bid:
            break
    if bid:
        out["bid"] = bid

    if bid_id:
        acc = _read_json(Path(roots["accept_receipts"]) / f"accept-{pid}-{bid_id}.json")
        if acc is not None:
            if _authoritative_for(acc, pid, bid_id):
                out["accept"] = acc
            else:
                out["contradiction"] = True

    if jobdir.is_dir():
        for name, key in (("executor-state.json", "executor_state"), ("REVISION_REQUEST.json", "revision_request"), ("FOUNDER_ACTION_REQUIRED.json", "founder_gate")):
            obj = _read_json(jobdir / name)
            if isinstance(obj, dict):
                out[key] = obj
        qa = _read_json(jobdir / "qa" / "qa-report.json")
        if isinstance(qa, dict):
            out["qa"] = qa
        manifest = _read_json(jobdir / "delivery" / "manifest.json")
        if isinstance(manifest, dict):
            out["delivery_manifest"] = manifest

    delivery = _read_json(Path(roots["money_receipts"]) / f"delivery-{pid}.json")
    if delivery is not None:
        if _authoritative_for(delivery, pid):
            out["delivery_receipt"] = delivery
        else:
            out["contradiction"] = True
    release = _read_json(Path(roots["money_receipts"]) / f"milestone-release-{pid}.json")
    if release is not None:
        if _authoritative_for(release, pid):
            out["release_receipt"] = release
        else:
            out["contradiction"] = True

    settled = []
    for row in _read_jsonl(roots["revenue_ledger"]):
        try:
            match = int(row.get("project_id") or 0) == pid
        except Exception:
            match = False
        if match and row.get("authoritative_external_settlement") is True and row.get("evidence") == "official_get_milestones_released_or_paid":
            settled.append(row)
    if settled:
        out["settlements"] = settled
    return out


def canonical_state(evidence: dict) -> str:
    if evidence.get("contradiction"):
        return "FAILED_CLOSED"
    if evidence.get("founder_gate"):
        return "FOUNDER_GATE"
    if evidence.get("settlements"):
        return "SETTLED"
    executor_state = (evidence.get("executor_state") or {}).get("state")
    if executor_state == "REVISION_REQUIRED" or evidence.get("revision_request"):
        return "REVISION_REQUIRED"
    if evidence.get("release_receipt"):
        return "SETTLEMENT_PENDING"
    if evidence.get("delivery_receipt"):
        return "DELIVERED"
    if executor_state == "DELIVERY_READY":
        return "DELIVERY_READY"
    qa = evidence.get("qa") or {}
    if qa and qa.get("green") is not True:
        return "QA_HOLD"
    if executor_state in {"EXECUTING", "RUNNING", "IN_PROGRESS"}:
        return "EXECUTING"
    job = evidence.get("job") or {}
    if job.get("status") == "AWARDED_ACCEPTED":
        if executor_state in {"WAITING_INPUT", "WAITING_FOR_INPUT"}:
            return "WAITING_INPUT"
        return "AWARDED_ACCEPTED"
    if evidence.get("accept"):
        return "AWARDED_ACCEPTED"
    if evidence.get("bid"):
        return "BID_SUBMITTED"
    return "DISCOVERING"
