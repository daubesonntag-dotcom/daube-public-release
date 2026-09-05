#!/usr/bin/env bash
set -euo pipefail

ROOT="$HOME/daube-host-autopilot"
RUNTIME="$ROOT/runtime"
STATE="$ROOT/state"
REF="${DAUBE_NATIVE_AUTOPILOT_REF:-${DAUBE_AUTOPILOT_TARGET_REVISION:-main}}"
REPO="daubesonntag-dotcom/daube-public-release"
RAW="https://raw.githubusercontent.com/$REPO/$REF/runtime/host-autopilot"
FILES=(models.py manifest.py chain.py stage.py checks.py transaction.py controller.py watchdog.py run.py test_autopilot.py)
SERVICE="daube-native-autopilot-chain.service"
TIMER="daube-native-autopilot-chain.timer"
BACKUP="$ROOT/native-chain-unit-backup"

for cmd in curl python3 systemctl flock sudo; do
  command -v "$cmd" >/dev/null || { echo "NATIVE_AUTOPILOT_BLOCKED=${cmd^^}_MISSING"; exit 1; }
done
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || { echo "NATIVE_AUTOPILOT_BLOCKED=EXACT_REF_REQUIRED"; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
for f in "${FILES[@]}"; do curl -fsSL "$RAW/$f" -o "$STAGE/$f"; done

(
  cd "$STAGE"
  PYTHONPATH="$STAGE" python3 -m unittest -v test_autopilot.py
  python3 -m py_compile models.py manifest.py chain.py stage.py checks.py transaction.py controller.py watchdog.py run.py
  PYTHONPATH="$STAGE" python3 run.py --verify
)

mkdir -p "$RUNTIME" "$STATE" "$ROOT/staging" "$ROOT/snapshots" "$BACKUP"
chmod 700 "$ROOT" "$RUNTIME" "$STATE" "$ROOT/staging" "$ROOT/snapshots" "$BACKUP"
for f in "${FILES[@]}"; do install -m 600 "$STAGE/$f" "$RUNTIME/$f"; done

USER_NAME="$(id -un)"
for name in "$SERVICE" "$TIMER"; do
  if sudo test -f "/etc/systemd/system/$name"; then sudo cat "/etc/systemd/system/$name" > "$BACKUP/$name"; fi
done
rollback_units(){
  for name in "$SERVICE" "$TIMER"; do
    if [ -f "$BACKUP/$name" ]; then sudo cp "$BACKUP/$name" "/etc/systemd/system/$name"; else sudo rm -f "/etc/systemd/system/$name"; fi
  done
  sudo systemctl daemon-reload || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback_units; fi; rm -rf "$STAGE"; exit $rc' EXIT

sudo tee "/etc/systemd/system/$SERVICE" >/dev/null <<EOF
[Unit]
Description=D'AUBE Native Autopilot Release Chain V1
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER_NAME
Environment=HOME=$HOME
Environment=PYTHONPATH=$RUNTIME
ExecStart=/usr/bin/flock -n $ROOT/deploy.lock /usr/bin/python3 $RUNTIME/run.py --native-chain
PrivateTmp=true
UMask=0077
Nice=10
TimeoutStartSec=35min
NoNewPrivileges=true
EOF

sudo tee "/etc/systemd/system/$TIMER" >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Native Autopilot Release Chain

[Timer]
OnBootSec=7min
OnUnitActiveSec=10min
Persistent=true
RandomizedDelaySec=45

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$TIMER"
PYTHONPATH="$RUNTIME" python3 "$RUNTIME/run.py" --verify

test "$(systemctl is-active "$TIMER")" = active
ENTRY="$(systemctl show -p ExecStart --value "$SERVICE")"
printf '%s\n' "$ENTRY" | grep -F "$ROOT/deploy.lock" >/dev/null
printf '%s\n' "$ENTRY" | grep -F -- '--native-chain' >/dev/null

echo "VERSION=native-autopilot-chain-v1"
echo "SOURCE_REF=$REF"
echo "NATIVE_CHAIN_TIMER=$(systemctl is-active "$TIMER")"
echo "SHARED_DEPLOY_LOCK=$ROOT/deploy.lock"
echo "FOUNDER_KILL_SWITCH=$ROOT/DISABLED"

trap - EXIT
rm -rf "$STAGE"
