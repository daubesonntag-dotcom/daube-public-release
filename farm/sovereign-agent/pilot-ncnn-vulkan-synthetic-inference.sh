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
#include <ncnn/datareader.h>
#include <cmath>
#include <cstdio>
#include <cstring>

#if NCNN_VULKAN
class DataReaderFromEmpty final : public ncnn::DataReader
{
public:
    int scan(const char*, void*) const override { return 0; }
    size_t read(void* buf, size_t size) const override
    {
        if (buf && size) std::memset(buf, 0, size);
        return size;
    }
};

static int fail_stage(const char* stage, int code)
{
    std::printf("{\"schema\":\"daube.ncnn-vulkan-synthetic-inference.v2\",\"status\":\"FAIL\",\"stage\":\"%s\",\"code\":%d,\"inferenceExecuted\":false,\"externalModelUsed\":false,\"privateAssetsUsed\":false,\"paidSpendAuthorized\":false}\n", stage, code);
    return code;
}

static int run_canary()
{
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

    const int param_rc = net.load_param_mem(param);
    if (param_rc != 0) return fail_stage("load_param_mem", 11);

    DataReaderFromEmpty dr;
    const int model_rc = net.load_model(dr);
    if (model_rc != 0) return fail_stage("load_model_empty", 12);

    ncnn::Mat input(8);
    const float values[8] = {-4.f, -1.f, 0.f, 1.f, 2.f, 3.f, -2.f, 5.f};
    for (int i = 0; i < 8; ++i) input[i] = values[i];

    ncnn::Extractor ex = net.create_extractor();
    const int input_rc = ex.input("data", input);
    if (input_rc != 0) return fail_stage("extractor_input", 13);

    ncnn::Mat output;
    const int extract_rc = ex.extract("out", output);
    if (extract_rc != 0) return fail_stage("extractor_extract", 14);
    if (output.total() != 8) return fail_stage("output_shape", 15);

    const float expected[8] = {0.f, 0.f, 0.f, 1.f, 2.f, 3.f, 0.f, 5.f};
    for (int i = 0; i < 8; ++i)
    {
        const float got = ((float*)output.data)[i];
        if (std::fabs(got - expected[i]) > 1e-6f) return fail_stage("cpu_reference_mismatch", 16);
    }

    const ncnn::GpuInfo& info = ncnn::get_gpu_info(0);
    std::printf(
        "{\"schema\":\"daube.ncnn-vulkan-synthetic-inference.v2\",\"status\":\"PASS\",\"gpu\":\"%s\",\"gpuCount\":%d,\"useVulkanCompute\":true,\"executionPath\":\"ncnn-official-high-level-vulkan\",\"graph\":\"Input-ReLU\",\"valuesVerified\":true,\"inferenceExecuted\":true,\"externalModelUsed\":false,\"privateAssetsUsed\":false,\"paidSpendAuthorized\":false}\n",
        info.device_name(), ncnn::get_gpu_count());
    return 0;
}
#endif

int main()
{
#if NCNN_VULKAN
    const int create_rc = ncnn::create_gpu_instance();
    if (create_rc != 0)
    {
        std::printf("{\"schema\":\"daube.ncnn-vulkan-synthetic-inference.v2\",\"status\":\"FAIL\",\"stage\":\"create_gpu_instance\",\"code\":10,\"createRc\":%d,\"inferenceExecuted\":false,\"paidSpendAuthorized\":false}\n", create_rc);
        return 10;
    }
    if (ncnn::get_gpu_count() < 1)
    {
        std::puts("{\"schema\":\"daube.ncnn-vulkan-synthetic-inference.v2\",\"status\":\"FAIL\",\"stage\":\"gpu_count\",\"code\":10,\"inferenceExecuted\":false,\"paidSpendAuthorized\":false}");
        ncnn::destroy_gpu_instance();
        return 10;
    }
    const int rc = run_canary();
    ncnn::destroy_gpu_instance();
    return rc;
#else
    std::puts("{\"schema\":\"daube.ncnn-vulkan-synthetic-inference.v2\",\"status\":\"FAIL\",\"stage\":\"ncnn_vulkan_disabled\",\"code\":20,\"inferenceExecuted\":false,\"paidSpendAuthorized\":false}");
    return 20;
#endif
}
CPP

# ncnn Android release builds disable RTTI and exceptions by default. Match the
# upstream ABI so DataReader subclasses do not reference unavailable typeinfo.
clang++ -O2 -std=c++17 -Wall -Wextra -Werror -Wformat=2 \
  -fno-rtti -fno-exceptions \
  -I"$include_dir" -L"$lib_dir" "$CACHE_DIR/ncnn-vulkan-synthetic.cpp" \
  -o "$INSTALL_DIR/daube-ncnn-vulkan-synthetic-inference" -lncnn -lvulkan -ldl -lm
export LD_LIBRARY_PATH="$lib_dir:${LD_LIBRARY_PATH:-}"
exec "$INSTALL_DIR/daube-ncnn-vulkan-synthetic-inference"
