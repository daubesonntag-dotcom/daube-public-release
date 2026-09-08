#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

HOST_ALIAS="${DAUBE_HOST_ALIAS:-daube-host-01}"
HOST_REPAIR_SHA="761f4a4cf0acd79e88df2bfef746afa762f7c882"
HOST_REPAIR_URL="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${HOST_REPAIR_SHA}/host/daube-v3-systemd-repair-v2.sh"
VERIFY_SHA="4436ca1333ca67eb17a56274dc9b76dd69ac863d"
VERIFY_URL="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${VERIFY_SHA}/host/verify-resource-warehouse-public-v2.sh"

say(){ printf '[SMART %s] %s\n' "$(date '+%F %T')" "$*"; }
fail(){ say "ERROR: $*"; exit 1; }

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

find_systemctl(){
  command -v systemctl 2>/dev/null || true
  for p in /usr/bin/systemctl /bin/systemctl /usr/local/bin/systemctl; do
    [[ -x "$p" ]] && { printf '%s\n' "$p"; return 0; }
  done
  return 1
}

run_host_payload(){
  say 'Host/systemd environment detected; running bounded V3 repair.'
  curl -fsSL --proto '=https' --tlsv1.2 "$HOST_REPAIR_URL" | env PATH="$PATH" bash
  say 'Running public Resource Warehouse manifest verifier.'
  curl -fsSL --proto '=https' --tlsv1.2 "$VERIFY_URL" | env PATH="$PATH" bash
}

if SYSTEMCTL_PATH="$(find_systemctl | head -n1)" && [[ -n "$SYSTEMCTL_PATH" ]]; then
  say "systemctl=$SYSTEMCTL_PATH pid1=$(ps -p 1 -o comm= 2>/dev/null | tr -d ' ' || true) host=$(hostname 2>/dev/null || true)"
  run_host_payload
  exit 0
fi

if [[ "${PREFIX:-}" == *com.termux* ]] || [[ -d /data/data/com.termux/files/usr ]]; then
  say 'Termux environment detected; delegating repair to daube-host-01.'
  command -v ssh >/dev/null 2>&1 || fail 'ssh missing in Termux'
  ssh -G "$HOST_ALIAS" >/dev/null 2>&1 || fail "SSH alias missing: $HOST_ALIAS"
  ssh -o BatchMode=yes -o ConnectTimeout=12 "$HOST_ALIAS" 'env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin bash -s' <<REMOTE
set -Eeuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
printf '[REMOTE] host=%s pid1=%s systemctl=%s\n' "\$(hostname)" "\$(ps -p 1 -o comm= 2>/dev/null | tr -d ' ' || true)" "\$(command -v systemctl || true)"
command -v systemctl >/dev/null 2>&1 || { echo '[REMOTE] ERROR: systemctl still missing'; ls -l /usr/bin/systemctl /bin/systemctl 2>/dev/null || true; exit 40; }
curl -fsSL --proto '=https' --tlsv1.2 '$HOST_REPAIR_URL' | bash
curl -fsSL --proto '=https' --tlsv1.2 '$VERIFY_URL' | bash
REMOTE
  exit 0
fi

say "Environment is neither Termux nor a visible systemd host. host=$(hostname 2>/dev/null || true) pid1=$(ps -p 1 -o comm= 2>/dev/null | tr -d ' ' || true) PATH=$PATH"
ls -l /usr/bin/systemctl /bin/systemctl /usr/local/bin/systemctl 2>/dev/null || true
fail 'No usable systemctl found; refusing to guess.'
