#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_HOST='daube-host-01'
MESH_TIMER='daube-resilience-mesh-agent.timer'
MESH_SERVICE='daube-resilience-mesh-agent.service'
STATE_URL='https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-public-recovery/v1/resilience-mesh/state'
KILL_SWITCH='/var/lib/daube-executor/FOUNDER_KILL_SWITCH'
AUTOPILOT_KILL_SWITCH="${HOME}/daube-host-autopilot/DISABLED"

log(){ printf '[D\047AUBE MESH BRIDGE REPAIR] %s\n' "$*"; }
die(){ log "HOLD $*"; exit 2; }

[[ "$(hostname -s)" == "$EXPECTED_HOST" ]] || die 'wrong_host'
[[ ! -e "$KILL_SWITCH" && ! -e "$AUTOPILOT_KILL_SWITCH" ]] || die 'founder_kill_switch_active'
for cmd in systemctl curl python3 sudo hostname seq sleep; do command -v "$cmd" >/dev/null 2>&1 || die "required_command_missing:${cmd}"; done
sudo -n true >/dev/null 2>&1 || die 'noninteractive_sudo_unavailable'
sudo -n systemctl cat "$MESH_TIMER" >/dev/null 2>&1 || die 'mesh_timer_not_installed'
sudo -n systemctl cat "$MESH_SERVICE" >/dev/null 2>&1 || die 'mesh_service_not_installed'

before_timer_enabled="$(systemctl is-enabled "$MESH_TIMER" 2>/dev/null || true)"
before_timer_active="$(systemctl is-active "$MESH_TIMER" 2>/dev/null || true)"
before_service_active="$(systemctl is-active "$MESH_SERVICE" 2>/dev/null || true)"
committed=0

rollback(){
  (( committed == 1 )) && return 0
  log 'rollback_begin'
  if [[ "$before_timer_enabled" == 'enabled' ]]; then
    sudo -n systemctl enable "$MESH_TIMER" >/dev/null 2>&1 || true
  else
    sudo -n systemctl disable "$MESH_TIMER" >/dev/null 2>&1 || true
  fi
  if [[ "$before_timer_active" == 'active' ]]; then
    sudo -n systemctl start "$MESH_TIMER" >/dev/null 2>&1 || true
  else
    sudo -n systemctl stop "$MESH_TIMER" >/dev/null 2>&1 || true
  fi
  if [[ "$before_service_active" == 'active' ]]; then
    sudo -n systemctl start "$MESH_SERVICE" >/dev/null 2>&1 || true
  else
    sudo -n systemctl stop "$MESH_SERVICE" >/dev/null 2>&1 || true
  fi
}
trap rollback EXIT

sudo -n systemctl daemon-reload
sudo -n systemctl reset-failed "$MESH_SERVICE" "$MESH_TIMER" >/dev/null 2>&1 || true
sudo -n systemctl enable --now "$MESH_TIMER"
sudo -n systemctl start --no-block "$MESH_SERVICE"
systemctl is-enabled --quiet "$MESH_TIMER" || die 'mesh_timer_not_enabled'
systemctl is-active --quiet "$MESH_TIMER" || die 'mesh_timer_not_active'

for _ in $(seq 1 30); do
  if curl -fsS --max-time 8 -H 'Accept: application/json' -H 'Cache-Control: no-store' "$STATE_URL" \
    | python3 -c 'import json,sys
j=json.load(sys.stdin)
ok=(j.get("ok") is True and j.get("mode")=="PRIMARY" and j.get("activeNodeId")=="daube-host-01" and j.get("mutationAuthorityProven") is True and j.get("paidSpendAuthorized") is False)
raise SystemExit(0 if ok else 1)' >/dev/null 2>&1; then
    committed=1
    trap - EXIT
    log 'PASS authoritative mesh PRIMARY restored; paidSpendAuthorized=false'
    exit 0
  fi
  sleep 2
done

die 'external_mesh_primary_readback_failed'
