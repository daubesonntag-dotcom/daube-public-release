#!/usr/bin/env bash
set -u
BASE="$HOME/daube-revenue-worker"
OPS="$BASE/full-loop"
V8="$OPS/v8"
JOBS="$OPS/jobs"
mkdir -p "$V8" "$V8/events"
chmod 700 "$V8" "$V8/events"

cat > "$V8/executor.py" <<'PY'
import hashlib,json,os,shlex,shutil,subprocess,time
from datetime import datetime,timezone
from pathlib import Path

VERSION='v8-provider-neutral-executor'
HOME=Path.home(); BASE=HOME/'daube-revenue-worker'; OPS=BASE/'full-loop'; JOBS=OPS/'jobs'; V8=OPS/'v8'
EVENTS=V8/'events'/'events.jsonl'
ALLOWED_STATES={'READY_FOR_EXECUTOR','WAITING_FOR_INPUT','EXECUTING','QA_FAILED','DELIVERY_READY','DELIVERY_SENT','REVISION_REQUIRED','MILESTONE_REQUEST_READY','HOLD_FOUNDER_GATE','DONE'}
BLOCKED={'tax','legal advice','medical','healthcare','trading','forex','crypto','gambling','adult','on-site','onsite','enterprise platform','complete platform','full platform'}

def now(): return datetime.now(timezone.utc).isoformat()
def atomic_json(path,obj):
    tmp=path.with_suffix(path.suffix+'.tmp'); tmp.write_text(json.dumps(obj,indent=2,default=str)+'\n'); os.replace(tmp,path)
def read_json(path): return json.loads(path.read_text())
def event(kind,**kw):
    row={'at':now(),'version':VERSION,'kind':kind,**kw}; EVENTS.parent.mkdir(parents=True,exist_ok=True)
    with EVENTS.open('a') as f:f.write(json.dumps(row,default=str)+'\n')
    print(kind,json.dumps(kw,default=str)[:600])
def validate_job(d):
    req=[d/'EXECUTOR_JOB.json',d/'job.json',d/'SCOPE.md']
    if not all(p.is_file() for p in req): return False,'MISSING_V7_EVIDENCE'
    task=read_json(req[0]); manifest=read_json(req[1]); scope=req[2].read_text().lower()
    if task.get('state')!='READY_FOR_EXECUTOR': return False,'NOT_READY'
    if manifest.get('status')!='AWARDED_ACCEPTED' or manifest.get('acceptance_guard')!='STANDARD_AUTHORITY_PASS': return False,'NO_ACCEPTANCE_EVIDENCE'
    if int(manifest.get('estimated_hours') or 999)>72: return False,'OVER_72H'
    if any(x in scope for x in BLOCKED): return False,'BLOCKED_SCOPE'
    return True,'PASS'
def detect_runtime():
    # Provider-neutral contract; V8 ships Codex adapter first. Never install/buy a runtime here.
    codex=shutil.which('codex')
    if codex: return {'name':'codex','path':codex}
    return None
def required_input_missing(d):
    manifest=read_json(d/'job.json'); scope=(manifest.get('scope') or '').lower()
    # Only hold for explicit external access requirements; do not invent access needs.
    markers=['existing repository','existing repo','github repository','source code access','ssh access','api key provided','credentials provided','sample data provided']
    if any(m in scope for m in markers) and not (d/'client-input').exists(): return ['client repository/access or supplied data referenced by scope']
    return []
def write_brief(d):
    m=read_json(d/'job.json'); scope=(d/'SCOPE.md').read_text()
    text=f'''# D’AUBE Execution Brief\n\nProject: {m.get("title")}\nProject ID: {m.get("project_id")}\nMaximum authorized effort: {m.get("estimated_hours")} hours\n\n{scope}\n\n## Non-negotiable executor constraints\n- Work only inside this job workspace.\n- Implement only the locked awarded scope.\n- Do not purchase services, paid APIs, credits, compute, or subscriptions.\n- Do not change payout, bank, tax, identity, KYC, or account credentials.\n- Never expose secrets in source, logs, tests, or delivery artifacts.\n- Do not fabricate tests, screenshots, client evidence, deployment status, or completion.\n- Do not perform destructive operations outside this workspace.\n- If required input is unavailable, stop and record what is missing.\n- Produce real implementation artifacts plus executable verification evidence.\n'''
    (d/'EXECUTION_BRIEF.md').write_text(text); return text
