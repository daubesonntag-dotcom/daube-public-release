#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/main/farm/sovereign-agent"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
BIN_DIR="$HOME/.local/bin"
STATE_DIR="$HOME/.local/share/daube-sovereign-host"
HOST_AGENT="$INSTALL_DIR/direct-agent.py"
GPU_AGENT="$INSTALL_DIR/gpu-agent.py"
GPU_CANARY="$INSTALL_DIR/daube-vulkan-compute-canary"
GPU_PROOF_BIN="$BIN_DIR/daube-sovereign-gpu-proof"
JOB_ID=17062

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: D'AUBE sovereign GPU upgrade must run inside Termux on Android." >&2; exit 2 ;;
esac

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$STATE_DIR"
chmod 700 "$STATE_DIR"

if [[ ! -f "$HOST_AGENT" ]]; then
  echo "Existing sovereign host agent not found; installing the host lane first."
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$BASE/install-termux.sh" | bash
fi

# The D'AUBE canary links against Android's Vulkan loader. Install the official
# Termux Android-loader shim only when libvulkan is not already available.
if [[ ! -e "$PREFIX/lib/libvulkan.so" ]]; then
  pkg install -y vulkan-loader-android >/dev/null
fi

agent_tmp="$(mktemp)"
bin_tmp="$(mktemp)"
sha_tmp="$(mktemp)"
trap 'rm -f "$agent_tmp" "$bin_tmp" "$sha_tmp"' EXIT

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/gpu-agent.py" -o "$agent_tmp"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/bin/android-arm64/daube-vulkan-compute-canary" -o "$bin_tmp"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/bin/android-arm64/daube-vulkan-compute-canary.sha256" -o "$sha_tmp"

python -m py_compile "$agent_tmp"
expected="$(awk 'NR==1 {print $1}' "$sha_tmp")"
observed="$(sha256sum "$bin_tmp" | awk '{print $1}')"
if [[ ! "$expected" =~ ^[0-9a-f]{64}$ ]] || [[ "$observed" != "$expected" ]]; then
  echo "ERROR: Vulkan compute canary checksum mismatch; refusing installation." >&2
  exit 5
fi

install -m 0755 "$agent_tmp" "$GPU_AGENT"
install -m 0755 "$bin_tmp" "$GPU_CANARY"

cat >"$GPU_PROOF_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
export DAUBE_VULKAN_CANARY="$GPU_CANARY"
exec python "$GPU_AGENT"
EOF
chmod 0755 "$GPU_PROOF_BIN"

set +e
"$GPU_PROOF_BIN"
proof_rc=$?
set -e

scheduler="NOT_SCHEDULED"
if [[ "$proof_rc" -eq 0 ]]; then
  if ! command -v termux-job-scheduler >/dev/null 2>&1; then
    pkg install -y termux-api >/dev/null 2>&1 || true
  fi
  if command -v termux-job-scheduler >/dev/null 2>&1; then
    set +e
    termux-job-scheduler \
      --script "$GPU_PROOF_BIN" \
      --job-id "$JOB_ID" \
      --period-ms 1800000 \
      --network any \
      --battery-not-low true \
      --storage-not-low false \
      --charging false \
      --persisted true >/dev/null
    schedule_rc=$?
    set -e
    [[ "$schedule_rc" -eq 0 ]] && scheduler="TERMUX_GPU_PROOF_30M_PERSISTED" || scheduler="SCHEDULE_FAILED"
  else
    scheduler="TERMUX_JOB_SCHEDULER_UNAVAILABLE"
  fi
fi

printf '\nD’AUBE Sovereign GPU upgrade\n'
printf '%s\n' '----------------------------'
printf 'binarySha256: %s\n' "$observed"
printf 'proofExitCode: %s\n' "$proof_rc"
printf 'scheduler: %s\n' "$scheduler"
printf 'OAuth: none\n'
printf 'Paid GPU: none\n'
printf 'Inbound ports: none\n'
printf 'Manual proof command: daube-sovereign-gpu-proof\n'

if [[ "$proof_rc" -ne 0 ]]; then
  printf '\nGPU was NOT promoted. The host lane remains intact and no software renderer is accepted.\n'
  printf 'Run daube-sovereign-gpu-proof to see the exact hardware/driver failure after any Vulkan-loader change.\n'
fi

exit "$proof_rc"
