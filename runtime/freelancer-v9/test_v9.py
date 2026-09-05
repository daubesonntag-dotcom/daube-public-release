import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import contract


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


if __name__ == "__main__":
    unittest.main()
