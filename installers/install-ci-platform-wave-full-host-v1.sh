#!/usr/bin/env bash
set -Eeuo pipefail

HOST_EXPECTED="daube-host-01"
FOUNDER="founder_daubesonntag_com"

log(){ printf '[D\047AUBE CI PLATFORM RECOVERY] %s\n' "$*"; }
die(){ log "HOLD: $*" >&2; exit 1; }

[[ "$(hostname -s)" == "$HOST_EXPECTED" ]] || die "wrong host"
[[ "$(id -un)" == "$FOUNDER" ]] || die "run through D'AUBE host autopilot founder identity"
command -v sudo >/dev/null 2>&1 || die "sudo missing"
sudo -n true >/dev/null 2>&1 || die "passwordless sudo authority missing"

log "request canonical verified ci-platform main"
sudo -n /usr/bin/bash -s <<'ROOT'
set -Eeuo pipefail
umask 077
REPO="daubesonntag-dotcom/daube-ci-platform"
BRANCH="main"
ENVFILE="/etc/daube/daube-executor-v2.env"
CONTROL="/opt/daube/control/daube-ci-platform"
STATE="/var/lib/daube-executor"
NODE="/opt/daube/toolchains/node24/bin/node"

[[ -f "$ENVFILE" ]] || { echo 'executor secret plane missing' >&2; exit 21; }
set -a
# shellcheck disable=SC1090
. "$ENVFILE"
set +a
[[ -n "${GH_TOKEN:-}" ]] || { echo 'GH_TOKEN missing in host secret plane' >&2; exit 22; }
export GH_TOKEN
for cmd in gh git jq rsync systemctl systemd-analyze bash mktemp tr; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "missing command: $cmd" >&2; exit 23; }
done

TARGET_SHA="$(gh api "repos/${REPO}/branches/${BRANCH}" --jq '.commit.sha' | tr '[:upper:]' '[:lower:]')"
[[ "$TARGET_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'canonical main target SHA invalid' >&2; exit 20; }
VERIFIED="$(gh api "repos/${REPO}/commits/${TARGET_SHA}" --jq .commit.verification.verified)"
[[ "$VERIFIED" == "true" ]] || { echo 'canonical main commit is not GitHub verified' >&2; exit 24; }

if [[ -f "$CONTROL/CONTROL_REVISION" ]]; then
  CURRENT_SHA="$(tr -d '\r\n' < "$CONTROL/CONTROL_REVISION" | tr '[:upper:]' '[:lower:]')"
  if [[ "$CURRENT_SHA" =~ ^[a-f0-9]{40}$ && "$CURRENT_SHA" != "$TARGET_SHA" ]]; then
    COMPARE_STATUS="$(gh api "repos/${REPO}/compare/${CURRENT_SHA}...${TARGET_SHA}" --jq '.status')"
    [[ "$COMPARE_STATUS" == "ahead" ]] || { echo 'canonical main is not a fast-forward from installed control' >&2; exit 31; }
  fi
fi

echo "resolved canonical verified target ${TARGET_SHA}"
WORK="$(mktemp -d "${STATE}/ci-platform-bootstrap.XXXXXX")"
BACKUP="${STATE}/ci-platform-bootstrap-lkg"
cleanup(){ rm -rf "$WORK"; }
trap cleanup EXIT

gh repo clone "$REPO" "$WORK/repo" -- --filter=blob:none --no-tags --no-checkout >/dev/null 2>&1
git -C "$WORK/repo" fetch --no-tags origin "$TARGET_SHA" >/dev/null 2>&1
git -C "$WORK/repo" checkout --detach "$TARGET_SHA" >/dev/null 2>&1
OBSERVED="$(git -C "$WORK/repo" rev-parse HEAD | tr '[:upper:]' '[:lower:]')"
[[ "$OBSERVED" == "$TARGET_SHA" ]] || { echo 'exact checkout mismatch' >&2; exit 25; }
[[ -z "$(git -C "$WORK/repo" status --porcelain=v1 --untracked-files=all)" ]] || { echo 'target checkout dirty' >&2; exit 26; }

bash -n \
  "$WORK/repo/deploy/systemd/install-daube-executor-v2.sh" \
  "$WORK/repo/deploy/systemd/install-daube-wave-full-host-v1.sh" \
  "$WORK/repo/deploy/systemd/install-daube-host-capsule-v1.sh" \
  "$WORK/repo/deploy/systemd/daube-host-boot-guardian-v1.sh" \
  "$WORK/repo/deploy/systemd/install-daube-gcp-e2-micro-controller-v1.sh"

if [[ -x "$NODE" ]]; then
  "$NODE" --test \
    "$WORK/repo/tests/host-boot-guardian-v1.test.mjs" \
    "$WORK/repo/tests/host-capsule-installer-v1.test.mjs" \
    "$WORK/repo/tests/host-steward-v1.test.mjs" \
    "$WORK/repo/tests/wave-full-host-bootstrap.test.mjs"
fi

rm -rf "$BACKUP"
install -d -o root -g root -m 0700 "$BACKUP"
if [[ -d "$CONTROL" ]]; then rsync -a "$CONTROL/" "$BACKUP/"; fi

set +e
DAUBE_CONTROL_REVISION="$TARGET_SHA" DAUBE_AUTHORIZE_THIS_HOST=1 \
  bash "$WORK/repo/deploy/systemd/install-daube-gcp-e2-micro-controller-v1.sh"
RC=$?
set -e
if (( RC != 0 )); then
  echo "canonical installer failed rc=$RC; restoring previous control root" >&2
  if [[ -d "$BACKUP" ]]; then
    install -d -o root -g root -m 0755 "$CONTROL"
    rsync -a --delete "$BACKUP/" "$CONTROL/"
  fi
  systemctl daemon-reload || true
  systemctl restart daube-executor-v2.service || true
  exit "$RC"
fi

[[ -f "$CONTROL/CONTROL_REVISION" ]] || { echo 'CONTROL_REVISION readback missing' >&2; exit 27; }
READBACK="$(tr -d '\r\n' < "$CONTROL/CONTROL_REVISION" | tr '[:upper:]' '[:lower:]')"
[[ "$READBACK" == "$TARGET_SHA" ]] || { echo "CONTROL_REVISION mismatch: $READBACK" >&2; exit 28; }

for unit in \
  daube-executor-v2.service \
  daube-machine-heartbeat.timer \
  daube-wave-full-dispatcher.timer \
  daube-host-steward-v1.timer \
  daube-host-self-recovery-v1.timer \
  daube-host-boot-guardian-v1.timer \
  daube-customer-care-mail.service \
  daube-customer-care-mail-source-sync.timer \
  daube-revenue-opportunity-worker.timer \
  daube-enterprise-governor-v1.service \
  daube-enterprise-governor-source-sync-v1.timer \
  daube-enterprise-runtime-github-status-publisher.timer; do
  systemctl is-enabled --quiet "$unit" || { echo "unit not enabled: $unit" >&2; exit 29; }
  systemctl is-active --quiet "$unit" || { echo "unit not active: $unit" >&2; exit 30; }
done

echo "CI_PLATFORM_WAVE_FULL_PASS revision=${TARGET_SHA}"
ROOT

log "PASS canonical verified ci-platform main requested and read back"
