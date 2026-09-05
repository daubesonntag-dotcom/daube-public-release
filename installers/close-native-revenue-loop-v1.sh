#!/usr/bin/env bash
set -u -o pipefail

HOST_ROOT="$HOME/daube-host-autopilot"
REV_ROOT="$HOME/daube-revenue-worker"
DESIRED_URL="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/main/.daube/autopilot/host-desired-state.json"
V10_RELEASE="native-revenue-autopilot-v10-5c1de65f"
MAX_HOST_SECONDS="${DAUBE_CLOSE_HOST_TIMEOUT:-1800}"
MAX_CHAIN_SECONDS="${DAUBE_CLOSE_CHAIN_TIMEOUT:-1200}"
POLL_SECONDS=5

log(){ printf '[D\047AUBE FULL CLOSURE] %s\n' "$*"; }
fail(){ printf '[D\047AUBE FULL CLOSURE] BLOCKED=%s\n' "$1" >&2; return 1; }
json_field(){ python3 - "$1" "$2" <<'PY'
import json,sys
p,k=sys.argv[1],sys.argv[2]
try:
    x=json.load(open(p))
    v=x.get(k)
    print('' if v is None else v)
except Exception:
    print('')
PY
}
fetch_desired(){
  curl -fsSL "$DESIRED_URL" -o /tmp/daube-close-desired.json || return 1
  CURRENT_RELEASE="$(json_field /tmp/daube-close-desired.json release_id)"
  CURRENT_REVISION="$(json_field /tmp/daube-close-desired.json target_revision)"
  [[ -n "$CURRENT_RELEASE" && "$CURRENT_REVISION" =~ ^[a-f0-9]{40}$ ]]
}
receipt_state(){
  local f="$HOST_ROOT/state/receipts/$1.json"
  [[ -r "$f" ]] || { printf 'MISSING'; return; }
  json_field "$f" state
}
terminal_bad(){ case "$1" in ROLLED_BACK|HOLD_FOUNDER_GATE|FAILED) return 0;; *) return 1;; esac; }

log 'PREFLIGHT'
[[ "$(hostname -s)" == "daube-host-01" ]] || { fail WRONG_HOST; exit 2; }
[[ "$(id -un)" == "founder_daubesonntag_com" ]] || { fail WRONG_USER; exit 2; }
command -v curl >/dev/null || { fail CURL_MISSING; exit 2; }
command -v python3 >/dev/null || { fail PYTHON_MISSING; exit 2; }
command -v systemctl >/dev/null || { fail SYSTEMCTL_MISSING; exit 2; }
sudo -n true >/dev/null 2>&1 || { fail PASSWORDLESS_SUDO_MISSING; exit 2; }

log 'HOST AUTOPILOT CONVERGENCE'
start_epoch="$(date +%s)"
last_release=''
while :; do
  fetch_desired || { fail DESIRED_STATE_UNAVAILABLE; exit 3; }
  if [[ "$CURRENT_RELEASE" != "$last_release" ]]; then
    log "FOLLOW release=$CURRENT_RELEASE revision=$CURRENT_REVISION"
    last_release="$CURRENT_RELEASE"
  fi
  state="$(receipt_state "$CURRENT_RELEASE")"
  if [[ "$state" == "APPLIED" ]]; then
    log "HOST_APPLIED release=$CURRENT_RELEASE"
    break
  fi
  if terminal_bad "$state"; then
    sleep 3
    fetch_desired || true
    if [[ "$CURRENT_RELEASE" == "$last_release" ]]; then
      fail "HOST_${state}_${CURRENT_RELEASE}"
      sudo journalctl -u daube-host-autopilot.service -n 120 --no-pager -o cat 2>/dev/null || true
      exit 4
    fi
    continue
  fi
  active="$(systemctl is-active daube-host-autopilot.service 2>/dev/null || true)"
  if [[ "$active" != "activating" && "$active" != "active" ]]; then
    sudo systemctl reset-failed daube-host-autopilot.service >/dev/null 2>&1 || true
    sudo systemctl start --no-block daube-host-autopilot.service >/dev/null 2>&1 || true
  fi
  now="$(date +%s)"
  if (( now - start_epoch >= MAX_HOST_SECONDS )); then
    fail HOST_AUTOPILOT_TIMEOUT
    sudo journalctl -u daube-host-autopilot.service -n 120 --no-pager -o cat 2>/dev/null || true
    exit 5
  fi
  sleep "$POLL_SECONDS"
done

