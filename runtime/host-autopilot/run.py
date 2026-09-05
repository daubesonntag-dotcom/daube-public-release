import argparse,json,os,shutil,subprocess,urllib.request
from pathlib import Path
from controller import poll_once, fetch_manifest_url
from manifest import validate_manifest
from chain import validate_chain,select_phase,phase_to_manifest
from stage import stage_release
from checks import run_checks
from transaction import Paths, run_transaction
from models import atomic_json, append_event, now
from watchdog import evaluate_health,self_heal,system_unit_state,system_restart

ROOT=Path.home()/'daube-host-autopilot'; STATE=ROOT/'state'; STAGING=ROOT/'staging'; SNAP=ROOT/'snapshots'
REPO='daubesonntag-dotcom/daube-public-release'
MANIFEST_URL=f'https://raw.githubusercontent.com/{REPO}/main/.daube/autopilot/host-desired-state.json'
CHAIN_URL=f'https://raw.githubusercontent.com/{REPO}/main/.daube/autopilot/release-chain.json'

def fetch_bytes(url):
    with urllib.request.urlopen(url,timeout=30) as r:return r.read()
def load_json(path):
    p=Path(path)
    if not p.exists():return None
    try:return json.loads(p.read_text())
    except Exception:return None
def load_last(): return load_json(STATE/'last-applied.json') or {}
def snapshot_unit_names(manifest):
    names=set(manifest.get('health_units',[]))
    for unit in list(names):
        if unit.endswith('.timer'): names.add(unit[:-6]+'.service')
    return sorted(names)
def snapshot_units(manifest):
    d=SNAP/f"{manifest['release_id']}-{manifest['target_revision'][:12]}"; d.mkdir(parents=True,exist_ok=True)
    for unit in snapshot_unit_names(manifest):
        src=Path('/etc/systemd/system')/unit
        if src.exists(): shutil.copy2(src,d/unit)
    return d
def activation_env(manifest):
    env=os.environ.copy(); revision=manifest['target_revision']
    env['DAUBE_AUTOPILOT_TARGET_REVISION']=revision
    env['DAUBE_V9_REF']=revision
    env['DAUBE_NATIVE_AUTOPILOT_REF']=revision
    return env
def activate(manifest):
    ep=STAGING/manifest['release_id']/manifest['activation']['entrypoint']
    if not ep.is_file():return 127
    r=subprocess.run(['bash',str(ep)],cwd=ep.parent.parent,text=True,capture_output=True,timeout=1800,env=activation_env(manifest))
    append_event(STATE/'events.jsonl',{'kind':'ACTIVATION','release_id':manifest['release_id'],'exit_code':r.returncode})
    return r.returncode
def health(units): return all(system_unit_state(u)=='active' for u in units)
def rollback(snapshot):
    try:
        for p in Path(snapshot).glob('daube-*'):
            subprocess.run(['sudo','cp',str(p),f'/etc/systemd/system/{p.name}'],check=True)
        subprocess.run(['sudo','systemctl','daemon-reload'],check=True)
        for p in Path(snapshot).glob('*.timer'):
            subprocess.run(['sudo','systemctl','enable','--now',p.name],check=False)
        return True
    except Exception:return False

def transact(manifest):
    stage_dir=STAGING/manifest['release_id']; shutil.rmtree(stage_dir,ignore_errors=True)
    adapters={'stage':lambda m:stage_release(m,stage_dir,fetch_bytes,REPO),'checks':lambda m:run_checks(stage_dir,m.get('checks',[])),'snapshot':snapshot_units,'activate':activate,'health':health,'rollback':rollback}
    result=run_transaction(manifest,Paths(ROOT),adapters)
    if result.get('state')=='APPLIED': atomic_json(STATE/'last-applied.json',{'release_id':manifest['release_id'],'target_revision':manifest['target_revision'],'applied_at':now()})
    atomic_json(STATE/'receipts'/f"{manifest['release_id']}.json",result)
    return result

