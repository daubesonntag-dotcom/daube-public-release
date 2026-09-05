#!/usr/bin/env bash
set -u

BASE="$HOME/daube-revenue-worker"
VENV="$HOME/.venvs/freelancer"
TOKEN_FILE="$HOME/.config/daube/secrets/freelancer.token"
OPS="$BASE/full-loop"
mkdir -p "$OPS/jobs" "$OPS/events" "$OPS/receipts" "$OPS/dead-letter"
chmod 700 "$OPS" "$OPS/jobs" "$OPS/events" "$OPS/receipts" "$OPS/dead-letter"

if [ ! -r "$TOKEN_FILE" ]; then echo "ERROR missing Freelancer token"; exit 1; fi
if [ ! -x "$VENV/bin/python" ]; then echo "ERROR missing Freelancer venv"; exit 1; fi

cat > "$OPS/award_watcher.py" <<'PY'
import json, re, time
from datetime import datetime, timezone
from pathlib import Path
from freelancersdk.session import Session
from freelancersdk.resources.projects.projects import get_bids, get_project_by_id, accept_project_bid, get_milestones, create_milestone_request
from freelancersdk.resources.projects.helpers import create_get_projects_project_details_object, create_get_projects_user_details_object
from freelancersdk.resources.messages.messages import create_project_thread, get_threads, get_messages
from freelancersdk.resources.messages.helpers import create_get_threads_object, create_get_threads_details_object, create_get_messages_object
from freelancersdk.resources.users.users import get_self_user_id

HOME=Path.home(); BASE=HOME/'daube-revenue-worker'; OPS=BASE/'full-loop'
TOKEN_FILE=HOME/'.config/daube/secrets/freelancer.token'
OPP_LOG=BASE/'opportunities.jsonl'; BID_RECEIPTS=BASE/'receipts'
LIVE_BASE=HOME/'daube-freelancer-live'; LIVE_BID_RECEIPTS=LIVE_BASE/'receipts'; LIVE_PROCESSED=LIVE_BASE/'processed'
STATE=OPS/'state.json'; JOBS=OPS/'jobs'; EVENTS=OPS/'events'; RECEIPTS=OPS/'receipts'
URL='https://www.freelancer.com'
VERSION='v7-full-loop-control-plane'
BLOCKED_TERMS={'tax','taxation','legal','medical','healthcare','therapy','trading','forex','crypto','gambling','adult','onsite','on-site','enterprise platform','full platform','complete platform','multi-tenant','native ios','native android','payment wallet','payment gateway','fintech','banking','financial services','money transfer'}

def now(): return datetime.now(timezone.utc).isoformat()
def load_state():
    try: return json.loads(STATE.read_text())
    except Exception: return {'version':VERSION,'accepted':{},'messaged':{},'milestone_requested':{},'last_run':None}
def save_state(s): s['version']=VERSION; s['last_run']=now(); STATE.write_text(json.dumps(s,indent=2)+'\n')
def log_event(kind,payload):
    row={'at':now(),'kind':kind,**payload}
    with (EVENTS/'events.jsonl').open('a') as f: f.write(json.dumps(row)+'\n')
    print(kind, json.dumps(payload, ensure_ascii=False)[:700])
def read_auto_ready(project_id):
    if not OPP_LOG.exists(): return None
    best=None
    for line in OPP_LOG.read_text().splitlines():
        try: x=json.loads(line)
        except Exception: continue
        if int(x.get('project_id') or 0)!=int(project_id): continue
        if x.get('decision')=='AUTO_BID_READY' or (int(x.get('score') or 0)>=88 and x.get('proposal')):
            if best is None or int(x.get('timestamp') or 0)>int(best.get('timestamp') or 0): best=x
    return best

def read_live_packet(project_id):
    p=LIVE_PROCESSED/f'freelancer-{int(project_id)}.json'
    if not p.is_file(): return None
    try: x=json.loads(p.read_text())
    except Exception: return None
    try: period=int(x.get('period') or 0)
    except Exception: period=0
    desc=x.get('description') if isinstance(x.get('description'),str) else ''
    guard=(x.get('confirm_standard_contract') is True and x.get('paid_spend_required') is not True and x.get('nonstandard_legal_terms') is not True and 1<=period<=3 and len(desc.strip())>=80)
    if not guard: return None
    return {'authority_source':'live_packet','live_packet_guard':True,'estimated_hours':period*24,'proposal':desc,'score':None}

