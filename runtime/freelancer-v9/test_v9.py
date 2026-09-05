import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import adapters
import contract
import controller
import delivery
import graph
import integration
import planner
import qa
import red_team
import research
import visual
import worth_money


def make_job(path, state="READY_FOR_EXECUTOR", status="AWARDED_ACCEPTED",
             guard="STANDARD_AUTHORITY_PASS", hours=24, criteria=None,
             scope="Implement bounded CLI fix.\nAcceptance: CLI prints success.\n"):
    path = Path(path)
    (path / "EXECUTOR_JOB.json").write_text(
        json.dumps({"state": state}), encoding="utf-8"
    )
    payload = {
        "project_id": 123,
        "title": "Test job",
        "status": status,
        "acceptance_guard": guard,
        "estimated_hours": hours,
        "client_inputs": [],
    }
    if criteria is not None:
        payload["acceptance_criteria"] = criteria
    (path / "job.json").write_text(json.dumps(payload), encoding="utf-8")
    (path / "SCOPE.md").write_text(scope, encoding="utf-8")


def fixture_contract(scope="Fix backend", criteria=None):
    return {
        "version": "v9-daube-execution-mesh",
        "project_id": 1,
        "title": "fixture",
        "locked_scope": scope,
        "acceptance_criteria": criteria or ["Build succeeds"],
        "estimated_hours": 24,
        "client_inputs": [],
        "allowed_operations": [],
        "forbidden_operations": [],
        "required_artifacts": ["work/"],
        "mandatory_gates": ["qa", "red_team", "worth_the_money"],
        "revision_allowance": 1,
        "authority_evidence": {
            "state": "READY_FOR_EXECUTOR",
            "status": "AWARDED_ACCEPTED",
            "acceptance_guard": "STANDARD_AUTHORITY_PASS",
        },
    }


class ContractTests(unittest.TestCase):
    def test_contract_requires_ready_executor_state(self):
        with TemporaryDirectory() as directory:
            make_job(directory, state="DONE", criteria=["CLI prints success"])
            with self.assertRaises(contract.ContractError):
                contract.build_job_contract(Path(directory))

    def test_contract_requires_authoritative_acceptance(self):
        with TemporaryDirectory() as directory:
            make_job(directory, status="PENDING", criteria=["CLI prints success"])
            with self.assertRaises(contract.ContractError):
                contract.build_job_contract(Path(directory))

    def test_contract_rejects_over_72_hours(self):
        with TemporaryDirectory() as directory:
            make_job(directory, hours=73, criteria=["CLI prints success"])
            with self.assertRaises(contract.ContractError):
                contract.build_job_contract(Path(directory))

    def test_contract_reads_v8_authority_from_job_json(self):
        with TemporaryDirectory() as directory:
            make_job(directory, criteria=["CLI prints success"])
            result = contract.build_job_contract(Path(directory))
            self.assertEqual(result["authority_evidence"]["state"], "READY_FOR_EXECUTOR")
            self.assertEqual(result["authority_evidence"]["status"], "AWARDED_ACCEPTED")
            self.assertEqual(result["estimated_hours"], 24)

    def test_contract_mechanically_extracts_acceptance_line(self):
        with TemporaryDirectory() as directory:
            make_job(directory, criteria=None)
            result = contract.build_job_contract(Path(directory))
            self.assertEqual(result["acceptance_criteria"], ["CLI prints success."])

    def test_contract_rejects_ambiguous_scope_without_criteria(self):
        with TemporaryDirectory() as directory:
            make_job(directory, criteria=None, scope="Fix the app.")
            with self.assertRaises(contract.ContractError):
                contract.build_job_contract(Path(directory))


