#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SOURCE_REVISION="${DAUBE_PHONE_EDGE_SOURCE_REVISION:-793bc4e4fa72808bff8778fdf2909958bca03aca}"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${SOURCE_REVISION}/farm/sovereign-agent"
INSTALL_DIR="$HOME/.local/lib/daube-sovereign-agent"
BIN_DIR="$HOME/.local/bin"
STATE_DIR="$HOME/.local/share/daube-sovereign-host"
WORKER="$INSTALL_DIR/phone-edge-worker.py"
KERNEL="$INSTALL_DIR/daube-vulkan-rgba-premultiply"
THERMAL_PROBE="$INSTALL_DIR/daube-thermal-headroom-probe"
BENCHMARK="$INSTALL_DIR/benchmark-phone-edge-gpu.py"
NCNN_PILOT="$INSTALL_DIR/pilot-ncnn-vulkan.sh"
FUSED_SPV="$INSTALL_DIR/rgba-premultiply-luma.spv"
FUSED_CONTRACT="$INSTALL_DIR/rgba-premultiply-luma.contract.v1.json"
GPU_PROOF="$BIN_DIR/daube-sovereign-gpu-proof"
WORKER_BIN="$BIN_DIR/daube-phone-edge-worker"
BENCHMARK_BIN="$BIN_DIR/daube-phone-edge-benchmark"
NCNN_PILOT_BIN="$BIN_DIR/daube-ncnn-vulkan-pilot"
JOB_ID=17063

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: D'AUBE Phone Edge GPU installer must run inside Termux on Android." >&2; exit 2 ;;
esac

printf '\nD’AUBE Phone Edge GPU — local build/install v4\n'
printf '%s\n' '---------------------------------------------'
printf 'Pinned source revision: %s\n' "$SOURCE_REVISION"
printf 'Execution: outbound pull only; no remote shell\n\n'

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$STATE_DIR"
chmod 700 "$STATE_DIR"

if [[ ! -f "$INSTALL_DIR/direct-agent.py" ]]; then
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/main/farm/sovereign-agent/install-termux.sh" | bash
fi
if [[ ! -x "$GPU_PROOF" ]]; then
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/main/farm/sovereign-agent/upgrade-gpu-termux.sh" | bash
fi

pkg install -y python curl coreutils clang glslang vulkan-headers vulkan-loader-android >/dev/null
pkg install -y termux-api >/dev/null 2>&1 || true

build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/gpu-edge-kernels/rgba-premultiply.comp" -o "$build_dir/rgba-premultiply.comp"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/gpu-edge-kernels/rgba-premultiply-luma.comp" -o "$build_dir/rgba-premultiply-luma.comp"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/gpu-edge-kernels/rgba-premultiply-luma.contract.v1.json" -o "$build_dir/rgba-premultiply-luma.contract.v1.json"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/gpu-edge-kernels/vk_rgba_premultiply.c" -o "$build_dir/vk_rgba_premultiply.c"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/thermal-headroom-probe.c" -o "$build_dir/thermal-headroom-probe.c"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/phone-edge-worker.py" -o "$build_dir/phone-edge-worker.py"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/benchmark-phone-edge-gpu.py" -o "$build_dir/benchmark-phone-edge-gpu.py"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/pilot-ncnn-vulkan.sh" -o "$build_dir/pilot-ncnn-vulkan.sh"

python -m py_compile "$build_dir/phone-edge-worker.py" "$build_dir/benchmark-phone-edge-gpu.py"
bash -n "$build_dir/pilot-ncnn-vulkan.sh"
python - "$build_dir/rgba-premultiply-luma.contract.v1.json" <<'PY'
import json,sys
row=json.load(open(sys.argv[1],encoding='utf-8'))
assert row['kernelId']=='rgba-premultiply-luma-u8-v1'
assert row['status']=='SOURCE_READY_NOT_RUNTIME_PROVEN'
assert row['paidSpendAuthorized'] is False
PY

glslangValidator -V -S comp "$build_dir/rgba-premultiply.comp" -o "$build_dir/rgba-premultiply.spv" >/dev/null
glslangValidator -V -S comp "$build_dir/rgba-premultiply-luma.comp" -o "$build_dir/rgba-premultiply-luma.spv" >/dev/null
python - "$build_dir/rgba-premultiply.spv" "$build_dir/rgba_premultiply_spv.h" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_bytes()
out=Path(sys.argv[2])
items=','.join(f'0x{b:02x}' for b in src)
out.write_text(
    'static const unsigned char daube_rgba_premultiply_spv[] = {' + items + '};\n'
    f'static const unsigned int daube_rgba_premultiply_spv_len = {len(src)}u;\n',
    encoding='utf-8'
)
PY

clang -O2 -std=c11 -Wall -Wextra -Werror \
  -I"$PREFIX/include" -L"$PREFIX/lib" \
  "$build_dir/vk_rgba_premultiply.c" -o "$build_dir/daube-vulkan-rgba-premultiply" -lvulkan
