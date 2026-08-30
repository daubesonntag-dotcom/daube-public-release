#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REVISION="${DAUBE_PHONE_EDGE_V6_REVISION:-374e846a00850389f00e6a55cfb87cb93f00334c}"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${REVISION}/farm/sovereign-agent"
BIN_DIR="$HOME/.local/bin"
LIB_DIR="$HOME/.local/lib/daube-sovereign-agent-v6"
CACHE_DIR="$HOME/.cache/daube-phone-edge/vulkan-v6"
mkdir -p "$BIN_DIR" "$LIB_DIR" "$CACHE_DIR"

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: run inside Termux on Android" >&2; exit 2 ;;
esac

pkg install -y python curl coreutils clang glslang vulkan-headers vulkan-loader-android >/dev/null
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() {
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$1" -o "$2"
}

fetch "$BASE/gpu-edge-kernels/rgba-premultiply.comp" "$work/rgba-premultiply.comp"
fetch "$BASE/gpu-edge-kernels/rgba-premultiply-luma.comp" "$work/rgba-premultiply-luma.comp"
fetch "$BASE/gpu-edge-kernels/vk_rgba_maxperf.c" "$work/vk_rgba_maxperf.c"
fetch "$BASE/phone-edge-v6-preflight.py" "$work/phone-edge-v6-preflight.py"
fetch "$BASE/run-phone-edge-v6-maxperf-canary.py" "$work/run-phone-edge-v6-maxperf-canary.py"

python -m py_compile "$work/phone-edge-v6-preflight.py" "$work/run-phone-edge-v6-maxperf-canary.py"
python "$work/phone-edge-v6-preflight.py" "$work/vk_rgba_maxperf.c"

build_kernel() {
  shader="$1"
  output="$2"
  glslangValidator -V -S comp "$shader" -o "$work/kernel.spv" >/dev/null
  python - "$work/kernel.spv" "$work/daube_shader_spv.h" <<'PY'
from pathlib import Path
import struct,sys
raw=Path(sys.argv[1]).read_bytes()
if not raw or len(raw)%4:
    raise SystemExit('invalid_spirv_word_length')
words=struct.unpack('<%dI'%(len(raw)//4), raw)
Path(sys.argv[2]).write_text(
    '#include <stdint.h>\n'
    'static const uint32_t daube_shader_spv[] = {' + ','.join(f'0x{x:08x}u' for x in words) + '};\n'
    f'static const size_t daube_shader_spv_len = {len(raw)}u;\n',
    encoding='utf-8'
)
PY
  clang -O3 -DNDEBUG -std=c11 -Wall -Wextra -Werror -Wformat=2 \
    -I"$PREFIX/include" -I"$work" -L"$PREFIX/lib" \
    "$work/vk_rgba_maxperf.c" -o "$output" -lvulkan
}

build_kernel "$work/rgba-premultiply.comp" "$work/daube-vulkan-rgba-premultiply-maxperf"
build_kernel "$work/rgba-premultiply-luma.comp" "$work/daube-vulkan-rgba-premultiply-luma-maxperf"

install -m 0755 "$work/daube-vulkan-rgba-premultiply-maxperf" "$LIB_DIR/daube-vulkan-rgba-premultiply-maxperf"
install -m 0755 "$work/daube-vulkan-rgba-premultiply-luma-maxperf" "$LIB_DIR/daube-vulkan-rgba-premultiply-luma-maxperf"
install -m 0755 "$work/run-phone-edge-v6-maxperf-canary.py" "$LIB_DIR/run-phone-edge-v6-maxperf-canary.py"

cat > "$BIN_DIR/daube-phone-edge-v6-premultiply" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_VK_PIPELINE_CACHE_PATH="$CACHE_DIR/premultiply.cache"
exec "$LIB_DIR/daube-vulkan-rgba-premultiply-maxperf" "\$@"
EOF

cat > "$BIN_DIR/daube-phone-edge-v6-premultiply-luma" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export DAUBE_VK_PIPELINE_CACHE_PATH="$CACHE_DIR/premultiply-luma.cache"
exec "$LIB_DIR/daube-vulkan-rgba-premultiply-luma-maxperf" "\$@"
EOF

cat > "$BIN_DIR/daube-phone-edge-v6-maxperf-canary" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
exec python "$LIB_DIR/run-phone-edge-v6-maxperf-canary.py"
EOF

chmod 0755 "$BIN_DIR/daube-phone-edge-v6-premultiply" \
  "$BIN_DIR/daube-phone-edge-v6-premultiply-luma" \
  "$BIN_DIR/daube-phone-edge-v6-maxperf-canary"

printf '%s\n' "{\"schema\":\"daube.phone-edge-v6-maxperf-install.v1\",\"status\":\"SOURCE_PREFLIGHT_AND_ANDROID_COMPILE_PASS\",\"revision\":\"$REVISION\",\"wholeImageDispatch\":true,\"pipelineCacheEnabled\":true,\"queueWaitIdleRemoved\":true,\"fusedKernelCompiled\":true,\"runtimeCanaryExecuted\":false,\"command\":\"daube-phone-edge-v6-maxperf-canary\",\"paidSpendAuthorized\":false}"
