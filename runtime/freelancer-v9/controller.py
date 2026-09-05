import json
from pathlib import Path

import adapters
import contract as contract_mod
import delivery
import graph as graph_mod
import integration
import planner
import qa
import red_team
import research
import visual
import worth_money
from models import atomic_write_json, transition


def _read_state(job_dir: Path):
    path = Path(job_dir) / "v9-state.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_evidence(job_dir: Path, name: str, payload: dict):
    path = Path(job_dir) / "evidence" / name
    atomic_write_json(path, payload)
    return str(path)


def _class_to_state(classification: str):
    if classification == "WAITING_FOR_INPUT":
        return "WAITING_FOR_INPUT"
    if classification == "HOLD_FOUNDER_GATE":
        return "HOLD_FOUNDER_GATE"
    return "RETRYABLE_FAIL"


def _required_input_missing(current_contract: dict):
    for item in current_contract.get("client_inputs") or []:
        if (
            isinstance(item, dict)
            and item.get("required") is True
            and item.get("provided") is not True
        ):
            return True
    return False


def _mark_acceptance_pre_review(
    matrix: dict,
    execution_graph: dict,
    qa_report: dict,
    integration_report: dict,
    visual_report: dict,
):
    nodes = {node["id"]: node for node in execution_graph.get("nodes") or []}
    for row in matrix.get("criteria") or []:
        passed = qa_report.get("green") is True
        for node_id in row.get("verification_nodes") or []:
            executor_class = nodes.get(node_id, {}).get("executor_class")
            if (
                executor_class == "integration_validator"
                and integration_report.get("classification") != "PASS"
            ):
                passed = False
            if (
                executor_class == "ux_visual"
                and visual_report.get("classification") != "PASS"
            ):
                passed = False
        row["status"] = "PASS" if passed else "PENDING"
    return matrix


