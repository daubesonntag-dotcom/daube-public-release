import hashlib, tempfile, unittest
from pathlib import Path
import manifest, stage, checks, transaction, controller, watchdog

def good_manifest():
    payload=b'echo ok\n'
    return {'schema':'daube.host-autopilot.v1','enabled':True,'target_revision':'89e7ea9e2ece88f5ffbc3f856b746aefca6a5427','release_id':'fixture-1','artifacts':[{'path':'installers/example.sh','sha256':hashlib.sha256(payload).hexdigest(),'mode':'0755'}],'checks':[['bash','-n','installers/example.sh']],'activation':{'kind':'installer','entrypoint':'installers/example.sh'},'health_units':['daube-runtime-watchdog.timer'],'rollback':'required'}

class ManifestTests(unittest.TestCase):
    def test_good(self): self.assertEqual(manifest.validate_manifest(good_manifest()),(True,'OK'))
    def test_revision_exact(self): m=good_manifest(); m['target_revision']='main'; self.assertFalse(manifest.validate_manifest(m)[0])
    def test_shell_string_rejected(self): m=good_manifest(); m['checks']=['bash -n x']; self.assertFalse(manifest.validate_manifest(m)[0])
    def test_path_allowlist(self): m=good_manifest(); m['artifacts'][0]['path']='../../etc/passwd'; self.assertFalse(manifest.validate_manifest(m)[0])
class StageTests(unittest.TestCase):
    def test_url_pinned(self):
        u=stage.artifact_url('daubesonntag-dotcom/daube-public-release',good_manifest()['target_revision'],'installers/example.sh'); self.assertIn(good_manifest()['target_revision'],u); self.assertNotIn('/main/',u)
    def test_hash_mismatch(self):
        m=good_manifest(); m['artifacts'][0]['sha256']='0'*64
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(stage.StageError): stage.stage_release(m,Path(d),lambda url:b'echo ok\n')
    def test_stage_ok(self):
        with tempfile.TemporaryDirectory() as d:self.assertEqual(stage.stage_release(good_manifest(),Path(d),lambda url:b'echo ok\n')['classification'],'PASS')
class CheckTests(unittest.TestCase):
    def test_nonzero(self): self.assertFalse(checks.run_checks(Path('/tmp'),[['false']],lambda argv,cwd,timeout:(1,'','bad'))['green'])
    def test_redact(self): self.assertNotIn('secret123',checks.redact_text('token=secret123'))
class TransactionTests(unittest.TestCase):
    def adapters(self,activate=0,health=True,rollback=True): return {'stage':lambda m:{'classification':'PASS'},'checks':lambda m:{'green':True},'snapshot':lambda m:'snap','activate':lambda m:activate,'health':lambda units:health,'rollback':lambda snap:rollback}
    def test_kill_switch(self):
        with tempfile.TemporaryDirectory() as d:
            p=transaction.Paths(Path(d)); p.disabled.write_text('1'); self.assertEqual(transaction.run_transaction(good_manifest(),p,self.adapters())['state'],'DISABLED')
    def test_activation_failure_rolls_back(self):
        with tempfile.TemporaryDirectory() as d:self.assertEqual(transaction.run_transaction(good_manifest(),transaction.Paths(Path(d)),self.adapters(activate=1))['state'],'ROLLED_BACK')
    def test_health_failure_rolls_back(self):
        with tempfile.TemporaryDirectory() as d:self.assertEqual(transaction.run_transaction(good_manifest(),transaction.Paths(Path(d)),self.adapters(health=False))['state'],'ROLLED_BACK')
    def test_rollback_failure_holds(self):
        with tempfile.TemporaryDirectory() as d:self.assertEqual(transaction.run_transaction(good_manifest(),transaction.Paths(Path(d)),self.adapters(activate=1,rollback=False))['state'],'HOLD_FOUNDER_GATE')
class ControllerTests(unittest.TestCase):
    def test_disabled_remote_noop(self):
        m=good_manifest(); m['enabled']=False; self.assertEqual(controller.poll_once({'repo':'x/y'},{'fetch_manifest':lambda:m,'run_transaction':lambda x:None})['classification'],'DISABLED')
    def test_same_release_noop(self):
        m=good_manifest(); r=controller.poll_once({'repo':'x/y','last_applied':{'release_id':'fixture-1','target_revision':m['target_revision']}},{'fetch_manifest':lambda:m,'run_transaction':lambda x:None}); self.assertEqual(r['classification'],'NOOP')
class WatchdogTests(unittest.TestCase):
    def test_unknown_unit_never_restarted(self):
        calls=[]; watchdog.self_heal({'units':{'evil.service':'inactive'}},lambda u:calls.append(u),{'daube-host-autopilot.timer'}); self.assertEqual(calls,[])
    def test_allowlisted_restart(self):
        calls=[]; watchdog.self_heal({'units':{'daube-host-autopilot.timer':'inactive'}},lambda u:calls.append(u),{'daube-host-autopilot.timer'}); self.assertEqual(calls,['daube-host-autopilot.timer'])
if __name__=='__main__': unittest.main()
