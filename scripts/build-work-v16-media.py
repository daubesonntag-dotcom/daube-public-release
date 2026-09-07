#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from urllib.request import Request, urlopen

import pillow_avif  # noqa: F401 - registers AVIF support with Pillow
from PIL import Image

SOURCE_URL = 'https://cdn.creativeclaw.co/u/218f016f/images/c2b5ff65-757c-4da3-b4fc-06a9e4f9a72f.png'
EXPECTED_SOURCE = (1672, 941)
OUT = Path('assets/media/hero')
LANDSCAPE_WIDTHS = (768, 1200, 1600)
MOBILE_SIZE = (706, 941)
MOBILE_FOCAL_X = 1060


def download_source() -> Image.Image:
    req = Request(SOURCE_URL, headers={'User-Agent': 'D-AUBE-V16-media-builder/1.0'})
    with urlopen(req, timeout=30) as response:
        data = response.read()
    image = Image.open(io.BytesIO(data)).convert('RGB')
    if image.size != EXPECTED_SOURCE:
        raise SystemExit(f'Unexpected hero source dimensions: {image.size}, expected {EXPECTED_SOURCE}')
    return image


def receipt(path: Path, width: int, height: int, fmt: str, role: str) -> dict:
    data = path.read_bytes()
    return {
        'file': path.as_posix(),
        'width': width,
        'height': height,
        'format': fmt,
        'role': role,
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'upscaled': False,
    }


def save_variants(image: Image.Image) -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    src_w, src_h = image.size

    for width in LANDSCAPE_WIDTHS:
        if width > src_w:
            raise SystemExit(f'Refusing upscale width {width} > {src_w}')
        height = round(src_h * width / src_w)
        resized = image.resize((width, height), Image.Resampling.LANCZOS)

        webp = OUT / f'daube-bloom-{width}.webp'
        resized.save(webp, 'WEBP', quality=88, method=6)
        entries.append(receipt(webp, width, height, 'webp', 'desktop'))

        avif = OUT / f'daube-bloom-{width}.avif'
        resized.save(avif, 'AVIF', quality=63, speed=5)
        entries.append(receipt(avif, width, height, 'avif', 'desktop'))

    crop_w, crop_h = MOBILE_SIZE
    if crop_w > src_w or crop_h > src_h:
        raise SystemExit(f'Refusing mobile upscale {MOBILE_SIZE} from {image.size}')
    left = max(0, min(src_w - crop_w, MOBILE_FOCAL_X - crop_w // 2))
    crop = image.crop((left, 0, left + crop_w, crop_h))

    mobile_webp = OUT / 'daube-bloom-mobile-706x941.webp'
    crop.save(mobile_webp, 'WEBP', quality=90, method=6)
    entries.append(receipt(mobile_webp, crop_w, crop_h, 'webp', 'mobile'))

    mobile_avif = OUT / 'daube-bloom-mobile-706x941.avif'
    crop.save(mobile_avif, 'AVIF', quality=65, speed=5)
    entries.append(receipt(mobile_avif, crop_w, crop_h, 'avif', 'mobile'))

    manifest = {
        'source': {
            'url': SOURCE_URL,
            'width': src_w,
            'height': src_h,
            'format': 'png',
            'upscaled': False,
        },
        'policy': {
            'truthBoundary': 'No derivative exceeds source pixel dimensions; no 2K/4K claim.',
            'mobileCrop': '706x941 focal crop from the 1672x941 source; no upscale.',
        },
        'derivatives': sorted(entries, key=lambda item: (item['role'], item['width'], item['format'])),
    }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return manifest


def main() -> None:
    manifest = save_variants(download_source())
    print(f"WORK_V16_MEDIA_BUILD_PASS derivatives={len(manifest['derivatives'])}")


if __name__ == '__main__':
    main()
