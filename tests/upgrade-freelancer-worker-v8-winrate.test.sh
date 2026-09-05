#!/usr/bin/env bash
set -u
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
SCRIPT="$ROOT/installers/upgrade-freelancer-worker-v8-winrate.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail(){ echo "FAIL: $*" >&2; exit 1; }
pass(){ echo "PASS: $*"; }

[ -f "$SCRIPT" ] || fail "v8 script missing"
bash -n "$SCRIPT" || fail "v8 shell syntax"

fixture="$TMP/worker.py"
cat > "$fixture" <<'PY'
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
VERSION="v7-currency-multiply-autobid"
HOME=Path.home()
URL="https://www.freelancer.com"
def load_state(): return {"submitted":[]}
AUTO_BID_THRESHOLD=88
MAX_AUTO_BIDS_PER_RUN=2
MAX_AUTO_BIDS_PER_DAY=4
QUERIES=["React TypeScript bug fix", "Next.js fix", "API integration"]
LANES={
 "frontend": {"react","typescript","javascript","next.js","nextjs","frontend","html","css","tailwind"},
 "api": {"api","rest api","webhook","integration","fastapi","python"},
 "ai": {"chatbot","openai","llm","rag","ai assistant"},
 "automation": {"automation","n8n","make.com","workflow","webhook"},
 "qa": {"qa","testing","test website","bug testing","ux testing"},
}

def lane_hits(text):
    hits={}
    for lane,terms in LANES.items():
        n=sum(1 for t in terms if t in text)
        if n: hits[lane]=n
    return hits

def score_project(p,user):
    currency=(p.get("currency") or {}).get("code") or ""
    b=p.get("budget") or {}; lo=float(b.get("minimum") or 0); hi=float(b.get("maximum") or 0)
    fx=float((p.get("currency") or {}).get("exchange_rate") or 0)
    if currency=="USD": fx=1.0
    currency_guard=False; lo_usd=hi_usd=0.0
    if 0 < fx < 100000:
        lo_usd=lo*fx; hi_usd=hi*fx
        currency_guard=(hi_usd>=25 and lo_usd<=1000 and hi_usd<=1000)
    return 98,["bounded_deliverable"],[j.get("name","") for j in p.get("jobs",[])],24,currency_guard

def proposal(p,skills,hours):
    return "generic"

def self_id(): return 1

def bid_amount(p):
    b=p.get("budget") or {}; lo=float(b.get("minimum") or 0); hi=float(b.get("maximum") or 0)
    return round(max(lo,min(hi,lo+0.32*(hi-lo))),2)

def submit_bid(p,score,desc,hours):
    amount=bid_amount(p)
    return amount

def main():
    t="token"
    session=Session(oauth_token=t,url=URL); state=load_state(); submitted=set(map(int,state.get("submitted",[])))
    ids=[]
    qualified=[]; auto_ready=[]
    detail={"projects":[]}
    for p in detail.get("projects",[]):
        pid=int(p.get("id") or 0); user={}
        score,reasons,skills,hours,auto_guard=score_project(p,user)
        prop=proposal(p,skills,hours) if score>=76 else None
        decision="REJECT"
        if score>=76: decision="QUALIFIED"
        if score>=AUTO_BID_THRESHOLD and hours<=72 and auto_guard and prop: decision="AUTO_BID_READY"
        rec={"project_id":pid,"score":score,"decision":decision,"reasons":reasons,"proposal":prop}
        if decision!="REJECT": qualified.append(rec)
        if decision=="AUTO_BID_READY": auto_ready.append((p,rec))
PY

"$SCRIPT" --patch-only "$fixture" >"$TMP/out"
grep -q '^PATCHED_WINRATE_OPTIMIZER_V8$' "$TMP/out" || fail "patch did not report PATCHED"
python3 -m py_compile "$fixture" || fail "patched fixture compile"

grep -q 'VERSION="v8-winrate-optimizer"' "$fixture" || fail "version not v8"
grep -q 'MAX_AUTO_BIDS_PER_RUN=2' "$fixture" || fail "per-run cap changed"
grep -q 'MAX_AUTO_BIDS_PER_DAY=4' "$fixture" || fail "daily cap changed"
grep -q 'get_self' "$fixture" || fail "account skill read missing"
grep -q 'account_skill_fit' "$fixture" || fail "skill fit reason missing"
grep -q 'account_skill_gap' "$fixture" || fail "skill gap reason missing"
grep -q 'Next.js API integration' "$fixture" || fail "query expansion missing"
grep -q 'score>=96' "$fixture" || fail "score-aware bid strategy missing"
grep -q 'job-specific' "$fixture" || fail "job-specific proposal marker missing"

