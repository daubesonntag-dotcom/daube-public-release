#!/usr/bin/env python3
"""D'AUBE Phone Edge v5 rapid hardening preflight.

Fail-closed source/build inspection before real-device promotion. This never
substitutes for Android/Mali compilation or runtime evidence.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BLOCKED_APIS = (
    "system(", "popen(", "fork(", "execl(", "execv(", "socket(", "connect(",
)
SOFTWARE_RENDERERS = ("llvmpipe", "lavapipe", "swiftshader", "software")


def require(ok: bool, code: str, findings: list[dict]) -> None:
    findings.append({"code": code, "pass": bool(ok)})


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print("usage: phone-edge-v5-preflight.py vk_rgba_premultiply_batch.c [rgba_premultiply_spv.h]", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")
    header_text = Path(sys.argv[2]).read_text(encoding="utf-8") if len(sys.argv) == 3 else ""
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

    # VkShaderModuleCreateInfo::pCode requires 32-bit words/alignment. V5 build
    # must generate a uint32_t array rather than relying on a byte-array cast.
    if header_text:
        require("static const uint32_t daube_rgba_premultiply_spv[]" in header_text, "spirv_pcode_32bit_alignment_safe", findings)
        require("daube_rgba_premultiply_spv_len" in header_text, "spirv_byte_length_declared", findings)
    else:
        require(False, "spirv_header_required_for_alignment_check", findings)

    failed = [x["code"] for x in findings if not x["pass"]]
    result = {
        "schema": "daube.phone-edge-v5-preflight.v1",
        "status": "PASS" if not failed else "BLOCKED",
        "source": str(path),
        "findings": findings,
        "failed": failed,
        "runtimeProofPerformed": False,
        "truthBoundary": "Source/build preflight only; real Android/Mali compile and canary remain mandatory.",
    }
    print(json.dumps(result, separators=(",", ":")))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
