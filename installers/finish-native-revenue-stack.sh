#!/usr/bin/env bash
set -u -o pipefail

HOME_DIR="$HOME"
HOST_ROOT="$HOME_DIR/daube-host-autopilot"
REV_ROOT="$HOME_DIR/daube-revenue-worker"
EXPECTED_NATIVE_RELEASE="native-autopilot-chain-74bacb46"
EXPECTED_CF_RELEASE="cloudflare-control-plane-host-v1-bbf82621"
EXPECTED_V9_RELEASE="v9-executor-89e7ea9e"
EXPECTED_V10_RELEASE="native-revenue-autopilot-v10-5c1de65f"
EXPECTED_V10_REF="5c1de65fa34287677d121b4edcf9aa6b2136c569"
V10_INSTALLER_SHA="78ebd0f2e2d196a8f146f03d60348a2a81e0a2152033060e30002a342f8bbb5b"

fail(){ printf 'BLOCKED=%s\n' "$1"; exit 2; }
info(){ printf '\n=== %s ===\n' "$1"; }
has_unit(){ systemctl list-unit-files "$1" --no-legend 2>/dev/null | grep -q "^$1"; }
active(){ [ "$(systemctl is-active "$1" 2>/dev/null || true)" = "active" ]; }
receipt_state(){
  local rid="$1" f="$HOST_ROOT/state/receipts/$rid.json"
  [ -r "$f" ] || { printf 'MISSING'; return; }
  python3 - "$f" <<'PY'
import json,sys
try:
    x=json.load(open(sys.argv[1]))
    print(x.get('state') or x.get('classification') or 'UNKNOWN')
except Exception:
    print('INVALID')
PY
}
show_receipt(){
  local rid="$1" f="$HOST_ROOT/state/receipts/$rid.json"
  printf '%s=' "$rid"
  receipt_state "$rid"
  if [ -r "$f" ]; then
    python3 - "$f" <<'PY'
import json,sys
try:
    x=json.load(open(sys.argv[1]))
    print(json.dumps({k:x.get(k) for k in ('release_id','target_revision','state','classification') if k in x},ensure_ascii=False))
except Exception: pass
PY
  fi
}

info "PREFLIGHT"
for c in python3 curl systemctl sudo; do command -v "$c" >/dev/null 2>&1 || fail "${c^^}_MISSING"; done
[ ! -e "$HOST_ROOT/DISABLED" ] || fail "FOUNDER_KILL_SWITCH_ACTIVE"
[ -r "$HOME_DIR/.config/daube/secrets/freelancer.token" ] || fail "FREELANCER_TOKEN_MISSING"
[ -x "$HOME_DIR/.venvs/freelancer/bin/python" ] || fail "FREELANCER_VENV_MISSING"
printf 'USER=%s\n' "$(id -un)"
printf 'HOST_ROOT=%s\n' "$HOST_ROOT"
printf 'REVENUE_ROOT=%s\n' "$REV_ROOT"

info "HOST AUTOPILOT"
has_unit daube-host-autopilot.service || fail "HOST_AUTOPILOT_SERVICE_MISSING"
has_unit daube-host-autopilot.timer || fail "HOST_AUTOPILOT_TIMER_MISSING"
sudo systemctl enable --now daube-host-autopilot.timer >/dev/null 2>&1 || fail "HOST_AUTOPILOT_TIMER_ENABLE_FAILED"
sudo systemctl start daube-host-autopilot.service || true
sleep 3
active daube-host-autopilot.timer || fail "HOST_AUTOPILOT_TIMER_INACTIVE"
show_receipt "$EXPECTED_NATIVE_RELEASE"

info "NATIVE CHAIN BOOTSTRAP"
if ! has_unit daube-native-autopilot-chain.service; then
  st="$(receipt_state "$EXPECTED_NATIVE_RELEASE")"
  [ "$st" = "APPLIED" ] || fail "NATIVE_BOOTSTRAP_NOT_APPLIED"
  fail "NATIVE_CHAIN_SERVICE_MISSING_AFTER_APPLIED_BOOTSTRAP"
fi
sudo systemctl enable --now daube-native-autopilot-chain.timer >/dev/null 2>&1 || fail "NATIVE_CHAIN_TIMER_ENABLE_FAILED"

info "ADVANCE NATIVE CHAIN"
for n in 1 2 3 4 5 6; do
  printf 'CHAIN_RUN=%s\n' "$n"
  sudo systemctl start daube-native-autopilot-chain.service || true
  sleep 3
  if [ -r "$HOST_ROOT/state/native-chain-current.json" ]; then
    python3 - "$HOST_ROOT/state/native-chain-current.json" <<'PY'
