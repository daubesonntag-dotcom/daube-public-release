import hashlib, json, tempfile, unittest
from pathlib import Path
from unittest import mock
import manifest, stage, checks, transaction, controller, watchdog, chain
import run

def good_manifest():
    payload=b'echo ok\n'
    return {'schema':'daube.host-autopilot.v1','enabled':True,'target_revision':'89e7ea9e2ece88f5ffbc3f856b746aefca6a5427','release_id':'fixture-1','artifacts':[{'path':'installers/example.sh','sha256':hashlib.sha256(payload).hexdigest(),'mode':'0755'}],'checks':[['bash','-n','installers/example.sh']],'activation':{'kind':'installer','entrypoint':'installers/example.sh'},'health_units':['daube-runtime-watchdog.timer'],'rollback':'required'}

def good_phase(phase_id='phase-1',release_id='release-1',revision='1'*40,depends_on=None):
    payload=b'echo ok\n'
    return {'phase_id':phase_id,'target_revision':revision,'release_id':release_id,'artifacts':[{'path':'installers/example.sh','sha256':hashlib.sha256(payload).hexdigest(),'mode':'0755'}],'checks':[['bash','-n','installers/example.sh']],'activation':{'kind':'installer','entrypoint':'installers/example.sh'},'health_units':['daube-runtime-watchdog.timer'],'depends_on':depends_on,'success_receipt':'APPLIED'}

def good_chain(enabled=True):
    p1=good_phase(); p2=good_phase('phase-2','release-2','2'*40,'phase-1')
    return {'schema':'daube.native-release-chain.v1','enabled':enabled,'chain_id':'chain-1','phases':[p1,p2],'rollback_policy':'phase-local-required'}

def applied(phase): return {'state':'APPLIED','release_id':phase['release_id'],'target_revision':phase['target_revision']}

class ManifestTests(unittest.TestCase):
    def test_good(self): self.assertEqual(manifest.validate_manifest(good_manifest()),(True,'OK'))
    def test_revision_exact(self): m=good_manifest(); m['target_revision']='main'; self.assertFalse(manifest.validate_manifest(m)[0])
    def test_shell_string_rejected(self): m=good_manifest(); m['checks']=['bash -n x']; self.assertFalse(manifest.validate_manifest(m)[0])
    def test_path_allowlist(self): m=good_manifest(); m['artifacts'][0]['path']='../../etc/passwd'; self.assertFalse(manifest.validate_manifest(m)[0])
class ChainTests(unittest.TestCase):
    def test_good_chain(self): self.assertEqual(chain.validate_chain(good_chain()),(True,'OK'))
    def test_chain_requires_exact_sha(self): c=good_chain(); c['phases'][0]['target_revision']='main'; self.assertFalse(chain.validate_chain(c)[0])
    def test_chain_rejects_shell_string(self): c=good_chain(); c['phases'][0]['checks']=['bash -n x']; self.assertFalse(chain.validate_chain(c)[0])
    def test_dependency_must_point_backward(self): c=good_chain(); c['phases'][0]['depends_on']='phase-2'; self.assertFalse(chain.validate_chain(c)[0])
    def test_disabled_chain(self): self.assertEqual(chain.select_phase(good_chain(False),lambda p:None)['classification'],'DISABLED')
    def test_first_phase_ready(self): self.assertEqual(chain.select_phase(good_chain(),lambda p:None)['phase']['phase_id'],'phase-1')
    def test_predecessor_exact_receipt_unlocks_second(self):
        c=good_chain(); p1=c['phases'][0]
        r=chain.select_phase(c,lambda p:applied(p1) if p['phase_id']=='phase-1' else None)
        self.assertEqual((r['classification'],r['phase']['phase_id']),('READY','phase-2'))
    def test_mismatched_receipt_never_unlocks_successor(self):
        c=good_chain(); bad={'state':'APPLIED','release_id':'wrong','target_revision':c['phases'][0]['target_revision']}
        r=chain.select_phase(c,lambda p:bad if p['phase_id']=='phase-1' else None)
        self.assertEqual((r['classification'],r['phase']['phase_id']),('READY','phase-1'))
    def test_rollback_is_terminal(self):
        c=good_chain(); p1=c['phases'][0]; rb={'state':'ROLLED_BACK','release_id':p1['release_id'],'target_revision':p1['target_revision']}
        self.assertEqual(chain.select_phase(c,lambda p:rb if p['phase_id']=='phase-1' else None)['classification'],'HOLD_FOUNDER_GATE')
    def test_phase_hold_is_terminal(self):
        c=good_chain(); p1=c['phases'][0]; hold={'state':'HOLD_FOUNDER_GATE','release_id':p1['release_id'],'target_revision':p1['target_revision']}
        self.assertEqual(chain.select_phase(c,lambda p:hold if p['phase_id']=='phase-1' else None)['classification'],'HOLD_FOUNDER_GATE')
    def test_all_applied_noop(self):
        c=good_chain(); receipts={p['phase_id']:applied(p) for p in c['phases']}
        self.assertEqual(chain.select_phase(c,lambda p:receipts[p['phase_id']])['classification'],'NOOP')
    def test_prior_founder_hold_stops_chain(self): self.assertEqual(chain.select_phase(good_chain(),lambda p:None,{'classification':'HOLD_FOUNDER_GATE'})['classification'],'HOLD_FOUNDER_GATE')
