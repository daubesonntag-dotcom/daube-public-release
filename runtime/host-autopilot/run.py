import argparse,json,shutil,subprocess,urllib.request
from pathlib import Path
from controller import poll_once, fetch_manifest_url
from manifest import validate_manifest
from stage import stage_release
from checks import run_checks
from transaction import Paths, run_transaction
from models import atomic_json, append_event, now
from watchdog import evaluate_health,self_heal,system_unit_state,system_restart

ROOT=Path.home()/'daube-host-autopilot'; STATE=ROOT/'state'; STAGING=ROOT/'staging'; SNAP=ROOT/'snapshots'
REPO='daubesonntag-dotcom/daube-public-release'
MANIFEST_URL=f'https://raw.githubusercontent.com/{REPO}/main/.daube/autopilot/host-desired-state.json'

def fetch_bytes(url):
    with urllib.request.urlopen(url,timeout=30) as r:return r.read()
def load_last():
    p=STATE/'last-applied.json'
    if not p.exists():return {}
    try:return json.loads(p.read_text())
    except Exception:return {}
def snapshot_units(manifest):
    d=SNAP/f"{manifest['release_id']}-{manifest['target_revision'][:12]}"; d.mkdir(parents=True,exist_ok=True)
    for unit in manifest.get('health_units',[]):
        src=Path('/etc/systemd/system')/unit
        if src.exists(): shutil.copy2(src,d/unit)
    return d
def activate(manifest):
    ep=STAGING/manifest['release_id']/manifest['activation']['entrypoint']
    if not ep.is_file():return 127
    r=subprocess.run(['bash',str(ep)],cwd=ep.parent.parent,text=True,capture_output=True,timeout=1800)
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
def watchdog_once():
    allow={'daube-host-autopilot.timer','daube-host-autopilot-watchdog.timer','daube-revenue-worker.timer','daube-freelancer-award-watcher.timer','daube-freelancer-executor.timer','daube-runtime-watchdog.timer','daube-freelancer-money-closure.timer'}
    report=evaluate_health(sorted(allow),system_unit_state); heal=self_heal(report,system_restart,allow)
    atomic_json(STATE/'watchdog.json',{'at':now(),**report,**heal}); print(json.dumps({'report':report,'heal':heal}))
def verify():
    probe={'schema':'daube.host-autopilot.v1','enabled':False,'target_revision':'0'*40,'release_id':'verify','artifacts':[{'path':'installers/verify.sh','sha256':'0'*64,'mode':'0755'}],'checks':[['bash','-n','installers/verify.sh']],'activation':{'kind':'installer','entrypoint':'installers/verify.sh'},'health_units':['daube-host-autopilot.timer'],'rollback':'required'}
    ok,reason=validate_manifest(probe)
    if not ok: raise SystemExit(reason)
    print('VERSION=host-autopilot-v1 IMPORTS=OK')
if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--verify',action='store_true'); ap.add_argument('--watchdog',action='store_true'); args=ap.parse_args()
    if args.verify: verify()
    elif args.watchdog: watchdog_once()
    else: once()
