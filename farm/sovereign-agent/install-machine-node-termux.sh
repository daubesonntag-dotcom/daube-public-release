#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
umask 077

# D'AUBE Machine Node capability installer for the already-paired sovereign
# Android/Termux host. Source is pinned immutably; no GitHub runner/token,
# remote shell, paid provider, secret-bearing job, or production mutation is used.
SOURCE_REVISION="${DAUBE_MACHINE_NODE_SOURCE_REVISION:-a2bae112fa2cc4b8a63c4a03e14b522c195db2ad}"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${SOURCE_REVISION}/farm/sovereign-agent"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
BIN_DIR="$HOME/.local/bin"
STATE_DIR="$HOME/.local/share/daube-sovereign-host"
WORKER="$INSTALL_DIR/machine-node-worker.py"
WORKER_BIN="$BIN_DIR/daube-machine-node-smoke"
JOB_ID=17065

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: D'AUBE Machine Node capability requires Termux on Android." >&2; exit 2 ;;
esac

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$STATE_DIR"
chmod 700 "$STATE_DIR"

# Preserve the existing Ed25519 sovereign identity. Never reinstall/rotate it
# merely to add this capability.
if [[ ! -r "$INSTALL_DIR/direct-agent.py" ]]; then
  echo "ERROR: Existing D'AUBE sovereign agent is required before Node capability rollout." >&2
  echo "Install/pair the sovereign edge first; this installer will not rotate identity." >&2
  exit 66
fi

pkg install -y python nodejs-lts npm git curl coreutils >/dev/null

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$node_major" =~ ^[0-9]+$ ]] || { echo "ERROR: Node version unreadable." >&2; exit 69; }
(( node_major >= 22 )) || { echo "ERROR: Node >=22 required." >&2; exit 69; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm missing." >&2; exit 69; }
command -v git >/dev/null 2>&1 || { echo "ERROR: git missing." >&2; exit 69; }

worker_tmp="$(mktemp)"
trap 'rm -f "$worker_tmp"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/machine-node-worker.py" -o "$worker_tmp"
python -m py_compile "$worker_tmp"
install -m 0755 "$worker_tmp" "$WORKER"

cat >"$WORKER_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
exec python "$WORKER"
EOF
chmod 0755 "$WORKER_BIN"

set +e
"$WORKER_BIN"
first_rc=$?
set -e
if [[ "$first_rc" -ne 0 ]]; then
  echo "ERROR: Initial D'AUBE Machine Node smoke failed with code $first_rc." >&2
  exit "$first_rc"
fi

scheduler="NOT_SCHEDULED"
if command -v termux-job-scheduler >/dev/null 2>&1; then
  set +e
  termux-job-scheduler \
    --script "$WORKER_BIN" \
    --job-id "$JOB_ID" \
    --period-ms 1800000 \
    --network any \
    --battery-not-low true \
    --storage-not-low false \
    --charging false \
    --persisted true >/dev/null
  schedule_rc=$?
  set -e
  [[ "$schedule_rc" -eq 0 ]] && scheduler="TERMUX_MACHINE_NODE_30M_PERSISTED" || scheduler="SCHEDULE_FAILED"
fi

printf '\nD’AUBE Machine Node capability installed\n'
printf '%s\n' '---------------------------------------'
printf 'sourceRevision: %s\n' "$SOURCE_REVISION"
printf 'node: %s\n' "$(node --version)"
printf 'npm: %s\n' "$(npm --version)"
printf 'git: %s\n' "$(git --version)"
printf 'scheduler: %s\n' "$scheduler"
printf 'transport: outbound HTTPS only\n'
printf 'remoteShell: forbidden\n'
printf 'remoteSourceExecution: forbidden\n'
printf 'secrets: forbidden\n'
printf 'productionMutation: forbidden\n'
printf 'paidSpendAuthorized: false\n'
printf 'manualSmoke: daube-machine-node-smoke\n'
