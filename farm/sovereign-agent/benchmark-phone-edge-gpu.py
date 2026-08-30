#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import statistics
import subprocess
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
KERNEL = Path(os.environ.get("DAUBE_PHONE_GPU_KERNEL", str(HERE / "daube-vulkan-rgba-premultiply")))
THERMAL = Path(os.environ.get("DAUBE_PHONE_THERMAL_PROBE", str(HERE / "daube-thermal-headroom-probe")))
MAX_TILE_PIXELS = 4096
MIN_BATTERY_PERCENT = 35
MAX_BATTERY_TEMP_C = 42.0
BENCH_HEADROOM_STOP = 0.90
MAX_THERMAL_STATUS_CODE = 2


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def safe_battery() -> dict[str, object]:
    result: dict[str, object] = {"percentage": None, "temperatureC": None, "charging": None}
    try:
        p = subprocess.run(["termux-battery-status"], capture_output=True, text=True, timeout=5, check=False)
        if p.returncode == 0:
            data = json.loads(p.stdout)
            result["percentage"] = int(data["percentage"]) if data.get("percentage") is not None else None
            result["temperatureC"] = float(data["temperature"]) if data.get("temperature") is not None else None
            result["charging"] = str(data.get("status", "")).upper() in {"CHARGING", "FULL"}
    except Exception:
        pass
    return result


def safe_thermal() -> dict[str, object]:
    fallback = {"supported": False, "headroom": None, "thermalStatusCode": None, "thermalStatus": None}
    if not THERMAL.exists() or not os.access(THERMAL, os.X_OK):
        return fallback
    try:
        p = subprocess.run([str(THERMAL)], capture_output=True, text=True, timeout=5, check=False)
        if p.returncode != 0:
            return fallback
        lines = [line.strip() for line in p.stdout.splitlines() if line.strip()]
        if not lines:
            return fallback
        data = json.loads(lines[-1])
        if data.get("schema") != "daube.android-thermal-headroom.v1":
            return fallback
        return {
            "supported": data.get("supported") is True,
            "headroom": float(data["headroom"]) if data.get("headroom") is not None else None,
            "thermalStatusCode": int(data["thermalStatusCode"]) if data.get("thermalStatusCode") is not None else None,
            "thermalStatus": str(data.get("thermalStatus"))[:32] if data.get("thermalStatus") is not None else None,
        }
    except Exception:
        return fallback


def safety_snapshot() -> dict[str, object]:
    return {"observedAt": now_iso(), "battery": safe_battery(), "thermal": safe_thermal()}


def safety_ok(snapshot: dict[str, object]) -> tuple[bool, str | None]:
    battery = snapshot["battery"]
    thermal = snapshot["thermal"]
    pct = battery.get("percentage")
    temp = battery.get("temperatureC")
    if pct is not None and int(pct) < MIN_BATTERY_PERCENT:
        return False, "battery_below_floor"
    if temp is not None and float(temp) > MAX_BATTERY_TEMP_C:
        return False, "battery_temperature_above_ceiling"
    if thermal.get("supported") is True:
        headroom = thermal.get("headroom")
        status = thermal.get("thermalStatusCode")
        if headroom is not None and float(headroom) >= BENCH_HEADROOM_STOP:
            return False, "thermal_headroom_benchmark_stop"
        if status is not None and int(status) > MAX_THERMAL_STATUS_CODE:
            return False, "thermal_status_benchmark_stop"
    return True, None


def deterministic_rgba(pixel_count: int, seed: int) -> bytes:
    out = bytearray(pixel_count * 4)
    state = seed & 0xFFFFFFFF
    for i in range(pixel_count):
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        r = state & 0xFF
        g = (state >> 8) & 0xFF
        b = (state >> 16) & 0xFF
        a = (state >> 24) & 0xFF
        j = i * 4
        out[j:j+4] = bytes((r, g, b, a))
    return bytes(out)


def premultiply_reference(raw: bytes) -> bytes:
    out = bytearray(len(raw))
    for i in range(0, len(raw), 4):
        a = raw[i + 3]
        out[i] = (raw[i] * a + 127) // 255
        out[i + 1] = (raw[i + 1] * a + 127) // 255
        out[i + 2] = (raw[i + 2] * a + 127) // 255
        out[i + 3] = a
    return bytes(out)


