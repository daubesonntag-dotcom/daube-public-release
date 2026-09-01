#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# D'AUBE Sovereign KMS — public-safe Android/Termux installer.
# Installs only the fixed-profile RSA-OAEP unwrap worker and the canonical
# Ed25519 sovereign-host identity helper. It opens no inbound port and stores
# no GitHub/cloud bearer credential.
REVISION="${DAUBE_SOVEREIGN_KMS_REVISION:-b61e3633251cf865e6e4c8c25903deecc23a9772}"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${REVISION}/farm/sovereign-agent"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
BIN_DIR="$HOME/.local/bin"
STATE_DIR="$HOME/.local/share/daube-sovereign-host"
HOST_AGENT="$INSTALL_DIR/direct-agent.py"
KMS_WORKER="$INSTALL_DIR/sovereign-kms-worker.py"
PID_FILE="$STATE_DIR/kms/worker.pid"
LOG_FILE="$STATE_DIR/kms/worker.log"

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: This installer must run inside Termux on Android." >&2; exit 2 ;;
esac

pkg install -y python openssl curl coreutils >/dev/null
pkg install -y openssl-tool >/dev/null 2>&1 || true

command -v python >/dev/null || { echo "ERROR: python unavailable" >&2; exit 3; }
command -v curl >/dev/null || { echo "ERROR: curl unavailable" >&2; exit 3; }
command -v openssl >/dev/null || { echo "ERROR: openssl CLI unavailable" >&2; exit 3; }

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$STATE_DIR/kms"
chmod 700 "$STATE_DIR" "$STATE_DIR/kms"

tmp_host="$(mktemp)"
tmp_worker="$(mktemp)"
trap 'rm -f "$tmp_host" "$tmp_worker"' EXIT

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/direct-agent.py" -o "$tmp_host"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/sovereign-kms-worker.py" -o "$tmp_worker"

python -m py_compile "$tmp_host" "$tmp_worker"
install -m 0755 "$tmp_host" "$HOST_AGENT"
install -m 0755 "$tmp_worker" "$KMS_WORKER"

cat >"$BIN_DIR/daube-sovereign-kms-register" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
exec python "$KMS_WORKER" --register-only
EOF

cat >"$BIN_DIR/daube-sovereign-kms-once" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
exec python "$KMS_WORKER" --once
EOF

cat >"$BIN_DIR/daube-sovereign-kms-start" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
STATE_DIR="$STATE_DIR"
PID_FILE="$PID_FILE"
LOG_FILE="$LOG_FILE"
WORKER="$KMS_WORKER"
mkdir -p "\$STATE_DIR/kms"
chmod 700 "\$STATE_DIR/kms"
if [[ -f "\$PID_FILE" ]]; then
  old="\$(cat "\$PID_FILE" 2>/dev/null || true)"
  if [[ "\$old" =~ ^[0-9]+$ ]] && kill -0 "\$old" 2>/dev/null; then
    printf 'ALREADY_RUNNING pid=%s\n' "\$old"
    exit 0
  fi
  rm -f "\$PID_FILE"
fi
export DAUBE_SOVEREIGN_HOME="\$STATE_DIR"
nohup python "\$WORKER" --daemon >>"\$LOG_FILE" 2>&1 &
pid=\$!
printf '%s\n' "\$pid" >"\$PID_FILE"
chmod 600 "\$PID_FILE" "\$LOG_FILE" 2>/dev/null || true
sleep 1
if ! kill -0 "\$pid" 2>/dev/null; then
  rm -f "\$PID_FILE"
  echo 'ERROR: worker exited during startup' >&2
  tail -n 20 "\$LOG_FILE" >&2 || true
  exit 4
fi
printf 'STARTED pid=%s\n' "\$pid"
EOF

cat >"$BIN_DIR/daube-sovereign-kms-stop" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
PID_FILE="$PID_FILE"
[[ -f "\$PID_FILE" ]] || { echo 'NOT_RUNNING'; exit 0; }
pid="\$(cat "\$PID_FILE" 2>/dev/null || true)"
if [[ "\$pid" =~ ^[0-9]+$ ]] && kill -0 "\$pid" 2>/dev/null; then
  kill "\$pid"
  for _ in 1 2 3 4 5; do
    kill -0 "\$pid" 2>/dev/null || break
    sleep 1
  done
  kill -0 "\$pid" 2>/dev/null && kill -9 "\$pid" 2>/dev/null || true
fi
rm -f "\$PID_FILE"
echo 'STOPPED'
EOF

cat >"$BIN_DIR/daube-sovereign-kms-status" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
STATE_DIR="$STATE_DIR"
PID_FILE="$PID_FILE"
ROOT_PUBLIC="\$STATE_DIR/kms/root-rsa-3072.pub.pem"
printf 'D’AUBE Sovereign KMS status\n'
printf '%s\n' '---------------------------'
printf 'revision: %s\n' "$REVISION"
printf 'transport: outbound-https-only\n'
printf 'inboundPorts: none\n'
printf 'arbitraryShell: false\n'
printf 'paidSpendAuthorized: false\n'
if [[ -f "\$PID_FILE" ]]; then
  pid="\$(cat "\$PID_FILE" 2>/dev/null || true)"
  if [[ "\$pid" =~ ^[0-9]+$ ]] && kill -0 "\$pid" 2>/dev/null; then
    printf 'worker: RUNNING pid=%s\n' "\$pid"
  else
    printf 'worker: STALE_PID\n'
  fi
else
  printf 'worker: STOPPED\n'
fi
if [[ -f "\$ROOT_PUBLIC" ]]; then
  printf 'rootPublicSha256: %s\n' "\$(sha256sum "\$ROOT_PUBLIC" | awk '{print \$1}')"
  printf 'rootPrivateKeyExported: false\n'
else
  printf 'rootPublicSha256: NOT_CREATED_YET\n'
fi
printf 'hardwareAttestationVerified: false_until_independent_receipt\n'
EOF

chmod 0755 \
  "$BIN_DIR/daube-sovereign-kms-register" \
  "$BIN_DIR/daube-sovereign-kms-once" \
  "$BIN_DIR/daube-sovereign-kms-start" \
  "$BIN_DIR/daube-sovereign-kms-stop" \
  "$BIN_DIR/daube-sovereign-kms-status"

if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$HOME/.bashrc"
fi
export PATH="$BIN_DIR:$PATH"

printf '\nD’AUBE Sovereign KMS installed.\n'
printf 'Pinned revision: %s\n' "$REVISION"
printf 'Root private key: created only by register/start on this device; never downloaded.\n'
printf 'Hardware attestation: NOT claimed by this Termux profile.\n'
printf '\nCommands:\n'
printf '  daube-sovereign-kms-register\n'
printf '  daube-sovereign-kms-start\n'
printf '  daube-sovereign-kms-once\n'
printf '  daube-sovereign-kms-status\n'
printf '  daube-sovereign-kms-stop\n'
