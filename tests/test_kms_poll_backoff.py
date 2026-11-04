"""Regression tests for the existing sovereign KMS worker (no network or keys)."""
from __future__ import annotations

import importlib.util
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
V1 = ROOT / "farm/sovereign-agent/sovereign-kms-worker.py"
spec = importlib.util.spec_from_file_location("kms_worker_under_test", V1)
kms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kms)


class KmsPollBackoffTests(unittest.TestCase):
    def test_repeated_wrapped_422_must_not_spin(self):
        error = RuntimeError("kms_poll_failed:422:rest_get_503")
        self.assertGreaterEqual(kms.retry_delay_seconds(error, 1, random_value=0.5), 30.0)
        self.assertGreaterEqual(kms.retry_delay_seconds(error, 3, random_value=0.5), 120.0)

    def test_retry_cap_and_shorter_transient_backoff(self):
        permanent = RuntimeError("kms_poll_failed:401:host_binding_invalid")
        self.assertLessEqual(kms.retry_delay_seconds(permanent, 100, random_value=1.0), 900.0)
        transient = RuntimeError("kms_poll_failed:503:overloaded")
        self.assertLess(kms.retry_delay_seconds(transient, 1, random_value=0.5), 30.0)

    def test_daemon_does_not_issue_next_poll_on_failure_immediately(self):
        delays = []
        def interrupting_sleep(delay):
            delays.append(delay)
            raise KeyboardInterrupt()
        with patch.object(kms, "run_once", side_effect=RuntimeError("kms_poll_failed:422:rest_get_503")), \
                patch.object(kms.time, "sleep", side_effect=interrupting_sleep), \
                patch("builtins.print"):
            with self.assertRaises(KeyboardInterrupt):
                kms.run_daemon(object(), "pub", "abc", {"schema": "test"})
        self.assertEqual(len(delays), 1)
        self.assertGreaterEqual(delays[0], 20)


    def test_error_backoff_resets_after_healthy_poll(self):
        """Failing, healthy, failing should back off 30s then idle then 30s."""
        delays = []
        outcomes = [
            RuntimeError("kms_poll_failed:422:rest_get_503"),
            {"status": "NO_JOB", "retryAfterMilliseconds": 750},
            RuntimeError("kms_poll_failed:422:rest_get_503"),
        ]
        def bounded_sleep(delay):
            delays.append(delay)
            if len(delays) == 3:
                raise KeyboardInterrupt()
        with patch.object(kms, "run_once", side_effect=outcomes), \
                patch.object(kms.time, "sleep", side_effect=bounded_sleep), \
                patch("builtins.print"):
            with self.assertRaises(KeyboardInterrupt):
                kms.run_daemon(object(), "pub", "abc", {"schema": "test"})
        self.assertEqual(len(delays), 3)
        self.assertGreaterEqual(delays[0], 20)
        self.assertLess(delays[1], 2.0)
        self.assertGreaterEqual(delays[2], 20)
        self.assertLess(delays[2], 60)

    def test_v2_reuses_exact_v1_safe_daemon(self):
        v2 = (ROOT / "farm/sovereign-agent/sovereign-kms-worker-v2.py").read_text()
        self.assertIn("return kms.run_daemon(host, public_pem, fingerprint, summary)", v2)



if __name__ == "__main__":
    unittest.main()
