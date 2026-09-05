import json
from pathlib import Path

from models import atomic_write_json


class ContractError(RuntimeError):
    pass


TOP_LEVEL_KEYS = {
    "version", "project_id", "title", "locked_scope", "acceptance_criteria",
    "estimated_hours", "client_inputs", "allowed_operations", "forbidden_operations",
    "required_artifacts", "mandatory_gates", "revision_allowance", "authority_evidence",
}

EXPECTED_AUTHORITY = {
    "state": "READY_FOR_EXECUTOR",
    "status": "AWARDED_ACCEPTED",
    "acceptance_guard": "STANDARD_AUTHORITY_PASS",
}


def _load_json(path: Path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ContractError(f"MISSING_AUTHORITATIVE_INPUT:{Path(path).name}") from exc
    except json.JSONDecodeError as exc:
        raise ContractError(f"INVALID_JSON:{Path(path).name}") from exc


def _load_scope(job_dir: Path):
    path = Path(job_dir) / "SCOPE.md"
    try:
        value = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError as exc:
        raise ContractError("MISSING_AUTHORITATIVE_INPUT:SCOPE.md") from exc
    if not value:
        raise ContractError("EMPTY_LOCKED_SCOPE")
    return value


def _mechanical_acceptance(scope: str):
    criteria = []
    for raw in scope.splitlines():
        line = raw.strip()
        lower = line.lower()
        if lower.startswith("acceptance:"):
            value = line.split(":", 1)[1].strip()
            if value:
                criteria.append(value)
        elif lower.startswith("acceptance criterion:"):
            value = line.split(":", 1)[1].strip()
            if value:
                criteria.append(value)
    return criteria


def validate_contract(current: dict):
    if set(current) != TOP_LEVEL_KEYS:
        return False, "INVALID_TOP_LEVEL_KEYS"
    if current["authority_evidence"] != EXPECTED_AUTHORITY:
        return False, "INVALID_AUTHORITY_EVIDENCE"
    hours = current.get("estimated_hours")
    if not isinstance(hours, int) or isinstance(hours, bool) or hours < 0 or hours > 72:
        return False, "INVALID_ESTIMATED_HOURS"
    criteria = current.get("acceptance_criteria")
    if (
        not isinstance(criteria, list)
        or not criteria
        or not all(isinstance(item, str) and item.strip() for item in criteria)
    ):
        return False, "AMBIGUOUS_ACCEPTANCE_CRITERIA"
    if current.get("revision_allowance") != 1:
        return False, "INVALID_REVISION_ALLOWANCE"
    return True, "OK"


def build_job_contract(job_dir: Path):
    job_dir = Path(job_dir)
    executor = _load_json(job_dir / "EXECUTOR_JOB.json")
    manifest = _load_json(job_dir / "job.json")
    scope = _load_scope(job_dir)

    state = executor.get("state")
    status = manifest.get("status")
    guard = manifest.get("acceptance_guard")
    if state != "READY_FOR_EXECUTOR":
        raise ContractError("READY_FOR_EXECUTOR_REQUIRED")
    if status != "AWARDED_ACCEPTED":
        raise ContractError("AUTHORITATIVE_ACCEPTANCE_REQUIRED")
    if guard != "STANDARD_AUTHORITY_PASS":
        raise ContractError("STANDARD_AUTHORITY_PASS_REQUIRED")

    hours = manifest.get("estimated_hours")
    if not isinstance(hours, int) or isinstance(hours, bool) or hours < 0 or hours > 72:
        raise ContractError("ESTIMATED_HOURS_OUT_OF_BOUNDS")

    criteria = manifest.get("acceptance_criteria")
    if criteria is None:
        criteria = _mechanical_acceptance(scope)
    if (
        not isinstance(criteria, list)
        or not criteria
        or not all(isinstance(item, str) and item.strip() for item in criteria)
    ):
        raise ContractError("AMBIGUOUS_ACCEPTANCE_CRITERIA")

    current = {
        "version": "v9-daube-execution-mesh",
        "project_id": manifest.get("project_id"),
        "title": str(manifest.get("title") or "").strip(),
        "locked_scope": scope,
        "acceptance_criteria": [item.strip() for item in criteria],
        "estimated_hours": hours,
        "client_inputs": list(manifest.get("client_inputs") or []),
        "allowed_operations": [
            "read_job_workspace",
            "write_job_workspace",
            "run_bounded_local_checks",
        ],
        "forbidden_operations": [
            "marketplace_write", "purchase", "paid_api", "credential_change",
            "payout_change", "bank_change", "tax_change", "identity_change",
            "kyc_change", "off_platform_payment",
        ],
        "required_artifacts": list(manifest.get("required_artifacts") or ["work/"]),
        "mandatory_gates": ["qa", "red_team", "worth_the_money"],
        "revision_allowance": 1,
        "authority_evidence": {
            "state": state,
            "status": status,
            "acceptance_guard": guard,
        },
    }

    ok, reason = validate_contract(current)
    if not ok:
        raise ContractError(reason)
    atomic_write_json(job_dir / "JOB_CONTRACT.json", current)
    return current
