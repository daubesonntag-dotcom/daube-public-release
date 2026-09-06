#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_HOST='daube-host-01'
EXPECTED_USER='founder_daubesonntag_com'
VERIFIED_BASE='673222cd1e37777631bc7a921b083f0cc18734d1'
COMPUTE_REPO="$HOME/daube/daube-compute-mesh"
STATE_DIR='/var/lib/daube-host-executor'
STATE_FILE="$STATE_DIR/state.json"
RECEIPT_DIR="$STATE_DIR/receipts"
REMOTE_UNIT="daube-remote-control-agent@${EXPECTED_USER}.service"

log(){ printf '[D’AUBE HOST CONTINUITY V6] %s\n' "$*"; }
fail(){ printf '[D’AUBE HOST CONTINUITY V6] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(hostname -s)" == "$EXPECTED_HOST" ]] || fail 'wrong host'
[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail 'wrong user'
[[ -d "$COMPUTE_REPO/.git" ]] || fail 'canonical Compute Mesh checkout missing'
for cmd in git node npm curl sudo systemctl journalctl ss awk grep find; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done
sudo -n true || fail 'existing non-interactive sudo authority unavailable'

origin="$(git -C "$COMPUTE_REPO" remote get-url origin)"
case "$origin" in
  git@github.com:daubesonntag-dotcom/daube-compute-mesh.git|ssh://git@github.com/daubesonntag-dotcom/daube-compute-mesh.git) ;;
  *) fail 'untrusted Compute Mesh origin' ;;
esac
[[ -z "$(git -C "$COMPUTE_REPO" status --porcelain=v1 --untracked-files=no)" ]] || fail 'tracked Compute Mesh drift detected'
git -C "$COMPUTE_REPO" fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
git -C "$COMPUTE_REPO" cat-file -e "${VERIFIED_BASE}^{commit}" || fail 'verified Sovereign v3 baseline missing'
git -C "$COMPUTE_REPO" merge-base --is-ancestor "$VERIFIED_BASE" refs/remotes/origin/main || fail 'main is not a trusted fast-forward descendant'
git -C "$COMPUTE_REPO" merge --ff-only refs/remotes/origin/main
TARGET_SHA="$(git -C "$COMPUTE_REPO" rev-parse HEAD)"
[[ "$TARGET_SHA" == "$(git -C "$COMPUTE_REPO" rev-parse refs/remotes/origin/main)" ]] || fail 'checkout not exact fetched main'
cd "$COMPUTE_REPO"

prove_health(){
  local health ports bad
  health="$(curl -fsS http://127.0.0.1:8787/healthz)" || fail 'localhost health unavailable'
  printf '%s' "$health" | node --input-type=module -e '
let body=""; for await (const c of process.stdin) body += c;
const j=JSON.parse(body);
if (j?.schema !== "daube.compute-mesh-service.v1" || j?.ok !== true || j?.productionAuthorityExpanded !== false) process.exit(3);
' || fail 'canonical health contract failed'
  ports="$(ss -ltnH | awk '{print $4}' | awk '$0 ~ /:8787$/ {print}')"
  [[ -n "$ports" ]] || fail 'no listener on 8787'
  bad="$(printf '%s\n' "$ports" | grep -vx '127.0.0.1:8787' || true)"
  [[ -z "$bad" ]] || { printf '%s\n' "$bad" >&2; fail 'NON_LOOPBACK_8787_FORBIDDEN'; }
}

latest_receipt(){
  find "$RECEIPT_DIR" -maxdepth 1 -type f -name '*.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-
}

archive_rollback_state(){
  [[ -r "$STATE_FILE" ]] || return 0
  local rollback stamp
  rollback="$(node --input-type=module - "$STATE_FILE" <<'NODE'
import fs from 'node:fs';
const j=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
process.stdout.write(j?.rollbackRequired === true ? '1' : '0');
NODE
)" || fail 'updater state invalid JSON'
  [[ "$rollback" == 1 ]] || return 0
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  sudo -n install -d -o root -g root -m 0700 "$STATE_DIR/archive"
  sudo -n cp -a "$STATE_FILE" "$STATE_DIR/archive/state-before-v6-$stamp.json"
  sudo -n rm -f "$STATE_FILE"
  log 'archived stale rollback-required updater state after exact-main + health proof'
}

UPDATER_RC=0
OUTCOME='UNKNOWN'
LATEST_RECEIPT=''
run_updater_once(){
  local before after
  before="$(latest_receipt || true)"
  sudo -n systemctl reset-failed daube-host-autonomous-update.service 2>/dev/null || true
  set +e
  sudo -n systemctl start daube-host-autonomous-update.service
  UPDATER_RC=$?
  set -e
  after="$(latest_receipt || true)"
  [[ -n "$after" && -r "$after" ]] || fail 'updater produced no readable receipt'
  [[ "$after" != "$before" ]] || fail 'updater produced no fresh receipt'
  LATEST_RECEIPT="$after"
  OUTCOME="$(node --input-type=module - "$after" <<'NODE'
import fs from 'node:fs'; const j=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); process.stdout.write(String(j?.outcome ?? 'UNKNOWN'));
NODE
)"
  log "updater rc=$UPDATER_RC outcome=$OUTCOME receipt=$LATEST_RECEIPT"
}

log "source admitted targetSha=$TARGET_SHA"
prove_health
sudo -n systemctl stop daube-host-autonomous-update.timer 2>/dev/null || true
for _ in $(seq 1 30); do systemctl is-active --quiet daube-host-autonomous-update.service || break; sleep 1; done
systemctl is-active --quiet daube-host-autonomous-update.service && fail 'updater remained busy >30s'
archive_rollback_state
run_updater_once