def bid_receipts():
    out=[]
    seen=set()
    for root in (BID_RECEIPTS,LIVE_BID_RECEIPTS):
        if not root.exists(): continue
        for p in root.glob('*.json'):
            try:
                x=json.loads(p.read_text()); key=(int(x.get('project_id') or 0),int(x.get('bid_id') or 0))
                if x.get('authoritative') is True and key[0]>0 and key[1]>0 and key not in seen:
                    out.append(x); seen.add(key)
            except Exception: pass
    return out

def extract_selected_bid_ids(project):
    vals=[]
    sb=project.get('selected_bids') or []
    if isinstance(sb,dict): sb=list(sb.values())
    if isinstance(sb,list):
        for b in sb:
            if isinstance(b,dict):
                try: vals.append(int(b.get('id') or b.get('bid_id') or 0))
                except Exception: pass
            else:
                try: vals.append(int(b))
                except Exception: pass
    return {x for x in vals if x>0}

def safe_contract(op, project):
    text=((project.get('title') or '')+' '+(project.get('description') or '')).lower()
    if any(t in text for t in BLOCKED_TERMS): return False,'BLOCKED_SCOPE'
    if not op: return False,'NO_PRIOR_QUALIFICATION'
    if op.get('authority_source')=='live_packet':
        if op.get('live_packet_guard') is not True: return False,'LIVE_PACKET_GUARD_FAILED'
    elif int(op.get('score') or 0)<88: return False,'LOW_SCORE'
    if int(op.get('estimated_hours') or 999)>72: return False,'OVER_72H'
    if not op.get('proposal'): return False,'NO_PROPOSAL_EVIDENCE'
    return True,'STANDARD_AUTHORITY_PASS'

