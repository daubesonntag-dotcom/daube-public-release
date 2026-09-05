#!/usr/bin/env bash
set -Eeuo pipefail

log(){ printf '[D'\''AUBE FULL WAVE V12] %s\n' "$*"; }
fail(){ log "HOLD: $*" >&2; exit 1; }

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REF="${DAUBE_AUTOPILOT_TARGET_REVISION:-}"
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || fail "exact autopilot target revision required"
command -v sudo >/dev/null 2>&1 || fail "sudo missing"
sudo -n true >/dev/null 2>&1 || fail "passwordless sudo authority missing"

export DAUBE_V9_REF="$REF"
export DAUBE_REVENUE_V10_REF="$REF"
export DAUBE_V11_REF="$REF"

for installer in \
  install-ci-platform-wave-full-host-v1.sh \
  install-freelancer-execution-mesh-v9.sh \
  install-native-revenue-autopilot-v10.sh \
  install-autonomous-business-operator-v11.sh
do
  test -x "$HERE/$installer" || fail "staged installer missing or not executable: $installer"
  log "RUN $installer ref=$REF"
  bash "$HERE/$installer"
done

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
  sudo systemctl enable "$unit" >/dev/null 2>&1 || true
  sudo systemctl start "$unit" >/dev/null 2>&1 || true
  systemctl is-active --quiet "$unit" || fail "unit not active: $unit"
done

KICK=(
  daube-revenue-opportunity-worker.service
  daube-revenue-worker.service
  daube-freelancer-preaward-conversation.service
  daube-freelancer-award-watcher.service
  daube-freelancer-executor.service
  daube-native-revenue-autopilot.service
  daube-business-operator.service
  daube-freelancer-money-closure.service
)

set +e
for unit in "${KICK[@]}"; do
  sudo systemctl start "$unit"
  rc=$?
  log "KICK unit=$unit rc=$rc"
done
set -e

READY="$HOME/daube-revenue-worker/business-v11/BUSINESS_OPERATOR_READY.json"
test -s "$READY" || fail "business operator readiness receipt missing"

OUT="$HOME/daube-revenue-worker/full-wave-v12"
mkdir -p "$OUT"
chmod 700 "$OUT"
python3 - "$REF" "$OUT/receipt.json" "${REQUIRED[@]}" <<'PY'
import json, subprocess, sys
from datetime import datetime, timezone

ref, out, *units = sys.argv[1:]
states = {}
for unit in units:
    p = subprocess.run(["systemctl", "is-active", unit], text=True, capture_output=True)
    states[unit] = p.stdout.strip() or f"rc={p.returncode}"
receipt = {
    "schema": "daube.full-wave-v12.receipt.v1",
    "classification": "FULL_WAVE_READY" if all(v == "active" for v in states.values()) else "HOLD",
    "target_revision": ref,
    "at": datetime.now(timezone.utc).isoformat(),
    "units": states,
    "revenue_truth": "EXTERNAL_SETTLEMENT_ONLY",
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(receipt, f, indent=2, sort_keys=True)
    f.write("\n")
print(json.dumps(receipt, sort_keys=True))
if receipt["classification"] != "FULL_WAVE_READY":
    raise SystemExit(1)
PY

log "PASS FULL_WAVE_READY ref=$REF"