class GraphPlannerTests(unittest.TestCase):
    def test_frontend_scope_includes_visual_lane(self):
        result = graph.build_graph(fixture_contract(
            scope="Build a responsive Next.js dashboard with filters"
        ))
        self.assertIn("ux_visual", {node["executor_class"] for node in result["nodes"]})

    def test_backend_scope_omits_visual_lane(self):
        result = graph.build_graph(fixture_contract(
            scope="Fix FastAPI webhook signature verification"
        ))
        self.assertNotIn("ux_visual", {node["executor_class"] for node in result["nodes"]})

    def test_research_and_integration_lanes_are_demand_driven(self):
        result = graph.build_graph(fixture_contract(
            scope="Implement webhook API integration using official documentation"
        ))
        classes = {node["executor_class"] for node in result["nodes"]}
        self.assertIn("research", classes)
        self.assertIn("integration_validator", classes)

    def test_every_acceptance_criterion_maps_to_verification(self):
        current = fixture_contract(criteria=["Dashboard builds", "Filter updates results"])
        result = graph.build_graph(current)
        matrix = planner.build_acceptance_matrix(current, result)
        self.assertTrue(all(row["verification_nodes"] for row in matrix["criteria"]))

    def test_cycle_detection(self):
        bad = {"nodes": [
            {"id": "a", "depends_on": ["b"]},
            {"id": "b", "depends_on": ["a"]},
        ]}
        with self.assertRaises(graph.GraphError):
            graph.topological_order(bad)


class AdapterTests(unittest.TestCase):
    def test_codex_adapter_never_receives_marketplace_authority(self):
        task = {"id": "implementation-1", "scope": "Fix component"}
        command = adapters.CodexAdapter("/usr/bin/codex").build_command(
            task, Path("/tmp/job/work"), {}
        )
        joined = " ".join(command)
        self.assertNotIn("Freelancer", joined)
        self.assertNotIn("milestone", joined.lower())
        self.assertNotIn("payment", joined.lower())

    def test_missing_runtime_fails_closed(self):
        self.assertIsNone(adapters.select_adapter("implementation", which=lambda _: None))

    def test_non_model_lane_is_not_routed_to_codex(self):
        self.assertIsNone(adapters.select_adapter("qa", which=lambda _: "/usr/bin/codex"))


class QATests(unittest.TestCase):
    def test_qa_requires_command_and_artifact(self):
        self.assertFalse(qa.evaluate([], [])["green"])

    def test_artifact_inventory_excludes_secrets(self):
        with TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "app.py").write_text("print('ok')", encoding="utf-8")
            (path / ".env").write_text("SECRET=x", encoding="utf-8")
            (path / "private_key.pem").write_text("key", encoding="utf-8")
            paths = [item["path"] for item in qa.inventory_artifacts(path)]
            self.assertIn("app.py", paths)
            self.assertNotIn(".env", paths)
            self.assertNotIn("private_key.pem", paths)

    def test_node_check_discovery_uses_existing_scripts_only(self):
        with TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "package.json").write_text(json.dumps({
                "scripts": {"test": "vitest", "build": "vite build"}
            }), encoding="utf-8")
            checks = qa.discover_checks(path, fixture_contract())
            self.assertIn(["npm", "run", "test"], checks)
            self.assertIn(["npm", "run", "build"], checks)
            self.assertNotIn(["npm", "run", "lint"], checks)


class IntegrationTests(unittest.TestCase):
    def test_webhook_scope_requires_integration(self):
        self.assertTrue(integration.requires_integration(
            fixture_contract(scope="Build webhook API integration")
        ))

    def test_required_integration_without_fixture_fails_closed(self):
        with TemporaryDirectory() as directory:
            result = integration.validate_integration(
                Path(directory), fixture_contract(scope="Build webhook API integration")
            )
            self.assertEqual(result["classification"], "WAITING_FOR_INPUT")


class VisualTests(unittest.TestCase):
    def test_frontend_requires_visual_evidence(self):
        self.assertTrue(visual.requires_visual_lane(
            fixture_contract(scope="Responsive React dashboard")
        ))

    def test_required_visual_without_tool_does_not_pass(self):
        with TemporaryDirectory() as directory:
            result = visual.inspect_visual(
                Path(directory), fixture_contract(scope="Responsive React dashboard"), tools={}
            )
            self.assertEqual(result["classification"], "RETRYABLE_FAIL")


class ResearchTests(unittest.TestCase):
    def test_rag_scope_requires_research(self):
        self.assertTrue(research.requires_research(
            fixture_contract(scope="Build RAG assistant from API documentation")
        ))

    def test_required_research_without_sources_waits(self):
        with TemporaryDirectory() as directory:
            result = research.collect_research(
                Path(directory),
                fixture_contract(scope="Build RAG assistant from API documentation"),
            )
            self.assertEqual(result["classification"], "WAITING_FOR_INPUT")


