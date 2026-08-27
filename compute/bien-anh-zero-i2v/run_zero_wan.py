#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from gradio_client import Client, handle_file

SPACE_URL = "https://kulkas2pintu-wan555.hf.space/"

PROMPT = """Photoreal documentary establishing shot in Hlaing Tharyar, Yangon Region, Myanmar. Use the supplied image as the exact first frame and visual authority. Create REAL camera translation, not a zoom and not a Ken Burns effect: a slow stabilized handheld/dolly move forward about 0.6 to 0.9 meters down the semi-open worker-hostel corridor. Perspective must change physically: near concrete parapet and columns move faster than distant roofs, door frames reveal slightly new side surfaces as camera advances, corridor vanishing geometry changes naturally, wet-floor reflections respond to the changing viewpoint. Preserve architecture, door count, wall wear, roof, settlement, buckets, sandals, laundry, wiring, water containers, overcast post-rain morning. Very subtle environmental motion only: clothes and loose wires move slightly in humid air; tiny roof-edge drips. No new people. No invented signage. No text changes. No morphing, duplication, geometry melting, fake depth-of-field, stylized grading or dramatic lighting. Natural documentary realism and world consistency."""

NEGATIVE = "zoom only, ken burns, flat 2D pan, fake parallax, warped architecture, melting geometry, duplicated doors, duplicated objects, new people, fake text, signage mutation, cinematic glow, strong bokeh, oversaturated, CGI, 3d render"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_path(value):
    if value is None:
        return None
    if isinstance(value, str):
        p = Path(value)
        if p.exists():
            return p
    if isinstance(value, dict):
        for key in ("path", "video", "file", "name"):
            v = value.get(key)
            if isinstance(v, str) and Path(v).exists():
                return Path(v)
    p = getattr(value, "path", None)
    if isinstance(p, str) and Path(p).exists():
        return Path(p)
    return None


def choose_endpoint(client: Client) -> str | None:
    try:
        api = client.view_api(return_format="dict")
    except Exception:
        return "/generate_video"
    named = api.get("named_endpoints", {}) if isinstance(api, dict) else {}
    if "/generate_video" in named:
        return "/generate_video"
    # Find the most plausible I2V endpoint, but avoid frame-grab helpers.
    for name in named:
        low = name.lower()
        if "generate" in low and "video" in low and "frame" not in low:
            return name
    return "/generate_video"


def call_space(client: Client, ref: Path):
    endpoint = choose_endpoint(client)
    common = [
        handle_file(str(ref)),
        None,
        PROMPT,
        4,
        NEGATIVE,
        3.0,
        1.0,
        1.0,
        42,
        False,
        6,
        "UniPCMultistep",
        3.0,
    ]
    attempts = [
        common + [16, True, True],
        common + [16, True],
        common,
    ]
    errors = []
    for args in attempts:
        try:
            return client.predict(*args, api_name=endpoint)
        except Exception as exc:
            errors.append(repr(exc))
    raise RuntimeError("all_gradio_call_shapes_failed: " + " | ".join(errors))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--source-revision", required=True)
    args = ap.parse_args()

    ref = Path(args.reference).resolve()
    out = Path(args.output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)

    client = Client(SPACE_URL, verbose=False)
    result = call_space(client, ref)

    candidates = list(result) if isinstance(result, (tuple, list)) else [result]
    video_path = None
    for item in candidates:
        video_path = extract_path(item)
        if video_path and video_path.suffix.lower() in {".mp4", ".webm", ".mov", ".mkv"}:
            break
    if video_path is None:
        raise RuntimeError(f"video_output_not_found:{result!r}")

    final = out / "EP01_SC01_SH01_CAM01_WAN22_ZERO_I2V.mp4"
    shutil.copy2(video_path, final)
    receipt = {
        "schema": "daube.bien-anh.zero-wan-i2v.v1",
        "status": "ZERO_GPU_I2V_CANDIDATE_REVIEW_REQUIRED",
        "sourceRevision": args.source_revision,
        "provider": "Hugging Face ZeroGPU public Space",
        "space": "kulkas2pintu/wan555",
        "model": "Wan2.2 I2V 14B fast preview",
        "purpose": "true image-to-video motion synthesis; no digital zoom substitute",
        "referenceSha256": sha256(ref),
        "video": {
            "name": final.name,
            "bytes": final.stat().st_size,
            "sha256": sha256(final),
        },
        "automaticPaidSpend": False,
        "promotionEligible": False,
        "fanOutEligible": False,
        "truthBoundary": "Candidate must be visually inspected for true perspective/parallax and world consistency before any canon/location promotion.",
    }
    (out / "ZERO_I2V_RECEIPT.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
