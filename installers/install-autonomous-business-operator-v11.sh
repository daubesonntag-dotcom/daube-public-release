#!/usr/bin/env bash
set -u -o pipefail

REF="${DAUBE_V11_REF:-${DAUBE_AUTOPILOT_TARGET_REVISION:-}}"
REPO="daubesonntag-dotcom/daube-public-release"
BASE="$HOME/daube-revenue-worker/business-v11"
RUNTIME="$BASE/runtime"
TRUSTED_ROOT_CARRIER="${DAUBE_TRUSTED_ROOT_CARRIER:-0}"
FOUNDER_USER="founder_daubesonntag_com"
SERVICE_USER="$(id -un)"
if [[ "$TRUSTED_ROOT_CARRIER" == "1" ]]; then
  [[ "${EUID}" -eq 0 ]] || { printf '[D\047AUBE BUSINESS V11] HOLD: trusted carrier requires root\n' >&2; exit 1; }
  [[ "${HOME:-}" == "/home/${FOUNDER_USER}" ]] || { printf '[D\047AUBE BUSINESS V11] HOLD: trusted carrier founder HOME mismatch\n' >&2; exit 1; }
  id "$FOUNDER_USER" >/dev/null 2>&1 || { printf '[D\047AUBE BUSINESS V11] HOLD: founder user missing\n' >&2; exit 1; }
  SERVICE_USER="$FOUNDER_USER"
fi
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

log(){ printf '[D\047AUBE BUSINESS V11] %s\n' "$*"; }
fail(){ printf '[D\047AUBE BUSINESS V11] HOLD: %s\n' "$*" >&2; exit 1; }

[[ "$REF" =~ ^[a-f0-9]{40}$ ]] || fail "exact 40-hex V11 ref required"
command -v curl >/dev/null || fail "curl missing"
command -v python3 >/dev/null || fail "python3 missing"
command -v sudo >/dev/null || fail "sudo missing"
sudo -n true >/dev/null 2>&1 || fail "passwordless sudo authority missing"

mkdir -p "$RUNTIME"; chmod 700 "$BASE" "$RUNTIME"
FILES=(models.py evidence.py crm.py priority.py learning.py dispatch.py controller.py run.py test_v11.py test_runtime.py)
for f in "${FILES[@]}"; do
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/${REF}/runtime/business-v11/${f}" -o "$RUNTIME/$f" || fail "download failed: $f"
  chmod 600 "$RUNTIME/$f"
done
chmod 700 "$RUNTIME/run.py"

(
  cd "$RUNTIME" || exit 1
  python3 -m unittest -v test_v11.py test_runtime.py
  python3 -m py_compile models.py evidence.py crm.py priority.py learning.py dispatch.py controller.py run.py
  python3 run.py --verify
) || fail "V11 tests/compile/verify failed"

if [[ "$TRUSTED_ROOT_CARRIER" == "1" ]]; then
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$BASE"
fi

sudo tee /etc/systemd/system/daube-business-operator.service >/dev/null <<EOF
[Unit]
Description=D'AUBE Autonomous Business Operator V11
After=network-online.target daube-native-revenue-autopilot.timer daube-runtime-watchdog.timer
Wants=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_GROUP
Environment=HOME=$HOME
WorkingDirectory=$RUNTIME
ExecStart=/usr/bin/python3 $RUNTIME/run.py
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=read-only
ProtectSystem=strict
ReadWritePaths=$HOME/daube-revenue-worker
ReadOnlyPaths=$HOME/.config/daube/secrets
UMask=0077
TimeoutStartSec=120
EOF

sudo tee /etc/systemd/system/daube-business-operator.timer >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Business Operator V11 every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=20
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
for t in daube-native-revenue-autopilot.timer daube-revenue-worker.timer daube-freelancer-award-watcher.timer daube-freelancer-executor.timer daube-runtime-watchdog.timer daube-freelancer-money-closure.timer; do
  sudo systemctl enable --now "$t" >/dev/null 2>&1 || fail "required timer unavailable: $t"
done
sudo systemctl enable --now daube-business-operator.timer >/dev/null || fail "business operator timer activation failed"
sudo systemctl start daube-business-operator.service || fail "business operator first run failed"

[[ -s "$BASE/BUSINESS_OPERATOR_READY.json" ]] || fail "BUSINESS_OPERATOR_READY receipt missing"
state="$(python3 - "$BASE/BUSINESS_OPERATOR_READY.json" <<'PY'
import json,sys
try: print(json.load(open(sys.argv[1])).get('classification',''))
except Exception: print('')
PY
)"
[[ "$state" == "BUSINESS_OPERATOR_READY" ]] || fail "business operator readiness classification invalid"
systemctl is-active --quiet daube-business-operator.timer || fail "business operator timer not active"

log "BUSINESS_OPERATOR_READY ref=$REF"
log "truth: V11 orchestrates existing native workers; revenue remains external-settlement-only"
