import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import run as runtime_runner


class RuntimeTests(unittest.TestCase):
    def test_runner_only_selects_ready_nonterminal_jobs(self):
        with TemporaryDirectory() as directory:
            jobs = Path(directory)

            ready = jobs / "1"
            ready.mkdir()
            (ready / "EXECUTOR_JOB.json").write_text(
                json.dumps({"state": "READY_FOR_EXECUTOR"}), encoding="utf-8"
            )

            done = jobs / "2"
            done.mkdir()
            (done / "EXECUTOR_JOB.json").write_text(
                json.dumps({"state": "DONE"}), encoding="utf-8"
            )

            delivery_ready = jobs / "3"
            delivery_ready.mkdir()
            (delivery_ready / "EXECUTOR_JOB.json").write_text(
                json.dumps({"state": "READY_FOR_EXECUTOR"}), encoding="utf-8"
            )
            (delivery_ready / "v9-state.json").write_text(
                json.dumps({"state": "DELIVERY_READY"}), encoding="utf-8"
            )

            selected = {path.name for path in runtime_runner.eligible_jobs(jobs)}
            self.assertEqual(selected, {"1"})


if __name__ == "__main__":
    unittest.main()
