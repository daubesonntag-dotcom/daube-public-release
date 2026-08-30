#!/usr/bin/env python3
import hashlib
import json
import os
import shutil
import statistics
import subprocess
import tempfile
import time
from pathlib import Path

SIZES = (64, 224, 512)
REPEATS = 3
HEADROOM_HOLD = 0.90


def run_json(cmd, env=None):
    p = subprocess.run(cmd, text=True, capture_output=True, env=env)
    if p.returncode != 0:
        raise RuntimeError(f"command_failed:{cmd[0]}:{p.returncode}:{p.stderr.strip()}")
    lines = [x.strip() for x in p.stdout.splitlines() if x.strip()]
    for line in reversed(lines):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    raise RuntimeError(f"json_missing:{cmd[0]}")


def thermal_guard(stage):
    probe = shutil.which("daube-phone-edge-thermal-headroom")
    if not probe:
        raise RuntimeError("thermal_probe_missing")
    data = run_json([probe])
    if not data.get("supported", False):
        raise RuntimeError("thermal_headroom_unsupported")
    headroom = data.get("headroom")
    status_code = int(data.get("thermalStatusCode", 0))
    if headroom is None:
        raise RuntimeError("thermal_headroom_missing")
    if float(headroom) >= HEADROOM_HOLD or status_code > 2:
        raise RuntimeError(f"thermal_hold:{stage}:{headroom}:{status_code}")
    return data


def rgba_bytes(side):
    out = bytearray(side * side * 4)
    for i in range(side * side):
        base = i * 4
        out[base + 0] = (i * 17 + 3) & 0xFF
        out[base + 1] = (i * 29 + 11) & 0xFF
        out[base + 2] = (i * 43 + 19) & 0xFF
        out[base + 3] = (i * 31 + 127) & 0xFF
    return bytes(out)


def premul_ref(raw):
    out = bytearray(raw)
    for i in range(0, len(out), 4):
        a = out[i + 3]
        out[i + 0] = (out[i + 0] * a + 127) // 255
        out[i + 1] = (out[i + 1] * a + 127) // 255
        out[i + 2] = (out[i + 2] * a + 127) // 255
    return bytes(out)


def fused_ref(raw):
    p = bytearray(premul_ref(raw))
    for i in range(0, len(p), 4):
        r, g, b, a = p[i], p[i + 1], p[i + 2], p[i + 3]
        y = (54 * r + 183 * g + 19 * b + 128) >> 8
        p[i + 0] = y
        p[i + 1] = y
        p[i + 2] = y
        p[i + 3] = a
    return bytes(p)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def timed_json(cmd):
    t0 = time.perf_counter()
    data = run_json(cmd)
    return (time.perf_counter() - t0) * 1000.0, data


def median_runs(cmd, outputs, expected):
    samples = []
    receipts = []
    for _ in range(REPEATS):
        thermal_guard("repeat")
        ms, receipt = timed_json(cmd)
        samples.append(ms)
        receipts.append(receipt)
        for path, ref in zip(outputs, expected):
            got = Path(path).read_bytes()
            if got != ref:
                raise RuntimeError(f"cpu_reference_mismatch:{path}")
    return statistics.median(samples), receipts[-1]