import json,sys
try:
    x=json.load(open(sys.argv[1]))
    print('CHAIN_CURRENT='+json.dumps(x,ensure_ascii=False)[:1200])
except Exception as e:
    print('CHAIN_CURRENT_INVALID='+type(e).__name__)
PY
  fi
  v10="$(receipt_state "$EXPECTED_V10_RELEASE")"
  [ "$v10" = "APPLIED" ] && break
  [ "$v10" = "ROLLED_BACK" ] && fail "V10_ROLLED_BACK"
  [ "$v10" = "HOLD_FOUNDER_GATE" ] && fail "V10_HOLD_FOUNDER_GATE"
done

info "AUTHORITATIVE RELEASE RECEIPTS"
for rid in "$EXPECTED_NATIVE_RELEASE" "$EXPECTED_CF_RELEASE" "$EXPECTED_V9_RELEASE" "$EXPECTED_V10_RELEASE"; do
  show_receipt "$rid"
  st="$(receipt_state "$rid")"
  case "$st" in
    APPLIED) ;;
    ROLLED_BACK) fail "${rid}_ROLLED_BACK" ;;
    HOLD_FOUNDER_GATE) fail "${rid}_HOLD_FOUNDER_GATE" ;;
    *) fail "${rid}_NOT_APPLIED" ;;
  esac
done

info "TIMER HEALTH"
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
for t in "${TIMERS[@]}"; do
  state="$(systemctl is-active "$t" 2>/dev/null || true)"
  printf '%s=%s\n' "$t" "$state"
  [ "$state" = "active" ] || fail "${t}_INACTIVE"
done

info "V10 RUNTIME"
V10_STATE="$REV_ROOT/v10/state.json"
[ -r "$V10_STATE" ] || { sudo systemctl start daube-native-revenue-autopilot.service || true; sleep 2; }
[ -r "$V10_STATE" ] || fail "V10_STATE_MISSING"
python3 - "$V10_STATE" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]))
print('V10_STATE='+json.dumps(x,ensure_ascii=False)[:3000])
PY

info "FREELANCER AUTH READ-ONLY"
TOKEN_FILE="$HOME_DIR/.config/daube/secrets/freelancer.token"
VENV="$HOME_DIR/.venvs/freelancer/bin/python"
"$VENV" - "$TOKEN_FILE" <<'PY'
import sys
from freelancersdk.session import Session
from freelancersdk.resources.users.users import get_self_user_id
p=sys.argv[1]
t=open(p).read().strip()
try:
    uid=get_self_user_id(Session(oauth_token=t,url='https://www.freelancer.com'))
    print('FREELANCER_AUTH=OK USER_ID='+str(uid))
except Exception as e:
    print('FREELANCER_AUTH=FAIL '+type(e).__name__+':'+str(e)[:180])
    raise SystemExit(2)
PY
[ $? -eq 0 ] || fail "FREELANCER_AUTH_FAILED"

info "REVENUE TRUTH"
LEDGER="$REV_ROOT/full-loop/money-closure/revenue-ledger.jsonl"
if [ -r "$LEDGER" ]; then
  python3 - "$LEDGER" <<'PY'
import json,sys
rows=[]
for line in open(sys.argv[1],errors='ignore'):
    try:x=json.loads(line)
    except Exception:continue
    if x.get('authoritative_external_settlement') is True and x.get('evidence')=='official_get_milestones_released_or_paid': rows.append(x)
print('SETTLED_REVENUE_ROWS='+str(len(rows)))
for x in rows[-10:]:
    print('SETTLED='+json.dumps({k:x.get(k) for k in ('project_id','milestone_id','amount','currency','provider_status')},ensure_ascii=False))
PY
else
  echo 'SETTLED_REVENUE_ROWS=0'
fi

info "FINAL"
echo "NATIVE_AUTOPILOT=APPLIED"
echo "EXECUTION_MESH_V9=APPLIED"
echo "NATIVE_REVENUE_AUTOPILOT_V10=APPLIED"
echo "V10_EXPECTED_REF=$EXPECTED_V10_REF"
echo "V10_INSTALLER_SHA256=$V10_INSTALLER_SHA"
echo "ALL_REQUIRED_TIMERS=ACTIVE"
echo "REVENUE_TRUTH=EXTERNAL_SETTLEMENT_ONLY"
echo "DONE=YES"
