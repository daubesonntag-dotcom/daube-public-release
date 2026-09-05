#!/usr/bin/env bash
set -u

BASE="$HOME/daube-revenue-worker"
TOKEN_FILE="$HOME/.config/daube/secrets/freelancer.token"
VENV="$HOME/.venvs/freelancer"
mkdir -p "$BASE" "$BASE/receipts" "$BASE/packets"
chmod 700 "$BASE" "$BASE/receipts" "$BASE/packets"

if [ ! -r "$TOKEN_FILE" ]; then echo "❌ Missing token file: $TOKEN_FILE"; exit 0; fi
if [ ! -x "$VENV/bin/python" ]; then echo "❌ Missing Freelancer venv: $VENV"; exit 0; fi

cat > "$BASE/worker.py" <<'PY'
import json, time
from datetime import datetime, timezone
from pathlib import Path
import requests
from freelancersdk.session import Session
from freelancersdk.resources.projects.projects import search_projects, get_projects
from freelancersdk.resources.projects.helpers import (
    create_search_projects_filter,
    create_get_projects_object,
    create_get_projects_project_details_object,
    create_get_projects_user_details_object,
)

VERSION="v5-scope-safe-autobid"
HOME=Path.home(); BASE=HOME/"daube-revenue-worker"
TOKEN_FILE=HOME/".config/daube/secrets/freelancer.token"
STATE_FILE=BASE/"state.json"; LOG_FILE=BASE/"opportunities.jsonl"
PACKET_DIR=BASE/"packets"; RECEIPT_DIR=BASE/"receipts"
URL="https://www.freelancer.com"
AUTO_BID_THRESHOLD=88
MAX_AUTO_BIDS_PER_RUN=2
MAX_AUTO_BIDS_PER_DAY=4

QUERIES=[
  "React TypeScript bug fix", "Next.js fix", "API integration",
  "AI chatbot integration", "RAG chatbot", "n8n automation",
  "webhook automation", "FastAPI API", "website QA testing",
  "Google API integration", "small frontend fix"
]

LANES={
 "frontend": {"react","typescript","javascript","next.js","nextjs","frontend","html","css","tailwind"},
 "api": {"api","rest api","webhook","integration","fastapi","python"},
 "ai": {"chatbot","openai","llm","rag","ai assistant"},
 "automation": {"automation","n8n","make.com","workflow","webhook"},
 "qa": {"qa","testing","test website","bug testing","ux testing"},
}

HARD_BLOCK={
 "tax","taxation","accounting compliance","legal advice","law firm","medical","healthcare","telehealth",
 "diagnosis","therapy","mental health","trading","forex","crypto","betting","gambling","casino",
 "power bi","tableau","dynamics 365","sap","tallyprime","gohighlevel","marketing campaign","seo campaign",
 "social media marketing","r3f","three fiber","three.js game","3d game","unity","unreal engine",
 "wordpress theme from scratch","native ios","native android","blockchain","web3","scrape captcha","bypass captcha",
 "adult","fake review","mass account"
}

SCOPE_BLOCK={
 "complete platform","full platform","entire platform","marketplace","multi-tenant","erp","fleet management",
 "full crm","enterprise solution","enterprise platform","admin panel and mobile app","from scratch end to end",
 "payment gateway system","full saas","complete saas","multi-vendor","full ecommerce platform"
}

SAFE_DELIVERABLES={
 "bug fix","fix","integration","api integration","webhook","chatbot integration","rag chatbot",
 "automation","workflow","landing page","small website","frontend component","dashboard fix",
 "qa testing","website testing","api endpoint","fastapi endpoint","deployment fix","configuration"
}

def now_iso(): return datetime.now(timezone.utc).isoformat()
def token(): return TOKEN_FILE.read_text().strip()
def headers(json_body=False):
    h={"Freelancer-OAuth-V1":token(),"Accept":"application/json","User-Agent":"D-AUBE-Revenue-Worker/5.0"}
    if json_body: h["Content-Type"]="application/json"
    return h

