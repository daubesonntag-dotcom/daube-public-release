#!/usr/bin/env bash
set -u

BASE="$HOME/daube-revenue-worker"
WORKER="$BASE/worker.py"
STATE="$BASE/state.json"
VENV="$HOME/.venvs/freelancer"
TARGET_VERSION="v8-winrate-optimizer"

patch_worker() {
  local worker="$1"
  python3 - "$worker" "$TARGET_VERSION" <<'PY'
import ast
from pathlib import Path
import sys

p=Path(sys.argv[1]); target=sys.argv[2]
s=p.read_text()

if f'VERSION="{target}"' in s and 'DAUBE_WINRATE_V8' in s:
    print('NO_CHANGE_WINRATE_OPTIMIZER_V8')
    raise SystemExit(0)

if 'VERSION="v7-currency-multiply-autobid"' not in s:
    print('UNEXPECTED_WORKER_VERSION', file=sys.stderr)
    raise SystemExit(3)

# Preserve the v7 currency correction and the existing safety caps.
for required in (
    'lo_usd=lo*fx; hi_usd=hi*fx',
    'MAX_AUTO_BIDS_PER_RUN=2',
    'MAX_AUTO_BIDS_PER_DAY=4',
    'AUTO_BID_THRESHOLD=88',
):
    if required not in s:
        print(f'REQUIRED_SAFETY_CONTRACT_MISSING:{required}', file=sys.stderr)
        raise SystemExit(4)


def replace_node(src, node, replacement):
    lines=src.splitlines(keepends=True)
    return ''.join(lines[:node.lineno-1]) + replacement + ''.join(lines[node.end_lineno:])

# Version.
s=s.replace('VERSION="v7-currency-multiply-autobid"', f'VERSION="{target}"', 1)

# Imports for read-only account-skill preflight.
if 'from freelancersdk.resources.users.users import get_self' not in s:
    anchor='from freelancersdk.session import Session\n'
    if anchor not in s:
        print('SESSION_IMPORT_ANCHOR_NOT_FOUND', file=sys.stderr); raise SystemExit(5)
    s=s.replace(anchor, anchor + 'from freelancersdk.resources.users.users import get_self\nfrom freelancersdk.resources.users.helpers import create_get_users_details_object\n', 1)

# Query expansion: still bounded to service lanes D\'AUBE can execute.
tree=ast.parse(s)
query_nodes=[n for n in tree.body if isinstance(n,(ast.Assign,ast.AnnAssign)) and any(isinstance(t,ast.Name) and t.id=='QUERIES' for t in getattr(n,'targets',[]))]
if len(query_nodes)!=1:
    print('QUERIES_ASSIGNMENT_NOT_FOUND', file=sys.stderr); raise SystemExit(6)
queries='''QUERIES=[\n  "React TypeScript bug fix", "React component fix", "Next.js fix", "Next.js API integration",\n  "TypeScript bug fix", "Vite build fix", "Tailwind UI fix", "frontend component fix",\n  "API integration", "REST API bug fix", "FastAPI endpoint", "Python API integration",\n  "webhook integration", "OAuth integration", "Google API integration",\n  "OpenAI API integration", "AI chatbot integration", "RAG chatbot",\n  "n8n automation", "Make.com automation", "workflow automation",\n  "website QA testing", "frontend QA testing", "deployment configuration fix"\n]\n'''
s=replace_node(s, query_nodes[0], queries)

# Reparse after replacing assignment.
tree=ast.parse(s)
funcs={n.name:n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
for name in ('score_project','proposal','bid_amount','submit_bid','main'):
    if name not in funcs:
        print(f'FUNCTION_NOT_FOUND:{name}', file=sys.stderr); raise SystemExit(7)

# Add read-only skill-fit helpers immediately before score_project.
insert_line=funcs['score_project'].lineno-1
lines=s.splitlines(keepends=True)
helpers='''def _job_ids(items):\n    out=set()\n    for j in items or []:\n        if not isinstance(j,dict): continue\n        try: jid=int(j.get("id") or j.get("job_id") or 0)\n        except Exception: jid=0\n        if jid>0: out.add(jid)\n    return out\n\ndef account_skill_ids(session):\n    # DAUBE_WINRATE_V8: read-only profile skill preflight; never mutates Freelancer profile skills.\n    try:\n        details=create_get_users_details_object(jobs=True)\n        data=get_self(session, details)\n        if isinstance(data,dict) and isinstance(data.get("result"),dict): data=data["result"]\n        if not isinstance(data,dict): return None\n        ids=_job_ids(data.get("jobs"))\n        return ids or None\n    except Exception as e:\n        print("ACCOUNT_SKILL_READ_FAIL",type(e).__name__,str(e)[:160])\n        return None\n\ndef skill_fit(project, account_ids):\n    required=_job_ids(project.get("jobs") if isinstance(project,dict) else None)\n    if account_ids is None: return False,"account_skill_check_unavailable"\n    if not required: return False,"project_skill_ids_missing"\n    missing=sorted(required-set(account_ids))\n    if missing: return False,"account_skill_gap:"+",".join(map(str,missing[:12]))\n    return True,"account_skill_fit"\n\n'''
s=''.join(lines[:insert_line]) + helpers + ''.join(lines[insert_line:])

# Replace proposal with a job-specific, non-fabricated pitch.
tree=ast.parse(s); funcs={n.name:n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
proposal='''def proposal(p,skills,hours):\n    # DAUBE_WINRATE_V8 job-specific proposal; no fabricated client history.\n    title=(p.get("title") or "your project").strip()\n    desc=(p.get("description") or "").strip()\n    focus=", ".join([x for x in skills[:4] if x]) or "the requested stack"\n    text=(title+" "+desc+" "+focus).lower()\n    if any(x in text for x in ("n8n","make.com","automation","workflow","webhook")):\n        plan="map the trigger/data flow, reproduce the failing path, then verify retries and error handling"\n    elif any(x in text for x in ("next.js","react","typescript","frontend","tailwind","vite")):\n        plan="reproduce the UI/build issue, isolate the smallest component or integration boundary, then verify the fix across the stated acceptance cases"\n    elif any(x in text for x in ("api","fastapi","oauth","google api","rest")):\n        plan="map the request/response contract, reproduce the failing edge case, then verify status codes, validation, and error handling"\n    elif any(x in text for x in ("openai","rag","chatbot","llm")):\n        plan="freeze the expected inputs/outputs, trace the retrieval or API path, then verify grounded behavior and failure handling"\n    else:\n        plan="freeze the acceptance criteria, reproduce the current behavior, then implement and verify the smallest bounded fix"\n    days=1 if hours<=24 else 2\n    return (\n      f"Hi — I reviewed {title}. The relevant stack here is {focus}. "\n      f"My first pass will freeze the acceptance criteria, then {plan}. "\n      "I’ll keep the work scoped to the posted requirements, include concise QA evidence, and flag any hidden dependency before expanding scope. "\n      f"For the stated bounded scope I can target {days}–3 days. "\n      "Any examples I share will be clearly identified as D’AUBE-owned work, not presented as past client work."\n    )\n'''
s=replace_node(s, funcs['proposal'], proposal)

# Replace price strategy: competitive for strongest fits, still always inside client budget.
tree=ast.parse(s); funcs={n.name:n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
price='''def bid_amount(p,score=0):\n    b=p.get("budget") or {}; lo=float(b.get("minimum") or 0); hi=float(b.get("maximum") or 0)\n    if hi<lo: lo,hi=hi,lo\n    # DAUBE_WINRATE_V8 score-aware pricing; never below minimum or above maximum.\n    fraction=0.20 if score>=96 else (0.25 if score>=92 else 0.30)\n    return round(max(lo,min(hi,lo+fraction*(hi-lo))),2)\n'''
s=replace_node(s, funcs['bid_amount'], price)

# submit_bid must pass score into pricing.
s=s.replace('amount=bid_amount(p); period=1 if hours<=24 else 2', 'amount=bid_amount(p,score); period=1 if hours<=24 else 2', 1)
s=s.replace('amount=bid_amount(p)\n', 'amount=bid_amount(p,score)\n', 1)

# Read account skills exactly once per worker cycle.
anchor='session=Session(oauth_token=t,url=URL); state=load_state(); submitted=set(map(int,state.get("submitted",[])))'
if anchor not in s:
    print('MAIN_SESSION_ANCHOR_NOT_FOUND', file=sys.stderr); raise SystemExit(8)
s=s.replace(anchor, anchor+'; account_skills=account_skill_ids(session); print(f"ACCOUNT_SKILLS={len(account_skills) if account_skills is not None else \'UNKNOWN\'}")', 1)

# Skill fit gates only AUTO_BID_READY, not discovery/qualification visibility.
import re
pattern=r'(?m)^([ \t]*)score,reasons,skills,hours,auto_guard=score_project\(p,user\)\n\1prop=proposal\(p,skills,hours\) if score>=76 else None$'
m=re.search(pattern,s)
if not m:
    print('SCORE_ANCHOR_NOT_FOUND', file=sys.stderr); raise SystemExit(9)
indent=m.group(1)
replacement2=(
    indent+'score,reasons,skills,hours,auto_guard=score_project(p,user)\n'+
    indent+'skill_ok,skill_reason=skill_fit(p,account_skills)\n'+
    indent+'reasons.append(skill_reason)\n'+
    indent+'auto_guard=bool(auto_guard and skill_ok)\n'+
    indent+'prop=proposal(p,skills,hours) if score>=76 else None'
)
s=s[:m.start()]+replacement2+s[m.end():]

# Make sure safety contracts survived the patch.
ast.parse(s)
for required in (
    'MAX_AUTO_BIDS_PER_RUN=2', 'MAX_AUTO_BIDS_PER_DAY=4', 'AUTO_BID_THRESHOLD=88',
    'lo_usd=lo*fx; hi_usd=hi*fx', 'account_skill_fit', 'account_skill_gap',
):
    if required not in s:
        print(f'POST_PATCH_CONTRACT_MISSING:{required}', file=sys.stderr); raise SystemExit(10)
if 'add_user_jobs' in s or 'set_user_jobs' in s:
    print('PROFILE_SKILL_MUTATION_FORBIDDEN', file=sys.stderr); raise SystemExit(11)

p.write_text(s)
print('PATCHED_WINRATE_OPTIMIZER_V8')
PY
}

migrate_state() {
  local state="$1"
  python3 - "$state" "$TARGET_VERSION" <<'PY'
from pathlib import Path
import json,os,sys
p=Path(sys.argv[1]); target=sys.argv[2]
if not p.exists(): print('STATE_NOT_PRESENT'); raise SystemExit(0)
try: x=json.loads(p.read_text())
except Exception: print('STATE_INVALID_JSON',file=sys.stderr); raise SystemExit(5)
if not isinstance(x,dict): print('STATE_NOT_OBJECT',file=sys.stderr); raise SystemExit(6)
x['version']=target
tmp=p.with_suffix(p.suffix+'.v8tmp'); tmp.write_text(json.dumps(x,indent=2)+'\n'); os.replace(tmp,p)
print('STATE_MIGRATED_PRESERVING_HISTORY')
PY
}

restore_worker() {
  local backup="$1"
  if [ -f "$backup" ]; then cp -p "$backup" "$WORKER"; echo 'WORKER_RESTORED_FROM_BACKUP'; fi
}

main() {
  if [ "${1:-}" = "--patch-only" ]; then
    [ "$#" -eq 2 ] || { echo 'USAGE: --patch-only WORKER' >&2; return 64; }
    patch_worker "$2"; return $?
  fi
  if [ "${1:-}" = "--migrate-state-only" ]; then
    [ "$#" -eq 2 ] || { echo 'USAGE: --migrate-state-only STATE' >&2; return 64; }
    migrate_state "$2"; return $?
  fi

  [ -f "$WORKER" ] || { echo "ERROR worker missing: $WORKER"; return 1; }
  [ -x "$VENV/bin/python" ] || { echo "ERROR Freelancer venv missing: $VENV"; return 1; }

  echo "=== D'AUBE FREELANCER WIN-RATE OPTIMIZER V8 ==="
  local timer_was_active=0 backup patch_out
  systemctl is-active --quiet daube-revenue-worker.timer 2>/dev/null && timer_was_active=1
  sudo systemctl stop daube-revenue-worker.timer || return 1
  for i in $(seq 1 30); do systemctl is-active --quiet daube-revenue-worker.service 2>/dev/null || break; sleep 2; done
  if systemctl is-active --quiet daube-revenue-worker.service 2>/dev/null; then
    echo 'ERROR revenue worker did not become idle'; [ "$timer_was_active" = 1 ] && sudo systemctl start daube-revenue-worker.timer || true; return 1
  fi

  backup="${WORKER}.v8-backup.$(date -u +%Y%m%dT%H%M%SZ).$$"
  cp -p "$WORKER" "$backup" || { [ "$timer_was_active" = 1 ] && sudo systemctl start daube-revenue-worker.timer || true; return 1; }
  if ! patch_out="$(patch_worker "$WORKER" 2>&1)"; then printf '%s\n' "$patch_out" >&2; restore_worker "$backup"; [ "$timer_was_active" = 1 ] && sudo systemctl start daube-revenue-worker.timer || true; return 1; fi
  printf '%s\n' "$patch_out"

  if ! "$VENV/bin/python" -m py_compile "$WORKER"; then echo 'ERROR worker compile failed'; restore_worker "$backup"; [ "$timer_was_active" = 1 ] && sudo systemctl start daube-revenue-worker.timer || true; return 1; fi
  if ! migrate_state "$STATE"; then echo 'ERROR state migration failed'; restore_worker "$backup"; [ "$timer_was_active" = 1 ] && sudo systemctl start daube-revenue-worker.timer || true; return 1; fi
  rm -f "$backup"
  echo 'WORKER_VERIFY_PASS'

  sudo systemctl enable --now daube-revenue-worker.timer || return 1
  echo '=== RUN ONE REVENUE CYCLE ==='
  sudo systemctl start daube-revenue-worker.service || true
  echo '=== CURRENT CYCLE SUMMARY ==='
  sudo journalctl -u daube-revenue-worker.service -n 120 --no-pager 2>/dev/null | grep -E 'VERSION=|ACCOUNT_SKILLS=|SCANNED=|QUALIFIED=|AUTO_READY=|SUBMITTED=|BID_FAIL|SUBMITTED ' | tail -40 || true
  echo '=== AUTHORITATIVE RECEIPTS ==='
  find "$BASE/receipts" -maxdepth 1 -type f -name '*.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -10 || true
  echo '=== TIMERS ==='
  systemctl is-active daube-revenue-worker.timer || true
  systemctl is-active daube-freelancer-award-watcher.timer || true
  systemctl is-active daube-freelancer-executor.timer || true
  echo 'V8_WINRATE_OPTIMIZER=PASS'
}

main "$@"
