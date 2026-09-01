#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

# D'AUBE Sovereign KMS v3 resilient installer.
# Keeps the external-key worker outbound-only and fail-closed while improving
# Android survivability with wake-lock + persisted JobScheduler watchdog.
# No arbitrary shell, inbound listener, cloud bearer credential, or paid fallback.

WORKER_REVISION="${DAUBE_SOVEREIGN_KMS_WORKER_REVISION:-3739daf1f85a151c6db32660d209baafa2b379ea}"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${WORKER_REVISION}/farm/sovereign-agent"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
BIN_DIR="$HOME/.local/bin"
STATE_DIR="$HOME/.local/share/daube-sovereign-host"
PID_FILE="$STATE_DIR/kms/worker.pid"
LOG_FILE="$STATE_DIR/kms/worker.log"
WATCHDOG_LOG="$STATE_DIR/kms/watchdog.log"
JOB_ID=17062

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: run this inside Termux on Android" >&2; exit 2 ;;
esac

pkg install -y python openssl curl coreutils >/dev/null
pkg install -y openssl-tool >/dev/null 2>&1 || true
pkg install -y termux-api >/dev/null 2>&1 || true

command -v python >/dev/null || { echo "ERROR: python unavailable" >&2; exit 3; }
command -v openssl >/dev/null || { echo "ERROR: openssl unavailable" >&2; exit 3; }
command -v curl >/dev/null || { echo "ERROR: curl unavailable" >&2; exit 3; }

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$STATE_DIR/kms"
chmod 700 "$STATE_DIR" "$STATE_DIR/kms"

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

cat >"$BIN_DIR/daube-sovereign-kms-watchdog" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
STATE_DIR="$STATE_DIR"
PID_FILE="$PID_FILE"
LOG_FILE="$LOG_FILE"
WORKER="$BIN_DIR/daube-sovereign-kms-v2"
mkdir -p "\$STATE_DIR/kms"
chmod 700 "\$STATE_DIR" "\$STATE_DIR/kms"
if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock >/dev/null 2>&1 || true; fi
if [[ -f "\$PID_FILE" ]]; then
  old="\$(cat "\$PID_FILE" 2>/dev/null || true)"
  if [[ "\$old" =~ ^[0-9]+$ ]] && kill -0 "\$old" 2>/dev/null; then
    printf 'ALREADY_RUNNING pid=%s\n' "\$old"
    exit 0
  fi
  rm -f "\$PID_FILE"
fi
if command -v setsid >/dev/null 2>&1; then
  setsid nohup "\$WORKER" --daemon >>"\$LOG_FILE" 2>&1 < /dev/null &
else
  nohup "\$WORKER" --daemon >>"\$LOG_FILE" 2>&1 < /dev/null &
fi
pid=\$!
printf '%s\n' "\$pid" >"\$PID_FILE"
chmod 600 "\$PID_FILE" "\$LOG_FILE" 2>/dev/null || true
sleep 2
if ! kill -0 "\$pid" 2>/dev/null; then
  rm -f "\$PID_FILE"
  echo 'ERROR: worker exited during watchdog start' >&2
  tail -n 40 "\$LOG_FILE" >&2 || true
  exit 4
fi
printf 'STARTED pid=%s\n' "\$pid"
EOF
chmod 0755 "$BIN_DIR/daube-sovereign-kms-watchdog"

cat >"$BIN_DIR/daube-sovereign-kms-once" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
exec "$BIN_DIR/daube-sovereign-kms-v2" --once
EOF
chmod 0755 "$BIN_DIR/daube-sovereign-kms-once"

cat >"$BIN_DIR/daube-sovereign-kms-status" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
STATE_DIR="$STATE_DIR"
PID_FILE="$PID_FILE"
ROOT_PRIVATE="\$STATE_DIR/kms/root-rsa-3072.pem"
ROOT_PUBLIC="\$STATE_DIR/kms/root-rsa-3072.pub.pem"
printf 'D’AUBE Sovereign KMS v3 status\n'
printf '%s\n' '------------------------------'
printf 'workerRevision: %s\n' "$WORKER_REVISION"
printf 'activation: private-key-possession-canary-required\n'
printf 'transport: outbound-https-only\n'
printf 'inboundPorts: none\n'
printf 'arbitraryShell: false\n'
printf 'paidSpendAuthorized: false\n'
if [[ -f "\$PID_FILE" ]]; then
  pid="\$(cat "\$PID_FILE" 2>/dev/null || true)"
  if [[ "\$pid" =~ ^[0-9]+$ ]] && kill -0 "\$pid" 2>/dev/null; then printf 'worker: RUNNING pid=%s\n' "\$pid"; else printf 'worker: STALE_PID\n'; fi
else
  printf 'worker: STOPPED\n'
fi
if [[ -f "\$ROOT_PRIVATE" ]]; then
  printf 'rootPrivateKeyPresent: true\n'
  printf 'rootPrivateKeyMode: %s\n' "\$(stat -c '%a' "\$ROOT_PRIVATE" 2>/dev/null || true)"
  printf 'rootPrivateKeyExported: false\n'
else
  printf 'rootPrivateKeyPresent: false\n'
fi
if [[ -f "\$ROOT_PUBLIC" ]]; then printf 'rootPublicSha256: %s\n' "\$(sha256sum "\$ROOT_PUBLIC" | awk '{print \$1}')"; fi
if command -v termux-job-scheduler >/dev/null 2>&1; then printf 'watchdogScheduler: AVAILABLE\n'; else printf 'watchdogScheduler: UNAVAILABLE\n'; fi
printf 'hardwareAttestationVerified: false\n'
EOF
chmod 0755 "$BIN_DIR/daube-sovereign-kms-status"

if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc" 2>/dev/null; then
  printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$HOME/.bashrc"
fi
export PATH="$BIN_DIR:$PATH"

# Hard admission gate. This is idempotent after KEY_ACTIVATED.
"$BIN_DIR/daube-sovereign-kms-v2" --register-only

# Start now.
"$BIN_DIR/daube-sovereign-kms-watchdog"

# Persisted watchdog. Android JobScheduler may coalesce exact timing; the daemon
# remains the low-latency path and this job is recovery-only.
scheduler="UNAVAILABLE"
if command -v termux-job-scheduler >/dev/null 2>&1; then
  set +e
  termux-job-scheduler \
    --script "$BIN_DIR/daube-sovereign-kms-watchdog" \
    --job-id "$JOB_ID" \
    --period-ms 900000 \
    --network any \
    --battery-not-low false \
    --storage-not-low false \
    --charging false \
    --persisted true >>"$WATCHDOG_LOG" 2>&1
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then scheduler="TERMUX_JOB_SCHEDULER_15M_PERSISTED"; else scheduler="AVAILABLE_BUT_SCHEDULE_FAILED"; fi
fi

printf '\nD’AUBE Sovereign KMS v3 resilience installed.\n'
printf 'Worker revision: %s\n' "$WORKER_REVISION"
printf 'Scheduler: %s\n' "$scheduler"
"$BIN_DIR/daube-sovereign-kms-status"
printf '\nNo inbound port, no cloud/GitHub bearer credential, no paid fallback.\n'