def load_state():
    try: s=json.loads(STATE_FILE.read_text())
    except Exception: s={}
    if s.get("version")!=VERSION: return {"version":VERSION,"submitted":[],"daily":{}}
    return s

def save_state(s):
    s["version"]=VERSION; STATE_FILE.write_text(json.dumps(s,indent=2)+"\n")

def nested_truthy(obj, keys):
    if isinstance(obj,dict):
        for k,v in obj.items():
            if str(k).lower() in keys and v in (True,1,"true","verified"): return True
            if nested_truthy(v,keys): return True
    elif isinstance(obj,list): return any(nested_truthy(v,keys) for v in obj)
    return False

def nested_num(obj, keys):
    best=0
    if isinstance(obj,dict):
        for k,v in obj.items():
            if str(k).lower() in keys and isinstance(v,(int,float)): best=max(best,float(v))
            best=max(best,nested_num(v,keys))
    elif isinstance(obj,list):
        for v in obj: best=max(best,nested_num(v,keys))
    return best

def detail_batch(session, ids):
    q=create_get_projects_object(
      project_ids=ids,
      project_details=create_get_projects_project_details_object(full_description=True,jobs=True,qualifications=True),
      user_details=create_get_projects_user_details_object(basic=True,profile_description=True,reputation=True),
    )
    return get_projects(session,q)

def user_for(result,p):
    owner=p.get("owner_id") or p.get("owner"); users=result.get("users") or {}
    if isinstance(users,dict): return users.get(str(owner)) or users.get(owner) or {}
    if isinstance(users,list):
        for u in users:
            if str(u.get("id"))==str(owner): return u
    return {}

def lane_hits(text):
    hits={}
    for lane,terms in LANES.items():
        n=sum(1 for t in terms if t in text)
        if n: hits[lane]=n
    return hits

def score_project(p,user):
    title=(p.get("title") or "").strip(); desc=(p.get("description") or "").strip()
    jobs=p.get("jobs") or []; skills=[str(j.get("name","")).strip() for j in jobs if isinstance(j,dict)]
    text=(title+" "+desc+" "+" ".join(skills)).lower()
    reasons=[]

    if any(x in text for x in HARD_BLOCK): return 0,["hard_domain_block"],skills,0,False
    if any(x in text for x in SCOPE_BLOCK): return 0,["hard_scope_block"],skills,0,False
    if (p.get("type") or "").lower()!="fixed": return 0,["not_fixed_price"],skills,0,False
    if (p.get("status") or "").lower()!="active": return 0,["not_active"],skills,0,False

    lanes=lane_hits(text)
    strong_lanes=[k for k,v in lanes.items() if v>=2]
    if not strong_lanes: return 0,["no_strong_service_lane"],skills,0,False

    safe_shape=any(x in text for x in SAFE_DELIVERABLES)
    if not safe_shape and len(desc)>1800: return 0,["unbounded_deliverable"],skills,0,False

    budget=p.get("budget") or {}; currency=(p.get("currency") or {}).get("code") or ""
    try: lo=float(budget.get("minimum") or 0); hi=float(budget.get("maximum") or 0)
    except Exception: lo=hi=0

    score=56
    score+=min(sum(lanes.values())*4,20)
    reasons.append("lanes="+",".join(sorted(strong_lanes)))
    if safe_shape: score+=8; reasons.append("bounded_deliverable")
    if 120<=len(desc)<=2200: score+=6; reasons.append("bounded_spec")
    elif len(desc)>4000: score-=20; reasons.append("long_spec")

    usd_guard=(currency=="USD" and 25<=lo<=hi<=1000 and hi>=80)
    if usd_guard: score+=8; reasons.append("usd_budget_guard")
    else: reasons.append("manual_budget_currency_gate")

    payment=nested_truthy(user,{"payment_verified","payment_verified_status","verified_payment"})
    history=nested_num(user.get("reputation",user),{"reviews","review_count","reviews_count","completed_projects","project_count"})
    if payment: score+=6; reasons.append("payment_verified")
    if history>0: score+=4; reasons.append("client_history")

    hours=24
    if len(desc)>1600: hours=48
    if len(desc)>3000: hours=96

    auto_credible=payment or history>=1
    return max(0,min(score,100)),reasons,skills,hours,(usd_guard and auto_credible and safe_shape)

