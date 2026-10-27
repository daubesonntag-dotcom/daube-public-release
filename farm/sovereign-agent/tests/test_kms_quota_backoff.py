import contextlib
import importlib.util
import io
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

source = Path(__file__).resolve().parents[1] / "sovereign-kms-worker.py"
spec = importlib.util.spec_from_file_location("daube_kms_worker", source)
kms = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kms)

class QuotaCircuitBreakerTests(unittest.TestCase):
    def test_402_backoff_bounded_instead_of_hot_loop(self):
        with patch.object(kms.secrets, "randbelow", return_value=100):
            self.assertEqual([kms.poll_failure_delay(RuntimeError("kms_poll_failed:402:quota"), n)
                              for n in [1,2,3,4,5,6,7,8]],
                             [60,120,240,480,960,1920,3600,3600])
    def test_429_backoff_and_jitter_range(self):
        with patch.object(kms.secrets, "randbelow", return_value=100):
            self.assertEqual([kms.poll_failure_delay(RuntimeError("kms_poll_failed:429:rate"), n)
                              for n in [1,2,3,6]], [15,30,60,300])
        with patch.object(kms.secrets, "randbelow", return_value=0):
            self.assertEqual(kms.poll_failure_delay(RuntimeError("kms_poll_failed:402:quota"), 1), 54)
    def test_unrelated_crypto_or_auth_failures_keep_legacy_delay(self):
        self.assertLessEqual(kms.poll_failure_delay(RuntimeError("kms_key_invalid"), 5),5.0)
        self.assertLess(kms.poll_failure_delay(RuntimeError("kms_poll_failed:401:unauthorized"), 2),6)
    def test_daemon_consecutive_402_slows_and_resets_on_success(self):
        host=Mock()
        host.runtime_kind.return_value="android-termux"
        host.ensure_identity.return_value=("PUBLIC","a"*64)
        errors=[
            RuntimeError("kms_poll_failed:402:quota"),
            RuntimeError("kms_poll_failed:402:quota"),
            {"status":"NO_JOB"},
            RuntimeError("kms_poll_failed:402:quota"),
            KeyboardInterrupt()
        ]
        with patch.object(kms, "load_host_agent",return_value=host),\
             patch.object(kms, "register",return_value={"status":"KEY_REGISTERED"}),\
             patch.object(kms, "run_once",side_effect=errors),\
             patch.object(kms.secrets,"randbelow",return_value=100),\
             patch.object(kms.time,"sleep") as sleeper,\
             patch.object(sys,"argv",["kms","--daemon"]),\
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(KeyboardInterrupt):
                kms.main()
        self.assertEqual([c.args[0] for c in sleeper.call_args_list][:4],
                         [60,120,max(0.2,kms.POLL_SECONDS),60])
    def test_once_does_not_retry_or_loop(self):
        host=Mock()
        host.runtime_kind.return_value="android-termux"
        host.ensure_identity.return_value=("PUBLIC","b"*64)
        with patch.object(kms,"load_host_agent",return_value=host),\
             patch.object(kms,"register",return_value={"status":"KEY_REGISTERED"}),\
             patch.object(kms,"run_once",return_value={"status":"NO_JOB"}),\
             patch.object(kms.time,"sleep") as sleeper,\
             patch.object(sys,"argv",["kms","--once"]),\
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(kms.main(),0)
        sleeper.assert_not_called()

if __name__=="__main__":unittest.main()
