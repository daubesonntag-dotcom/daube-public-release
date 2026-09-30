#!/usr/bin/env python3
from __future__ import annotations
import argparse, importlib.util, json, sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v27.py'
spec=importlib.util.spec_from_file_location('bien_anh_v27',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v27:{P}')
v27=importlib.util.module_from_spec(spec)
spec.loader.exec_module(v27)


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser=argparse.ArgumentParser()
    parser.add_argument('--output-dir',required=True)
    parser.add_argument('--source-revision',required=True)
    args=parser.parse_args(argv)
    v27.pbr.require_assets(); v27.v25.require_v25_assets()
    out=Path(args.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    v27.pbr.base.build_scene(out,args.source_revision)
    v27.v24.add_reality_reconstruction(); v27.v25.add_v25_refinement()
    v27.v26.rebuild_room_fronts(); v27.v26.add_threshold_life(); v27.v26.add_real_exterior_plate(); v27.v26.retune_camera_light()
    v27.add_v27_documentary_refinement()
    scene=bpy.context.scene
    scene.cycles.samples=16; scene.cycles.use_denoising=True
    scene.render.resolution_x=960; scene.render.resolution_y=540
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)
    v27.v26.patch_receipt(out); v27.patch_receipt(out)
    receipt_path=out/'bien-anh-v23-public-bootstrap-receipt.json'
    receipt=json.loads(receipt_path.read_text(encoding='utf-8'))
    receipt['status']='PHYSICAL_WIDE_V27_FAST_REALISM_GATE_PRODUCED_REVIEW_REQUIRED'
    receipt['qcRender']={'samples':16,'resolution':'960x540','denoising':True,'purpose':'fast visual realism gate; not final-sample render'}
    receipt_path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(receipt)

if __name__=='__main__': main()
