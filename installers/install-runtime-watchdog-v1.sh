#!/usr/bin/env bash
set -u
BASE="$HOME/daube-revenue-worker"
WD="$BASE/watchdog"
mkdir -p "$WD"
chmod 700 "$WD"
cat > "$WD/watchdog.py" <<'PY'
import json,os,shutil,subprocess,time,urllib.request,urllib.error
from datetime import datetime,timezone
from pathlib import Path
HOME=Path.home(); BASE=HOME/'daube-revenue-worker'; WD=BASE/'watchdog'; JOBS=BASE/'full-loop'/'jobs'
TOKEN=HOME/'.config/daube/secrets/freelancer.token'
TIMERS=('daube-revenue-worker.timer','daube-freelancer-award-watcher.timer','daube-freelancer-executor.timer')

def now(): return datetime.now(timezone.utc).isoformat()
def atomic(path,obj):
 t=path.with_suffix(path.suffix+'.tmp'); t.write_text(json.dumps(obj,indent=2,default=str)+'\n'); os.replace(t,path)
def auth_class(text,code=0):
 s=(text or '').strip().lower()
 if code==0 and ('not logged in' not in s) and ('logged in using chatgpt' in s or s.startswith('logged in') or 'authenticated' in s): return 'PASS'
 return 'HOLD'
def disk_class(percent_free):
 if percent_free < 5:return 'HOLD'
 if percent_free < 10:return 'WARN'
 return 'PASS'
def lock_class(age_seconds,executor_active):
 if age_seconds <= 7200:return 'PASS'
 return 'WARN' if executor_active else 'HEALABLE'
def overall(checks):
 vals={x['status'] for x in checks}
 if 'HOLD' in vals:return 'HOLD'
 if 'WARN' in vals:return 'DEGRADED'
 if 'HEALED' in vals:return 'HEALTHY'
 return 'HEALTHY'
def run(cmd,timeout=20):
 try:return subprocess.run(cmd,text=True,capture_output=True,timeout=timeout)
 except Exception as e:return type('R',(),{'returncode':999,'stdout':'','stderr':str(e)})()
def timer_active(name):return run(['systemctl','is-active',name]).stdout.strip()=='active'
def heal_timer(name):
 if name not in TIMERS:return False
 r=run(['sudo','systemctl','enable','--now',name],45); return r.returncode==0 and timer_active(name)
def freelancer_probe():
 if not TOKEN.is_file():return {'name':'freelancer_auth','status':'HOLD','detail':'TOKEN_FILE_MISSING'}
 token=TOKEN.read_text().strip()
 if not token:return {'name':'freelancer_auth','status':'HOLD','detail':'TOKEN_EMPTY'}
 req=urllib.request.Request('https://www.freelancer.com/api/users/0.1/self/',headers={'freelancer-oauth-v1':token,'User-Agent':'DAUBE-Watchdog/1'})
 try:
  with urllib.request.urlopen(req,timeout=20) as r:return {'name':'freelancer_auth','status':'PASS' if r.status==200 else 'HOLD','detail':f'HTTP_{r.status}'}
 except urllib.error.HTTPError as e:return {'name':'freelancer_auth','status':'HOLD','detail':f'HTTP_{e.code}'}
 except Exception as e:return {'name':'freelancer_auth','status':'WARN','detail':'NETWORK_'+type(e).__name__}
def codex_probe():
 c=shutil.which('codex') or str(HOME/'.local/bin/codex')
 if not Path(c).is_file():return {'name':'codex_auth','status':'HOLD','detail':'CODEX_BINARY_MISSING'}
 r=run([c,'login','status']); text=(r.stdout or '')+' '+(r.stderr or '')
 return {'name':'codex_auth','status':auth_class(text,r.returncode),'detail':'AUTH_OK' if auth_class(text,r.returncode)=='PASS' else 'AUTH_REQUIRED'}
def disk_probe():
 u=shutil.disk_usage(HOME); pct=u.free/u.total*100; return {'name':'disk','status':disk_class(pct),'detail':f'FREE_PERCENT={pct:.1f}'}
def lock_probes(executor_active):
 out=[]
 if not JOBS.exists():return out
 for p in JOBS.glob('*/.executor.lock'):
  age=time.time()-p.stat().st_mtime; cls=lock_class(age,executor_active)
  if cls=='HEALABLE':
   try:p.unlink(); status='HEALED'; detail=f'REMOVED_STALE_LOCK_AGE={int(age)}'
   except Exception:status='WARN';detail='STALE_LOCK_REMOVE_FAILED'
  else:status=cls;detail=f'LOCK_AGE={int(age)}'
  out.append({'name':'executor_lock:'+p.parent.name,'status':status,'detail':detail})
 return out
