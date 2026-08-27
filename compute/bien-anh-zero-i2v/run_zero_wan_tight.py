#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from gradio_client import Client, handle_file

SPACE_URL = "https://kulkas2pintu-wan555.hf.space/"
PROMPT = """Use the supplied photograph as the exact first frame and immutable scene authority. Create a premium Southeast Asian television-drama establishing shot, grounded and observational rather than a commercial or music-video shot. The camera is at an adult eye height around 1.55 m with a natural 32–35 mm full-frame-equivalent perspective and deep focus. The operator makes a very small physical advance of about 0.20–0.30 meter down the corridor with only 1–3 cm natural shoulder drift and tiny human micro-instability; no floating gimbal, no dramatic dolly, no crane, no digital zoom. This MUST be true viewpoint change: nearby door edges, parapet and columns shift subtly faster than distant roofs; wet-floor reflections respond naturally to the changed viewpoint.

Preserve the location exactly. Same old doors, wall wear, roof, parapet, columns, buckets, sandals, laundry, water containers, wiring, exterior roofs and vegetation. Do not invent, remove, duplicate, resize, recolor, relabel or relocate any object. Do not add people. Do not create readable signage or text. Existing laundry and loose wires may move only imperceptibly in a weak humid morning breeze. Architecture must remain rigid and temporally stable.

Television-drama image language: neutral Rec.709-like color, restrained saturation, moderate contrast, soft overcast highlight roll-off, realistic shadow detail, no teal-orange grade, no crushed blacks, no glossy commercial sheen, no anamorphic flare, no shallow-depth-of-field bokeh, no fake film look. It is 06:12 after rain in Hlaing Tharyar: humid, already daylight, overcast, wet floor, practical corridor light still faintly visible. The shot should feel like a real location camera crew quietly entered the hostel for a serious TV drama, not an AI showcase."""

NEGATIVE = """zoom only, ken burns, 2d pan, static crop, floating gimbal, dramatic dolly, crane shot, drone shot, music video, commercial lighting, teal orange, cinematic glow, anamorphic flare, bokeh, shallow depth of field, crushed blacks, oversaturated, CGI, 3d render, new object, new coat, new sign, poster, readable text, people, extra door, duplicate object, geometry morphing, melting wall, warped column, moving architecture, changing roof, changing bucket, changing laundry color, breathing walls, flicker, temporal mutation"""


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def pick_path(v):
    if isinstance(v, str) and Path(v).exists():
        return Path(v)
    if isinstance(v, dict):
        for k in ("path", "file", "name", "video"):
            x = v.get(k)
            if isinstance(x, str) and Path(x).exists():
                return Path(x)
        x = v.get("video")
        if isinstance(x, dict):
            y = x.get("path")
            if isinstance(y, str) and Path(y).exists():
                return Path(y)
    p = getattr(v, "path", None)
    if isinstance(p, str) and Path(p).exists():
        return Path(p)
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--source-revision", required=True)
    args = ap.parse_args()

    ref = Path(args.reference).resolve()
    out = Path(args.output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)

    client = Client(SPACE_URL, verbose=False)
    result = client.predict(
        handle_file(str(ref)),
        None,
        PROMPT,
        6,
        NEGATIVE,
        3.0,
        1.0,
        1.0,
        8246,
        False,
        8,
        "UniPCMultistep",
        3.0,
        16,
        True,
        True,
        api_name="/generate_video",
    )

    items = list(result) if isinstance(result, (tuple, list)) else [result]
    src = None
    for item in items:
        p = pick_path(item)
        if p and p.suffix.lower() in {".mp4", ".webm", ".mov", ".mkv"}:
            src = p
            break
    if src is None:
        raise RuntimeError(f"video_output_not_found:{result!r}")

    raw = out / "EP01_SC01_SH01_CAM01_WAN22_TVDRAMA_RAW.mp4"
    shutil.copy2(src, raw)
    receipt = {
        "schema": "daube.bien-anh.zero-wan-i2v.tvdrama.v1",
        "status": "TV_DRAMA_I2V_CANDIDATE_REVIEW_REQUIRED",
        "sourceRevision": args.source_revision,
        "space": "kulkas2pintu/wan555",
        "model": "Wan2.2 I2V A14B ZeroGPU",
        "steps": 6,
        "durationRequestedSeconds": 3.0,
        "cameraLanguage": "premium television drama; 32-35mm equivalent; eye-level; 0.20-0.30m true translation; restrained shoulder micro-drift",
        "colorLanguage": "neutral Rec.709-like; restrained saturation; moderate contrast; overcast post-rain morning",
        "referenceSha256": sha256(ref),
        "rawVideo": {"name": raw.name, "bytes": raw.stat().st_size, "sha256": sha256(raw)},
        "automaticPaidSpend": False,
        "promotionEligible": False,
        "fanOutEligible": False,
        "truthBoundary": "Must pass visual temporal-consistency and television-drama language QC. True parallax alone is insufficient if objects mutate or the motion reads as digital zoom/commercial camera language.",
    }
    (out / "TV_DRAMA_I2V_RECEIPT.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
