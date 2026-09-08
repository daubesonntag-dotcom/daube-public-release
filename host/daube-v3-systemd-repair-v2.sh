#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

say(){ printf '[HOST %s] %s\n' "$(date '+%F %T')" "$*"; }
fail(){ say "ERROR: $*"; exit 1; }

command -v systemctl >/dev/null 2>&1 || fail 'systemd/systemctl is required.'
sudo -n true >/dev/null 2>&1 || fail 'Non-interactive sudo is required.'

CORE=(daube-v3-controller.service daube-v3-radar.service)
MAIL=daube-customer-care-mail-source-sync.service
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_EVID=/var/lib/daube/v3/evidence
EVID="$BASE_EVID/$STAMP-systemd-repair-v2"

say '1/7 create persistent V3 directories before any sandboxed unit starts'
sudo -n install -d -m 0755 /etc/daube/v3 /var/lib/daube/v3 /var/log/daube/v3 /run/daube/v3 "$BASE_EVID"
sudo -n install -d -m 0750 "$EVID"

say '2/7 snapshot current unit definitions and journals'
for u in "${CORE[@]}" "$MAIL"; do
  if systemctl list-unit-files "$u" --no-legend 2>/dev/null | grep -q "^$u"; then
    systemctl cat "$u" | sudo -n tee "$EVID/${u}.unit.before.txt" >/dev/null || true
    systemctl show "$u" | sudo -n tee "$EVID/${u}.show.before.txt" >/dev/null || true
    journalctl -u "$u" -n 100 --no-pager -o short-iso | sudo -n tee "$EVID/${u}.journal.before.log" >/dev/null || true
  fi
done

say '3/7 persist V3 directories through reboot using tmpfiles'
cat <<'EOF' | sudo -n tee /etc/tmpfiles.d/daube-v3.conf >/dev/null
d /etc/daube/v3 0755 root root -
d /var/lib/daube/v3 0755 root root -
d /var/log/daube/v3 0755 root root -
d /run/daube/v3 0755 root root -
EOF
sudo -n systemd-tmpfiles --create /etc/tmpfiles.d/daube-v3.conf

say '4/7 install bootstrap dependency and bounded ReadWritePaths'
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

for u in "${CORE[@]}"; do
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

say '5/7 verify unit syntax, then restart V3 core'
for u in "${CORE[@]}"; do
  if ! systemctl list-unit-files "$u" --no-legend 2>/dev/null | grep -q "^$u"; then
    say "missing unit: $u"
    continue
  fi
  sudo -n systemctl reset-failed "$u" 2>/dev/null || true
  sudo -n systemctl restart "$u" || true
  sleep 2
done

say '6/7 retry customer-care mail sync without widening its sandbox'
mail_result='missing'
mail_exec='n/a'
mail_active='missing'
if systemctl list-unit-files "$MAIL" --no-legend 2>/dev/null | grep -q "^$MAIL"; then
  sudo -n systemctl reset-failed "$MAIL" 2>/dev/null || true
  sudo -n systemctl restart "$MAIL" || true
  sleep 2
  mail_result="$(systemctl show -p Result --value "$MAIL" 2>/dev/null || true)"
  mail_exec="$(systemctl show -p ExecMainStatus --value "$MAIL" 2>/dev/null || true)"
  mail_active="$(systemctl show -p ActiveState --value "$MAIL" 2>/dev/null || true)"
fi

say '7/7 verify final state and emit evidence receipt'
core_pass=1
for u in "${CORE[@]}"; do
  if ! systemctl list-unit-files "$u" --no-legend 2>/dev/null | grep -q "^$u"; then
    printf '%s=missing\n' "$u"
    core_pass=0
    continue
  fi
  type="$(systemctl show -p Type --value "$u" 2>/dev/null || true)"
  active="$(systemctl show -p ActiveState --value "$u" 2>/dev/null || true)"
  result="$(systemctl show -p Result --value "$u" 2>/dev/null || true)"
  exec_status="$(systemctl show -p ExecMainStatus --value "$u" 2>/dev/null || true)"
  printf '%s type=%s active=%s result=%s exec=%s\n' "$u" "$type" "$active" "$result" "$exec_status"
  if [[ "$type" == oneshot ]]; then
    [[ "$result" == success && "$exec_status" == 0 ]] || core_pass=0
  else
    [[ "$active" == active && "$result" == success ]] || core_pass=0
  fi
  systemctl status "$u" --no-pager -l | sudo -n tee "$EVID/${u}.status.after.txt" >/dev/null || true
  journalctl -u "$u" -n 100 --no-pager -o short-iso | sudo -n tee "$EVID/${u}.journal.after.log" >/dev/null || true
done

mail_pass=false
if [[ "$mail_result" == success && "$mail_exec" == 0 ]]; then mail_pass=true; fi
printf '%s active=%s result=%s exec=%s pass=%s\n' "$MAIL" "$mail_active" "$mail_result" "$mail_exec" "$mail_pass"
if systemctl list-unit-files "$MAIL" --no-legend 2>/dev/null | grep -q "^$MAIL"; then
  systemctl status "$MAIL" --no-pager -l | sudo -n tee "$EVID/${MAIL}.status.after.txt" >/dev/null || true
  journalctl -u "$MAIL" -n 120 --no-pager -o short-iso | sudo -n tee "$EVID/${MAIL}.journal.after.log" >/dev/null || true
fi

if command -v daube-v3 >/dev/null 2>&1; then
  daube-v3 status | sudo -n tee "$EVID/daube-v3-status.txt" >/dev/null || true
  daube-v3 radar | sudo -n tee "$EVID/daube-v3-radar.txt" >/dev/null || true
  daube-v3 snapshot | sudo -n tee "$EVID/daube-v3-snapshot.txt" >/dev/null || true
fi

controller_state="$(systemctl show -p ActiveState --value daube-v3-controller.service 2>/dev/null || true)"
radar_state="$(systemctl show -p ActiveState --value daube-v3-radar.service 2>/dev/null || true)"
printf '{"schema":"daube.v3-systemd-repair-receipt.v2","timestamp":"%s","controller":"%s","radar":"%s","mailActive":"%s","mailResult":"%s","mailExecStatus":"%s","corePass":%s,"mailPass":%s,"evidence":"%s"}\n' \
  "$(date -u +%FT%TZ)" "$controller_state" "$radar_state" "$mail_active" "$mail_result" "$mail_exec" \
  "$([[ $core_pass -eq 1 ]] && echo true || echo false)" "$mail_pass" "$EVID" | sudo -n tee "$EVID/receipt.json"

echo '--- FAILED UNITS ---'
systemctl --failed --no-pager || true

if [[ $core_pass -eq 1 ]]; then
  echo 'DAUBE_V3_CORE=PASS'
else
  echo 'DAUBE_V3_CORE=FAIL'
  echo '--- CONTROLLER LAST LOGS ---'
  journalctl -u daube-v3-controller.service -n 60 --no-pager -o cat || true
  echo '--- RADAR LAST LOGS ---'
  journalctl -u daube-v3-radar.service -n 60 --no-pager -o cat || true
  exit 31
fi

if [[ "$mail_pass" == true || "$mail_result" == missing ]]; then
  echo "DAUBE_MAIL_SYNC=PASS:$mail_active/$mail_result"
else
  echo "DAUBE_MAIL_SYNC=DEGRADED:$mail_active/$mail_result/exec=$mail_exec"
  echo '--- MAIL LAST LOGS ---'
  journalctl -u "$MAIL" -n 80 --no-pager -o cat || true
fi
