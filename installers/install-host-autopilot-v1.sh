#!/usr/bin/env bash
set -euo pipefail
ROOT="$HOME/daube-host-autopilot"; RUNTIME="$ROOT/runtime"; STATE="$ROOT/state"
REPO="daubesonntag-dotcom/daube-public-release"
for cmd in curl python3 systemctl flock sudo; do command -v "$cmd" >/dev/null || { echo "AUTOPILOT_BLOCKED=${cmd^^}_MISSING"; exit 1; }; done
if [ -n "${DAUBE_AUTOPILOT_REF:-}" ]; then
  REF="$DAUBE_AUTOPILOT_REF"
else
  MANIFEST_URL="https://raw.githubusercontent.com/$REPO/main/.daube/autopilot/host-desired-state.json"
  REF="$(curl -fsSL "$MANIFEST_URL" | python3 -c 'import json,re,sys; m=json.load(sys.stdin); r=str(m.get("target_revision","")); assert re.fullmatch(r"[0-9a-f]{40}",r), "invalid target revision"; print(r)')"
fi
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || { echo "AUTOPILOT_BLOCKED=INVALID_REF"; exit 1; }
RAW="https://raw.githubusercontent.com/$REPO/$REF/runtime/host-autopilot"
FILES=(models.py manifest.py stage.py checks.py transaction.py controller.py watchdog.py run.py test_autopilot.py)
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
for f in "${FILES[@]}"; do curl -fsSL "$RAW/$f" -o "$STAGE/$f"; done
(
  cd "$STAGE"
  PYTHONPATH="$STAGE" python3 -m unittest -v test_autopilot.py
  python3 -m py_compile models.py manifest.py stage.py checks.py transaction.py controller.py watchdog.py run.py
  PYTHONPATH="$STAGE" python3 run.py --verify
)
mkdir -p "$RUNTIME" "$STATE" "$ROOT/staging" "$ROOT/snapshots" "$ROOT/bootstrap-backup"
chmod 700 "$ROOT" "$RUNTIME" "$STATE" "$ROOT/staging" "$ROOT/snapshots" "$ROOT/bootstrap-backup"
for f in "${FILES[@]}"; do install -m 600 "$STAGE/$f" "$RUNTIME/$f"; done
USER_NAME="$(id -un)"; BACKUP="$ROOT/bootstrap-backup"
for name in daube-host-autopilot.service daube-host-autopilot.timer daube-host-autopilot-watchdog.service daube-host-autopilot-watchdog.timer; do
  p="/etc/systemd/system/$name"; if sudo test -f "$p"; then sudo cat "$p" > "$BACKUP/$name"; fi
done
rollback_units(){
  for name in daube-host-autopilot.service daube-host-autopilot.timer daube-host-autopilot-watchdog.service daube-host-autopilot-watchdog.timer; do
    if [ -f "$BACKUP/$name" ]; then sudo cp "$BACKUP/$name" "/etc/systemd/system/$name"; else sudo rm -f "/etc/systemd/system/$name"; fi
  done
  sudo systemctl daemon-reload || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback_units; fi; rm -rf "$STAGE"; exit $rc' EXIT
sudo tee /etc/systemd/system/daube-host-autopilot.service >/dev/null <<EOF
[Unit]
Description=D'AUBE Host Autopilot v1
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=$USER_NAME
Environment=HOME=$HOME
Environment=PYTHONPATH=$RUNTIME
ExecStart=/usr/bin/flock -n $ROOT/deploy.lock /usr/bin/python3 $RUNTIME/run.py
PrivateTmp=true
UMask=0077
Nice=10
TimeoutStartSec=35min
EOF
sudo tee /etc/systemd/system/daube-host-autopilot.timer >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Host Autopilot
[Timer]
OnBootSec=4min
OnUnitActiveSec=10min
Persistent=true
RandomizedDelaySec=45
[Install]
WantedBy=timers.target
EOF
sudo tee /etc/systemd/system/daube-host-autopilot-watchdog.service >/dev/null <<EOF
[Unit]
Description=D'AUBE Host Autopilot Watchdog v1
After=network-online.target
[Service]
Type=oneshot
User=$USER_NAME
Environment=HOME=$HOME
Environment=PYTHONPATH=$RUNTIME
ExecStart=/usr/bin/python3 $RUNTIME/run.py --watchdog
PrivateTmp=true
UMask=0077
Nice=10
TimeoutStartSec=5min
EOF
sudo tee /etc/systemd/system/daube-host-autopilot-watchdog.timer >/dev/null <<'EOF'
[Unit]
Description=Run D'AUBE Host Autopilot Watchdog
[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
Persistent=true
RandomizedDelaySec=60
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now daube-host-autopilot.timer daube-host-autopilot-watchdog.timer
sudo systemctl start daube-host-autopilot.service
sudo systemctl start daube-host-autopilot-watchdog.service
test "$(systemctl is-active daube-host-autopilot.timer)" = active
test "$(systemctl is-active daube-host-autopilot-watchdog.timer)" = active
PYTHONPATH="$RUNTIME" python3 "$RUNTIME/run.py" --verify
echo "AUTOPILOT=BOOTSTRAPPED"; echo "SOURCE_REF=$REF"
echo "DEPLOY_TIMER=$(systemctl is-active daube-host-autopilot.timer)"
echo "WATCHDOG_TIMER=$(systemctl is-active daube-host-autopilot-watchdog.timer)"
echo "KILL_SWITCH=$ROOT/DISABLED"
trap - EXIT; rm -rf "$STAGE"
