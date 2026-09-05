#!/usr/bin/env bash
set -euo pipefail

REQUESTED_USER="${DAUBE_AUTOPILOT_USER:-}"
if (( EUID == 0 )); then
  [[ -n "$REQUESTED_USER" ]] || { echo "AUTOPILOT_BLOCKED=ROOT_REQUIRES_USER"; exit 1; }
  id "$REQUESTED_USER" >/dev/null 2>&1 || { echo "AUTOPILOT_BLOCKED=OWNER_INVALID"; exit 1; }
  USER_NAME="$REQUESTED_USER"
  USER_GROUP="$(id -gn "$USER_NAME")"
  EXPECTED_HOME="$(getent passwd "$USER_NAME" | cut -d: -f6)"
  [[ -n "$EXPECTED_HOME" && "$HOME" == "$EXPECTED_HOME" ]] || { echo "AUTOPILOT_BLOCKED=HOME_MISMATCH"; exit 1; }
  privileged(){ "$@"; }
else
  USER_NAME="$(id -un)"
  USER_GROUP="$(id -gn)"
  [[ -z "$REQUESTED_USER" || "$REQUESTED_USER" == "$USER_NAME" ]] || { echo "AUTOPILOT_BLOCKED=OWNER_MISMATCH"; exit 1; }
  command -v sudo >/dev/null 2>&1 || { echo "AUTOPILOT_BLOCKED=SUDO_MISSING"; exit 1; }
  privileged(){ sudo "$@"; }
fi

ROOT="$HOME/daube-host-autopilot"; RUNTIME="$ROOT/runtime"; STATE="$ROOT/state"
REPO="daubesonntag-dotcom/daube-public-release"
for cmd in curl python3 systemctl flock install id getent cut tee chmod chown cat rm mkdir mktemp; do command -v "$cmd" >/dev/null || { echo "AUTOPILOT_BLOCKED=${cmd^^}_MISSING"; exit 1; }; done
if [ -n "${DAUBE_AUTOPILOT_REF:-}" ]; then
  REF="$DAUBE_AUTOPILOT_REF"
else
  MANIFEST_URL="https://raw.githubusercontent.com/$REPO/main/.daube/autopilot/host-desired-state.json"
  REF="$(curl -fsSL "$MANIFEST_URL" | python3 -c 'import json,re,sys; m=json.load(sys.stdin); r=str(m.get("target_revision","")); assert re.fullmatch(r"[0-9a-f]{40}",r), "invalid target revision"; print(r)')"
fi
[[ "$REF" =~ ^[0-9a-f]{40}$ ]] || { echo "AUTOPILOT_BLOCKED=INVALID_REF"; exit 1; }
RAW="https://raw.githubusercontent.com/$REPO/$REF/runtime/host-autopilot"
FILES=(models.py manifest.py chain.py stage.py checks.py transaction.py controller.py watchdog.py run.py test_autopilot.py)
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
for f in "${FILES[@]}"; do curl -fsSL "$RAW/$f" -o "$STAGE/$f"; done
(
  cd "$STAGE"
  PYTHONPATH="$STAGE" python3 -m unittest -v test_autopilot.py
  python3 -m py_compile models.py manifest.py chain.py stage.py checks.py transaction.py controller.py watchdog.py run.py
  PYTHONPATH="$STAGE" python3 run.py --verify
)
mkdir -p "$RUNTIME" "$STATE" "$ROOT/staging" "$ROOT/snapshots" "$ROOT/bootstrap-backup"
chmod 700 "$ROOT" "$RUNTIME" "$STATE" "$ROOT/staging" "$ROOT/snapshots" "$ROOT/bootstrap-backup"
if (( EUID == 0 )); then chown -R "$USER_NAME:$USER_GROUP" "$ROOT"; fi
for f in "${FILES[@]}"; do install -o "$USER_NAME" -g "$USER_GROUP" -m 600 "$STAGE/$f" "$RUNTIME/$f"; done
BACKUP="$ROOT/bootstrap-backup"
for name in daube-host-autopilot.service daube-host-autopilot.timer daube-host-autopilot-watchdog.service daube-host-autopilot-watchdog.timer; do
  p="/etc/systemd/system/$name"; if privileged test -f "$p"; then privileged cat "$p" > "$BACKUP/$name"; fi
done
rollback_units(){
  for name in daube-host-autopilot.service daube-host-autopilot.timer daube-host-autopilot-watchdog.service daube-host-autopilot-watchdog.timer; do
    if [ -f "$BACKUP/$name" ]; then privileged cp "$BACKUP/$name" "/etc/systemd/system/$name"; else privileged rm -f "/etc/systemd/system/$name"; fi
  done
  privileged systemctl daemon-reload || true
}
trap 'rc=$?; if [ $rc -ne 0 ]; then rollback_units; fi; rm -rf "$STAGE"; exit $rc' EXIT
privileged tee /etc/systemd/system/daube-host-autopilot.service >/dev/null <<EOF
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
privileged tee /etc/systemd/system/daube-host-autopilot.timer >/dev/null <<'EOF'
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
privileged tee /etc/systemd/system/daube-host-autopilot-watchdog.service >/dev/null <<EOF
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
privileged tee /etc/systemd/system/daube-host-autopilot-watchdog.timer >/dev/null <<'EOF'
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
privileged systemctl daemon-reload
privileged systemctl enable --now daube-host-autopilot.timer daube-host-autopilot-watchdog.timer
privileged systemctl start daube-host-autopilot.service
privileged systemctl start daube-host-autopilot-watchdog.service
test "$(systemctl is-active daube-host-autopilot.timer)" = active
test "$(systemctl is-active daube-host-autopilot-watchdog.timer)" = active
PYTHONPATH="$RUNTIME" python3 "$RUNTIME/run.py" --verify
echo "AUTOPILOT=BOOTSTRAPPED"; echo "SOURCE_REF=$REF"
echo "DEPLOY_TIMER=$(systemctl is-active daube-host-autopilot.timer)"
echo "WATCHDOG_TIMER=$(systemctl is-active daube-host-autopilot-watchdog.timer)"
echo "KILL_SWITCH=$ROOT/DISABLED"
trap - EXIT; rm -rf "$STAGE"
