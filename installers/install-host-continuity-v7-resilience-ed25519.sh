#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_HOST='daube-host-01'
EXPECTED_USER='founder_daubesonntag_com'
SERVICE='daube-resilience-mesh-agent.service'
COMPAT_ROOT='/usr/local/libexec/daube-resilience-mesh'
BIN_DIR="$COMPAT_ROOT/bin"
WRAPPER="$BIN_DIR/openssl"
DROPIN_DIR="/etc/systemd/system/${SERVICE}.d"
DROPIN="$DROPIN_DIR/20-ed25519-oneshot-compat.conf"

log(){ printf '[D’AUBE HOST CONTINUITY V7] %s\n' "$*"; }
fail(){ printf '[D’AUBE HOST CONTINUITY V7] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(hostname -s)" == "$EXPECTED_HOST" ]] || fail 'wrong host'
[[ "$(id -un)" == "$EXPECTED_USER" ]] || fail 'wrong user'
for cmd in sudo systemctl journalctl openssl mktemp grep awk; do command -v "$cmd" >/dev/null || fail "missing command: $cmd"; done
sudo -n true || fail 'existing non-interactive sudo authority unavailable'
systemctl cat "$SERVICE" >/dev/null 2>&1 || fail 'resilience mesh agent service not installed'

log 'installing service-scoped OpenSSL Ed25519 one-shot compatibility shim'
sudo -n install -d -o root -g root -m 0755 "$BIN_DIR"
cat >/tmp/daube-openssl-ed25519-compat <<'WRAP'
#!/usr/bin/env bash
set -Eeuo pipefail
REAL='/usr/bin/openssl'
[[ -x "$REAL" ]] || { echo 'real openssl missing' >&2; exit 69; }

if [[ "${1:-}" == 'pkeyutl' ]]; then
  sign=0
  rawin=0
  has_in=0
  for arg in "$@"; do
    case "$arg" in
      -sign) sign=1 ;;
      -rawin) rawin=1 ;;
      -in) has_in=1 ;;
    esac
  done
  if (( sign == 1 && rawin == 1 && has_in == 0 )); then
    umask 077
    tmp="$(mktemp "${TMPDIR:-/tmp}/daube-ed25519-msg.XXXXXX")"
    cleanup(){ rm -f "$tmp"; }
    trap cleanup EXIT HUP INT TERM
    cat >"$tmp"
    set +e
    "$REAL" "$@" -in "$tmp"
    rc=$?
    set -e
    cleanup
    trap - EXIT HUP INT TERM
    exit "$rc"
  fi
fi

exec "$REAL" "$@"
WRAP
sudo -n install -o root -g root -m 0755 /tmp/daube-openssl-ed25519-compat "$WRAPPER"

log 'proving compatibility shim with an ephemeral Ed25519 identity'
TESTDIR="$(mktemp -d)"
trap 'rm -rf "$TESTDIR" /tmp/daube-openssl-ed25519-compat' EXIT
umask 077
/usr/bin/openssl genpkey -algorithm ED25519 -out "$TESTDIR/key.pem" >/dev/null 2>&1
/usr/bin/openssl pkey -in "$TESTDIR/key.pem" -pubout -out "$TESTDIR/pub.pem" >/dev/null 2>&1
printf '%s' '{"daube":"resilience-mesh-ed25519-v7"}' >"$TESTDIR/msg.json"
cat "$TESTDIR/msg.json" | "$WRAPPER" pkeyutl -sign -rawin -inkey "$TESTDIR/key.pem" >"$TESTDIR/sig.bin"
/usr/bin/openssl pkeyutl -verify -rawin -pubin -inkey "$TESTDIR/pub.pem" -in "$TESTDIR/msg.json" -sigfile "$TESTDIR/sig.bin" >/dev/null 2>&1 \
  || fail 'compatibility shim signature verification failed'

log 'scoping compatibility shim to resilience mesh agent service only'
sudo -n install -d -o root -g root -m 0755 "$DROPIN_DIR"
cat >/tmp/daube-resilience-mesh-openssl-dropin <<EOF
[Service]
Environment="PATH=${BIN_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EOF
sudo -n install -o root -g root -m 0644 /tmp/daube-resilience-mesh-openssl-dropin "$DROPIN"
sudo -n systemctl daemon-reload
sudo -n systemctl reset-failed "$SERVICE" 2>/dev/null || true

log 'running bounded heartbeat restart/readback'
set +e
sudo -n systemctl start "$SERVICE"
SERVICE_RC=$?
set -e

if [[ "$SERVICE_RC" -ne 0 ]]; then
  sudo -n journalctl -u "$SERVICE" -n 120 --no-pager >&2 || true
  fail "resilience mesh heartbeat still failed rc=$SERVICE_RC"
fi

RECENT="$(sudo -n journalctl -u "$SERVICE" --since '3 minutes ago' --no-pager 2>/dev/null || true)"
if grep -Eq 'unable to determine file size for oneshot operation|Public Key operation error|CalledProcessError.*pkeyutl' <<<"$RECENT"; then
  printf '%s\n' "$RECENT" >&2
  fail 'Ed25519 one-shot signing failure still present after compatibility shim'
fi

if systemctl cat daube-resilience-mesh-agent.timer >/dev/null 2>&1; then
  sudo -n systemctl enable --now daube-resilience-mesh-agent.timer >/dev/null
fi

log 'RESILIENCE_MESH_ED25519_V7_VERIFIED serviceStart=PASS cryptoCompat=PASS keyRotated=false costCeiling=0 authorityExpanded=false'