def main():
    premul = shutil.which("daube-phone-edge-v6-premultiply")
    fused = shutil.which("daube-phone-edge-v6-premultiply-luma")
    if not premul or not fused:
        raise RuntimeError("v6_commands_missing_run_installer_first")

    thermal_before = thermal_guard("before")
    legacy = shutil.which("daube-phone-edge-v5-batch")

    with tempfile.TemporaryDirectory(prefix="daube-v6-") as td:
        root = Path(td)
        raw = {s: rgba_bytes(s) for s in SIZES}
        premul_expected = {s: premul_ref(raw[s]) for s in SIZES}
        fused_expected = {s: fused_ref(raw[s]) for s in SIZES}
        inp = {}
        for s in SIZES:
            p = root / f"in-{s}.rgba"
            p.write_bytes(raw[s])
            inp[s] = p

        # Warm pipeline cache with the smallest bounded workload.
        warm_out = root / "warm.rgba"
        warm_ms, warm_receipt = timed_json([premul, str(inp[64]), str(warm_out)])
        if warm_out.read_bytes() != premul_expected[64]:
            raise RuntimeError("warmup_cpu_reference_mismatch")

        v6_224_out = root / "v6-224.rgba"
        v6_512_out = root / "v6-512.rgba"
        v6_224_ms, v6_224_receipt = median_runs(
            [premul, str(inp[224]), str(v6_224_out)], [v6_224_out], [premul_expected[224]]
        )
        v6_512_ms, v6_512_receipt = median_runs(
            [premul, str(inp[512]), str(v6_512_out)], [v6_512_out], [premul_expected[512]]
        )

        combined_224 = root / "combined-224.rgba"
        combined_512 = root / "combined-512.rgba"
        combined_ms, combined_receipt = median_runs(
            [premul, str(inp[224]), str(combined_224), str(inp[512]), str(combined_512)],
            [combined_224, combined_512],
            [premul_expected[224], premul_expected[512]],
        )

        fused_224 = root / "fused-224.rgba"
        fused_512 = root / "fused-512.rgba"
        fused_ms, fused_receipt = median_runs(
            [fused, str(inp[224]), str(fused_224), str(inp[512]), str(fused_512)],
            [fused_224, fused_512],
            [fused_expected[224], fused_expected[512]],
        )

        legacy_224_ms = None
        legacy_512_ms = None
        if legacy:
            legacy_224 = root / "legacy-224.rgba"
            legacy_512 = root / "legacy-512.rgba"
            legacy_224_ms, _ = median_runs(
                [legacy, str(inp[224]), str(legacy_224)], [legacy_224], [premul_expected[224]]
            )
            legacy_512_ms, _ = median_runs(
                [legacy, str(inp[512]), str(legacy_512)], [legacy_512], [premul_expected[512]]
            )

        thermal_after = thermal_guard("after")

        result = {
            "schema": "daube.phone-edge-v6-maxperf-canary.v1",
            "status": "PASS",
            "device": v6_512_receipt.get("device"),
            "warmupMs": round(warm_ms, 3),
            "v6Premultiply224MedianMs": round(v6_224_ms, 3),
            "v6Premultiply512MedianMs": round(v6_512_ms, 3),
            "v6Combined224And512MedianMs": round(combined_ms, 3),
            "v6Fused224And512MedianMs": round(fused_ms, 3),
            "wholeImageDispatch": bool(v6_512_receipt.get("wholeImageDispatch")),
            "queueWaitIdleUsed": bool(v6_512_receipt.get("queueWaitIdleUsed")),
            "fenceSynchronization": bool(v6_512_receipt.get("fenceSynchronization")),
            "pipelineCacheLoadedAfterWarmup": bool(v6_224_receipt.get("pipelineCacheLoaded")),
            "multiJobContextReused": combined_receipt.get("jobs") == 2 and combined_receipt.get("contextCreates") == 1,
            "fusedRuntimeExecuted": fused_receipt.get("jobs") == 2,
            "cpuReferenceVerified224": True,
            "cpuReferenceVerified512": True,
            "fusedCpuReferenceVerified224": True,
            "fusedCpuReferenceVerified512": True,
            "input224Sha256": sha256(raw[224]),
            "input512Sha256": sha256(raw[512]),
            "premul224Sha256": sha256(premul_expected[224]),
            "premul512Sha256": sha256(premul_expected[512]),
            "fused224Sha256": sha256(fused_expected[224]),
            "fused512Sha256": sha256(fused_expected[512]),
            "legacyComparatorAvailable": legacy is not None,
            "legacy224MedianMs": round(legacy_224_ms, 3) if legacy_224_ms is not None else None,
            "legacy512MedianMs": round(legacy_512_ms, 3) if legacy_512_ms is not None else None,
            "speedup224VsV5": round(legacy_224_ms / v6_224_ms, 3) if legacy_224_ms is not None and v6_224_ms > 0 else None,
            "speedup512VsV5": round(legacy_512_ms / v6_512_ms, 3) if legacy_512_ms is not None and v6_512_ms > 0 else None,
            "thermalBefore": thermal_before,
            "thermalAfter": thermal_after,
            "privateAssetsUsed": False,
            "paidSpendAuthorized": False,
            "externalModelInferenceProven": False,
        }
        print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({
            "schema": "daube.phone-edge-v6-maxperf-canary.v1",
            "status": "FAIL",
            "error": str(exc),
            "privateAssetsUsed": False,
            "paidSpendAuthorized": False,
        }, separators=(",", ":")))
        raise SystemExit(20)
