#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

NCNN_VERSION="20260526"
NCNN_ASSET="ncnn-${NCNN_VERSION}-android-vulkan-shared.zip"
NCNN_SHA256="eb205b332274974511890903828451ae7a4c19c309f21431536e0a8c9f3dd0c1"
NCNN_URL="https://github.com/Tencent/ncnn/releases/download/${NCNN_VERSION}/${NCNN_ASSET}"
CACHE_DIR="${DAUBE_NCNN_CACHE_DIR:-$HOME/.cache/daube-phone-edge/ncnn-${NCNN_VERSION}}"
INSTALL_DIR="${DAUBE_NCNN_PILOT_DIR:-$HOME/.local/lib/daube-phone-edge-ncnn}"
ARCHIVE="$CACHE_DIR/$NCNN_ASSET"

case "${PREFIX:-}" in *com.termux*) ;; *) echo "ERROR: Android/Termux required" >&2; exit 2;; esac
mkdir -p "$CACHE_DIR" "$INSTALL_DIR"
pkg install -y clang curl coreutils unzip vulkan-headers vulkan-loader-android >/dev/null

if [[ ! -f "$ARCHIVE" ]]; then
  curl --fail --location --proto '=https' --tlsv1.2 "$NCNN_URL" -o "$ARCHIVE"
fi
actual_sha="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
[[ "$actual_sha" == "$NCNN_SHA256" ]] || { echo "ERROR: ncnn asset SHA-256 mismatch" >&2; exit 3; }

if [[ ! -d "$CACHE_DIR/extracted" ]]; then
  mkdir -p "$CACHE_DIR/extracted"
  unzip -q "$ARCHIVE" -d "$CACHE_DIR/extracted"
fi
include_dir="$(find "$CACHE_DIR/extracted" -type f -path '*/include/ncnn/net.h' -print -quit | sed 's#/ncnn/net.h$##')"
libncnn="$(find "$CACHE_DIR/extracted" -type f -path '*/arm64-v8a/lib/libncnn.so' -print -quit)"
[[ -n "$include_dir" && -n "$libncnn" ]] || { echo "ERROR: arm64 ncnn shared layout missing" >&2; exit 4; }
lib_dir="$(dirname "$libncnn")"

cat > "$CACHE_DIR/ncnn-vulkan-synthetic.cpp" <<'CPP'
#include <ncnn/net.h>
#include <ncnn/gpu.h>
#include <cmath>
#include <cstdio>

static int run_canary() {
    ncnn::Net net;
    net.opt.use_vulkan_compute = true;
    net.opt.use_fp16_storage = false;
    net.opt.use_fp16_packed = false;
    net.opt.use_fp16_arithmetic = false;
    net.set_vulkan_device(0);
    static const char param[] =
        "7767517\n"
        "2 2\n"
        "Input input 0 1 data 0=8\n"
        "ReLU relu 1 1 data out 0=0\n";
    if (net.load_param_mem(param) != 0) return 11;

    ncnn::Mat input(8);
    const float values[8] = {-4.f,-1.f,0.f,1.f,2.f,3.f,-2.f,5.f};
    for (int i=0;i<8;i++) input[i]=values[i];
    const ncnn::VulkanDevice* vkdev = ncnn::get_gpu_device(0);
    if (!vkdev) return 12;
    ncnn::VkBlobAllocator blob(vkdev);
    ncnn::VkStagingAllocator staging(vkdev);
    ncnn::Option opt = net.opt;
    opt.blob_vkallocator = &blob;
    opt.workspace_vkallocator = &blob;
    opt.staging_vkallocator = &staging;

    ncnn::Extractor ex = net.create_extractor();
    ex.set_blob_vkallocator(&blob);
    ex.set_workspace_vkallocator(&blob);
    ex.set_staging_vkallocator(&staging);
    ncnn::VkCompute cmd(vkdev);
    ncnn::VkMat input_gpu;
    cmd.record_upload(input, input_gpu, opt);
    if (ex.input("data", input_gpu) != 0) return 13;
    ncnn::VkMat output_gpu;
    if (ex.extract("out", output_gpu, cmd) != 0) return 14;
    ncnn::Mat output;
    cmd.record_download(output_gpu, output, opt);
    if (cmd.submit_and_wait() != 0) return 15;
    if (output.total() != 8) return 16;
    const float expected[8] = {0.f,0.f,0.f,1.f,2.f,3.f,0.f,5.f};
    for (int i=0;i<8;i++) {
        if (std::fabs(((float*)output.data)[i]-expected[i]) > 1e-6f) return 17;
    }
    std::printf("{\"schema\":\"daube.ncnn-vulkan-synthetic-inference.v1\",\"status\":\"PASS\",\"gpu\":\"%s\",\"explicitVkMat\":true,\"explicitVkCompute\":true,\"graph\":\"Input-ReLU\",\"valuesVerified\":true,\"inferenceExecuted\":true,\"externalModelUsed\":false,\"privateAssetsUsed\":false,\"paidSpendAuthorized\":false}\n", ncnn::get_gpu_info(0).device_name());
    return 0;
}

int main() {
#if NCNN_VULKAN
    if (ncnn::create_gpu_instance() != 0 || ncnn::get_gpu_count() < 1) return 10;
    const int rc = run_canary();
    ncnn::destroy_gpu_instance();
    return rc;
#else
    return 20;
#endif
}
CPP

clang++ -O2 -std=c++17 -Wall -Wextra -Werror -Wformat=2 \
  -I"$include_dir" -L"$lib_dir" "$CACHE_DIR/ncnn-vulkan-synthetic.cpp" \
  -o "$INSTALL_DIR/daube-ncnn-vulkan-synthetic-inference" -lncnn -lvulkan -ldl -lm
export LD_LIBRARY_PATH="$lib_dir:${LD_LIBRARY_PATH:-}"
exec "$INSTALL_DIR/daube-ncnn-vulkan-synthetic-inference"
