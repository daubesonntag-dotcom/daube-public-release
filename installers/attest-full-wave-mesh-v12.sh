#!/usr/bin/env bash
set -Eeuo pipefail

log(){ printf '[D'\''AUBE FULL WAVE ATTEST] %s\n' "$*"; }
fail(){ log "HOLD: $*" >&2; exit 1; }

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REF="${DAUBE_AUTOPILOT_TARGET_REVISION:-}"
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || fail "exact autopilot target revision required"
V12="$HERE/install-full-wave-mesh-lane-v12.sh"
READY="$HOME/daube-revenue-worker/full-wave-v12/receipt.json"
test -x "$V12" || fail "V12 installer missing"

# Control-plane persistence must be repaired even when an exact-target runtime
# receipt already exists and the expensive V12 transaction can be skipped.
sudo -n systemctl enable --now daube-native-autopilot-chain.timer >/dev/null 2>&1 \
  || fail "native autopilot chain persistence unavailable"
systemctl is-active --quiet daube-native-autopilot-chain.timer \
  || fail "native autopilot chain timer inactive"
test "$(systemctl is-enabled daube-native-autopilot-chain.timer)" = enabled \
  || fail "native autopilot chain timer not enabled"

receipt_ready() {
  python3 - "$READY" "$REF" <<'PY'
import json, pathlib, sys
p=pathlib.Path(sys.argv[1])
ref=sys.argv[2]
try:
    v=json.loads(p.read_text())
except Exception:
    raise SystemExit(1)
ok=(v.get("schema")=="daube.full-wave-v12.receipt.v1"
    and v.get("classification")=="FULL_WAVE_READY"
    and v.get("target_revision")==ref
    and isinstance(v.get("units"),dict)
    and len(v["units"])==13
    and all(x=="active" for x in v["units"].values()))
raise SystemExit(0 if ok else 1)
PY
}

if receipt_ready; then
  log "existing exact-target FULL_WAVE_READY receipt admitted; skip V12 re-execution"
else
  log "no admissible exact-target V12 receipt; run one V12 transaction"
  bash "$V12"
fi
receipt_ready || fail "V12 receipt missing, stale, or not FULL_WAVE_READY"

REQUIRED=(
  daube-executor-v2.service
  daube-web-release-governor.service
  daube-compute-mesh.service
  daube-customer-care-mail.service
  daube-revenue-opportunity-worker.timer
  daube-revenue-worker.timer
  daube-freelancer-preaward-conversation.timer
  daube-freelancer-award-watcher.timer
  daube-freelancer-executor.timer
  daube-runtime-watchdog.timer
  daube-freelancer-money-closure.timer
  daube-native-revenue-autopilot.timer
  daube-business-operator.timer
)
for unit in "${REQUIRED[@]}"; do
  systemctl is-active --quiet "$unit" || fail "unit not active: $unit"
done

sudo -n /usr/bin/bash -s <<'ROOT'
set -Eeuo pipefail
ENVFILE=/etc/daube/daube-executor-v2.env
CONTROL=/opt/daube/control/daube-ci-platform
STATE=/var/lib/daube-executor
REPO=daubesonntag-dotcom/daube-ci-platform
[[ -f "$ENVFILE" ]] || exit 21
set -a
# shellcheck disable=SC1090
. "$ENVFILE"
set +a
[[ -n "${GH_TOKEN:-}" ]] || exit 22
SHA="$(tr -d '\r\n' < "$CONTROL/CONTROL_REVISION" | tr '[:upper:]' '[:lower:]')"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 23

post(){
  local state="$1" context="$2" desc="$3"
  gh api --method POST "repos/${REPO}/statuses/${SHA}" \
    -f "state=${state}" -f "context=${context}" -f "description=${desc}" >/dev/null
}

systemctl start daube-machine-heartbeat.service || true
P0="$STATE/authority-evidence.d/P0-9-owned-host.json"
CF="$STATE/cloudflare-control-plane.json"
ENT="$STATE/enterprise-runtime/governor.json"

P0_OK=false
if [[ -f "$P0" ]] && jq -e '.satisfied == true' "$P0" >/dev/null 2>&1; then P0_OK=true; fi
CF_OK=false
if [[ -f "$CF" ]] && jq -e '.tokenVerified == true and (.status == "READY" or .status == "READY_DNS_ONLY") and .blocker == null' "$CF" >/dev/null 2>&1; then CF_OK=true; fi
ENT_STATE="UNKNOWN"
if [[ -f "$ENT" ]]; then ENT_STATE="$(jq -r '.status // "UNKNOWN"' "$ENT")"; fi

post success "daube/full-wave-v12" "FULL_WAVE_READY · 13 runtime lanes active"
if $P0_OK; then
  post success "daube/p0-9-owned-host" "P0-9 VERIFIED · signed 24h host continuity + local-root authority"
else
  post pending "daube/p0-9-owned-host" "P0-9 HOLD · awaiting evidence-backed persistence authority"
fi
if $CF_OK; then
  post success "daube/cloudflare-control-plane" "READY_DNS_ONLY · token + zone + DNS readback verified"
else
  post pending "daube/cloudflare-control-plane" "Cloudflare control-plane HOLD · readback incomplete"
fi
case "$ENT_STATE" in
  OPERATING)
    post success "daube/enterprise-runtime-v1" "OPERATING · independent workforce heartbeat observed"
    ;;
  OPERATING_FAIL_CLOSED)
    post pending "daube/enterprise-runtime-v1" "OPERATING_FAIL_CLOSED · governor healthy, workforce runtime pending"
    ;;
  *)
    post pending "daube/enterprise-runtime-v1" "Enterprise runtime HOLD · governor report unavailable"
    ;;
esac

if $P0_OK && $CF_OK && [[ "$ENT_STATE" == "OPERATING" ]]; then
  post success "daube/full-closure" "FULL_CLOSURE_VERIFIED · wave + P0-9 + Cloudflare + workforce runtime"
else
  post pending "daube/full-closure" "FULL_CLOSURE_PENDING · one or more independent evidence gates remain"
fi
ROOT

log "PASS attestation statuses published without exposing host secrets"
