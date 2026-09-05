#!/usr/bin/env bash
set -u
BASE="$HOME/daube-revenue-worker"
OPS="$BASE/full-loop"
MC="$OPS/money-closure"
JOBS="$OPS/jobs"
VENV="$HOME/.venvs/freelancer"
TOKEN_FILE="$HOME/.config/daube/secrets/freelancer.token"
mkdir -p "$MC/receipts" "$MC/events"
chmod 700 "$MC" "$MC/receipts" "$MC/events"

cat > "$MC/money_closure.py" <<'PY'
import json,os,re,zipfile
from datetime import datetime,timezone
from pathlib import Path
from freelancersdk.session import Session
from freelancersdk.resources.users.users import get_self_user_id
from freelancersdk.resources.messages.messages import create_project_thread,post_message,post_attachment,get_messages
from freelancersdk.resources.messages.helpers import create_attachment,create_get_messages_object
from freelancersdk.resources.projects.projects import get_milestones
from freelancersdk.resources.projects import request_release_milestone_payment

HOME=Path.home(); BASE=HOME/'daube-revenue-worker'; OPS=BASE/'full-loop'; JOBS=OPS/'jobs'; MC=OPS/'money-closure'
TOKEN_FILE=HOME/'.config/daube/secrets/freelancer.token'; RECEIPTS=MC/'receipts'; EVENTS=MC/'events'/'events.jsonl'; STATE=MC/'state.json'; REVENUE=MC/'revenue-ledger.jsonl'
VERSION='money-closure-v1'; URL='https://www.freelancer.com'
EXPAND_TERMS={'new feature','additional feature','extra feature','new page','additional page','new integration','another integration','redesign entire','full redesign','new platform','mobile app','native app','unlimited revision','additional scope'}
RISK_TERMS={'legal advice','medical diagnosis','therapy','forex','trading bot','crypto trading','gambling','adult content','onsite','on-site','payment wallet','payment gateway','fintech','banking','financial services','money transfer'}
SENSITIVE_NAMES=('secret','token','credential','.env','id_rsa','private_key','apikey','api_key','password')

def now():return datetime.now(timezone.utc).isoformat()
def readj(p):return json.loads(p.read_text())
def atomic(p,o):
 t=p.with_suffix(p.suffix+'.tmp'); t.write_text(json.dumps(o,indent=2,default=str)+'\n'); os.replace(t,p)
def load_state():
 try:return readj(STATE)
 except Exception:return {'version':VERSION,'jobs':{},'settled_keys':[]}
def save_state(s):s['version']=VERSION;s['last_run']=now();atomic(STATE,s)
def event(kind,**kw):
 row={'at':now(),'version':VERSION,'kind':kind,**kw}; EVENTS.parent.mkdir(parents=True,exist_ok=True)
 with EVENTS.open('a') as f:f.write(json.dumps(row,default=str)+'\n')
 print(kind,json.dumps(kw,default=str)[:600])

def delivery_eligible(d):
 try: es=readj(d/'executor-state.json'); man=readj(d/'delivery'/'manifest.json'); qa=readj(d/'qa'/'qa-report.json'); job=readj(d/'job.json')
 except Exception:return False,'MISSING_DELIVERY_EVIDENCE'
 pid=int(job.get('project_id') or 0); bid=int(job.get('bid_id') or 0)
 acc=OPS/'receipts'/f'accept-{pid}-{bid}.json'
 if es.get('state')!='DELIVERY_READY':return False,'EXECUTOR_NOT_DELIVERY_READY'
 if not acc.is_file():return False,'NO_ACCEPT_RECEIPT'
 try:a=readj(acc)
 except Exception:return False,'BAD_ACCEPT_RECEIPT'
 if a.get('authoritative') is not True:return False,'NONAUTHORITATIVE_ACCEPT'
 if man.get('qa_green') is not True or qa.get('green') is not True:return False,'QA_NOT_GREEN'
 if not man.get('artifacts'):return False,'NO_ARTIFACTS'
 return True,'PASS'
def revision_class(text,count):
 s=(text or '').lower()
 if count>=1:return 'HOLD_REVISION_CAP'
 if any(x in s for x in RISK_TERMS):return 'HOLD_RISK'
 if any(x in s for x in EXPAND_TERMS):return 'HOLD_SCOPE_EXPANSION'
 return 'REVISION_REQUIRED' if s.strip() else 'NO_ACTION'
