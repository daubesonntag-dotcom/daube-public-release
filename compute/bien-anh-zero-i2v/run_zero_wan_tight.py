#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from gradio_client import Client, handle_file

SPACE_URL = "https://kulkas2pintu-wan555.hf.space/"
PROMPT = """Use the supplied photograph as the exact first frame and immutable scene authority. Produce a photoreal documentary camera move in this real-looking Hlaing Tharyar worker-hostel corridor. The camera physically translates only about 0.25 to 0.35 meter straight forward with a tiny 2 to 4 cm drift to camera-right. This MUST be true viewpoint change, not zoom: nearby parapet/columns shift slightly faster than distant roofs, doorway edges reveal tiny changes in side surfaces, and wet-floor reflections respond to the viewpoint. Preserve every existing architectural element and object exactly: same doors, same roof, same parapet, same buckets, sandals, laundry, water containers, wiring, wall wear and exterior roofs. Do not invent, delete, duplicate, recolor or relocate objects. No new coats, signs, posters, people, plants, buckets or furniture. Do not generate any readable text or signage. Very subtle breeze only in already-existing hanging laundry and wires. No dramatic motion, no cinematic stylization, no bokeh, no relighting. Natural overcast post-rain documentary realism, stable geometry and temporal consistency."""
NEGATIVE = "zoom only, ken burns, 2d pan, static crop, new object, new coat, new sign, poster, readable text, people, extra door, duplicate object, geometry morphing, melting wall, warped column, moving architecture, changing roof, changing bucket, changing laundry color, cinematic glow, bokeh, oversaturated, CGI, 3d render"


def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()


def pick_path(v):
    if isinstance(v,str) and Path(v).exists(): return Path(v)
    if isinstance(v,dict):
        for k in ('path','file','name','video'):
            x=v.get(k)
            if isinstance(x,str) and Path(x).exists(): return Path(x)
        x=v.get('video')
        if isinstance(x,dict):
            y=x.get('path')
            if isinstance(y,str) and Path(y).exists(): return Path(y)
    p=getattr(v,'path',None)
    if isinstance(p,str) and Path(p).exists(): return Path(p)
    return None


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--reference',required=True)
    ap.add_argument('--output-dir',required=True)
    ap.add_argument('--source-revision',required=True)
    args=ap.parse_args()

    ref=Path(args.reference).resolve(); out=Path(args.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    client=Client(SPACE_URL,verbose=False)
    result=client.predict(
        handle_file(str(ref)),
        None,
        PROMPT,
        6,
        NEGATIVE,
        2.5,
        1.0,
        1.0,
        777,
        False,
        8,
        'UniPCMultistep',
        3.0,
        16,
        True,
        True,
        api_name='/generate_video',
    )
    items=list(result) if isinstance(result,(tuple,list)) else [result]
    src=None
    for item in items:
        p=pick_path(item)
        if p and p.suffix.lower() in {'.mp4','.webm','.mov','.mkv'}:
            src=p; break
    if src is None:
        raise RuntimeError(f'video_output_not_found:{result!r}')
    final=out/'EP01_SC01_SH01_CAM01_WAN22_ZERO_I2V_FINAL_CANDIDATE.mp4'
    shutil.copy2(src,final)
    receipt={
        'schema':'daube.bien-anh.zero-wan-i2v.tight.v1',
        'status':'ZERO_GPU_TIGHT_I2V_CANDIDATE_REVIEW_REQUIRED',
        'sourceRevision':args.source_revision,
        'space':'kulkas2pintu/wan555',
        'model':'Wan2.2 I2V A14B ZeroGPU',
        'steps':6,
        'durationRequestedSeconds':2.5,
        'motionIntent':'0.25-0.35m true camera translation with minimal scene mutation',
        'referenceSha256':sha256(ref),
        'video':{'name':final.name,'bytes':final.stat().st_size,'sha256':sha256(final)},
        'automaticPaidSpend':False,
        'promotionEligible':False,
        'fanOutEligible':False,
        'truthBoundary':'Must pass visual temporal-consistency QC; true parallax alone is insufficient if any scene object mutates.'
    }
    (out/'ZERO_I2V_TIGHT_RECEIPT.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))

if __name__=='__main__': main()