def run_job(
    job_dir: Path,
    *,
    implementation_adapter=None,
    qa_runner=None,
    visual_tools=None,
):
    job_dir = Path(job_dir)
    existing = _read_state(job_dir)
    if (
        existing
        and existing.get("state") == "DELIVERY_READY"
        and (job_dir / "delivery" / "manifest.json").exists()
    ):
        return existing

    try:
        current_contract = contract_mod.build_job_contract(job_dir)
    except contract_mod.ContractError as exc:
        reason = str(exc)
        target = "WAITING_FOR_INPUT" if (
            "AMBIGUOUS" in reason or "MISSING_AUTHORITATIVE_INPUT" in reason
        ) else "HOLD_FOUNDER_GATE"
        return transition(job_dir, target, reason=reason)

    if _required_input_missing(current_contract):
        return transition(
            job_dir,
            "WAITING_FOR_INPUT",
            reason="MISSING_REQUIRED_CLIENT_INPUT",
        )

    transition(job_dir, "PLANNING")
    execution_graph = graph_mod.build_graph(current_contract)
    acceptance_matrix = planner.build_acceptance_matrix(current_contract, execution_graph)
    atomic_write_json(job_dir / "EXECUTION_GRAPH.json", execution_graph)
    atomic_write_json(job_dir / "ACCEPTANCE_MATRIX.json", acceptance_matrix)

    research_report = research.collect_research(job_dir / "work", current_contract)
    _write_evidence(job_dir, "research-report.json", research_report)
    if research_report.get("classification") != "PASS":
        return transition(
            job_dir,
            _class_to_state(research_report.get("classification")),
            reason=research_report.get("reason"),
            evidence=["evidence/research-report.json"],
        )

    transition(job_dir, "EXECUTING_MESH")
    adapter = implementation_adapter or adapters.select_adapter("implementation")
    if adapter is None:
        return transition(
            job_dir,
            "HOLD_FOUNDER_GATE",
            reason="IMPLEMENTATION_RUNTIME_UNAVAILABLE",
        )

    implementation_node = next(
        node for node in execution_graph["nodes"]
        if node["executor_class"] == "implementation"
    )
    work_dir = job_dir / "work"
    max_attempts = int(implementation_node.get("max_attempts", 3))
    for attempt in range(1, max_attempts + 1):
        task = {
            "id": implementation_node["id"],
            "scope": current_contract["locked_scope"],
            "attempt": attempt,
            "acceptance_criteria": current_contract["acceptance_criteria"],
        }
        implementation_result = adapter.execute(
            task,
            work_dir,
            {"timeout_seconds": 1800, "attempt": attempt},
        )
        implementation_result["attempt"] = attempt
        _write_evidence(
            job_dir,
            f"implementation-attempt-{attempt}.json",
            implementation_result,
        )
        classification = implementation_result.get("classification")
        if classification == "PASS":
            break
        if classification in {"WAITING_FOR_INPUT", "HOLD_FOUNDER_GATE"}:
            return transition(
                job_dir,
                _class_to_state(classification),
                reason=f"IMPLEMENTATION_{classification}",
                evidence=[f"evidence/implementation-attempt-{attempt}.json"],
            )
    else:
        return transition(
            job_dir,
            "RETRYABLE_FAIL",
            reason="IMPLEMENTATION_RETRY_LIMIT",
            evidence=[f"evidence/implementation-attempt-{max_attempts}.json"],
        )

    integration_report = integration.validate_integration(work_dir, current_contract)
    _write_evidence(job_dir, "integration-report.json", integration_report)
    if integration_report.get("classification") != "PASS":
        return transition(
            job_dir,
            _class_to_state(integration_report.get("classification")),
            reason=integration_report.get("reason"),
            evidence=["evidence/integration-report.json"],
        )

    transition(job_dir, "QA_REVIEW")
    effective_qa_runner = qa_runner or qa.execute_qa
    qa_report = effective_qa_runner(work_dir, current_contract)
    _write_evidence(job_dir, "qa-report.json", qa_report)
    if not qa_report.get("green"):
        return transition(
            job_dir,
            "QA_FAILED",
            reason="MANDATORY_QA_NOT_GREEN",
            evidence=["evidence/qa-report.json"],
        )

    visual_report = visual.inspect_visual(work_dir, current_contract, visual_tools or {})
    _write_evidence(job_dir, "visual-report.json", visual_report)
    if visual_report.get("classification") != "PASS":
        return transition(
            job_dir,
            _class_to_state(visual_report.get("classification")),
            reason=visual_report.get("reason"),
            evidence=["evidence/visual-report.json"],
        )

    acceptance_matrix = _mark_acceptance_pre_review(
        acceptance_matrix,
        execution_graph,
        qa_report,
        integration_report,
        visual_report,
    )
    atomic_write_json(job_dir / "ACCEPTANCE_MATRIX.json", acceptance_matrix)

    transition(job_dir, "RED_TEAM_REVIEW")
    artifacts = qa_report.get("artifacts") or qa.inventory_artifacts(work_dir)
    red_report = red_team.review(
        current_contract,
        acceptance_matrix,
        artifacts,
        qa_report,
    )
    _write_evidence(job_dir, "red-team-report.json", red_report)
    if red_report.get("classification") != "PASS":
        return transition(
            job_dir,
            "RETRYABLE_FAIL",
            reason="RED_TEAM_VETO",
            evidence=["evidence/red-team-report.json"],
        )

    transition(job_dir, "WORTH_THE_MONEY_REVIEW")
    criteria_satisfied = bool(acceptance_matrix.get("criteria")) and all(
        row.get("status") == "PASS" for row in acceptance_matrix["criteria"]
    )
    worth_report = worth_money.evaluate({
        "criteria_satisfied": criteria_satisfied,
        "artifacts_work": qa_report.get("green") is True and bool(artifacts),
        "mandatory_gates_green": (
            qa_report.get("green") is True
            and integration_report.get("classification") == "PASS"
            and visual_report.get("classification") == "PASS"
            and red_report.get("classification") == "PASS"
        ),
        "edge_cases_addressed": red_report.get("classification") == "PASS",
        "handoff_accurate": (
            criteria_satisfied and red_report.get("classification") == "PASS"
        ),
        "evidence_refs": {
            "criteria_satisfied": ["ACCEPTANCE_MATRIX.json"],
            "artifacts_work": ["evidence/qa-report.json"],
            "mandatory_gates_green": [
                "evidence/qa-report.json",
                "evidence/integration-report.json",
                "evidence/visual-report.json",
                "evidence/red-team-report.json",
            ],
            "edge_cases_addressed": ["evidence/red-team-report.json"],
            "handoff_accurate": [
                "ACCEPTANCE_MATRIX.json",
                "evidence/red-team-report.json",
            ],
        },
    })
    _write_evidence(job_dir, "WORTH_THE_MONEY.json", worth_report)
    if not worth_report.get("pass"):
        return transition(
            job_dir,
            "RETRYABLE_FAIL",
            reason="WORTH_THE_MONEY_VETO",
            evidence=["evidence/WORTH_THE_MONEY.json"],
        )

    delivery.compose_delivery(
        job_dir,
        current_contract,
        artifacts=artifacts,
        acceptance_matrix=acceptance_matrix,
        qa_report=qa_report,
        red_team_report=red_report,
        worth_money_report=worth_report,
    )
    return transition(
        job_dir,
        "DELIVERY_READY",
        evidence=[
            "delivery/manifest.json",
            "ACCEPTANCE_MATRIX.json",
            "evidence/qa-report.json",
            "evidence/red-team-report.json",
            "evidence/WORTH_THE_MONEY.json",
        ],
    )