def milestone_status(m):
 status=str(m.get('status') or m.get('state') or '').lower()
 if m.get('released') is True or m.get('is_released') is True or status in {'released','paid'}:return 'SETTLED'
 if status in {'cancelled','canceled','deleted'}:return 'CLOSED_NO_SETTLEMENT'
 return 'OPEN'
def milestone_release_eligible(m):
 try:mid=int(m.get('id') or 0); amount=float(m.get('amount') or 0)
 except Exception:return False
 return mid>0 and amount>0 and milestone_status(m)=='OPEN'
def safe_bundle_files(d):
 out=[]
 for root in (d/'work',d/'delivery',d/'qa'):
  if not root.exists():continue
  for p in root.rglob('*'):
   if not p.is_file():continue
   rel=str(p.relative_to(d)); low=rel.lower()
   if any(x in low for x in SENSITIVE_NAMES):continue
   if '.git/' in low or 'node_modules/' in low or p.name.endswith('.tmp'):continue
   out.append((p,rel))
 return out
def make_bundle(d):
 files=safe_bundle_files(d)
 if not files:raise RuntimeError('NO_SAFE_FILES_TO_BUNDLE')
 z=d/'delivery'/f'daube-delivery-{d.name}.zip'
 with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as arc:
  for p,rel in files:arc.write(p,rel)
 return z

def extract_thread_id(obj):
 if isinstance(obj,dict):
  for k in ('thread_id','id'):
   try:
    v=int(obj.get(k) or 0)
    if v>0:return v
   except Exception:pass
  for v in obj.values():
   r=extract_thread_id(v)
   if r:return r
 if isinstance(obj,(list,tuple)):
  for v in obj:
   r=extract_thread_id(v)
   if r:return r
 for k in ('thread_id','id'):
  try:
   v=int(getattr(obj,k,0) or 0)
   if v>0:return v
  except Exception:pass
 return 0
def message_text(m):
 if not isinstance(m,dict):return ''
 for k in ('message','text','body'):
  v=m.get(k)
  if isinstance(v,str):return v
 return ''
def message_sender(m):
 if not isinstance(m,dict):return 0
 for k in ('from_user','from_user_id','user_id','sender_id'):
  v=m.get(k)
  if isinstance(v,dict):v=v.get('id')
  try:
   n=int(v or 0)
   if n:return n
  except Exception:pass
 return 0
def message_id(m):
 try:return int(m.get('id') or m.get('message_id') or 0)
 except Exception:return 0

def get_project_milestones(session,pid):
 try:r=get_milestones(session,project_ids=[pid],limit=100,offset=0)
 except Exception as e:event('MILESTONE_READ_FAIL',project_id=pid,error=type(e).__name__+':'+str(e)[:180]);return []
 if isinstance(r,dict):return r.get('milestones') or []
 return []
def append_revenue(st,pid,m):
 mid=int(m.get('id') or 0); key=f'{pid}:{mid}'
 if not mid or key in st['settled_keys']:return False
 row={'at':now(),'provider':'freelancer','evidence':'official_get_milestones_released_or_paid','project_id':pid,'milestone_id':mid,'amount':m.get('amount'),'currency':(m.get('currency') or {}).get('code') if isinstance(m.get('currency'),dict) else m.get('currency'),'provider_status':m.get('status') or m.get('state'),'authoritative_external_settlement':True}
 with REVENUE.open('a') as f:f.write(json.dumps(row,default=str)+'\n')
 st['settled_keys'].append(key);event('REVENUE_SETTLED',project_id=pid,milestone_id=mid,amount=m.get('amount'));return True

def deliver(session,me,d,js):
 job=readj(d/'job.json');pid=int(job['project_id']);owner=job.get('client_owner_id') or job.get('owner_id')
 if not owner:return False,'NO_CLIENT_OWNER'
 bundle=make_bundle(d)
 msg='Delivery is ready for the awarded scope. I attached the implementation bundle plus handoff/QA evidence. Please review against the posted acceptance criteria; one bounded in-scope revision cycle is included.'
 try:
  tr=create_project_thread(session,[int(owner)],pid,msg);tid=extract_thread_id(tr)
  if not tid:return False,'THREAD_ID_NOT_RETURNED'
  fh=bundle.open('rb')
  try:att=post_attachment(session,thread_id=tid,attachments=[create_attachment(fh,bundle.name)])
  finally:fh.close()
 except Exception as e:
  event('DELIVERY_FAIL_CLOSED',project_id=pid,error=type(e).__name__+':'+str(e)[:180]);return False,'PROVIDER_WRITE_FAILED'
 rec={'authoritative':True,'provider':'freelancer_official_sdk','action':'delivery_message_and_attachment','at':now(),'project_id':pid,'thread_id':tid,'bundle':bundle.name,'thread_result':str(tr)[:1000],'attachment_result':str(att)[:1000]}
 atomic(RECEIPTS/f'delivery-{pid}.json',rec);js.update({'state':'DELIVERY_SENT','thread_id':tid,'delivery_at':now(),'revision_count':int(js.get('revision_count') or 0),'last_message_id':0});atomic(d/'executor-state.json',{'version':'v8-provider-neutral-executor','state':'DELIVERY_SENT','at':now()});event('DELIVERY_SENT',project_id=pid,thread_id=tid);return True,'PASS'
