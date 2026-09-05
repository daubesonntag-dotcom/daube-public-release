from pathlib import Path

from models import atomic_write_json


class DeliveryError(RuntimeError):
    pass


def compose_delivery(
    job_dir: Path,
    contract: dict,
    *,
    artifacts: list,
    acceptance_matrix: dict,
    qa_report: dict,
    red_team_report: dict,
    worth_money_report: dict,
):
    if not worth_money_report.get("pass"):
        raise DeliveryError("WORTH_THE_MONEY_REQUIRED")
    if not qa_report.get("green"):
        raise DeliveryError("QA_GREEN_REQUIRED")
    if red_team_report.get("classification") != "PASS":
        raise DeliveryError("RED_TEAM_PASS_REQUIRED")
    if not artifacts:
        raise DeliveryError("ARTIFACTS_REQUIRED")

    job_dir = Path(job_dir)
    delivery_dir = job_dir / "delivery"
    delivery_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": "v9-daube-execution-mesh",
        "project_id": contract.get("project_id"),
        "artifacts": artifacts,
        "qa_green": True,
        "red_team": "PASS",
        "worth_the_money": "PASS",
        "marketplace_action_performed": False,
        "revenue_claimed": False,
    }
    atomic_write_json(delivery_dir / "manifest.json", manifest)
    atomic_write_json(delivery_dir / "acceptance-traceability.json", acceptance_matrix)

    handoff = (
        "# D’AUBE Delivery Handoff\n\n"
        f"Project: {contract.get('title', '')}\n\n"
        f"Scope: {contract.get('locked_scope', '')}\n\n"
        "All listed artifacts passed the recorded mandatory V9 gates. "
        "This package does not itself submit to a marketplace or claim settlement/revenue.\n"
    )
    (delivery_dir / "HANDOFF.md").write_text(handoff, encoding="utf-8")
    (delivery_dir / "CLIENT_DELIVERY_DRAFT.md").write_text(
        "Delivery package prepared with acceptance traceability and QA evidence. "
        "Official marketplace delivery remains controlled by Money Closure.\n",
        encoding="utf-8",
    )
    return manifest