def main():
 WD.mkdir(parents=True,exist_ok=True); checks=[]
 for t in TIMERS:
  if timer_active(t):checks.append({'name':t,'status':'PASS','detail':'ACTIVE'})
  elif heal_timer(t):checks.append({'name':t,'status':'HEALED','detail':'STARTED'})
  else:checks.append({'name':t,'status':'HOLD','detail':'START_FAILED'})
 checks += [freelancer_probe(),codex_probe(),disk_probe()]
 checks += lock_probes(timer_active('daube-freelancer-executor.service'))
 state=overall(checks); report={'version':'watchdog-v1','at':now(),'overall':state,'checks':checks}
 old=None
 try:old=json.loads((WD/'health.json').read_text())
 except Exception:pass
 atomic(WD/'health.json',report)
 if not old or old.get('overall')!=state:
  with (WD/'incidents.jsonl').open('a') as f:f.write(json.dumps({'at':now(),'from':old.get('overall') if old else None,'to':state,'checks':[x for x in checks if x['status']!='PASS']})+'\n')
 holds=[x for x in checks if x['status']=='HOLD']
 action=WD/'FOUNDER_ACTION_REQUIRED.json'
 if holds:atomic(action,{'at':now(),'status':'ACTION_REQUIRED','issues':[{'name':x['name'],'detail':x['detail']} for x in holds]})
 else:action.unlink(missing_ok=True)
 print(f'WATCHDOG={state}')
 for x in checks:print(x['status'],x['name'],x['detail'])
if __name__=='__main__':main()
PY
cat > "$WD/test_watchdog.py" <<'PY'
import unittest,watchdog
class T(unittest.TestCase):
 def test_auth_rejects_not_logged_in(self):self.assertEqual(watchdog.auth_class('Not logged in',0),'HOLD')
 def test_auth_accepts_chatgpt(self):self.assertEqual(watchdog.auth_class('Logged in using ChatGPT',0),'PASS')
 def test_disk(self):
  self.assertEqual(watchdog.disk_class(4.9),'HOLD');self.assertEqual(watchdog.disk_class(7),'WARN');self.assertEqual(watchdog.disk_class(20),'PASS')
 def test_lock(self):
  self.assertEqual(watchdog.lock_class(8000,False),'HEALABLE');self.assertEqual(watchdog.lock_class(8000,True),'WARN');self.assertEqual(watchdog.lock_class(100,False),'PASS')
 def test_overall(self):
  self.assertEqual(watchdog.overall([{'status':'PASS'},{'status':'HEALED'}]),'HEALTHY');self.assertEqual(watchdog.overall([{'status':'WARN'}]),'DEGRADED');self.assertEqual(watchdog.overall([{'status':'HOLD'}]),'HOLD')
if __name__=='__main__':unittest.main()
PY
cat > "$WD/run.sh" <<'SH'
#!/usr/bin/env bash
set -u
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin"
exec python3 "$HOME/daube-revenue-worker/watchdog/watchdog.py"
SH
chmod 700 "$WD/run.sh"
(cd "$WD" && python3 -m unittest -v test_watchdog) || { echo WATCHDOG_TESTS_FAILED; exit 1; }
python3 -m py_compile "$WD/watchdog.py" || exit 1
sudo tee /etc/systemd/system/daube-runtime-watchdog.service >/dev/null <<EOF
[Unit]
Description=D'AUBE Runtime Watchdog + Self-Heal
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=$(id -un)
Environment=HOME=$HOME
Environment=PATH=$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$WD/run.sh
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$BASE
ReadOnlyPaths=$HOME/.config/daube/secrets
EOF
sudo tee /etc/systemd/system/daube-runtime-watchdog.timer >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE runtime watchdog every 10 minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
RandomizedDelaySec=30
Persistent=true
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now daube-runtime-watchdog.timer
sudo systemctl start daube-runtime-watchdog.service || true
echo '=== D’AUBE RUNTIME WATCHDOG V1 ==='
"$WD/run.sh" || true
echo '=== FOUR TIMERS ==='
for t in daube-revenue-worker.timer daube-freelancer-award-watcher.timer daube-freelancer-executor.timer daube-runtime-watchdog.timer; do printf '%-42s ' "$t"; systemctl is-active "$t" || true; done