def ensure_workspace(project,bid,op):
    pid=int(project['id']); d=JOBS/str(pid); d.mkdir(parents=True,exist_ok=True)
    manifest={
      'version':VERSION,'project_id':pid,'bid_id':int(bid['bid_id']),'title':project.get('title'),'status':'AWARDED_ACCEPTED',
      'created_at':now(),'source_url':f'https://www.freelancer.com/projects/{pid}',
      'acceptance_guard':'STANDARD_AUTHORITY_PASS','estimated_hours':op.get('estimated_hours'),'qualification_score':op.get('score'),
      'client_owner_id':project.get('owner_id') or project.get('owner'),'scope':project.get('description'),'proposal':op.get('proposal'),
      'delivery_policy':{'max_hours':72,'revision_cycles':1,'scope_expansion':'PAID_CHANGE_ORDER_REQUIRED','revenue_truth':'SETTLED_EXTERNAL_ONLY'}
    }
    (d/'job.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (d/'SCOPE.md').write_text(f"# {project.get('title','Project')}\n\n## Client scope\n{project.get('description') or ''}\n\n## Locked operating rules\n- Deliver only the awarded scope.\n- No scope expansion without an agreed paid change order.\n- One bounded revision cycle.\n- QA evidence required before delivery.\n- Never represent D’AUBE-owned work as client work.\n")
    (d/'STATUS').write_text('AWARDED_ACCEPTED\n')
    return d

def main():
    token=TOKEN_FILE.read_text().strip(); session=Session(oauth_token=token,url=URL); me=get_self_user_id(session); st=load_state()
    receipts=bid_receipts(); print(f'VERSION={VERSION} USER={me} TRACKED_BIDS={len(receipts)}')
    pd=create_get_projects_project_details_object(full_description=True,jobs=True,selected_bids=True,qualifications=True)
    ud=create_get_projects_user_details_object(basic=True,reputation=True,employer_reputation=True,status=True,financial=True)
    for br in receipts:
        pid=int(br['project_id']); bid_id=int(br['bid_id']); op=read_auto_ready(pid) or read_live_packet(pid)
        try: project=get_project_by_id(session,pid,project_details=pd,user_details=ud)
        except Exception as e: log_event('PROJECT_READ_FAIL',{'project_id':pid,'error':str(e)[:180]}); continue
        if isinstance(project,dict) and 'result' in project and isinstance(project['result'],dict): project=project['result']
        selected=extract_selected_bid_ids(project)
        if bid_id not in selected:
            log_event('AWARD_NOT_YET_CONFIRMED',{'project_id':pid,'bid_id':bid_id,'selected_bid_ids':sorted(selected)[:10]}); continue
        ok,reason=safe_contract(op,project)
        if not ok:
            log_event('AWARD_FOUNDER_GATE',{'project_id':pid,'bid_id':bid_id,'reason':reason}); continue
        key=str(bid_id)
        if key not in st['accepted']:
            try:
                r=accept_project_bid(session,bid_id)
                st['accepted'][key]={'at':now(),'project_id':pid,'result':r}
                (RECEIPTS/f'accept-{pid}-{bid_id}.json').write_text(json.dumps({'authoritative':True,'provider':'freelancer_official_sdk','action':'accept_project_bid','at':now(),'project_id':pid,'bid_id':bid_id,'result':r},indent=2,default=str)+'\n')
                log_event('AWARD_ACCEPTED',{'project_id':pid,'bid_id':bid_id})
            except Exception as e:
                log_event('ACCEPT_FAIL_CLOSED',{'project_id':pid,'bid_id':bid_id,'error':str(e)[:220]}); continue
        d=ensure_workspace(project,br,op)
        owner=project.get('owner_id') or project.get('owner')
        if owner and str(pid) not in st['messaged']:
            msg=("Thanks — I’ve accepted the awarded project and locked the scope to the posted requirements. "
                 "I’m starting with acceptance criteria and environment/access validation, then implementation and QA. "
                 "If any required repository, credentials, sample data, or deployment access is not yet available, please send it in this project thread. "
                 "I’ll flag any material scope change before proceeding beyond the agreed work.")
            try:
                tr=create_project_thread(session,[int(owner)],pid,msg)
                st['messaged'][str(pid)]={'at':now(),'thread_result':tr}
                (d/'STATUS').write_text('WAITING_FOR_INPUT_OR_EXECUTION\n')
                log_event('CLIENT_THREAD_OPENED',{'project_id':pid})
            except Exception as e: log_event('MESSAGE_FAIL_CLOSED',{'project_id':pid,'error':str(e)[:220]})
        task={
          'project_id':pid,'bid_id':bid_id,'created_at':now(),'state':'READY_FOR_EXECUTOR',
          'workspace':str(d),'requirements_file':str(d/'SCOPE.md'),
          'executor_contract':{'must_read_client_thread':True,'must_produce_tests':True,'must_produce_qa_evidence':True,'may_request_one_revision':True,'may_expand_scope':False,'may_spend_money':False}
        }
        (d/'EXECUTOR_JOB.json').write_text(json.dumps(task,indent=2)+'\n')
        log_event('EXECUTOR_JOB_READY',{'project_id':pid,'workspace':str(d)})
    save_state(st)

if __name__=='__main__': main()
PY

cat > "$OPS/run-award-watcher.sh" <<'SH'
#!/usr/bin/env bash
set -u
exec "$HOME/.venvs/freelancer/bin/python" "$HOME/daube-revenue-worker/full-loop/award_watcher.py"
SH
chmod 700 "$OPS/run-award-watcher.sh"

sudo tee /etc/systemd/system/daube-freelancer-award-watcher.service >/dev/null <<EOF
[Unit]
Description=D'AUBE Freelancer Award & Delivery Control Plane v7
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=$(id -un)
Environment=HOME=$HOME
ExecStart=$OPS/run-award-watcher.sh
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$BASE
ReadOnlyPaths=$HOME/.config/daube/secrets $HOME/.venvs/freelancer
EOF

sudo tee /etc/systemd/system/daube-freelancer-award-watcher.timer >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Freelancer award watcher
[Timer]
OnBootSec=4min
OnUnitActiveSec=15min
Persistent=true
RandomizedDelaySec=45
[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now daube-freelancer-award-watcher.timer
sudo systemctl start daube-freelancer-award-watcher.service || true

echo "=== D'AUBE FREELANCER FULL LOOP V7 ==="
"$OPS/run-award-watcher.sh" || true
echo "=== TIMERS ==="
systemctl is-active daube-revenue-worker.timer || true
systemctl is-active daube-freelancer-award-watcher.timer || true
systemctl --no-pager list-timers daube-revenue-worker.timer daube-freelancer-award-watcher.timer || true
echo "=== FULL-LOOP EVENTS ==="
tail -n 20 "$OPS/events/events.jsonl" 2>/dev/null || true
echo "=== JOB WORKSPACES ==="
find "$OPS/jobs" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null || true
