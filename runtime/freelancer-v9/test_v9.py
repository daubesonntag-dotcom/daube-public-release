import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import contract
import graph
import planner


def make_job(path, status="AWARDED_ACCEPTED", guard="STANDARD_AUTHORITY_PASS", hours=24, criteria=None):
    path = Path(path)
    (path / "EXECUTOR_JOB.json").write_text(json.dumps({
        "project_id": 123,
        "title": "Test job",
        "status": status,
        "acceptance_guard": guard,
        "estimated_hours": hours,
        "acceptance_criteria": criteria or ["CLI prints success"],
        "client_inputs": [],
    }), encoding="utf-8")
    (path / "job.json").write_text(json.dumps({
        "project_id": 123,
        "title": "Test job",
    }), encoding="utf-8")
    (path / "SCOPE.md").write_text(
        "Implement bounded CLI fix.\nAcceptance: CLI prints success.\n",
        encoding="utf-8",
    )


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
            "status": "AWARDED_ACCEPTED",
            "acceptance_guard": "STANDARD_AUTHORITY_PASS",
        },
    }


class ContractTests(unittest.TestCase):
    def test_contract_requires_authoritative_acceptance(self):
        with TemporaryDirectory() as directory:
            make_job(directory, status="PENDING")
            with self.assertRaises(contract.ContractError):
                contract.build_job_contract(Path(directory))

    def test_contract_rejects_over_72_hours(self):
        with TemporaryDirectory() as directory:
            make_job(directory, hours=73)
            with self.assertRaises(contract.ContractError):
                contract.build_job_contract(Path(directory))

    def test_contract_has_exact_top_level_keys(self):
        with TemporaryDirectory() as directory:
            make_job(directory)
            result = contract.build_job_contract(Path(directory))
            self.assertEqual(set(result), {
                "version", "project_id", "title", "locked_scope", "acceptance_criteria",
                "estimated_hours", "client_inputs", "allowed_operations", "forbidden_operations",
                "required_artifacts", "mandatory_gates", "revision_allowance", "authority_evidence",
            })
            self.assertEqual(result["revision_allowance"], 1)


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

    def test_every_acceptance_criterion_maps_to_verification(self):
        current = fixture_contract(criteria=["Dashboard builds", "Filter updates results"])
        result = graph.build_graph(current)
        matrix = planner.build_acceptance_matrix(current, result)
        self.assertTrue(all(row["verification_nodes"] for row in matrix["criteria"]))

    def test_cycle_detection(self):
        bad = {
            "nodes": [
                {"id": "a", "depends_on": ["b"]},
                {"id": "b", "depends_on": ["a"]},
            ]
        }
        with self.assertRaises(graph.GraphError):
            graph.topological_order(bad)


if __name__ == "__main__":
    unittest.main()
