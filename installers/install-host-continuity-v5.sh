#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_HOST='daube-host-01'
EXPECTED_USER='founder_daubesonntag_com'
REMOTE_UNIT='daube-remote-control-agent@founder_daubesonntag_com.service'
WATCHDOG_SERVICE='daube-remote-control-agent-watchdog.service'
WATCHDOG_TIMER='daube-remote-control-agent-watchdog.timer'
SOVEREIGN_TIMER='daube-sovereign-execution.timer'
STATE_DIR='/var/lib/daube-remote-agent-watchdog'

log(){ printf '[D’AUBE HOST CONTINUITY V5] %s\n' "$*"; }
fail(){ printf '[D’AUBE HOST CONTINUITY V5] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(hostname -s)" == "$EXPECTED_HOST" ]] || fail 'wrong host'
[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail 'wrong user'
sudo -n true || fail 'existing non-interactive sudo authority unavailable'
systemctl cat "$REMOTE_UNIT" >/dev/null || fail 'persistent Remote Agent unit missing'
systemctl cat "$SOVEREIGN_TIMER" >/dev/null || fail 'Sovereign timer missing'

WATCHDOG_TMP="$(mktemp)"
SERVICE_TMP="$(mktemp)"
TIMER_TMP="$(mktemp)"
trap 'rm -f "$WATCHDOG_TMP" "$SERVICE_TMP" "$TIMER_TMP"' EXIT

cat > "$WATCHDOG_TMP" <<'WATCHDOG'
#!/usr/bin/env bash
set -Eeuo pipefail
REMOTE_UNIT='daube-remote-control-agent@founder_daubesonntag_com.service'
STATE_DIR='/var/lib/daube-remote-agent-watchdog'
STAMP="$STATE_DIR/last-restart-epoch"
COOLDOWN_SECONDS=600
mkdir -p "$STATE_DIR"
now="$(date +%s)"
last=0
if [[ -r "$STAMP" ]]; then read -r last < "$STAMP" || last=0; fi
[[ "$last" =~ ^[0-9]+$ ]] || last=0
reason=''
if ! systemctl is-active --quiet "$REMOTE_UNIT"; then
  reason='unit_inactive'
else
  recent="$(journalctl -u "$REMOTE_UNIT" --since "-4 minutes" --no-pager 2>/dev/null || true)"
  if grep -Fq 'Remote session expired and could not be renewed.' <<<"$recent"; then
    reason='session_lost'
  elif grep -Fq 'Device startup failed' <<<"$recent"; then
    reason='startup_failed'
  fi
fi
if [[ -z "$reason" ]]; then
  echo 'REMOTE_AGENT_WATCHDOG=HEALTHY_NO_ACTION'
  exit 0
fi
if (( now - last < COOLDOWN_SECONDS )); then
  echo "REMOTE_AGENT_WATCHDOG=HOLD_COOLDOWN reason=$reason"
  exit 0
fi
printf '%s\n' "$now" > "$STAMP.tmp"
chmod 600 "$STAMP.tmp"
mv -f "$STAMP.tmp" "$STAMP"
echo "REMOTE_AGENT_WATCHDOG=RESTART reason=$reason"
systemctl restart "$REMOTE_UNIT"
sleep 3
systemctl is-active --quiet "$REMOTE_UNIT" || exit 1
echo 'REMOTE_AGENT_WATCHDOG=RESTARTED_ACTIVE'
WATCHDOG

cat > "$SERVICE_TMP" <<'SERVICE'
[Unit]
Description=D'AUBE Remote Control Agent session watchdog
After=network-online.target daube-remote-control-agent@founder_daubesonntag_com.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/libexec/daube/remote-control-agent-watchdog
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
PrivateDevices=true
RestrictRealtime=true
LockPersonality=true
ReadWritePaths=/var/lib/daube-remote-agent-watchdog
UMask=0077
TimeoutStartSec=45s
SERVICE

cat > "$TIMER_TMP" <<'TIMER'
[Unit]
Description=D'AUBE Remote Control Agent session watchdog timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
RandomizedDelaySec=10s
AccuracySec=5s
Persistent=true
Unit=daube-remote-control-agent-watchdog.service

[Install]
WantedBy=timers.target
TIMER

log 'installing bounded Remote Agent watchdog'
sudo -n install -d -o root -g root -m 0755 /usr/local/libexec/daube
sudo -n install -d -o root -g root -m 0700 "$STATE_DIR"
sudo -n install -o root -g root -m 0755 "$WATCHDOG_TMP" /usr/local/libexec/daube/remote-control-agent-watchdog
sudo -n install -o root -g root -m 0644 "$SERVICE_TMP" "/etc/systemd/system/$WATCHDOG_SERVICE"
sudo -n install -o root -g root -m 0644 "$TIMER_TMP" "/etc/systemd/system/$WATCHDOG_TIMER"
sudo -n systemctl daemon-reload

log 'reconciling Sovereign timer'
sudo -n systemctl enable --now daube-sovereign-execution.timer >/dev/null
systemctl is-enabled --quiet daube-sovereign-execution.timer || fail 'Sovereign timer not enabled'
systemctl is-active --quiet daube-sovereign-execution.timer || fail 'Sovereign timer not active'

log 'performing one bounded Remote Agent restart'
now="$(date +%s)"
printf '%s\n' "$now" | sudo -n tee "$STATE_DIR/last-restart-epoch" >/dev/null
sudo -n chmod 600 "$STATE_DIR/last-restart-epoch"
sudo -n systemctl restart "$REMOTE_UNIT"
sleep 3
systemctl is-active --quiet "$REMOTE_UNIT" || fail 'Remote Agent process not active after restart'

sudo -n systemctl enable --now daube-remote-control-agent-watchdog.timer >/dev/null
systemctl is-enabled --quiet daube-remote-control-agent-watchdog.timer || fail 'Remote Agent watchdog timer not enabled'
systemctl is-active --quiet daube-remote-control-agent-watchdog.timer || fail 'Remote Agent watchdog timer not active'

log 'HOST_CONTINUITY_V5_APPLIED agentProcessActive=true sovereignTimerActive=true watchdogActive=true costCeiling=0 authorityExpanded=false'