def execute_runtime(runtime,d,brief):
    work=d/'work'; work.mkdir(exist_ok=True)
    if runtime['name']=='codex':
        prompt=brief+'\nImplement the bounded deliverable in '+str(work)+'. Run appropriate local verification. Do not communicate with the marketplace or claim payment.'
        cmd=[runtime['path'],'exec','--full-auto','--sandbox','workspace-write','-C',str(work),prompt]
    else: raise RuntimeError('UNSUPPORTED_RUNTIME')
    started=now()
    try:r=subprocess.run(cmd,cwd=work,text=True,capture_output=True,timeout=5400)
    except subprocess.TimeoutExpired as e:return {'ok':False,'reason':'RUNTIME_TIMEOUT','started_at':started,'finished_at':now(),'stdout':(e.stdout or '')[-4000:] if isinstance(e.stdout,str) else '','stderr':(e.stderr or '')[-4000:] if isinstance(e.stderr,str) else ''}
    return {'ok':r.returncode==0,'reason':'PASS' if r.returncode==0 else 'RUNTIME_NONZERO','returncode':r.returncode,'started_at':started,'finished_at':now(),'stdout':r.stdout[-4000:],'stderr':r.stderr[-4000:]}
def candidate_commands(work):
    cmds=[]
    if (work/'package.json').is_file():
        try:scripts=read_json(work/'package.json').get('scripts',{})
        except Exception:scripts={}
        for n in ('test','lint','typecheck','build'):
            if n in scripts:cmds.append(['npm','run',n,'--','--runInBand'] if n=='test' else ['npm','run',n])
    if (work/'pyproject.toml').is_file() or (work/'pytest.ini').is_file() or list(work.glob('test*.py')) or (work/'tests').is_dir(): cmds.append(['python3','-m','pytest','-q'])
    return cmds
def run_qa(d):
    work=d/'work'; qdir=d/'qa'; qdir.mkdir(exist_ok=True); rows=[]
    for cmd in candidate_commands(work):
        try:r=subprocess.run(cmd,cwd=work,text=True,capture_output=True,timeout=900); rows.append({'command':shlex.join(cmd),'exit_code':r.returncode,'stdout':r.stdout[-3000:],'stderr':r.stderr[-3000:]})
        except Exception as e:rows.append({'command':shlex.join(cmd),'exit_code':999,'error':str(e)[:500]})
    files=[p for p in work.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts]
    green=bool(files) and bool(rows) and all(x['exit_code']==0 for x in rows)
    report={'at':now(),'green':green,'commands':rows,'artifact_file_count':len(files)}; atomic_json(qdir/'qa-report.json',report); return report,files
def package(d,files,qa):
    out=d/'delivery'; out.mkdir(exist_ok=True); work=d/'work'; arts=[]
    for p in files:
        rel=str(p.relative_to(work)); h=hashlib.sha256(p.read_bytes()).hexdigest(); arts.append({'path':rel,'sha256':h,'bytes':p.stat().st_size})
    manifest={'version':VERSION,'created_at':now(),'project_id':read_json(d/'job.json').get('project_id'),'qa_green':qa['green'],'qa_report':'../qa/qa-report.json','artifacts':arts}
    atomic_json(out/'manifest.json',manifest)
    (out/'HANDOFF.md').write_text('# Delivery handoff\n\nImplementation is packaged with SHA-256 artifact hashes and a green local QA report. Review the manifest and QA evidence before any marketplace delivery action.\n')
    return manifest
def process(d):
    state_path=d/'executor-state.json'
    if state_path.exists() and read_json(state_path).get('state') in {'DELIVERY_READY','DELIVERY_SENT','DONE'}: return
    ok,reason=validate_job(d)
    if not ok:
        if reason!='NOT_READY': atomic_json(state_path,{'version':VERSION,'state':'HOLD_FOUNDER_GATE','reason':reason,'at':now()})
        return
    missing=required_input_missing(d)
    if missing:
        atomic_json(d/'NEEDS_INPUT.json',{'at':now(),'missing':missing}); atomic_json(state_path,{'version':VERSION,'state':'WAITING_FOR_INPUT','reason':'MISSING_CLIENT_INPUT','at':now()}); event('WAITING_FOR_INPUT',project_id=d.name,missing=missing); return
    runtime=detect_runtime()
    if not runtime:
        atomic_json(state_path,{'version':VERSION,'state':'HOLD_FOUNDER_GATE','reason':'NO_APPROVED_EXECUTOR_RUNTIME','at':now()}); event('EXECUTOR_HOLD',project_id=d.name,reason='NO_APPROVED_EXECUTOR_RUNTIME'); return
    brief=write_brief(d); atomic_json(state_path,{'version':VERSION,'state':'EXECUTING','runtime':runtime['name'],'at':now()})
    rr=execute_runtime(runtime,d,brief); atomic_json(d/'runtime-receipt.json',rr)
    if not rr['ok']:
        atomic_json(state_path,{'version':VERSION,'state':'QA_FAILED','reason':rr['reason'],'at':now()}); event('EXECUTION_FAILED',project_id=d.name,reason=rr['reason']); return
    qa,files=run_qa(d)
    if not qa['green']:
        atomic_json(state_path,{'version':VERSION,'state':'QA_FAILED','reason':'QA_GATE_FAILED','at':now()}); event('QA_FAILED',project_id=d.name); return
    package(d,files,qa); atomic_json(state_path,{'version':VERSION,'state':'DELIVERY_READY','at':now()}); event('DELIVERY_READY',project_id=d.name,artifacts=len(files))
