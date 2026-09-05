#!/usr/bin/env bash
set -Eeuo pipefail

STAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$STAGE_ROOT/runtime/ci-platform"
DEST_DIR="/opt/daube/control/daube-ci-platform/runtime/persistent-executor-v2"
UNIT_SRC="$SRC_DIR/daube-executor-v2.service"
UNIT_DST="/etc/systemd/system/daube-executor-v2.service"
NODE="/opt/daube/toolchains/node24/bin/node"
STATE="/var/lib/daube-executor/cloudflare-control-plane.json"
BACKUP="$HOME/daube-host-autopilot/snapshots/cloudflare-control-plane-host-v1-$(date +%s)"
CI_SOURCE_SHA="0921123567d3dab4353d61e5e4f0e6abb7833434"

for cmd in sudo systemctl python3; do command -v "$cmd" >/dev/null || { echo "BLOCKED_${cmd^^}_MISSING"; exit 1; }; done
sudo -n true >/dev/null 2>&1 || { echo 'BLOCKED_SUDO_NONINTERACTIVE'; exit 1; }
test -x "$NODE" || { echo 'BLOCKED_NODE24_MISSING'; exit 1; }
for f in cloudflare-control-plane.mjs cloudflare-control-plane-hook.mjs daube-executor-v2.service; do test -s "$SRC_DIR/$f" || { echo "BLOCKED_PAYLOAD_MISSING=$f"; exit 1; }; done
"$NODE" --check "$SRC_DIR/cloudflare-control-plane.mjs"
"$NODE" --check "$SRC_DIR/cloudflare-control-plane-hook.mjs"
systemd-analyze verify "$UNIT_SRC" >/dev/null

mkdir -p "$BACKUP"; chmod 700 "$BACKUP"
backup_one(){ local src="$1" name="$2"; if sudo test -f "$src"; then sudo cat "$src" > "$BACKUP/$name"; chmod 600 "$BACKUP/$name"; else : > "$BACKUP/$name.absent"; fi; }
restore_one(){ local dst="$1" name="$2"; if [ -f "$BACKUP/$name" ]; then sudo install -o root -g root -m 0644 "$BACKUP/$name" "$dst"; elif [ -f "$BACKUP/$name.absent" ]; then sudo rm -f "$dst"; fi; }

backup_one "$DEST_DIR/cloudflare-control-plane.mjs" cloudflare-control-plane.mjs
backup_one "$DEST_DIR/cloudflare-control-plane-hook.mjs" cloudflare-control-plane-hook.mjs
backup_one "$UNIT_DST" daube-executor-v2.service

rollback(){
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "ROLLBACK=START rc=$rc"
    restore_one "$DEST_DIR/cloudflare-control-plane.mjs" cloudflare-control-plane.mjs
    restore_one "$DEST_DIR/cloudflare-control-plane-hook.mjs" cloudflare-control-plane-hook.mjs
    restore_one "$UNIT_DST" daube-executor-v2.service
    sudo systemctl daemon-reload || true
    sudo systemctl restart daube-executor-v2.service || true
    echo 'ROLLBACK=DONE'
  fi
  exit "$rc"
}
trap rollback EXIT

sudo install -d -o root -g root -m 0755 "$DEST_DIR"
sudo install -o root -g root -m 0644 "$SRC_DIR/cloudflare-control-plane.mjs" "$DEST_DIR/cloudflare-control-plane.mjs"
sudo install -o root -g root -m 0644 "$SRC_DIR/cloudflare-control-plane-hook.mjs" "$DEST_DIR/cloudflare-control-plane-hook.mjs"
sudo install -o root -g root -m 0644 "$UNIT_SRC" "$UNIT_DST"
sudo systemctl daemon-reload
sudo systemctl restart daube-executor-v2.service
ready=''
for _ in $(seq 1 24); do
  if systemctl is-active --quiet daube-executor-v2.service && sudo test -s "$STATE"; then
    snapshot="$(sudo cat "$STATE")"
    verdict="$(printf '%s' "$snapshot" | python3 -c 'import json,sys; x=json.load(sys.stdin); ok=x.get("tokenVerified") is True and (x.get("zone") or {}).get("name")=="daubesonntag.com" and str(x.get("status","")).startswith("READY"); print("PASS" if ok else "HOLD")')"
    if [ "$verdict" = PASS ]; then ready=1; break; fi
  fi
  sleep 2
done

[ -n "$ready" ] || { echo 'BLOCKED_CLOUDFLARE_READINESS'; sudo cat "$STATE" 2>/dev/null || true; exit 1; }
sudo grep -F -- '--import /opt/daube/control/daube-ci-platform/runtime/persistent-executor-v2/cloudflare-control-plane-hook.mjs' "$UNIT_DST" >/dev/null
systemctl is-active --quiet daube-executor-v2.service

echo 'CLOUDFLARE_CONTROL_PLANE=READY'
echo "CI_SOURCE_SHA=$CI_SOURCE_SHA"
echo "STATE_PATH=$STATE"
echo "BACKUP_PATH=$BACKUP"
trap - EXIT