clang -O2 -std=c11 -Wall -Wextra -Werror \
  "$build_dir/thermal-headroom-probe.c" -o "$build_dir/daube-thermal-headroom-probe" -ldl -lm
chmod 0755 "$build_dir/daube-vulkan-rgba-premultiply" "$build_dir/daube-thermal-headroom-probe" "$build_dir/benchmark-phone-edge-gpu.py" "$build_dir/pilot-ncnn-vulkan.sh"

kernel_sha="$(sha256sum "$build_dir/daube-vulkan-rgba-premultiply" | awk '{print $1}')"
thermal_probe_sha="$(sha256sum "$build_dir/daube-thermal-headroom-probe" | awk '{print $1}')"
worker_sha="$(sha256sum "$build_dir/phone-edge-worker.py" | awk '{print $1}')"
benchmark_sha="$(sha256sum "$build_dir/benchmark-phone-edge-gpu.py" | awk '{print $1}')"
fused_spv_sha="$(sha256sum "$build_dir/rgba-premultiply-luma.spv" | awk '{print $1}')"
ncnn_pilot_sha="$(sha256sum "$build_dir/pilot-ncnn-vulkan.sh" | awk '{print $1}')"

install -m 0755 "$build_dir/daube-vulkan-rgba-premultiply" "$KERNEL"
install -m 0755 "$build_dir/daube-thermal-headroom-probe" "$THERMAL_PROBE"
install -m 0755 "$build_dir/phone-edge-worker.py" "$WORKER"
install -m 0755 "$build_dir/benchmark-phone-edge-gpu.py" "$BENCHMARK"
install -m 0755 "$build_dir/pilot-ncnn-vulkan.sh" "$NCNN_PILOT"
install -m 0644 "$build_dir/rgba-premultiply-luma.spv" "$FUSED_SPV"
install -m 0644 "$build_dir/rgba-premultiply-luma.contract.v1.json" "$FUSED_CONTRACT"

cat >"$WORKER_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_SOVEREIGN_HOME="$STATE_DIR"
export DAUBE_PHONE_GPU_KERNEL="$KERNEL"
export DAUBE_PHONE_THERMAL_PROBE="$THERMAL_PROBE"
exec python "$WORKER"
EOF
chmod 0755 "$WORKER_BIN"

cat >"$BENCHMARK_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_PHONE_GPU_KERNEL="$KERNEL"
export DAUBE_PHONE_THERMAL_PROBE="$THERMAL_PROBE"
exec python "$BENCHMARK" "\$@"
EOF
chmod 0755 "$BENCHMARK_BIN"

cat >"$NCNN_PILOT_BIN" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
exec bash "$NCNN_PILOT" "\$@"
EOF
chmod 0755 "$NCNN_PILOT_BIN"

"$GPU_PROOF"

set +e
"$WORKER_BIN"
first_worker_rc=$?
set -e
if [[ "$first_worker_rc" -ne 0 && "$first_worker_rc" -ne 3 ]]; then
  echo "ERROR: Initial phone GPU worker execution failed with code $first_worker_rc." >&2
  exit "$first_worker_rc"
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
  [[ "$schedule_rc" -eq 0 ]] && scheduler="TERMUX_PHONE_GPU_30M_PERSISTED" || scheduler="SCHEDULE_FAILED"
fi

printf '\nD’AUBE Phone Edge GPU v4 installed\n'
printf '%s\n' '-----------------------------------'
printf 'kernelSha256: %s\n' "$kernel_sha"
printf 'thermalProbeSha256: %s\n' "$thermal_probe_sha"
printf 'workerSha256: %s\n' "$worker_sha"
printf 'benchmarkSha256: %s\n' "$benchmark_sha"
printf 'fusedShaderSpvSha256: %s\n' "$fused_spv_sha"
printf 'ncnnPilotSha256: %s\n' "$ncnn_pilot_sha"
printf 'scheduler: %s\n' "$scheduler"
printf 'signedTelemetry: Ed25519 claim-bound v1 + Android thermal headroom\n'
printf 'benchmark: daube-phone-edge-benchmark\n'
printf 'ncnnPilot: daube-ncnn-vulkan-pilot (manual; ~24 MB upstream asset)\n'
printf 'fusedKernel: SOURCE_READY_NOT_RUNTIME_PROVEN\n'
printf 'maxJobBytes: 16384\n'
printf 'minBatteryPercent: 35\n'
printf 'maxBatteryTempC: 42\n'
printf 'maxThermalHeadroomForecast10s: 0.95\n'
printf 'maxThermalStatusCode: 2 (MODERATE); SEVERE+ is held\n'
printf 'remoteShell: forbidden\n'
printf 'paidSpendAuthorized: false\n'
printf 'manual worker: daube-phone-edge-worker\n'
printf 'manual GPU proof: daube-sovereign-gpu-proof\n'
