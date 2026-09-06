#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_HOST='daube-host-01'
EXPECTED_USER='founder_daubesonntag_com'
EXPECTED_COMPUTE_SHA='673222cd1e37777631bc7a921b083f0cc18734d1'
COMPUTE_REPO="$HOME/daube/daube-compute-mesh"

log(){ printf '[D’AUBE HOST CONTINUITY V3] %s\n' "$*"; }
fail(){ printf '[D’AUBE HOST CONTINUITY V3] ERROR: %s\n' "$*" >&2; exit 1; }

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
REMOTE_SHA="$(git -C "$COMPUTE_REPO" rev-parse refs/remotes/origin/main)"
[[ "$REMOTE_SHA" == "$EXPECTED_COMPUTE_SHA" ]] || fail "unexpected Compute Mesh main: $REMOTE_SHA"
git -C "$COMPUTE_REPO" merge --ff-only refs/remotes/origin/main
[[ "$(git -C "$COMPUTE_REPO" rev-parse HEAD)" == "$EXPECTED_COMPUTE_SHA" ]] || fail 'canonical Compute Mesh checkout not exact expected SHA'

cd "$COMPUTE_REPO"
log 'running focused source gates'
npm run test:remote-control-persistence
npm run test:sovereign-execution
npm run test:host-ops-supervisor-all
bash -n scripts/install-remote-control-agent.sh
bash -n scripts/install-sovereign-execution-fabric.sh
bash -n scripts/install-host-ops-supervisor-safe.sh

log 'installing reviewed root-owned runtime snapshots'
sudo -n bash scripts/install-sovereign-execution-fabric.sh
sudo -n bash scripts/install-host-ops-supervisor-safe.sh
sudo -n bash scripts/install-remote-control-agent.sh
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

log "HOST_CONTINUITY_V3_VERIFIED computeSha=$EXPECTED_COMPUTE_SHA costCeiling=0 authorityExpanded=false"