def inspect_reply(session,me,d,js):
 tid=int(js.get('thread_id') or 0)
 if not tid:return
 try:r=get_messages(session,create_get_messages_object(threads=[tid],user_details=True))
 except Exception as e:event('MESSAGE_READ_FAIL',project_id=d.name,error=type(e).__name__+':'+str(e)[:180]);return
 msgs=(r.get('messages') or []) if isinstance(r,dict) else []
 last=int(js.get('last_message_id') or 0)
 candidates=[]
 for m in msgs:
  mid=message_id(m);sender=message_sender(m);txt=message_text(m)
  if mid>last:last=max(last,mid)
  if mid and mid>int(js.get('last_message_id') or 0) and sender and sender!=int(me) and txt:candidates.append((mid,txt))
 js['last_message_id']=last
 if not candidates:return
 mid,txt=sorted(candidates)[-1];cls=revision_class(txt,int(js.get('revision_count') or 0))
 if cls=='REVISION_REQUIRED':
  js['revision_count']=int(js.get('revision_count') or 0)+1;js['state']='REVISION_REQUIRED';atomic(d/'REVISION_REQUEST.json',{'at':now(),'message_id':mid,'client_request':txt,'scope_policy':'LOCKED_SCOPE_ONLY'});atomic(d/'EXECUTOR_JOB.json',{'project_id':int(d.name),'state':'READY_FOR_EXECUTOR','revision':js['revision_count'],'revision_request':str(d/'REVISION_REQUEST.json')});atomic(d/'executor-state.json',{'version':'v8-provider-neutral-executor','state':'REVISION_REQUIRED','at':now()});event('REVISION_QUEUED',project_id=d.name,message_id=mid)
 elif cls.startswith('HOLD_'):
  js['state']='HOLD_FOUNDER_GATE';atomic(d/'FOUNDER_ACTION_REQUIRED.json',{'at':now(),'reason':cls,'message_id':mid,'client_request':txt});event('REVISION_HOLD',project_id=d.name,reason=cls)

def main():
 token=TOKEN_FILE.read_text().strip();session=Session(oauth_token=token,url=URL);me=get_self_user_id(session);st=load_state();JOBS.mkdir(parents=True,exist_ok=True)
 jobs=[d for d in JOBS.iterdir() if d.is_dir()];print(f'VERSION={VERSION} JOBS={len(jobs)} USER={me}')
 for d in jobs:
  try:job=readj(d/'job.json');pid=int(job.get('project_id') or d.name)
  except Exception:continue
  js=st['jobs'].setdefault(str(pid),{'state':'DISCOVERED','revision_count':0})
  if js.get('state') in {'DISCOVERED','DELIVERY_READY'}:
   ok,reason=delivery_eligible(d)
   if ok and not (RECEIPTS/f'delivery-{pid}.json').is_file():deliver(session,me,d,js)
   elif not ok:js['hold_reason']=reason
  if js.get('state') in {'DELIVERY_SENT','WAITING_CLIENT'}:
   js['state']='WAITING_CLIENT';inspect_reply(session,me,d,js)
  miles=get_project_milestones(session,pid)
  for m in miles:
   if milestone_status(m)=='SETTLED':append_revenue(st,pid,m)
  if js.get('state') in {'DELIVERY_SENT','WAITING_CLIENT'} and (RECEIPTS/f'delivery-{pid}.json').is_file():
   requested=(RECEIPTS/f'milestone-release-{pid}.json').is_file()
   if not requested:
    eligible=[m for m in miles if milestone_release_eligible(m)]
    if eligible:
     m=eligible[0];mid=int(m['id'])
     try:r=request_release_milestone_payment(session,milestone_id=mid)
     except Exception as e:event('MILESTONE_RELEASE_REQUEST_FAIL',project_id=pid,milestone_id=mid,error=type(e).__name__+':'+str(e)[:180])
     else:
      atomic(RECEIPTS/f'milestone-release-{pid}.json',{'authoritative':True,'provider':'freelancer_official_sdk','action':'request_release_milestone_payment','at':now(),'project_id':pid,'milestone_id':mid,'result':str(r)[:1200]});js['state']='SETTLEMENT_PENDING';event('MILESTONE_RELEASE_REQUESTED',project_id=pid,milestone_id=mid)
  if any(milestone_status(m)=='SETTLED' for m in miles):js['state']='SETTLED'
 save_state(st)
