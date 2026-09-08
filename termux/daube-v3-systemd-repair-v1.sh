#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
umask 077
HOST_ALIAS="${DAUBE_HOST_ALIAS:-daube-host-01}"
LOG_DIR="$HOME/.daube-v3"
LOG_FILE="$LOG_DIR/systemd-repair-v1.log"
mkdir -p "$LOG_DIR"
log(){ printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG_FILE"; }
die(){ log "ERROR: $*"; exit 1; }
case "${PREFIX:-}" in *com.termux*) ;; *) die 'Run inside Termux on Android.';; esac
termux-wake-lock 2>/dev/null || true
command -v ssh >/dev/null 2>&1 || die 'OpenSSH is required in Termux.'
ssh -G "$HOST_ALIAS" >/dev/null 2>&1 || die "SSH alias missing: $HOST_ALIAS"
ssh -o BatchMode=yes -o ConnectTimeout=12 "$HOST_ALIAS" 'true' >/dev/null 2>&1 || die "SSH unreachable: $HOST_ALIAS"
log "Repairing D’AUBE V3 systemd packaging on $HOST_ALIAS"
ssh -tt -o ServerAliveInterval=20 -o ServerAliveCountMax=6 "$HOST_ALIAS" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
sudo -n true
say(){ printf '[HOST %s] %s\n' "$(date '+%F %T')" "$*"; }
CORE=(daube-v3-controller.service daube-v3-radar.service)
MAIL=daube-customer-care-mail-source-sync.service

say '1/6 snapshot current unit definitions'
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVID="/var/lib/daube/v3/evidence/$STAMP-systemd-repair-v1"
sudo -n install -d -m 0755 /var/lib/daube/v3/evidence
sudo -n install -d -m 0750 "$EVID"
for u in "${CORE[@]}" "$MAIL"; do
  if systemctl list-unit-files "$u" --no-legend 2>/dev/null | grep -q "^$u"; then
    systemctl cat "$u" | sudo -n tee "$EVID/${u}.unit.before.txt" >/dev/null || true
    systemctl show "$u" | sudo -n tee "$EVID/${u}.show.before.txt" >/dev/null || true
    journalctl -u "$u" -n 80 --no-pager -o short-iso | sudo -n tee "$EVID/${u}.journal.before.log" >/dev/null || true
  fi
done

say '2/6 install persistent V3 directories via tmpfiles'
cat <<'EOF' | sudo -n tee /etc/tmpfiles.d/daube-v3.conf >/dev/null
d /etc/daube/v3 0755 root root -
d /var/lib/daube/v3 0755 root root -
d /var/log/daube/v3 0755 root root -
d /run/daube/v3 0755 root root -
EOF
sudo -n systemd-tmpfiles --create /etc/tmpfiles.d/daube-v3.conf
sudo -n test -d /etc/daube/v3

say '3/6 install bootstrap service + bounded sandbox write paths'
cat <<'EOF' | sudo -n tee /etc/systemd/system/daube-v3-bootstrap.service >/dev/null
[Unit]
Description=D'AUBE V3 Runtime Directory Bootstrap
Before=daube-v3-controller.service daube-v3-radar.service

[Service]
Type=oneshot
ExecStart=/usr/bin/install -d -m 0755 /etc/daube/v3 /var/lib/daube/v3 /var/log/daube/v3 /run/daube/v3
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
for u in daube-v3-controller.service daube-v3-radar.service; do
  sudo -n install -d -m 0755 "/etc/systemd/system/${u}.d"
  cat <<'EOF' | sudo -n tee "/etc/systemd/system/${u}.d/20-daube-v3-bootstrap.conf" >/dev/null
[Unit]
Requires=daube-v3-bootstrap.service
After=daube-v3-bootstrap.service

[Service]
ReadWritePaths=/etc/daube/v3 /var/lib/daube/v3 /var/log/daube/v3 /run/daube/v3
EOF
done
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now daube-v3-bootstrap.service >/dev/null

say '4/6 restart V3 core'
for u in "${CORE[@]}"; do
  if systemctl list-unit-files "$u" --no-legend 2>/dev/null | grep -q "^$u"; then
    sudo -n systemctl reset-failed "$u" 2>/dev/null || true
    sudo -n systemctl restart "$u"
    sleep 2
  fi
done

say '5/6 retry customer-care sync without changing its security boundary'
if systemctl list-unit-files "$MAIL" --no-legend 2>/dev/null | grep -q "^$MAIL"; then
  sudo -n systemctl reset-failed "$MAIL" 2>/dev/null || true
  sudo -n systemctl restart "$MAIL" || true
  sleep 2
fi

say '6/6 verify + receipt'
core_pass=1
for u in "${CORE[@]}"; do
  state="$(systemctl is-active "$u" 2>/dev/null || true)"
  printf '%s=%s\n' "$u" "$state"
  [[ "$state" == active ]] || core_pass=0
  systemctl status "$u" --no-pager -l | sudo -n tee "$EVID/${u}.status.after.txt" >/dev/null || true
  journalctl -u "$u" -n 60 --no-pager -o short-iso | sudo -n tee "$EVID/${u}.journal.after.log" >/dev/null || true
done
mail_state="missing"
if systemctl list-unit-files "$MAIL" --no-legend 2>/dev/null | grep -q "^$MAIL"; then
  mail_state="$(systemctl is-active "$MAIL" 2>/dev/null || true)"
  printf '%s=%s\n' "$MAIL" "$mail_state"
  systemctl status "$MAIL" --no-pager -l | sudo -n tee "$EVID/${MAIL}.status.after.txt" >/dev/null || true
  journalctl -u "$MAIL" -n 80 --no-pager -o short-iso | sudo -n tee "$EVID/${MAIL}.journal.after.log" >/dev/null || true
fi
if command -v daube-v3 >/dev/null 2>&1; then
  daube-v3 status | sudo -n tee "$EVID/daube-v3-status.txt" >/dev/null || true
  daube-v3 radar | sudo -n tee "$EVID/daube-v3-radar.txt" >/dev/null || true
  daube-v3 snapshot | sudo -n tee "$EVID/daube-v3-snapshot.txt" >/dev/null || true
fi
printf '{"schema":"daube.v3-systemd-repair-receipt.v1","timestamp":"%s","controller":"%s","radar":"%s","mailSync":"%s","corePass":%s,"evidence":"%s"}\n' \
  "$(date -u +%FT%TZ)" \
  "$(systemctl is-active daube-v3-controller.service 2>/dev/null || true)" \
  "$(systemctl is-active daube-v3-radar.service 2>/dev/null || true)" \
  "$mail_state" \
  "$([[ $core_pass -eq 1 ]] && echo true || echo false)" \
  "$EVID" | sudo -n tee "$EVID/receipt.json"

echo '--- FAILED UNITS ---'
systemctl --failed --no-pager || true
if [[ $core_pass -eq 1 ]]; then
  echo 'DAUBE_V3_CORE=PASS'
else
  echo 'DAUBE_V3_CORE=FAIL'
  exit 31
fi
if [[ "$mail_state" == active || "$mail_state" == inactive || "$mail_state" == missing ]]; then
  echo "DAUBE_MAIL_SYNC=$mail_state"
else
  echo "DAUBE_MAIL_SYNC=DEGRADED"
  echo '--- MAIL LAST LOGS ---'
  journalctl -u "$MAIL" -n 40 --no-pager -o cat || true
fi
REMOTE
log 'PASS: D’AUBE V3 bounded systemd repair completed.'
