import importlib.util
import pathlib
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / "farm" / "sovereign-agent" / "sovereign-kms-worker.py"
SPEC = importlib.util.spec_from_file_location("daube_sovereign_kms_worker_under_test", SOURCE)
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class SovereignKmsPollCadenceTest(unittest.TestCase):
    def test_invalid_poll_contract_422_uses_long_cooldown(self):
        self.assertGreaterEqual(worker.retry_delay_seconds("kms_poll_failed:422:invalid_host", 1), 600)

    def test_transient_errors_backoff_exponentially_with_cap(self):
        samples = [worker.retry_delay_seconds("kms_poll_failed:503:unavailable", n) for n in (1, 2, 3, 20)]
        self.assertGreater(samples[1], samples[0])
        self.assertGreater(samples[2], samples[1])
        self.assertLessEqual(samples[-1], 300)

    def test_idle_polls_have_floor_and_ceiling(self):
        self.assertGreaterEqual(worker.idle_delay_seconds(1, 750), 10)
        self.assertLessEqual(worker.idle_delay_seconds(100, 750), 60)

    def test_daemon_no_job_uses_bounded_idle_sleep(self):
        from unittest.mock import patch
        observed = []
        class StopLoop(Exception):
            pass
        def stop_sleep(seconds):
            observed.append(seconds)
            raise StopLoop
        with patch.object(worker, "run_once", return_value={"status": "NO_JOB", "retryAfterMilliseconds": 750}), \
             patch.object(worker.time, "sleep", side_effect=stop_sleep):
            with self.assertRaises(StopLoop):
                worker.run_daemon(object(), "public", "fingerprint", {})
        self.assertGreaterEqual(observed[0], 10.0)

    def test_success_resets_error_streak(self):
        self.assertLess(worker.retry_delay_seconds("kms_poll_failed:503:temporary", 1),
                        worker.retry_delay_seconds("kms_poll_failed:503:temporary", 4))


if __name__ == "__main__":
    unittest.main()