log 'NATIVE CHAIN CONVERGENCE'
sudo systemctl enable --now daube-native-autopilot-chain.timer >/dev/null 2>&1 || true
chain_start="$(date +%s)"
while :; do
  v10_state="$(receipt_state "$V10_RELEASE")"
  if [[ "$v10_state" == "APPLIED" ]]; then
    log 'V10_APPLIED'
    break
  fi
  if terminal_bad "$v10_state"; then
    fail "V10_${v10_state}"
    [[ -r "$HOST_ROOT/state/receipts/$V10_RELEASE.json" ]] && cat "$HOST_ROOT/state/receipts/$V10_RELEASE.json" || true
    exit 6
  fi
  chain_active="$(systemctl is-active daube-native-autopilot-chain.service 2>/dev/null || true)"
  if [[ "$chain_active" != "activating" && "$chain_active" != "active" ]]; then
    sudo systemctl start --no-block daube-native-autopilot-chain.service >/dev/null 2>&1 || true
  fi
  current="$HOST_ROOT/state/native-chain-current.json"
  if [[ -r "$current" ]]; then
    cls="$(json_field "$current" classification)"
    phase="$(json_field "$current" phase_id)"
    [[ -n "$cls" ]] && log "CHAIN classification=$cls phase=${phase:-none}"
    if terminal_bad "$cls"; then fail "CHAIN_$cls"; cat "$current"; exit 7; fi
  fi
  now="$(date +%s)"
  if (( now - chain_start >= MAX_CHAIN_SECONDS )); then
    fail NATIVE_CHAIN_TIMEOUT
    [[ -r "$current" ]] && cat "$current" || true
    exit 8
  fi
  sleep "$POLL_SECONDS"
done

log 'RUNTIME TIMERS'
TIMERS=(
  daube-host-autopilot.timer
  daube-host-autopilot-watchdog.timer
  daube-native-autopilot-chain.timer
  daube-native-revenue-autopilot.timer
  daube-revenue-worker.timer
  daube-freelancer-award-watcher.timer
  daube-freelancer-executor.timer
  daube-runtime-watchdog.timer
  daube-freelancer-money-closure.timer
)
missing=0
for t in "${TIMERS[@]}"; do
  if systemctl list-unit-files "$t" --no-legend 2>/dev/null | grep -q "^$t"; then
    sudo systemctl enable --now "$t" >/dev/null 2>&1 || true
    s="$(systemctl is-active "$t" 2>/dev/null || true)"
  else
    s='MISSING'
  fi
  printf '%-50s %s\n' "$t" "$s"
  [[ "$s" == "active" ]] || missing=1
done
(( missing == 0 )) || { fail RUNTIME_TIMER_HEALTH; exit 9; }

log 'WATCHDOG + AUTH'
sudo systemctl start daube-runtime-watchdog.service >/dev/null 2>&1 || true
WD="$REV_ROOT/watchdog/health.json"
if [[ -r "$WD" ]]; then
  auth="$(python3 - "$WD" <<'PY'
import json,sys
try:
 x=json.load(open(sys.argv[1]))
 c=next((c for c in x.get('checks',[]) if c.get('name')=='freelancer_auth'),{})
 print((c.get('status') or '')+'|'+(c.get('detail') or ''))
except Exception: print('|')
PY
)"
  log "FREELANCER_AUTH=$auth"
  [[ "$auth" == PASS\|HTTP_200 ]] || { fail FREELANCER_AUTH_NOT_PASS; exit 10; }
else
  fail WATCHDOG_EVIDENCE_MISSING
  exit 10
fi

log 'REVENUE TRUTH'
LEDGER="$REV_ROOT/full-loop/money-closure/revenue-ledger.jsonl"
if [[ -r "$LEDGER" ]]; then
  settled="$(python3 - "$LEDGER" <<'PY'
import json,sys
n=0
for line in open(sys.argv[1],errors='ignore'):
 try:
  x=json.loads(line)
  if x.get('authoritative_external_settlement') is True:n+=1
 except Exception: pass
print(n)
PY
)"
else
  settled=0
fi
log "AUTHORITATIVE_SETTLEMENTS=$settled"

log 'FINAL'
echo 'HOST=APPLIED'
echo 'NATIVE_CHAIN=APPLIED'
echo 'V10=APPLIED'
echo 'TIMERS=9/9_ACTIVE'
echo 'FREELANCER_AUTH=PASS'
echo "SETTLED_REVENUE_EVENTS=$settled"
echo 'DONE=YES'