case "$OUTCOME" in
  NO_CHANGE|ACTIVATED)
    [[ "$UPDATER_RC" -eq 0 ]] || fail 'healthy updater receipt paired with non-zero service result'
    ;;
  HOLD_ROLLBACK_REQUIRED)
    prove_health
    archive_rollback_state
    run_updater_once
    [[ "$UPDATER_RC" -eq 0 && "$OUTCOME" =~ ^(NO_CHANGE|ACTIVATED)$ ]] || { cat "$LATEST_RECEIPT" >&2; exit 51; }
    ;;
  HOLD_LOCK_BUSY)
    sleep 5
    systemctl is-active --quiet daube-host-autonomous-update.service && { cat "$LATEST_RECEIPT" >&2; exit 52; }
    run_updater_once
    [[ "$UPDATER_RC" -eq 0 && "$OUTCOME" =~ ^(NO_CHANGE|ACTIVATED)$ ]] || { cat "$LATEST_RECEIPT" >&2; exit 53; }
    ;;
  HOLD_BASELINE_UNHEALTHY)
    cat "$LATEST_RECEIPT" >&2
    prove_health
    exit 54
    ;;
  *)
    cat "$LATEST_RECEIPT" >&2
    exit 55
    ;;
esac
sudo -n systemctl enable --now daube-host-autonomous-update.timer >/dev/null

if ! systemctl is-enabled --quiet daube-compute-mesh.service; then
  sudo -n systemctl enable daube-compute-mesh.service >/dev/null 2>&1 || sudo -n systemctl add-wants multi-user.target daube-compute-mesh.service >/dev/null
fi
systemctl is-enabled --quiet daube-compute-mesh.service || fail 'Compute Mesh not boot-enabled'

log 'reconciling reviewed runtimes'
sudo -n bash scripts/install-sovereign-execution-fabric.sh
sudo -n bash scripts/install-host-ops-supervisor-safe-v2.sh
sudo -n bash scripts/install-remote-control-agent.sh
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now daube-runtime.target >/dev/null
sudo -n systemctl enable --now daube-sovereign-execution.timer daube-host-ops-supervisor.timer "$REMOTE_UNIT" >/dev/null

log 'installing bounded functional Remote Agent watchdog'
cat >/tmp/daube-remote-agent-watchdog-v6 <<'WATCHDOG'
#!/usr/bin/env bash
set -Eeuo pipefail
UNIT='daube-remote-control-agent@founder_daubesonntag_com.service'
STAMP='/var/lib/daube-remote-agent-watchdog/last-restart'
NOW="$(date +%s)"; LAST=0
[[ -r "$STAMP" ]] && LAST="$(cat "$STAMP" 2>/dev/null || echo 0)"
[[ "$LAST" =~ ^[0-9]+$ ]] || LAST=0
if ! systemctl is-active --quiet daube-sovereign-execution.timer; then systemctl restart daube-sovereign-execution.timer; fi
if ! systemctl is-active --quiet "$UNIT"; then systemctl restart "$UNIT"; printf '%s\n' "$NOW" >"$STAMP"; exit 0; fi
LOG="$(journalctl -u "$UNIT" --since '4 minutes ago' --no-pager 2>/dev/null || true)"
if grep -Eq 'Remote session expired and could not be renewed|Device startup failed|remote_channel_session_lost' <<<"$LOG"; then
  if (( NOW - LAST >= 600 )); then systemctl restart "$UNIT"; printf '%s\n' "$NOW" >"$STAMP"; fi
fi
WATCHDOG
sudo -n install -d -o root -g root -m 0755 /usr/local/libexec/daube
sudo -n install -d -o root -g root -m 0700 /var/lib/daube-remote-agent-watchdog
sudo -n install -o root -g root -m 0755 /tmp/daube-remote-agent-watchdog-v6 /usr/local/libexec/daube/remote-agent-watchdog
cat >/tmp/daube-remote-agent-watchdog-v6.service <<'UNIT'
[Unit]
Description=D'AUBE Remote Agent functional watchdog
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/libexec/daube/remote-agent-watchdog
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
UNIT
cat >/tmp/daube-remote-agent-watchdog-v6.timer <<'TIMER'
[Unit]
Description=D'AUBE Remote Agent watchdog timer
[Timer]
OnBootSec=90s
OnUnitActiveSec=2min
AccuracySec=15s
Persistent=true
Unit=daube-remote-agent-watchdog.service
[Install]
WantedBy=timers.target
TIMER
sudo -n install -o root -g root -m 0644 /tmp/daube-remote-agent-watchdog-v6.service /etc/systemd/system/daube-remote-agent-watchdog.service
sudo -n install -o root -g root -m 0644 /tmp/daube-remote-agent-watchdog-v6.timer /etc/systemd/system/daube-remote-agent-watchdog.timer
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now daube-remote-agent-watchdog.timer >/dev/null

for unit in daube-compute-mesh.service daube-host-autonomous-update.timer daube-sovereign-execution.timer daube-host-ops-supervisor.timer "$REMOTE_UNIT" daube-remote-agent-watchdog.timer; do
  systemctl is-enabled --quiet "$unit" || fail "$unit not enabled"
  systemctl is-active --quiet "$unit" || fail "$unit not active"
done
prove_health
log "HOST_CONTINUITY_V6_VERIFIED computeSha=$TARGET_SHA updater=$OUTCOME costCeiling=0 authorityExpanded=false"
