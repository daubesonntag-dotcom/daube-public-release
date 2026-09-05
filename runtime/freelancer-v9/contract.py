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


def validate_contract(contract: dict):
    if set(contract) != TOP_LEVEL_KEYS:
        return False, "INVALID_TOP_LEVEL_KEYS"
    if contract["authority_evidence"] != {
        "status": "AWARDED_ACCEPTED",
        "acceptance_guard": "STANDARD_AUTHORITY_PASS",
    }:
        return False, "INVALID_AUTHORITY_EVIDENCE"
    hours = contract.get("estimated_hours")
    if not isinstance(hours, int) or isinstance(hours, bool) or hours < 0 or hours > 72:
        return False, "INVALID_ESTIMATED_HOURS"
    criteria = contract.get("acceptance_criteria")
    if not isinstance(criteria, list) or not criteria or not all(
        isinstance(item, str) and item.strip() for item in criteria
    ):
        return False, "AMBIGUOUS_ACCEPTANCE_CRITERIA"
    if contract.get("revision_allowance") != 1:
        return False, "INVALID_REVISION_ALLOWANCE"
    return True, "OK"


def build_job_contract(job_dir: Path):
    job_dir = Path(job_dir)
    executor = _load_json(job_dir / "EXECUTOR_JOB.json")
    fallback = _load_json(job_dir / "job.json")

    status = executor.get("status")
    guard = executor.get("acceptance_guard")
    if status != "AWARDED_ACCEPTED":
        raise ContractError("AUTHORITATIVE_ACCEPTANCE_REQUIRED")
    if guard != "STANDARD_AUTHORITY_PASS":
        raise ContractError("STANDARD_AUTHORITY_PASS_REQUIRED")

    hours = executor.get("estimated_hours")
    if not isinstance(hours, int) or isinstance(hours, bool) or hours < 0 or hours > 72:
        raise ContractError("ESTIMATED_HOURS_OUT_OF_BOUNDS")

    criteria = executor.get("acceptance_criteria")
    if not isinstance(criteria, list) or not criteria or not all(
        isinstance(item, str) and item.strip() for item in criteria
    ):
        raise ContractError("AMBIGUOUS_ACCEPTANCE_CRITERIA")

    contract = {
        "version": "v9-daube-execution-mesh",
        "project_id": executor.get("project_id", fallback.get("project_id")),
        "title": executor.get("title", fallback.get("title", "")).strip(),
        "locked_scope": _load_scope(job_dir),
        "acceptance_criteria": [item.strip() for item in criteria],
        "estimated_hours": hours,
        "client_inputs": list(executor.get("client_inputs") or []),
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
        "required_artifacts": list(executor.get("required_artifacts") or ["work/"]),
        "mandatory_gates": ["qa", "red_team", "worth_the_money"],
        "revision_allowance": 1,
        "authority_evidence": {
            "status": status,
            "acceptance_guard": guard,
        },
    }

    ok, reason = validate_contract(contract)
    if not ok:
        raise ContractError(reason)
    atomic_write_json(job_dir / "JOB_CONTRACT.json", contract)
    return contract