class NativeChainRuntimeTests(unittest.TestCase):
    def patched_paths(self,d):
        root=Path(d); state=root/'state'
        return mock.patch.multiple(run,ROOT=root,STATE=state,STAGING=root/'staging',SNAP=root/'snapshots')
    def test_local_kill_switch_wins_without_fetch(self):
        with tempfile.TemporaryDirectory() as d, self.patched_paths(d):
            run.ROOT.mkdir(parents=True); (run.ROOT/'DISABLED').write_text('1'); calls=[]
            result=run.native_chain_once(lambda:calls.append('fetch') or good_chain(),lambda m:None)
            self.assertEqual(result['classification'],'DISABLED'); self.assertEqual(calls,[])
    def test_one_invocation_executes_only_one_phase_and_writes_audit(self):
        with tempfile.TemporaryDirectory() as d, self.patched_paths(d):
            calls=[]
            def tx(m): calls.append(m['release_id']); return {'state':'APPLIED','release_id':m['release_id'],'target_revision':m['target_revision']}
            result=run.native_chain_once(lambda:good_chain(),tx)
            self.assertEqual(calls,['release-1']); self.assertEqual(result['classification'],'APPLIED')
            audit=json.loads((run.STATE/'native-chain-receipts'/'chain-1'/'phase-1.json').read_text())
            self.assertEqual((audit['state'],audit['release_id']),('APPLIED','release-1'))
    def test_existing_phase1_receipt_advances_only_phase2(self):
        with tempfile.TemporaryDirectory() as d, self.patched_paths(d):
            c=good_chain(); p1=c['phases'][0]; receipt=run.STATE/'receipts'/f"{p1['release_id']}.json"; receipt.parent.mkdir(parents=True); receipt.write_text(json.dumps(applied(p1)))
            calls=[]
            def tx(m): calls.append(m['release_id']); return {'state':'APPLIED','release_id':m['release_id'],'target_revision':m['target_revision']}
            result=run.native_chain_once(lambda:c,tx)
            self.assertEqual(calls,['release-2']); self.assertEqual(result['phase_id'],'phase-2')
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
class ActivationSafetyTests(unittest.TestCase):
    def test_activation_env_pins_target_revision(self):
        m=good_manifest(); env=run.activation_env(m); self.assertEqual(env['DAUBE_V9_REF'],m['target_revision']); self.assertEqual(env['DAUBE_AUTOPILOT_TARGET_REVISION'],m['target_revision']); self.assertEqual(env['DAUBE_NATIVE_AUTOPILOT_REF'],m['target_revision'])
    def test_timer_snapshot_includes_companion_service(self):
        m=good_manifest(); names=run.snapshot_unit_names(m); self.assertIn('daube-runtime-watchdog.timer',names); self.assertIn('daube-runtime-watchdog.service',names)
class WatchdogTests(unittest.TestCase):
    def test_unknown_unit_never_restarted(self):
        calls=[]; watchdog.self_heal({'units':{'evil.service':'inactive'}},lambda u:calls.append(u),{'daube-host-autopilot.timer'}); self.assertEqual(calls,[])
    def test_allowlisted_restart(self):
        calls=[]; watchdog.self_heal({'units':{'daube-host-autopilot.timer':'inactive'}},lambda u:calls.append(u),{'daube-host-autopilot.timer'}); self.assertEqual(calls,['daube-host-autopilot.timer'])
if __name__=='__main__': unittest.main()