python3 - "$fixture" <<'PYRUN' || fail "behavior checks"
import importlib.util,sys,types
mods={
'freelancersdk':types.ModuleType('freelancersdk'),
'freelancersdk.session':types.ModuleType('freelancersdk.session'),
'freelancersdk.resources':types.ModuleType('freelancersdk.resources'),
'freelancersdk.resources.projects':types.ModuleType('freelancersdk.resources.projects'),
'freelancersdk.resources.projects.projects':types.ModuleType('freelancersdk.resources.projects.projects'),
'freelancersdk.resources.projects.helpers':types.ModuleType('freelancersdk.resources.projects.helpers'),
'freelancersdk.resources.users':types.ModuleType('freelancersdk.resources.users'),
'freelancersdk.resources.users.users':types.ModuleType('freelancersdk.resources.users.users'),
'freelancersdk.resources.users.helpers':types.ModuleType('freelancersdk.resources.users.helpers'),
}
class Session: pass
mods['freelancersdk.session'].Session=Session
for n in ['search_projects','get_projects']: setattr(mods['freelancersdk.resources.projects.projects'],n,lambda *a,**k: {})
for n in ['create_search_projects_filter','create_get_projects_object','create_get_projects_project_details_object','create_get_projects_user_details_object']: setattr(mods['freelancersdk.resources.projects.helpers'],n,lambda *a,**k: {})
mods['freelancersdk.resources.users.users'].get_self=lambda *a,**k: {}
mods['freelancersdk.resources.users.helpers'].create_get_users_details_object=lambda **k: k
sys.modules.update(mods)
spec=importlib.util.spec_from_file_location('worker',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

p={'jobs':[{'id':10,'name':'React.js'},{'id':20,'name':'TypeScript'}]}
ok,reason=m.skill_fit(p,{10,20,30}); assert ok and reason=='account_skill_fit',(ok,reason)
ok,reason=m.skill_fit(p,{10}); assert not ok and reason.startswith('account_skill_gap:'),(ok,reason)
ok,reason=m.skill_fit(p,None); assert not ok and reason=='account_skill_check_unavailable',(ok,reason)

p2={'budget':{'minimum':100,'maximum':300}}
assert m.bid_amount(p2,98)==140.0,m.bid_amount(p2,98)
assert m.bid_amount(p2,93)==150.0,m.bid_amount(p2,93)
assert m.bid_amount(p2,89)==160.0,m.bid_amount(p2,89)

prop=m.proposal({'title':'Fix Next.js webhook','description':'Webhook fails on retries'},['Next.js','Webhook'],24)
assert 'Fix Next.js webhook' in prop
assert 'Next.js' in prop and 'Webhook' in prop
assert 'acceptance criteria' in prop.lower()
PYRUN
pass "skill-fit, pricing, proposal behavior"

sha1="$(sha256sum "$fixture" | awk '{print $1}')"
"$SCRIPT" --patch-only "$fixture" >"$TMP/out2"
sha2="$(sha256sum "$fixture" | awk '{print $1}')"
grep -q '^NO_CHANGE_WINRATE_OPTIMIZER_V8$' "$TMP/out2" || fail "idempotent no-change missing"
[ "$sha1" = "$sha2" ] || fail "idempotent run changed worker"
pass "idempotence"

bad="$TMP/bad.py"; printf 'VERSION="other"\n' > "$bad"
if "$SCRIPT" --patch-only "$bad" >"$TMP/bad.out" 2>"$TMP/bad.err"; then fail "unexpected version succeeded"; fi
grep -q 'UNEXPECTED_WORKER_VERSION' "$TMP/bad.err" || fail "wrong fail-closed error"
pass "fail-closed unexpected version"

grep -Eq 'add_user_jobs|set_user_jobs' "$fixture" && fail "profile skill mutation introduced" || true
pass "no profile-skill mutation"

state="$TMP/state.json"
cat > "$state" <<'JSON'
{"version":"v7-currency-multiply-autobid","submitted":[40692329,40692343,40692347],"daily":{"2026-09-05":3},"other":"keep"}
JSON
"$SCRIPT" --migrate-state-only "$state" >"$TMP/state-out"
python3 - "$state" <<'PYRUN' || fail "state migration failed"
import json,sys
x=json.load(open(sys.argv[1]))
assert x["version"]=="v8-winrate-optimizer",x
assert x["submitted"]==[40692329,40692343,40692347],x
assert x["daily"]=={"2026-09-05":3},x
assert x["other"]=="keep",x
PYRUN
pass "state migration preserves submitted/daily history"

echo "ALL_V8_WINRATE_TESTS_PASS"
