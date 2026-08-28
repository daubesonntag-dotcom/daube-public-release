#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SOURCE_URL="${DAUBE_SOVEREIGN_AGENT_URL:-https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/main/farm/sovereign-agent/direct-agent.py}"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
BIN_DIR="$HOME/.local/bin"
STATE_DIR="$HOME/.local/share/daube-sovereign-host"
AGENT="$INSTALL_DIR/direct-agent.py"
WRAPPER="$BIN_DIR/daube-sovereign-proof"
JOB_ID=17061

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "This installer is for Termux on Android." >&2; exit 2 ;;
esac

pkg install -y python openssl curl >/dev/null
mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$STATE_DIR"
chmod 700 "$STATE_DIR"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$SOURCE_URL" -o "$tmp"
python -m py_compile "$tmp"
install -m 0755 "$tmp" "$AGENT"

cat >"$WRAPPER" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
exec python "$AGENT"
EOF
chmod 0755 "$WRAPPER"

set +e
"$WRAPPER"
rc=$?
set -e
if [[ "$rc" -ne 0 && "$rc" -ne 3 ]]; then
  echo "Initial sovereign proof failed with exit code $rc." >&2
  exit "$rc"
fi

scheduler="UNAVAILABLE"
if command -v termux-job-scheduler >/dev/null 2>&1; then
  # Android N+ enforces a 15-minute minimum. Thirty minutes stays comfortably
  # inside the Resource Farm six-hour freshness window while limiting battery use.
  termux-job-scheduler \
    --script "$WRAPPER" \
    --job-id "$JOB_ID" \
    --period-ms 1800000 \
    --network any \
    --battery-not-low true \
    --storage-not-low false \
    --charging false \
    --persisted true
  scheduler="TERMUX_JOB_SCHEDULER_30M_PERSISTED"
fi

echo
echo "D'AUBE founder-controlled edge installed."
echo "Runtime: android-termux"
echo "Transport: outbound HTTPS only"
echo "Inbound ports: none"
echo "Cloud credentials: none"
echo "GitHub runner/PAT: none"
echo "Scheduler: $scheduler"
if [[ "$rc" -eq 3 ]]; then
  echo "PAIRING_REQUIRED: copy the printed publicKeySha256 to the D'AUBE control plane for founder approval of this exact physical device."
else
  echo "Initial proof is verified; Resource Farm can admit sovereign-local while evidence remains fresh."
fi
if [[ "$scheduler" == "UNAVAILABLE" ]]; then
  echo "Periodic proof was not scheduled because termux-job-scheduler is unavailable. The one-time pairing proof still works; install/enable Termux JobScheduler support for unattended refresh."
fi