def proposal(p,skills,hours):
    title=(p.get("title") or "your project").strip(); focus=", ".join(skills[:5]) if skills else "the requested scope"
    days=1 if hours<=24 else 2
    return (
      f"Hi — I reviewed {title}. This is a good fit for my work around {focus}. "
      "I’ll first freeze the acceptance criteria, reproduce/map the current behavior, then implement the smallest production-ready fix or integration with explicit error handling and QA evidence. "
      f"For the stated bounded scope I can target delivery in {days}–3 days, including verification and a concise handoff. "
      "Any examples I provide will be clearly identified as D’AUBE-owned work, not presented as past client work. If access or hidden dependencies materially change the scope, I’ll surface that before expanding the commitment."
    )

def self_id():
    r=requests.get(f"{URL}/api/users/0.1/self/",headers=headers(),timeout=20); r.raise_for_status()
    uid=int(r.json()["result"]["id"])
    if uid<=0: raise RuntimeError("FREELANCER_SELF_ID_MISSING")
    return uid

def bid_amount(p):
    b=p.get("budget") or {}; lo=float(b.get("minimum") or 0); hi=float(b.get("maximum") or 0)
    return round(max(lo,min(hi,lo+0.32*(hi-lo))),2)

def submit_bid(p,score,desc,hours):
    amount=bid_amount(p); period=1 if hours<=24 else 2
    payload={"project_id":int(p["id"]),"bidder_id":self_id(),"amount":amount,"period":period,"milestone_percentage":100,"description":desc}
    packet={"source":"freelancer_official_api","created_at":now_iso(),"qualification_score":score,"estimated_hours":hours,**payload}
    (PACKET_DIR/f"{p['id']}.json").write_text(json.dumps(packet,indent=2)+"\n")
    r=requests.post(f"{URL}/api/projects/0.1/bids/",headers=headers(True),json=payload,timeout=30)
    body=r.json() if r.content else {}
    if not r.ok: raise RuntimeError(body.get("message") or f"HTTP_{r.status_code}")
    bid_id=int((body.get("result") or {}).get("id") or 0)
    if bid_id<=0: raise RuntimeError("AUTHORITATIVE_BID_ID_MISSING")
    receipt={"type":"marketplace_submission_receipt","authoritative":True,"provider":"freelancer_official_api","recorded_at":now_iso(),"project_id":int(p["id"]),"bid_id":bid_id,"submitted_amount":amount,"delivery_days":period,"qualification_score":score,"request_id":body.get("request_id")}
    (RECEIPT_DIR/f"{p['id']}-{bid_id}.json").write_text(json.dumps(receipt,indent=2)+"\n")
    return receipt

