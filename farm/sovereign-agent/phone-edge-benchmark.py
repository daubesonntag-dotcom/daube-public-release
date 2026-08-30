#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import statistics
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORKER = HERE / "phone-edge-worker.py"


def load_worker():
    spec = importlib.util.spec_from_file_location("daube_phone_edge_worker", WORKER)
    if spec is None or spec.loader is None:
        raise RuntimeError("phone_edge_worker_import_failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def percentile(values: list[int], q: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(q * len(ordered)) - 1))
    return int(ordered[index])


def deterministic_rgba(byte_count: int) -> bytes:
    if byte_count < 4 or byte_count % 4:
        raise ValueError("byte_count_must_be_positive_rgba_multiple")
    pixels = byte_count // 4
    raw = bytearray(byte_count)
    for pixel in range(pixels):
        base = pixel * 4
        raw[base] = (pixel * 17 + 11) & 0xFF
        raw[base + 1] = (pixel * 29 + 23) & 0xFF
        raw[base + 2] = (pixel * 43 + 37) & 0xFF
        raw[base + 3] = (pixel * 61 + 53) & 0xFF
    return bytes(raw)


def telemetry_summary(samples: list[dict[str, object]]) -> dict[str, object]:
    battery = [int(s["percentage"]) for s in samples if s.get("percentage") is not None]
    temperatures = [float(s["temperatureC"]) for s in samples if s.get("temperatureC") is not None]
    headrooms: list[float] = []
    status_codes: list[int] = []
    for sample in samples:
        thermal = sample.get("thermal") if isinstance(sample.get("thermal"), dict) else {}
        if thermal.get("headroom") is not None:
            headrooms.append(float(thermal["headroom"]))
        if thermal.get("thermalStatusCode") is not None:
            status_codes.append(int(thermal["thermalStatusCode"]))
    return {
        "batteryStartPercent": battery[0] if battery else None,
        "batteryEndPercent": battery[-1] if battery else None,
        "batteryDropPercent": max(0, battery[0] - battery[-1]) if battery else None,
        "maxBatteryTemperatureC": round(max(temperatures), 2) if temperatures else None,
        "maxThermalHeadroom10s": round(max(headrooms), 4) if headrooms else None,
        "maxThermalStatusCode": max(status_codes) if status_codes else None,
    }


def admission_score(worker, successful: int, requested: int, telemetry: dict[str, object]) -> int:
    stability = 50.0 * (successful / max(1, requested))

    headroom = telemetry.get("maxThermalHeadroom10s")
    if headroom is None:
        thermal = 15.0
    else:
        ceiling = max(0.01, float(worker.MAX_THERMAL_HEADROOM))
        thermal = 30.0 * max(0.0, min(1.0, 1.0 - float(headroom) / ceiling))

    battery_end = telemetry.get("batteryEndPercent")
    if battery_end is None:
        battery = 10.0
    else:
        floor = float(worker.MIN_BATTERY_PERCENT)
        battery = 20.0 * max(0.0, min(1.0, (float(battery_end) - floor) / max(1.0, 100.0 - floor)))

    return max(0, min(100, round(stability + thermal + battery)))


def main() -> int:
    parser = argparse.ArgumentParser(description="D’AUBE sustained Android/Termux Vulkan benchmark")
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--bytes", type=int, default=16 * 1024)
    parser.add_argument("--cooldown-ms", type=int, default=100)
    args = parser.parse_args()

    if args.iterations < 3 or args.iterations > 200:
        raise SystemExit("iterations must be between 3 and 200")

    worker = load_worker()
    worker.host = worker.load_host_agent()
    worker.host.require_runtime()
    if worker.host.runtime_kind() != "android-termux":
        raise SystemExit("D'AUBE phone GPU benchmark requires Android/Termux")
    if args.bytes > worker.MAX_INPUT_BYTES:
        raise SystemExit(f"bytes exceeds worker ceiling {worker.MAX_INPUT_BYTES}")

    raw = deterministic_rgba(args.bytes)
    expected_input_sha = hashlib.sha256(raw).hexdigest()
    latencies: list[int] = []
    outputs: list[str] = []
    safety_samples: list[dict[str, object]] = []
    device_names: set[str] = set()
    failures: list[dict[str, object]] = []

    started = time.perf_counter()
    for iteration in range(args.iterations):
        try:
            safety = worker.battery_guard()
            safety_samples.append(safety)
            output, kernel_receipt, latency_ms = worker.run_kernel(raw)
            if len(output) != len(raw):
                raise RuntimeError("benchmark_output_size_invalid")
            outputs.append(hashlib.sha256(output).hexdigest())
            latencies.append(latency_ms)
            device_names.add(str(kernel_receipt.get("deviceName", ""))[:160])
        except Exception as error:
            failures.append({
                "iteration": iteration,
                "errorClass": type(error).__name__,
                "errorCode": str(error)[:160],
            })
            break
        if args.cooldown_ms > 0:
            time.sleep(args.cooldown_ms / 1000.0)

    elapsed_ms = max(1, int((time.perf_counter() - started) * 1000))
    successful = len(latencies)
    telemetry = telemetry_summary(safety_samples)
    deterministic_output = bool(outputs) and len(set(outputs)) == 1
    pixels_per_run = len(raw) // 4
    total_pixels = pixels_per_run * successful
    throughput_pixels_per_second = round(total_pixels / (elapsed_ms / 1000.0), 2)

    receipt = {
        "schema": "daube.phone-edge-sustained-benchmark.v1",
        "profile": worker.PROFILE,
        "kernelId": worker.KERNEL_ID,
        "backend": "vulkan",
        "deviceNames": sorted(name for name in device_names if name),
        "requestedIterations": args.iterations,
        "successfulIterations": successful,
        "inputBytesPerRun": len(raw),
        "pixelsPerRun": pixels_per_run,
        "inputSha256": expected_input_sha,
        "deterministicOutput": deterministic_output,
        "outputSha256": outputs[0] if deterministic_output else None,
        "latencyMs": {
            "min": min(latencies) if latencies else None,
            "median": int(statistics.median(latencies)) if latencies else None,
            "p95": percentile(latencies, 0.95) if latencies else None,
            "max": max(latencies) if latencies else None,
        },
        "elapsedMs": elapsed_ms,
        "throughputPixelsPerSecondIncludingCooldown": throughput_pixels_per_second,
        "telemetry": telemetry,
        "admissionScore0to100": admission_score(worker, successful, args.iterations, telemetry),
        "classification": "PHONE_GPU_LIGHTWEIGHT_EDGE_ONLY",
        "heavyMediaClassProven": False,
        "desktopGpuPossessionProven": False,
        "privateAssetsUsed": False,
        "paidSpendAuthorized": False,
        "failures": failures,
        "passed": successful == args.iterations and deterministic_output and not failures,
    }
    receipt["receiptSha256"] = hashlib.sha256(
        json.dumps(receipt, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
    return 0 if receipt["passed"] else 4


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({
            "schema": "daube.phone-edge-sustained-benchmark.v1",
            "passed": False,
            "errorClass": type(error).__name__,
            "errorCode": str(error)[:200],
            "paidSpendAuthorized": False,
        }, ensure_ascii=False, sort_keys=True))
        raise SystemExit(2)
