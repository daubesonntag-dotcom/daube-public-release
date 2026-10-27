import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name, filename):
    path=ROOT / "farm/sovereign-agent" / filename
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
class StopDaemon(BaseException): pass
class DummyHost:
    def require_runtime(self): return None
    def runtime_kind(self): return "android-termux"
    def ensure_identity(self): return ("public-pem","f"*64)
class QuotaBackoffTests(unittest.TestCase):
    def test_supabase_402_long_cooldown(self):
        kms=load("kms_v1_backoff","sovereign-kms-worker.py")
        self.assertEqual(kms.retry_delay_seconds(RuntimeError("kms_poll_failed:402:exceed_egress_quota"),1),1800)
        self.assertEqual(kms.retry_delay_seconds(RuntimeError("kms_register_failed:402:restricted"),30),1800)
    def test_429_403_and_transient(self):
        kms=load("kms_v1_codes","sovereign-kms-worker.py")
        self.assertEqual(kms.retry_delay_seconds(RuntimeError("kms_poll_failed:429:rate"),1),300)
        self.assertEqual(kms.retry_delay_seconds(RuntimeError("kms_poll_failed:403:access"),1),900)
        self.assertEqual(kms.retry_delay_seconds(RuntimeError("network reset"),3),8)
        self.assertEqual(kms.retry_delay_seconds(RuntimeError("network reset"),800),120)
    def test_v1_daemon_waits_after_quota_without_real_http(self):
        kms=load("kms_v1_daemon","sovereign-kms-worker.py")
        delays=[]
        def stop_after_sleep(value):
            delays.append(value);raise StopDaemon()
        with patch.object(kms,"load_host_agent",return_value=DummyHost()),patch.object(kms,"register_with_retries",return_value={"status":"KEY_REGISTERED"}),patch.object(kms,"run_once",side_effect=RuntimeError("kms_poll_failed:402:quota")),patch.object(kms.time,"sleep",side_effect=stop_after_sleep),patch.object(sys,"argv",["kms","--daemon"]):
            with self.assertRaises(StopDaemon):kms.main()
        self.assertEqual(delays,[1800])
    def test_v2_daemon_inherits_same_policy(self):
        kms=load("kms_v1_v2","sovereign-kms-worker.py")
        v2=load("kms_v2_daemon","sovereign-kms-worker-v2.py")
        delays=[]
        def stop_after_sleep(seconds):
            delays.append(seconds);raise StopDaemon()
        with patch.object(v2,"load_v1",return_value=kms),patch.object(kms,"load_host_agent",return_value=DummyHost()),patch.object(kms,"register_with_retries",return_value={"status":"KEY_REGISTERED"}),patch.object(v2,"activate_with_retries",return_value={"status":"ALREADY_ACTIVE"}),patch.object(kms,"run_once",side_effect=RuntimeError("kms_poll_failed:402:quota")),patch.object(v2.time,"sleep",side_effect=stop_after_sleep),patch.object(sys,"argv",["kms-v2","--daemon"]):
            with self.assertRaises(StopDaemon):v2.main()
        self.assertEqual(delays,[1800])
if __name__=="__main__":unittest.main()