def run_tile(raw: bytes) -> tuple[float, str, str]:
    with tempfile.TemporaryDirectory(prefix="daube-phone-bench-") as td:
        inp = Path(td) / "input.rgba"
        out = Path(td) / "output.rgba"
        inp.write_bytes(raw)
        start = time.perf_counter()
        p = subprocess.run([str(KERNEL), str(inp), str(out)], capture_output=True, text=True, timeout=30, check=False)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        if p.returncode != 0:
            detail = (p.stderr or p.stdout or "kernel_failed").strip().splitlines()[-1][:180]
            raise RuntimeError(f"kernel_failed:{p.returncode}:{detail}")
        lines = [line.strip() for line in p.stdout.splitlines() if line.strip()]
        if not lines:
            raise RuntimeError("kernel_receipt_missing")
        receipt = json.loads(lines[-1])
        if not (receipt.get("passed") is True and receipt.get("hardwareGpu") is True and receipt.get("softwareRenderer") is False and receipt.get("backend") == "vulkan"):
            raise RuntimeError("kernel_receipt_invalid")
        actual = out.read_bytes()
        expected = premultiply_reference(raw)
        if actual != expected:
            raise RuntimeError("cpu_reference_mismatch")
        return elapsed_ms, str(receipt.get("deviceName", ""))[:160], hashlib.sha256(actual).hexdigest()


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, math.ceil(p * len(ordered)) - 1))
    return ordered[idx]


def benchmark_size(side: int, seed: int) -> tuple[dict[str, object], str | None]:
    pixels = side * side
    tiles = math.ceil(pixels / MAX_TILE_PIXELS)
    remaining = pixels
    latencies: list[float] = []
    output_hashes: list[str] = []
    device_name = None
    start_safety = safety_snapshot()
    ok, reason = safety_ok(start_safety)
    if not ok:
        return {"side": side, "pixels": pixels, "tiles": tiles, "status": "SKIPPED_SAFETY", "safetyBefore": start_safety}, reason

    rung_started = time.perf_counter()
    for tile_index in range(tiles):
        if tile_index and tile_index % 8 == 0:
            mid = safety_snapshot()
            ok, reason = safety_ok(mid)
            if not ok:
                return {
                    "side": side, "pixels": pixels, "tiles": tiles, "tilesCompleted": tile_index,
                    "status": "ABORTED_SAFETY", "safetyBefore": start_safety, "safetyAbort": mid,
                    "latenciesMs": latencies,
                }, reason
        tile_pixels = min(MAX_TILE_PIXELS, remaining)
        raw = deterministic_rgba(tile_pixels, seed ^ (side << 16) ^ tile_index)
        latency, current_device, output_hash = run_tile(raw)
        device_name = device_name or current_device
        latencies.append(latency)
        output_hashes.append(output_hash)
        remaining -= tile_pixels

    total_ms = (time.perf_counter() - rung_started) * 1000.0
    end_safety = safety_snapshot()
    digest = hashlib.sha256("".join(output_hashes).encode()).hexdigest()
    return {
        "side": side,
        "pixels": pixels,
        "tiles": tiles,
        "status": "PASS",
        "deviceName": device_name,
        "totalMs": round(total_ms, 2),
        "medianTileMs": round(statistics.median(latencies), 2),
        "p95TileMs": round(percentile(latencies, 0.95) or 0, 2),
        "minTileMs": round(min(latencies), 2),
        "maxTileMs": round(max(latencies), 2),
        "effectiveMpixelsPerSecond": round((pixels / 1_000_000) / (total_ms / 1000.0), 4) if total_ms > 0 else None,
        "combinedOutputSha256": digest,
        "safetyBefore": start_safety,
        "safetyAfter": end_safety,
        "cpuReferenceVerified": True,
    }, None


def main() -> int:
    parser = argparse.ArgumentParser(description="D'AUBE thermally bounded Phone Edge Vulkan benchmark ladder")
    parser.add_argument("--sizes", default="64,128,224,512", help="comma-separated logical square image sizes")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not KERNEL.exists() or not os.access(KERNEL, os.X_OK):
        raise SystemExit("phone GPU kernel missing; run install-phone-edge-gpu.sh first")
    sizes = []
    for token in args.sizes.split(","):
        side = int(token.strip())
        if side < 8 or side > 1024:
            raise SystemExit("benchmark side must be between 8 and 1024")
        sizes.append(side)

    receipt: dict[str, object] = {
        "schema": "daube.phone-edge-benchmark-ladder.v1",
        "status": "PASS",
        "startedAt": now_iso(),
        "kernelId": "rgba-premultiply-u8-v1",
        "backend": "vulkan",
        "tilePixels": MAX_TILE_PIXELS,
        "logicalSizes": sizes,
        "hardZero": True,
        "paidSpendAuthorized": False,
        "privateAssetsUsed": False,
        "rungs": [],
    }
    for index, side in enumerate(sizes):
        rung, stop_reason = benchmark_size(side, args.seed ^ index)
        receipt["rungs"].append(rung)
        if stop_reason:
            receipt["status"] = "SAFETY_STOP"
            receipt["stopReason"] = stop_reason
            break
        time.sleep(1.0)
    receipt["completedAt"] = now_iso()
    print(json.dumps(receipt, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
