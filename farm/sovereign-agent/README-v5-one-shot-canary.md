# D'AUBE Phone Edge v5 one-shot canary

Run only after `install-phone-edge-v5-fastpath.sh` has reported `SOURCE_PREFLIGHT_AND_ANDROID_COMPILE_PASS`.

The canary is fail-closed and performs thermal guards before and after GPU work, measures legacy-vs-persistent Vulkan at 224x224, verifies persistent Vulkan output against an independent CPU reference at 224x224 and 512x512, confirms one context/pipeline is reused across tiles, then executes the checksum-pinned ncnn Vulkan synthetic `Input -> ReLU` canary with CPU-verified values. It uses public deterministic synthetic inputs only and authorizes no paid spend.

Runtime promotion is allowed only when the final receipt reports `daube.phone-edge-v5-full-canary.v1` with `status=PASS`.