def once():
    result=poll_once({'repo':REPO,'last_applied':load_last()},{'fetch_manifest':lambda:fetch_manifest_url(MANIFEST_URL),'run_transaction':transact})
    atomic_json(STATE/'current.json',result); append_event(STATE/'events.jsonl',{'kind':'POLL','classification':result.get('classification')}); print(json.dumps(result))

def phase_receipt(phase): return load_json(STATE/'receipts'/f"{phase['release_id']}.json")
def native_chain_once(fetch_chain=None,transact_fn=None):
    if (ROOT/'DISABLED').exists():
        result={'classification':'DISABLED'}
    else:
        try: chain_data=(fetch_chain or (lambda:fetch_manifest_url(CHAIN_URL)))()
        except Exception as exc: chain_data=None; result={'classification':'NO_DATA','reason':type(exc).__name__}
        if chain_data is not None:
            selected=select_phase(chain_data,phase_receipt)
            result={**selected,'chain_id':chain_data.get('chain_id')}
            if selected.get('classification')=='READY':
                phase=selected['phase']; tx=(transact_fn or transact)(phase_to_manifest(phase))
                result={'classification':tx.get('state'),'chain_id':chain_data['chain_id'],'phase_id':phase['phase_id'],'release_id':phase['release_id'],'target_revision':phase['target_revision'],'transaction':tx}
                audit={'chain_id':chain_data['chain_id'],'phase_id':phase['phase_id'],'release_id':phase['release_id'],'target_revision':phase['target_revision'],'state':tx.get('state'),'at':now(),'transaction':tx}
                atomic_json(STATE/'native-chain-receipts'/chain_data['chain_id']/f"{phase['phase_id']}.json",audit)
    atomic_json(STATE/'native-chain-current.json',result)
    append_event(STATE/'native-chain-events.jsonl',{'kind':'NATIVE_CHAIN','classification':result.get('classification'),'chain_id':result.get('chain_id'),'phase_id':result.get('phase_id')})
    print(json.dumps(result)); return result

def watchdog_once():
    allow={'daube-host-autopilot.timer','daube-host-autopilot-watchdog.timer','daube-native-autopilot-chain.timer','daube-revenue-worker.timer','daube-freelancer-award-watcher.timer','daube-freelancer-executor.timer','daube-runtime-watchdog.timer','daube-freelancer-money-closure.timer'}
    report=evaluate_health(sorted(allow),system_unit_state); heal=self_heal(report,system_restart,allow)
    atomic_json(STATE/'watchdog.json',{'at':now(),**report,**heal}); print(json.dumps({'report':report,'heal':heal}))
def verify():
    probe={'schema':'daube.host-autopilot.v1','enabled':False,'target_revision':'0'*40,'release_id':'verify','artifacts':[{'path':'installers/verify.sh','sha256':'0'*64,'mode':'0755'}],'checks':[['bash','-n','installers/verify.sh']],'activation':{'kind':'installer','entrypoint':'installers/verify.sh'},'health_units':['daube-host-autopilot.timer'],'rollback':'required'}
    ok,reason=validate_manifest(probe)
    if not ok: raise SystemExit(reason)
    chain_probe={'schema':'daube.native-release-chain.v1','enabled':False,'chain_id':'verify-chain','rollback_policy':'phase-local-required','phases':[{'phase_id':'verify-phase','target_revision':'0'*40,'release_id':'verify-release','artifacts':[{'path':'installers/verify.sh','sha256':'0'*64,'mode':'0755'}],'checks':[['bash','-n','installers/verify.sh']],'activation':{'kind':'installer','entrypoint':'installers/verify.sh'},'health_units':['daube-host-autopilot.timer'],'depends_on':None,'success_receipt':'APPLIED'}]}
    ok,reason=validate_chain(chain_probe)
    if not ok: raise SystemExit(reason)
    print('VERSION=host-autopilot-v1 NATIVE_CHAIN=v1 IMPORTS=OK')
if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--verify',action='store_true'); ap.add_argument('--watchdog',action='store_true'); ap.add_argument('--native-chain',action='store_true'); args=ap.parse_args()
    if args.verify: verify()
    elif args.watchdog: watchdog_once()
    elif args.native_chain: native_chain_once()
    else: once()
