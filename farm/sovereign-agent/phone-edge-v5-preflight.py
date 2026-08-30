#!/usr/bin/env python3
"""D'AUBE Phone Edge v5 rapid hardening preflight.

This is a source-level fail-closed gate used before real-device promotion. It does
not substitute for Android/Mali compilation or runtime evidence.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BLOCKED_APIS = (
    "system(", "popen(", "fork(", "execl(", "execv(", "socket(", "connect(",
)
SOFTWARE_RENDERERS = ("llvmpipe", "lavapipe", "swiftshader", "software")


def require(ok: bool, code: str, findings: list[dict]) -> None:
    findings.append({"code": code, "pass": bool(ok)})


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: phone-edge-v5-preflight.py vk_rgba_premultiply_batch.c", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")
    findings: list[dict] = []

    # Safety / attack-surface review (“doctor” pass).
    require("MAX_TOTAL_PIXELS" in text and "262144u" in text, "bounded_total_pixels_512_square", findings)
    require("TILE_PIXELS" in text and "4096u" in text, "bounded_tile_pixels", findings)
    require(all(api not in text for api in BLOCKED_APIS), "no_shell_process_or_network_api", findings)
    require(all(name in text.lower() for name in SOFTWARE_RENDERERS), "software_renderer_rejection", findings)
    require("VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT" in text, "coherent_host_memory_required", findings)

    # Vulkan lifecycle / synchronization review (“engineer” pass).
    require(text.count("vkCreateInstance(") == 1, "single_instance_create", findings)
    require(text.count("vkCreateDevice(") == 1, "single_device_create", findings)
    require(text.count("vkCreateComputePipelines(") == 1, "single_pipeline_create", findings)
    require("VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT" in text and "vkResetCommandBuffer" in text, "safe_command_buffer_reuse", findings)
    require("VK_ACCESS_SHADER_WRITE_BIT" in text and "VK_ACCESS_HOST_READ_BIT" in text, "shader_to_host_memory_barrier", findings)
    require("vkQueueWaitIdle" in text, "gpu_completion_before_host_read", findings)
    require("vkUnmapMemory" in text and "vkFreeMemory" in text and "vkDestroyBuffer" in text, "mapped_memory_cleanup", findings)
    require("vkDestroyPipeline" in text and "vkDestroyShaderModule" in text and "vkDestroyDevice" in text and "vkDestroyInstance" in text, "vulkan_object_cleanup", findings)
    require("contextReusedAcrossTiles\\\":true" in text, "receipt_declares_context_reuse", findings)

    # Portability guard: VkShaderModuleCreateInfo::pCode is uint32_t words and
    # must be suitably aligned. A byte-array cast is tolerated by some builds
    # but is not accepted for v5 promotion.
    unsafe_spv_cast = bool(re.search(r"pCode\s*=\s*\(const uint32_t \*\)\s*daube_rgba_premultiply_spv", text))
    require(not unsafe_spv_cast, "spirv_pcode_32bit_alignment_safe", findings)

    failed = [x["code"] for x in findings if not x["pass"]]
    result = {
        "schema": "daube.phone-edge-v5-preflight.v1",
        "status": "PASS" if not failed else "BLOCKED",
        "source": str(path),
        "findings": findings,
        "failed": failed,
        "runtimeProofPerformed": False,
        "truthBoundary": "Source preflight only; real Android/Mali compile and canary remain mandatory.",
    }
    print(json.dumps(result, separators=(",", ":")))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