class ReviewGateTests(unittest.TestCase):
    def test_red_team_vetoes_secret_artifact(self):
        report = red_team.review(
            fixture_contract(),
            {"criteria": [{"criterion_id": "AC-001", "status": "PASS"}]},
            [{"path": ".env", "sha256": "x"}],
            {"green": True},
        )
        self.assertEqual(report["classification"], "RETRYABLE_FAIL")

    def test_worth_money_requires_all_five_passes(self):
        result = worth_money.evaluate({
            "criteria_satisfied": True,
            "artifacts_work": True,
            "mandatory_gates_green": True,
            "edge_cases_addressed": True,
            "handoff_accurate": False,
        })
        self.assertFalse(result["pass"])
        self.assertEqual(len(result["questions"]), 5)

    def test_delivery_requires_worth_money_pass(self):
        with TemporaryDirectory() as directory:
            with self.assertRaises(delivery.DeliveryError):
                delivery.compose_delivery(
                    Path(directory), fixture_contract(),
                    artifacts=[{"path": "app.py", "sha256": "abc", "bytes": 1}],
                    acceptance_matrix={"criteria": []},
                    qa_report={"green": True},
                    red_team_report={"classification": "PASS"},
                    worth_money_report={"pass": False},
                )


class FakeImplementationAdapter:
    def __init__(self, fail_times=0):
        self.calls = 0
        self.fail_times = fail_times

    def execute(self, task, workspace, constraints):
        self.calls += 1
        Path(workspace).mkdir(parents=True, exist_ok=True)
        if self.calls <= self.fail_times:
            return {
                "runtime": "fake", "node_id": task["id"],
                "classification": "RETRYABLE_FAIL", "returncode": 1,
                "stdout_excerpt": "", "stderr_excerpt": "synthetic fail",
            }
        (Path(workspace) / "app.py").write_text("print('ok')\n", encoding="utf-8")
        return {
            "runtime": "fake", "node_id": task["id"],
            "classification": "PASS", "returncode": 0,
            "stdout_excerpt": "ok", "stderr_excerpt": "",
        }


def green_qa(workspace, current_contract):
    artifacts = qa.inventory_artifacts(workspace)
    return {
        "green": bool(artifacts),
        "commands": [{"command": ["synthetic-check"], "exit_code": 0}],
        "artifacts": artifacts,
        "checks_applicable": True,
        "commands_green": True,
        "artifacts_present": bool(artifacts),
    }


class ControllerTests(unittest.TestCase):
    def _job(self, directory, scope="Fix backend CLI", criteria=None):
        if criteria is None:
            scope += "\nAcceptance: Build succeeds.\n"
        make_job(directory, criteria=criteria, scope=scope)

    def test_bounded_fixture_reaches_delivery_ready(self):
        with TemporaryDirectory() as directory:
            self._job(directory)
            result = controller.run_job(
                Path(directory),
                implementation_adapter=FakeImplementationAdapter(),
                qa_runner=green_qa,
            )
            self.assertEqual(result["state"], "DELIVERY_READY")
            self.assertTrue((Path(directory) / "delivery" / "manifest.json").exists())

    def test_implementation_repairs_once_then_reverifies(self):
        with TemporaryDirectory() as directory:
            self._job(directory)
            adapter = FakeImplementationAdapter(fail_times=1)
            result = controller.run_job(
                Path(directory), implementation_adapter=adapter, qa_runner=green_qa
            )
            self.assertEqual(result["state"], "DELIVERY_READY")
            self.assertEqual(adapter.calls, 2)

    def test_repeated_implementation_failure_stops(self):
        with TemporaryDirectory() as directory:
            self._job(directory)
            adapter = FakeImplementationAdapter(fail_times=99)
            result = controller.run_job(
                Path(directory), implementation_adapter=adapter, qa_runner=green_qa
            )
            self.assertEqual(result["state"], "RETRYABLE_FAIL")
            self.assertEqual(adapter.calls, 3)

    def test_delivery_ready_is_idempotent(self):
        with TemporaryDirectory() as directory:
            self._job(directory)
            first = controller.run_job(
                Path(directory),
                implementation_adapter=FakeImplementationAdapter(),
                qa_runner=green_qa,
            )
            second_adapter = FakeImplementationAdapter()
            second = controller.run_job(
                Path(directory), implementation_adapter=second_adapter, qa_runner=green_qa
            )
            self.assertEqual(first["state"], "DELIVERY_READY")
            self.assertEqual(second["state"], "DELIVERY_READY")
            self.assertEqual(second_adapter.calls, 0)


if __name__ == "__main__":
    unittest.main()
