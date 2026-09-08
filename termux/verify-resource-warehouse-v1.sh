#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
umask 077
HOST_ALIAS="${DAUBE_HOST_ALIAS:-daube-host-01}"
BRANCH="${DAUBE_WAREHOUSE_BRANCH:-upgrade/resource-warehouse-v1-20260909}"
LOG_DIR="$HOME/.daube-v3"; LOG_FILE="$LOG_DIR/resource-warehouse-v1.log"; mkdir -p "$LOG_DIR"
log(){ printf '[%s] %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG_FILE"; }
case "${PREFIX:-}" in *com.termux*) ;; *) echo 'Run inside Termux.' >&2; exit 2;; esac
termux-wake-lock 2>/dev/null || true
if ! command -v ssh >/dev/null 2>&1; then
  log 'OpenSSH missing; repairing Termux apt cache directories before install.'
  mkdir -p "$PREFIX/var/cache/apt/archives/partial" "$PREFIX/var/lib/apt/lists/partial" "${TMPDIR:-$PREFIX/tmp}"
  apt-get update
  apt-get install -y openssh
fi
ssh -G "$HOST_ALIAS" >/dev/null 2>&1 || { log "ERROR SSH alias missing: $HOST_ALIAS"; exit 10; }
ssh -o BatchMode=yes -o ConnectTimeout=12 "$HOST_ALIAS" 'true' >/dev/null 2>&1 || { log "ERROR SSH unreachable: $HOST_ALIAS"; exit 11; }
log "Verifying D’AUBE Resource Warehouse via $HOST_ALIAS branch=$BRANCH"
ssh -tt -o ServerAliveInterval=20 -o ServerAliveCountMax=6 "$HOST_ALIAS" "DAUBE_WAREHOUSE_BRANCH='$BRANCH' bash -s" <<'REMOTE'
set -Eeuo pipefail
BRANCH="${DAUBE_WAREHOUSE_BRANCH:-upgrade/resource-warehouse-v1-20260909}"
TMP="$(mktemp -d /tmp/daube-resource-warehouse.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
export PATH="$HOME/.local/node22/bin:$PATH"
command -v node >/dev/null 2>&1 || { echo 'Node missing' >&2; exit 20; }
command -v npm >/dev/null 2>&1 || { echo 'npm missing' >&2; exit 20; }
node --version
npm --version
git clone --quiet --filter=blob:none --no-checkout git@github.com:daubesonntag-dotcom/daube-provider-fabric.git "$TMP/repo"
cd "$TMP/repo"
git fetch --quiet --no-tags origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
git checkout --quiet --detach "refs/remotes/origin/$BRANCH"
SHA="$(git rev-parse HEAD)"
[[ -z "$(git status --porcelain=v1 --untracked-files=no)" ]] || { echo 'tracked checkout drift' >&2; exit 21; }
printf 'exact_sha=%s\n' "$SHA"
npm run verify
node --input-type=module <<'NODE'
import fs from 'node:fs';
for (const path of ['warehouse/RESOURCE_WAREHOUSE_V1.json','warehouse/RESOURCE_WAREHOUSE_CREATIVE_COMPUTE_V1.json']) {
  const w=JSON.parse(fs.readFileSync(path,'utf8'));
  console.log(`${path}: resources=${w.resources.length}`);
}
NODE
cat >"$TMP/receipt.json" <<EOF
{"schema":"daube.resource-warehouse-termux-receipt.v1","status":"VERIFIED","sourceSha":"$SHA","costCeilingUsd":0,"githubHostedMinutesUsed":0,"credentialMaterialIncluded":false}
EOF
cat "$TMP/receipt.json"
echo 'RESOURCE_WAREHOUSE_RUNTIME=PASS'
REMOTE
log 'PASS: Resource Warehouse verified without GitHub-hosted Actions minutes.'