if __name__=='__main__':main()
PY

cat > "$MC/test_money_closure.py" <<'PY'
import json,tempfile,unittest
from pathlib import Path
import money_closure as m
class T(unittest.TestCase):
 def job(self):
  td=tempfile.TemporaryDirectory();d=Path(td.name);(d/'delivery').mkdir();(d/'qa').mkdir();(d/'work').mkdir();
  (d/'executor-state.json').write_text(json.dumps({'state':'DELIVERY_READY'}));(d/'delivery'/'manifest.json').write_text(json.dumps({'qa_green':True,'artifacts':[{'path':'x'}]}));(d/'qa'/'qa-report.json').write_text(json.dumps({'green':True}));(d/'job.json').write_text(json.dumps({'project_id':1,'bid_id':2}));return td,d
 def test_revision_cap(self):self.assertEqual(m.revision_class('fix this bug',1),'HOLD_REVISION_CAP')
 def test_scope_expansion(self):self.assertEqual(m.revision_class('please add new feature',0),'HOLD_SCOPE_EXPANSION')
 def test_in_scope_revision(self):self.assertEqual(m.revision_class('please fix button spacing',0),'REVISION_REQUIRED')
 def test_settlement_strict(self):
  self.assertEqual(m.milestone_status({'status':'released'}),'SETTLED');self.assertEqual(m.milestone_status({'status':'pending'}),'OPEN')
 def test_release_eligibility(self):
  self.assertTrue(m.milestone_release_eligible({'id':4,'amount':100,'status':'pending'}));self.assertFalse(m.milestone_release_eligible({'id':4,'amount':100,'status':'released'}))
 def test_sensitive_bundle_exclusion(self):
  td,d=self.job();(d/'work'/'app.py').write_text('x');(d/'work'/'.env').write_text('secret');names=[r for _,r in m.safe_bundle_files(d)];self.assertIn('work/app.py',names);self.assertNotIn('work/.env',names);td.cleanup()
if __name__=='__main__':unittest.main()
PY

cat > "$MC/run.sh" <<'SH'
#!/usr/bin/env bash
set -u
exec "$HOME/.venvs/freelancer/bin/python" "$HOME/daube-revenue-worker/full-loop/money-closure/money_closure.py"
SH
chmod 700 "$MC/run.sh"
(cd "$MC" && PYTHONPATH="$MC" "$VENV/bin/python" -m unittest -v test_money_closure) || { echo MONEY_CLOSURE_TESTS_FAILED; exit 1; }
"$VENV/bin/python" -m py_compile "$MC/money_closure.py" || exit 1
sudo tee /etc/systemd/system/daube-freelancer-money-closure.service >/dev/null <<EOF
[Unit]
Description=D'AUBE Freelancer Delivery/Milestone/Settlement Closure
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=$(id -un)
Environment=HOME=$HOME
ExecStart=$MC/run.sh
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$BASE
ReadOnlyPaths=$HOME/.config/daube/secrets $HOME/.venvs/freelancer
EOF
sudo tee /etc/systemd/system/daube-freelancer-money-closure.timer >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Freelancer money closure
[Timer]
OnBootSec=8min
OnUnitActiveSec=15min
Persistent=true
RandomizedDelaySec=45
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now daube-freelancer-money-closure.timer
sudo systemctl start daube-freelancer-money-closure.service || true
echo '=== D’AUBE FREELANCER MONEY CLOSURE V1 ==='
"$MC/run.sh" || true
echo '=== TIMER ==='
systemctl is-active daube-freelancer-money-closure.timer || true
echo '=== REVENUE LEDGER ==='
tail -n 10 "$MC/revenue-ledger.jsonl" 2>/dev/null || true
