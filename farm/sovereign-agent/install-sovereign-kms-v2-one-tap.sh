#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REVISION="${DAUBE_SOVEREIGN_KMS_REVISION:-af82989cf68c69e7876a080c42405cb15139c9e7}"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${REVISION}/farm/sovereign-agent"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
BIN_DIR="$HOME/.local/bin"
STATE_DIR="$HOME/.local/share/daube-sovereign-host"
PID_FILE="$STATE_DIR/kms/worker.pid"
LOG_FILE="$STATE_DIR/kms/worker.log"

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: run this inside Termux on Android" >&2; exit 2 ;;
esac

pkg install -y python openssl curl coreutils >/dev/null
pkg install -y openssl-tool >/dev/null 2>&1 || true
command -v python >/dev/null || { echo "ERROR: python unavailable" >&2; exit 3; }
command -v openssl >/dev/null || { echo "ERROR: openssl unavailable" >&2; exit 3; }
command -v curl >/dev/null || { echo "ERROR: curl unavailable" >&2; exit 3; }

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$STATE_DIR/kms"
chmod 700 "$STATE_DIR" "$STATE_DIR/kms"

# Stop an older KMS daemon only if its PID file points to a live process.
if [[ -f "$PID_FILE" ]]; then
  old="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$old" =~ ^[0-9]+$ ]] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$old" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$old" 2>/dev/null && kill -9 "$old" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for file in direct-agent.py sovereign-kms-worker.py sovereign-kms-worker-v2.py; do
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$BASE/$file" -o "$work/$file"
done
python -m py_compile "$work/direct-agent.py" "$work/sovereign-kms-worker.py" "$work/sovereign-kms-worker-v2.py"
install -m 0755 "$work/direct-agent.py" "$INSTALL_DIR/direct-agent.py"
install -m 0755 "$work/sovereign-kms-worker.py" "$INSTALL_DIR/sovereign-kms-worker.py"
install -m 0755 "$work/sovereign-kms-worker-v2.py" "$INSTALL_DIR/sovereign-kms-worker-v2.py"

cat >"$BIN_DIR/daube-sovereign-kms-v2" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
exec python "$INSTALL_DIR/sovereign-kms-worker-v2.py" "\$@"
EOF
chmod 0755 "$BIN_DIR/daube-sovereign-kms-v2"

cat >"$BIN_DIR/daube-sovereign-kms-status" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
STATE_DIR="$STATE_DIR"
PID_FILE="$PID_FILE"
ROOT_PRIVATE="\$STATE_DIR/kms/root-rsa-3072.pem"
ROOT_PUBLIC="\$STATE_DIR/kms/root-rsa-3072.pub.pem"
printf 'D’AUBE Sovereign KMS v2 status\n'
printf '%s\n' '------------------------------'
printf 'revision: %s\n' "$REVISION"
printf 'activation: private-key-possession-canary-required\n'
printf 'transport: outbound-https-only\n'
printf 'arbitraryShell: false\n'
printf 'paidSpendAuthorized: false\n'
if [[ -f "\$PID_FILE" ]]; then
  pid="\$(cat "\$PID_FILE" 2>/dev/null || true)"
  if [[ "\$pid" =~ ^[0-9]+$ ]] && kill -0 "\$pid" 2>/dev/null; then printf 'worker: RUNNING pid=%s\n' "\$pid"; else printf 'worker: STALE_PID\n'; fi
else
  printf 'worker: STOPPED\n'
fi
if [[ -f "\$ROOT_PRIVATE" ]]; then
  mode="\$(stat -c '%a' "\$ROOT_PRIVATE" 2>/dev/null || true)"
  printf 'rootPrivateKeyPresent: true\n'
  printf 'rootPrivateKeyMode: %s\n' "\$mode"
  printf 'rootPrivateKeyExported: false\n'
else
  printf 'rootPrivateKeyPresent: false\n'
fi
if [[ -f "\$ROOT_PUBLIC" ]]; then printf 'rootPublicSha256: %s\n' "\$(sha256sum "\$ROOT_PUBLIC" | awk '{print \$1}')"; fi
printf 'hardwareAttestationVerified: false\n'
EOF
chmod 0755 "$BIN_DIR/daube-sovereign-kms-status"

if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$HOME/.bashrc"
fi
export PATH="$BIN_DIR:$PATH"

# Hard gate: registration + private-key-possession canary must pass before daemon starts.
printf '\nD’AUBE Sovereign KMS v2 · admission canary\n'
"$BIN_DIR/daube-sovereign-kms-v2" --register-only

nohup "$BIN_DIR/daube-sovereign-kms-v2" --daemon >>"$LOG_FILE" 2>&1 &
pid=$!
printf '%s\n' "$pid" >"$PID_FILE"
chmod 600 "$PID_FILE" "$LOG_FILE" 2>/dev/null || true
sleep 1
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "ERROR: KMS v2 worker exited during startup" >&2
  tail -n 30 "$LOG_FILE" >&2 || true
  exit 4
fi

printf '\nD’AUBE Sovereign KMS v2 STARTED pid=%s\n' "$pid"
"$BIN_DIR/daube-sovereign-kms-status"
printf '\nNo inbound port, no cloud/GitHub bearer credential, no paid fallback.\n'
