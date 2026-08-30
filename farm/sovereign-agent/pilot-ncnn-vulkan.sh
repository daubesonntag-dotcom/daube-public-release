#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

NCNN_VERSION="20260526"
NCNN_ASSET="ncnn-${NCNN_VERSION}-android-vulkan-shared.zip"
NCNN_SHA256="eb205b332274974511890903828451ae7a4c19c309f21431536e0a8c9f3dd0c1"
NCNN_URL="https://github.com/Tencent/ncnn/releases/download/${NCNN_VERSION}/${NCNN_ASSET}"
CACHE_DIR="${DAUBE_NCNN_CACHE_DIR:-$HOME/.cache/daube-phone-edge/ncnn-${NCNN_VERSION}}"
INSTALL_DIR="${DAUBE_NCNN_PILOT_DIR:-$HOME/.local/lib/daube-phone-edge-ncnn}"
BIN_DIR="$HOME/.local/bin"
ARCHIVE="$CACHE_DIR/$NCNN_ASSET"

case "${PREFIX:-}" in
  *com.termux*) ;;
  *) echo "ERROR: ncnn Vulkan pilot must run in Android/Termux." >&2; exit 2 ;;
esac

mkdir -p "$CACHE_DIR" "$INSTALL_DIR" "$BIN_DIR"
pkg install -y clang curl coreutils unzip vulkan-headers vulkan-loader-android >/dev/null

if [[ ! -f "$ARCHIVE" ]]; then
  curl --fail --location --proto '=https' --tlsv1.2 "$NCNN_URL" -o "$ARCHIVE"
fi
actual_sha="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
if [[ "$actual_sha" != "$NCNN_SHA256" ]]; then
  echo "ERROR: ncnn asset SHA-256 mismatch" >&2
  rm -f "$ARCHIVE"
  exit 3
fi

rm -rf "$CACHE_DIR/extracted"
mkdir -p "$CACHE_DIR/extracted"
unzip -q "$ARCHIVE" -d "$CACHE_DIR/extracted"

include_dir="$(find "$CACHE_DIR/extracted" -type f -path '*/include/ncnn/gpu.h' -print -quit | sed 's#/ncnn/gpu.h$##')"
libncnn="$(find "$CACHE_DIR/extracted" -type f -path '*/arm64-v8a/lib/libncnn.so' -print -quit)"
if [[ -z "$libncnn" ]]; then
  libncnn="$(find "$CACHE_DIR/extracted" -type f -name 'libncnn.so' -path '*arm64*' -print -quit)"
fi
if [[ -z "$include_dir" || -z "$libncnn" ]]; then
  echo "ERROR: expected arm64 ncnn Vulkan shared layout not found" >&2
  exit 4
fi
lib_dir="$(dirname "$libncnn")"

cat >"$CACHE_DIR/ncnn-vulkan-probe.cpp" <<'CPP'
#include <ncnn/gpu.h>
#include <cstdio>
#include <cstring>

static void json_string(const char* s) {
    std::putchar('"');
    const unsigned char* p = (const unsigned char*)(s ? s : "");
    for (; *p; ++p) {
        if (*p == '"' || *p == '\\') { std::putchar('\\'); std::putchar(*p); }
        else if (*p >= 0x20 && *p < 0x7f) std::putchar(*p);
        else std::printf("\\u%04x", (unsigned)*p);
    }
    std::putchar('"');
}

int main() {
#if NCNN_VULKAN
    const int create_rc = ncnn::create_gpu_instance();
    if (create_rc != 0) {
        std::printf("{\"schema\":\"daube.ncnn-vulkan-probe.v1\",\"status\":\"CREATE_GPU_INSTANCE_FAILED\",\"createRc\":%d,\"paidSpendAuthorized\":false}\n", create_rc);
        return 10;
    }
    const int count = ncnn::get_gpu_count();
    std::printf("{\"schema\":\"daube.ncnn-vulkan-probe.v1\",\"status\":\"%s\",\"ncnnVulkanCompiled\":true,\"gpuCount\":%d,\"devices\":[", count > 0 ? "VULKAN_RUNTIME_PROBED" : "NO_GPU", count);
    for (int i = 0; i < count; ++i) {
        const ncnn::GpuInfo& info = ncnn::get_gpu_info(i);
        if (i) std::putchar(',');
        std::printf("{\"index\":%d,\"name\":", i);
        json_string(info.device_name());
        std::printf(",\"vendorId\":%u,\"deviceId\":%u,\"apiVersion\":%u,\"driverVersion\":%u,\"type\":%d,\"roughScore\":%u,\"computeQueues\":%u,\"fp16Storage\":%s,\"fp16Arithmetic\":%s,\"int8Storage\":%s,\"int8Arithmetic\":%s}",
            info.vendor_id(), info.device_id(), info.api_version(), info.driver_version(), info.type(), info.rough_score(),
            ncnn::get_gpu_device(i)->info.compute_queue_count(),
            info.support_fp16_storage() ? "true" : "false",
            info.support_fp16_arithmetic() ? "true" : "false",
            info.support_int8_storage() ? "true" : "false",
            info.support_int8_arithmetic() ? "true" : "false");
    }
    std::printf("],\"inferenceExecuted\":false,\"privateAssetsUsed\":false,\"paidSpendAuthorized\":false}\n");
    ncnn::destroy_gpu_instance();
    return count > 0 ? 0 : 11;
#else
    std::puts("{\"schema\":\"daube.ncnn-vulkan-probe.v1\",\"status\":\"NCNN_VULKAN_DISABLED\",\"ncnnVulkanCompiled\":false,\"inferenceExecuted\":false,\"paidSpendAuthorized\":false}");
    return 12;
#endif
}
CPP

clang++ -O2 -std=c++17 -Wall -Wextra -Werror \
  -I"$include_dir" -L"$lib_dir" \
  "$CACHE_DIR/ncnn-vulkan-probe.cpp" -o "$INSTALL_DIR/daube-ncnn-vulkan-probe" \
  -lncnn -lvulkan -ldl -lm
chmod 0755 "$INSTALL_DIR/daube-ncnn-vulkan-probe"

cat >"$BIN_DIR/daube-ncnn-vulkan-probe" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
export LD_LIBRARY_PATH="$lib_dir:\${LD_LIBRARY_PATH:-}"
exec "$INSTALL_DIR/daube-ncnn-vulkan-probe"
EOF
chmod 0755 "$BIN_DIR/daube-ncnn-vulkan-probe"

cat >"$INSTALL_DIR/provenance.json" <<EOF
{"schema":"daube.phone-edge-third-party-provenance.v1","upstream":"Tencent/ncnn","version":"$NCNN_VERSION","asset":"$NCNN_ASSET","sha256":"$NCNN_SHA256","source":"official-github-release","classification":"PILOT","inferenceExecuted":false,"paidSpendAuthorized":false}
EOF

export LD_LIBRARY_PATH="$lib_dir:${LD_LIBRARY_PATH:-}"
"$INSTALL_DIR/daube-ncnn-vulkan-probe"