def main():
    JOBS.mkdir(parents=True,exist_ok=True); jobs=[d for d in JOBS.iterdir() if d.is_dir()]
    print(f'VERSION={VERSION} JOBS={len(jobs)} RUNTIME={(detect_runtime() or {}).get("name","NONE")}')
    for d in jobs:
        lock=d/'.executor.lock'
        try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
        except FileExistsError:continue
        try:process(d)
        except Exception as e:event('EXECUTOR_EXCEPTION',project_id=d.name,error=type(e).__name__+':'+str(e)[:300])
        finally:os.close(fd); lock.unlink(missing_ok=True)
if __name__=='__main__':main()
PY

cat > "$V8/test_executor.py" <<'PY'
import json,tempfile,unittest
from pathlib import Path
import executor
class T(unittest.TestCase):
 def job(self,state='READY_FOR_EXECUTOR',hours=24,scope='React API integration bug fix'):
  td=tempfile.TemporaryDirectory(); d=Path(td.name); (d/'EXECUTOR_JOB.json').write_text(json.dumps({'state':state})); (d/'job.json').write_text(json.dumps({'status':'AWARDED_ACCEPTED','acceptance_guard':'STANDARD_AUTHORITY_PASS','estimated_hours':hours,'scope':scope,'project_id':1,'title':'x'})); (d/'SCOPE.md').write_text(scope); return td,d
 def test_valid(self):
  t,d=self.job(); self.assertEqual(executor.validate_job(d),(True,'PASS')); t.cleanup()
 def test_reject_over72(self):
  t,d=self.job(hours=73); self.assertEqual(executor.validate_job(d)[1],'OVER_72H'); t.cleanup()
 def test_reject_wrong_state(self):
  t,d=self.job(state='DONE'); self.assertEqual(executor.validate_job(d)[1],'NOT_READY'); t.cleanup()
 def test_blocked_scope(self):
  t,d=self.job(scope='legal advice API'); self.assertEqual(executor.validate_job(d)[1],'BLOCKED_SCOPE'); t.cleanup()
 def test_explicit_input_hold(self):
  t,d=self.job(scope='fix existing repository React app'); self.assertTrue(executor.required_input_missing(d)); t.cleanup()
 def test_package_hash(self):
  t,d=self.job(); w=d/'work'; w.mkdir(); (w/'a.txt').write_text('abc'); m=executor.package(d,[w/'a.txt'],{'green':True}); self.assertEqual(m['artifacts'][0]['sha256'],'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); t.cleanup()
 def test_qa_needs_command_and_artifact(self):
  t,d=self.job(); (d/'work').mkdir(); (d/'work'/'a.txt').write_text('x'); q,_=executor.run_qa(d); self.assertFalse(q['green']); t.cleanup()
if __name__=='__main__':unittest.main()
PY

cat > "$V8/run.sh" <<'SH'
#!/usr/bin/env bash
set -u
exec python3 "$HOME/daube-revenue-worker/full-loop/v8/executor.py"
SH
chmod 700 "$V8/run.sh"

# Verification is deliberately before systemd activation.
PYTHONPATH="$V8" python3 -m unittest -v "$V8/test_executor.py" || { echo 'V8_TESTS_FAILED'; exit 1; }
python3 -m py_compile "$V8/executor.py" || exit 1

sudo tee /etc/systemd/system/daube-freelancer-executor.service >/dev/null <<EOF
[Unit]
Description=D'AUBE Freelancer Provider-Neutral Executor v8
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=$(id -un)
Environment=HOME=$HOME
ExecStart=$V8/run.sh
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$BASE
ReadOnlyPaths=$HOME/.config/daube/secrets $HOME/.venvs/freelancer
EOF
sudo tee /etc/systemd/system/daube-freelancer-executor.timer >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Freelancer executor v8
[Timer]
OnBootSec=6min
OnUnitActiveSec=15min
Persistent=true
RandomizedDelaySec=45
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now daube-freelancer-executor.timer
sudo systemctl start daube-freelancer-executor.service || true

echo "=== D'AUBE FREELANCER EXECUTOR V8 ==="
"$V8/run.sh" || true
echo "=== TIMERS ==="
systemctl is-active daube-revenue-worker.timer || true
systemctl is-active daube-freelancer-award-watcher.timer || true
systemctl is-active daube-freelancer-executor.timer || true
systemctl --no-pager list-timers daube-revenue-worker.timer daube-freelancer-award-watcher.timer daube-freelancer-executor.timer || true
echo "=== EXECUTOR EVENTS ==="
tail -n 20 "$V8/events/events.jsonl" 2>/dev/null || true
