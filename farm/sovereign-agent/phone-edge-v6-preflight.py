#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: phone-edge-v6-preflight.py vk_rgba_maxperf.c")

src = Path(sys.argv[1]).read_text(encoding="utf-8")
checks = []

def check(code: str, ok: bool):
    checks.append({"code": code, "pass": bool(ok)})

check("bounded_total_pixels", bool(re.search(r"#define\s+MAX_TOTAL_PIXELS\s+4194240u", src)))
check("software_renderer_rejection", all(x in src.lower() for x in ["llvmpipe", "lavapipe", "swiftshader", "software"]))
check("hardware_compute_queue_required", "VK_QUEUE_COMPUTE_BIT" in src)
check("single_full_size_buffer", "const VkDeviceSize buffer_bytes" in src and "TILE_PIXELS" not in src)
check("host_visible_coherent_memory", "VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT" in src)
check("host_to_shader_barrier", "VK_ACCESS_HOST_WRITE_BIT" in src and "VK_PIPELINE_STAGE_HOST_BIT" in src)
check("shader_to_host_barrier", "VK_ACCESS_SHADER_WRITE_BIT" in src and "VK_ACCESS_HOST_READ_BIT" in src)
check("fence_sync", "vkCreateFence" in src and "vkWaitForFences" in src and "vkResetFences" in src)
check("queue_wait_idle_removed", "vkQueueWaitIdle(" not in src)
check("pipeline_cache_create", "vkCreatePipelineCache" in src)
check("pipeline_cache_persist", "vkGetPipelineCacheData" in src and "DAUBE_VK_PIPELINE_CACHE_PATH" in src)
check("multi_job_context_reuse", "job_count" in src and "contextCreates\\\":1" in src and "pipelineCreates\\\":1" in src)
check("dispatch_limit_checked", "maxComputeWorkGroupCount[0]" in src and "dispatch_limit_exceeded" in src)
check("bounded_cache_file", "16 * 1024 * 1024" in src)
check("no_shell_or_network_api", all(x not in src for x in ["system(", "popen(", "curl ", "wget ", "socket(", "connect("]))
check("truth_boundary", "privateAssetsUsed\\\":false" in src and "paidSpendAuthorized\\\":false" in src)

failed = [c for c in checks if not c["pass"]]
print(json.dumps({
    "schema": "daube.phone-edge-v6-preflight.v1",
    "status": "PASS" if not failed else "FAIL",
    "checks": checks,
    "failed": failed,
    "runtimeProofPerformed": False,
    "paidSpendAuthorized": False,
}, separators=(",", ":")))
if failed:
    raise SystemExit(10)
