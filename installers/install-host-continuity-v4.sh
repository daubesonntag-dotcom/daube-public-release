#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_HOST='daube-host-01'
EXPECTED_USER='founder_daubesonntag_com'
VERIFIED_BASE='673222cd1e37777631bc7a921b083f0cc18734d1'
COMPUTE_REPO="$HOME/daube/daube-compute-mesh"

log(){ printf '[D’AUBE HOST CONTINUITY V4] %s\n' "$*"; }
fail(){ printf '[D’AUBE HOST CONTINUITY V4] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(hostname -s)" == "$EXPECTED_HOST" ]] || fail 'wrong host'
[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail 'wrong user'
[[ -d "$COMPUTE_REPO/.git" ]] || fail 'canonical Compute Mesh checkout missing'
for cmd in git npm node curl sudo systemctl ss awk grep; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done
sudo -n true || fail 'existing non-interactive sudo authority unavailable'

origin="$(git -C "$COMPUTE_REPO" remote get-url origin)"
case "$origin" in
  git@github.com:daubesonntag-dotcom/daube-compute-mesh.git|ssh://git@github.com/daubesonntag-dotcom/daube-compute-mesh.git) ;;
  *) fail 'untrusted Compute Mesh origin' ;;
esac
[[ -z "$(git -C "$COMPUTE_REPO" status --porcelain=v1 --untracked-files=no)" ]] || fail 'tracked Compute Mesh drift detected'

git -C "$COMPUTE_REPO" fetch --no-tags origin refs/heads/main:refs/remotes/origin/main
TARGET_SHA="$(git -C "$COMPUTE_REPO" rev-parse refs/remotes/origin/main)"
git -C "$COMPUTE_REPO" cat-file -e "${VERIFIED_BASE}^{commit}" || fail 'verified Sovereign v3 baseline missing'
git -C "$COMPUTE_REPO" merge-base --is-ancestor "$VERIFIED_BASE" refs/remotes/origin/main || fail 'current Compute Mesh main is not a trusted fast-forward descendant of Sovereign v3 baseline'
git -C "$COMPUTE_REPO" merge --ff-only refs/remotes/origin/main
[[ "$(git -C "$COMPUTE_REPO" rev-parse HEAD)" == "$TARGET_SHA" ]] || fail 'canonical Compute Mesh checkout not exact fetched main'

cd "$COMPUTE_REPO"
log "source admitted targetSha=$TARGET_SHA baseline=$VERIFIED_BASE"
log 'running focused source gates'
npm run test:remote-control-persistence
npm run test:sovereign-execution
npm run test:sovereign-execution-v3
npm run test:host-ops-supervisor-all
bash -n scripts/install-remote-control-agent.sh
bash -n scripts/install-sovereign-execution-fabric.sh
bash -n scripts/install-host-ops-supervisor-safe.sh

ensure_core_boot_persistence(){
  log 'reconciling Compute Mesh boot persistence before Host Ops readback'
  sudo -n systemctl daemon-reload
  if ! systemctl is-enabled --quiet daube-compute-mesh.service; then
    if ! sudo -n systemctl enable daube-compute-mesh.service >/dev/null 2>&1; then
      sudo -n systemctl add-wants multi-user.target daube-compute-mesh.service >/dev/null
    fi
  fi
  systemctl is-enabled --quiet daube-compute-mesh.service || fail 'Compute Mesh could not be made boot-enabled'
  if ! systemctl is-active --quiet daube-compute-mesh.service; then
    sudo -n systemctl start daube-compute-mesh.service
  fi
  systemctl is-active --quiet daube-compute-mesh.service || fail 'Compute Mesh is not active'
  sudo -n systemctl enable --now daube-host-autonomous-update.timer >/dev/null
  systemctl is-enabled --quiet daube-host-autonomous-update.timer || fail 'autonomous updater timer not enabled'
  systemctl is-active --quiet daube-host-autonomous-update.timer || fail 'autonomous updater timer not active'
}

ensure_core_boot_persistence

log 'installing reviewed Sovereign runtime snapshot'
sudo -n bash scripts/install-sovereign-execution-fabric.sh

log 'installing Host Ops only after core boot persistence is proven'
if ! sudo -n bash scripts/install-host-ops-supervisor-safe.sh; then
  echo 'HOST_OPS_V4_FAILED' >&2
  sudo -n systemctl --no-pager --full status daube-host-ops-supervisor.service >&2 || true
  sudo -n journalctl -u daube-host-ops-supervisor.service -n 80 --no-pager >&2 || true
  latest="$(sudo -n find /var/lib/daube-host-ops/receipts -maxdepth 1 -type f -name '*.json' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
  if [[ -n "${latest:-}" ]]; then sudo -n cat "$latest" >&2 || true; fi
  exit 50
fi

log 'installing persistent non-root Remote Control Agent'
sudo -n bash scripts/install-remote-control-agent.sh
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now daube-runtime.target >/dev/null

service_user="$(id -un)"
for unit in \
  daube-compute-mesh.service \
  daube-host-autonomous-update.timer \
  daube-sovereign-execution.timer \
  daube-host-ops-supervisor.timer \
  "daube-remote-control-agent@${service_user}.service"; do
  systemctl is-enabled --quiet "$unit" || fail "$unit not enabled"
  systemctl is-active --quiet "$unit" || fail "$unit not active"
done

HEALTH_FILE="$(mktemp)"
trap 'rm -f "$HEALTH_FILE"' EXIT
curl -fsS http://127.0.0.1:8787/healthz > "$HEALTH_FILE"
node --input-type=module - "$HEALTH_FILE" <<'NODE'
import fs from 'node:fs';
const health = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (health?.ok !== true) throw new Error('compute_mesh_health_not_ok');
if (health?.productionAuthorityExpanded !== false) throw new Error('production_authority_expanded');
NODE
if ss -ltnH | awk '{print $4}' | grep -Eq '^(0\.0\.0\.0|\[::\]|\*):8787$'; then
  fail 'public Compute Mesh listener detected'
fi

log "HOST_CONTINUITY_V4_VERIFIED computeSha=$TARGET_SHA costCeiling=0 authorityExpanded=false"
