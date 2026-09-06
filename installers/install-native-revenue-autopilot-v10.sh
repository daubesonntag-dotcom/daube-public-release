#!/usr/bin/env bash
set -euo pipefail

BASE="$HOME/daube-revenue-worker"
V10="$BASE/v10"
RUNTIME="$V10/runtime"
TOKEN_FILE="$HOME/.config/daube/secrets/freelancer.token"
VENV="$HOME/.venvs/freelancer"
REPO="daubesonntag-dotcom/daube-public-release"
REF="${DAUBE_REVENUE_V10_REF:-${DAUBE_AUTOPILOT_TARGET_REVISION:-}}"
FILES=(evidence.py providers.py concierge.py controller.py test_v10.py)
SERVICE="daube-native-revenue-autopilot.service"
TIMER="daube-native-revenue-autopilot.timer"
BACKUP="$V10/unit-backup"
TRUSTED_ROOT_CARRIER="${DAUBE_TRUSTED_ROOT_CARRIER:-0}"
FOUNDER_USER="founder_daubesonntag_com"
SERVICE_USER="$(id -un)"
if [[ "$TRUSTED_ROOT_CARRIER" == "1" ]]; then
  [[ "${EUID}" -eq 0 ]] || { echo "V10_BLOCKED=TRUSTED_CARRIER_NOT_ROOT"; exit 1; }
  [[ "${HOME:-}" == "/home/${FOUNDER_USER}" ]] || { echo "V10_BLOCKED=TRUSTED_CARRIER_HOME"; exit 1; }
  id "$FOUNDER_USER" >/dev/null 2>&1 || { echo "V10_BLOCKED=FOUNDER_USER_MISSING"; exit 1; }
  SERVICE_USER="$FOUNDER_USER"
fi
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

for cmd in curl python3 systemctl sudo; do
  command -v "$cmd" >/dev/null || { echo "V10_BLOCKED=${cmd^^}_MISSING"; exit 1; }
done
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || { echo "V10_BLOCKED=EXACT_REF_REQUIRED"; exit 1; }
[ -r "$TOKEN_FILE" ] || { echo "V10_BLOCKED=FREELANCER_TOKEN_MISSING"; exit 1; }
[ -x "$VENV/bin/python" ] || { echo "V10_BLOCKED=FREELANCER_VENV_MISSING"; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
RAW="https://raw.githubusercontent.com/$REPO/$REF/runtime/revenue-v10"
for f in "${FILES[@]}"; do
  curl -fsSL "$RAW/$f" -o "$STAGE/$f"
done

(
  cd "$STAGE"
  PYTHONPATH="$STAGE" python3 -m unittest -v test_v10.py
  python3 -m py_compile evidence.py providers.py concierge.py controller.py test_v10.py
)

mkdir -p "$RUNTIME" "$V10/projects" "$V10/founder-gates" "$BACKUP"
chmod 700 "$V10" "$RUNTIME" "$V10/projects" "$V10/founder-gates" "$BACKUP"
for f in "${FILES[@]}"; do install -m 600 "$STAGE/$f" "$RUNTIME/$f"; done

for name in "$SERVICE" "$TIMER"; do
  if sudo test -f "/etc/systemd/system/$name"; then
    sudo cat "/etc/systemd/system/$name" > "$BACKUP/$name"
  fi
done

if [[ "$TRUSTED_ROOT_CARRIER" == "1" ]]; then
  chown "$SERVICE_USER:$SERVICE_GROUP" "$BASE"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$V10"
fi

rollback_units() {
  for name in "$SERVICE" "$TIMER"; do
    if [ -f "$BACKUP/$name" ]; then
      sudo cp "$BACKUP/$name" "/etc/systemd/system/$name"
    else
      sudo rm -f "/etc/systemd/system/$name"
    fi
  done
  sudo systemctl daemon-reload || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback_units; fi; rm -rf "$STAGE"; exit $rc' EXIT

sudo tee "/etc/systemd/system/$SERVICE" >/dev/null <<EOF
[Unit]
Description=D'AUBE Native Revenue Autopilot V10
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_GROUP
Environment=HOME=$HOME
Environment=PYTHONPATH=$RUNTIME
ExecStart=/usr/bin/python3 $RUNTIME/controller.py
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$BASE
ReadOnlyPaths=$HOME/.config/daube/secrets $HOME/.venvs/freelancer
UMask=0077
Nice=10
TimeoutStartSec=10min
EOF

sudo tee "/etc/systemd/system/$TIMER" >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Native Revenue Autopilot V10

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
Persistent=true
RandomizedDelaySec=45

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$TIMER"

for timer in \
  daube-revenue-worker.timer \
  daube-freelancer-award-watcher.timer \
  daube-freelancer-executor.timer \
  daube-runtime-watchdog.timer \
  daube-freelancer-money-closure.timer
do
  test "$(systemctl is-active "$timer")" = active || { echo "V10_BLOCKED_EXISTING_TIMER=$timer"; exit 1; }
done
test "$(systemctl is-active "$TIMER")" = active

echo "VERSION=native-revenue-autopilot-v10"
echo "SOURCE_REF=$REF"
echo "V10_TIMER=$(systemctl is-active "$TIMER")"
echo "REVENUE_TRUTH=EXTERNAL_SETTLEMENT_ONLY"

trap - EXIT
rm -rf "$STAGE"