def main():
    t=token()
    if not t: print("TOKEN_MISSING"); return
    session=Session(oauth_token=t,url=URL); state=load_state(); submitted=set(map(int,state.get("submitted",[])))
    flt=create_search_projects_filter(sort_field="time_updated",or_search_query=True)
    ids=[]
    for q in QUERIES:
        try: result=search_projects(session,query=q,active_only=True,search_filter=flt)
        except Exception as e: print("SEARCH_FAIL",q,type(e).__name__,str(e)[:140]); continue
        for p in result.get("projects",[]):
            pid=int(p.get("id") or 0)
            if pid>0 and pid not in ids and pid not in submitted: ids.append(pid)
            if len(ids)>=80: break
        if len(ids)>=80: break

    rejected=0; qualified=[]; auto_ready=[]
    for start in range(0,len(ids),20):
        try: detail=detail_batch(session,ids[start:start+20])
        except Exception as e: print("DETAIL_FAIL",type(e).__name__,str(e)[:160]); continue
        for p in detail.get("projects",[]):
            pid=int(p.get("id") or 0); user=user_for(detail,p)
            score,reasons,skills,hours,auto_guard=score_project(p,user)
            prop=proposal(p,skills,hours) if score>=76 else None
            decision="REJECT"
            if score>=76: decision="QUALIFIED"
            if score>=AUTO_BID_THRESHOLD and hours<=72 and auto_guard and prop: decision="AUTO_BID_READY"
            rec={"timestamp":int(time.time()),"scorer_version":VERSION,"project_id":pid,"title":p.get("title"),"score":score,"decision":decision,"reasons":reasons,"estimated_hours":hours,"budget":p.get("budget"),"currency":p.get("currency"),"skills":skills,"proposal":prop,"url":f"https://www.freelancer.com/projects/{pid}"}
            with LOG_FILE.open("a") as f: f.write(json.dumps(rec)+"\n")
            if decision=="REJECT": rejected+=1
            else: qualified.append(rec)
            if decision=="AUTO_BID_READY": auto_ready.append((p,rec))

    today=datetime.now(timezone.utc).date().isoformat(); daily=state.setdefault("daily",{}); used=int(daily.get(today,0))
    allowance=max(0,min(MAX_AUTO_BIDS_PER_RUN,MAX_AUTO_BIDS_PER_DAY-used)); submitted_now=0
    for p,rec in sorted(auto_ready,key=lambda x:x[1]["score"],reverse=True):
        pid=int(p["id"])
        if submitted_now>=allowance or pid in submitted: break
        try:
            receipt=submit_bid(p,rec["score"],rec["proposal"],rec["estimated_hours"])
            submitted.add(pid); submitted_now+=1
            print("SUBMITTED",pid,"BID_ID",receipt["bid_id"],"SCORE",rec["score"])
        except Exception as e: print("BID_FAIL",pid,type(e).__name__,str(e)[:180])

    daily[today]=used+submitted_now; state["submitted"]=sorted(submitted)[-1000:]; save_state(state)
    print(f"VERSION={VERSION} SCANNED={len(ids)} REJECTED={rejected} QUALIFIED={len(qualified)} AUTO_READY={len(auto_ready)} SUBMITTED={submitted_now}")
    for c in sorted(qualified,key=lambda x:x["score"],reverse=True)[:12]: print(c["score"],c["decision"],c["project_id"],c["title"],c["url"])

if __name__=="__main__": main()
PY

cat > "$BASE/run.sh" <<'SH'
#!/usr/bin/env bash
set -u
VENV="$HOME/.venvs/freelancer"
exec "$VENV/bin/python" "$HOME/daube-revenue-worker/worker.py"
SH
chmod 700 "$BASE/run.sh"

sudo tee /etc/systemd/system/daube-revenue-worker.service >/dev/null <<EOF2
[Unit]
Description=D'AUBE Freelancer Revenue Worker v5
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=$(id -un)
Environment=HOME=$HOME
ExecStart=$BASE/run.sh
Nice=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$HOME/daube-revenue-worker
ReadOnlyPaths=$HOME/.config/daube/secrets $HOME/.venvs/freelancer
EOF2

sudo tee /etc/systemd/system/daube-revenue-worker.timer >/dev/null <<'EOF2'
[Unit]
Description=Run D'AUBE Freelancer Revenue Worker v5
[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true
RandomizedDelaySec=45
[Install]
WantedBy=timers.target
EOF2

sudo systemctl daemon-reload
sudo systemctl enable --now daube-revenue-worker.timer
sudo systemctl start daube-revenue-worker.service || true

echo "=== D'AUBE FREELANCER WORKER V5 ==="
"$BASE/run.sh" || true
echo "=== TIMER ==="
systemctl is-active daube-revenue-worker.timer || true
systemctl --no-pager list-timers daube-revenue-worker.timer || true
