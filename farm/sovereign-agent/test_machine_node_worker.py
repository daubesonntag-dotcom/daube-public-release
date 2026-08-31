from __future__ import annotations

import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
WORKER_PATH = HERE / "machine-node-worker.py"


def load_worker():
    spec = importlib.util.spec_from_file_location("daube_machine_node_worker", WORKER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("worker_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MachineNodeWorkerContractTests(unittest.TestCase):
    def setUp(self):
        self.worker = load_worker()

    def test_challenge_is_fail_closed(self):
        valid = {
            "ok": True,
            "status": "CHALLENGE_ISSUED",
            "challenge": {
                "schema": self.worker.CHALLENGE_SCHEMA,
                "challengeId": "a" * 64,
                "seedHex": "b" * 64,
                "iterations": 4096,
                "commandsFixed": True,
                "remoteShellAllowed": False,
                "paidSpendAuthorized": False,
            },
        }
        accepted = self.worker.validate_challenge(valid)
        self.assertEqual(accepted["iterations"], 4096)
        for patch in (
            {"commandsFixed": False},
            {"remoteShellAllowed": True},
            {"paidSpendAuthorized": True},
            {"iterations": 20000},
        ):
            candidate = {**valid, "challenge": {**valid["challenge"], **patch}}
            with self.assertRaises(RuntimeError):
                self.worker.validate_challenge(candidate)

    def test_tools_are_bound_to_termux_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "data" / "data" / "com.termux" / "files" / "usr"
            bin_dir = prefix / "bin"
            bin_dir.mkdir(parents=True)
            node = bin_dir / "node"
            node.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            node.chmod(node.stat().st_mode | stat.S_IXUSR)
            with mock.patch.dict(os.environ, {"PREFIX": str(prefix)}, clear=False):
                self.assertEqual(Path(self.worker.termux_tool("node")), node.resolve())
                with self.assertRaises(RuntimeError):
                    self.worker.termux_tool("missing")

    def test_versions_and_digest_use_only_fixed_absolute_tools(self):
        mapping = {
            "/termux/bin/node --version": "v22.16.0",
            "/termux/bin/npm --version": "10.9.2",
            "/termux/bin/git --version": "git version 2.50.1",
        }
        calls: list[list[str]] = []

        def fake_tool(name: str) -> str:
            return f"/termux/bin/{name}"

        def fake_run(argv: list[str], timeout: int = 10) -> str:
            calls.append(argv)
            key = " ".join(argv)
            if key in mapping:
                return mapping[key]
            if argv[:2] == ["/termux/bin/node", "-e"]:
                return "c" * 64
            raise AssertionError(argv)

        with mock.patch.object(self.worker, "termux_tool", side_effect=fake_tool), mock.patch.object(self.worker, "run_fixed", side_effect=fake_run):
            node, node_version, npm_version, git_version = self.worker.software_versions()
            digest = self.worker.compute_node_digest(node, "a" * 64, 4096)
        self.assertEqual((node_version, npm_version, git_version), ("v22.16.0", "10.9.2", "git version 2.50.1"))
        self.assertEqual(digest, "c" * 64)
        self.assertTrue(all(call[0].startswith("/termux/bin/") for call in calls))
        self.assertNotIn("bash", {Path(call[0]).name for call in calls})
        self.assertNotIn("sh", {Path(call[0]).name for call in calls})

    def test_result_cannot_claim_private_paid_or_shell_execution(self):
        result = self.worker.build_result(
            "sovereign-" + "a" * 20,
            {"challengeId": "b" * 64},
            "v22.16.0",
            "10.9.2",
            "git version 2.50.1",
            "c" * 64,
        )
        self.assertIs(result["privateAssetsUsed"], False)
        self.assertIs(result["paidSpendAuthorized"], False)
        self.assertIs(result["remoteShellUsed"], False)
        self.assertIs(result["commandsFixed"], True)

    def test_source_contains_no_generic_remote_execution_primitive(self):
        source = WORKER_PATH.read_text(encoding="utf-8")
        self.assertNotIn("shell=True", source)
        self.assertNotIn("os.system(", source)
        self.assertNotIn("subprocess.Popen", source)
        self.assertNotIn("eval(", source)
        self.assertNotIn("exec(", source)
        self.assertIn('termux_tool("node")', source)
        self.assertIn('termux_tool("npm")', source)
        self.assertIn('termux_tool("git")', source)


if __name__ == "__main__":
    unittest.main()
