#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REVISION="${DAUBE_PHONE_EDGE_V5_REVISION:-6cd76288def3b250dcef63ede3f531cb8a3af085}"
BASE="https://raw.githubusercontent.com/daubesonntag-dotcom/daube-public-release/${REVISION}/farm/sovereign-agent"
BIN_DIR="$HOME/.local/bin"
LIB_DIR="$HOME/.local/lib/daube-sovereign-agent-v5"
mkdir -p "$BIN_DIR" "$LIB_DIR"

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: run inside Termux on Android" >&2; exit 2 ;;
esac

pkg install -y python curl coreutils clang glslang vulkan-headers vulkan-loader-android >/dev/null
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/gpu-edge-kernels/rgba-premultiply.comp" -o "$work/rgba-premultiply.comp"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/gpu-edge-kernels/vk_rgba_premultiply_batch.c" -o "$work/vk_rgba_premultiply_batch.c"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$BASE/phone-edge-v5-preflight.py" -o "$work/phone-edge-v5-preflight.py"

glslangValidator -V -S comp "$work/rgba-premultiply.comp" -o "$work/rgba-premultiply.spv" >/dev/null
python - "$work/rgba-premultiply.spv" "$work/rgba_premultiply_spv.h" <<'PY'
from pathlib import Path
import struct,sys
raw=Path(sys.argv[1]).read_bytes()
if not raw or len(raw)%4:
    raise SystemExit('invalid_spirv_word_length')
words=struct.unpack('<%dI'%(len(raw)//4),raw)
Path(sys.argv[2]).write_text(
    '#include <stdint.h>\n'
    'static const uint32_t daube_rgba_premultiply_spv[] = {' + ','.join(f'0x{x:08x}u' for x in words) + '};\n'
    f'static const unsigned int daube_rgba_premultiply_spv_len = {len(raw)}u;\n',
    encoding='utf-8'
)
PY

python "$work/phone-edge-v5-preflight.py" "$work/vk_rgba_premultiply_batch.c" "$work/rgba_premultiply_spv.h"

clang -O2 -std=c11 -Wall -Wextra -Werror -Wformat=2 \
  -I"$PREFIX/include" -I"$work" -L"$PREFIX/lib" \
  "$work/vk_rgba_premultiply_batch.c" -o "$work/daube-vulkan-rgba-premultiply-batch" -lvulkan

install -m 0755 "$work/daube-vulkan-rgba-premultiply-batch" "$LIB_DIR/daube-vulkan-rgba-premultiply-batch"
cat > "$BIN_DIR/daube-phone-edge-v5-batch" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
exec "$LIB_DIR/daube-vulkan-rgba-premultiply-batch" "\$@"
EOF
chmod 0755 "$BIN_DIR/daube-phone-edge-v5-batch"

printf '%s\n' '{"schema":"daube.phone-edge-v5-fastpath-install.v1","status":"SOURCE_PREFLIGHT_AND_ANDROID_COMPILE_PASS","runtimeCanaryExecuted":false,"command":"daube-phone-edge-v5-batch INPUT_RGBA8_BIN OUTPUT_RGBA8_BIN","paidSpendAuthorized":false}'
