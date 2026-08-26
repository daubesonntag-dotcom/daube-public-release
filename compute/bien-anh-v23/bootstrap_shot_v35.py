#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v35.py'
spec=importlib.util.spec_from_file_location('bien_anh_v35',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v35:{P}')
v35=importlib.util.module_from_spec(spec); spec.loader.exec_module(v35)
base=v35.base


def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def key_camera(cam,frame,loc,target,roll_deg=0.0):
    cam.location=loc
    base.point_at(cam,target)
    cam.rotation_euler[2]+=math.radians(roll_deg)
    cam.keyframe_insert(data_path='location',frame=frame)
    cam.keyframe_insert(data_path='rotation_euler',frame=frame)


def set_smooth_camera_fcurves(cam):
    if cam.animation_data and cam.animation_data.action:
        for fc in cam.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation='BEZIER'
                kp.handle_left_type='AUTO_CLAMPED'
                kp.handle_right_type='AUTO_CLAMPED'


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',required=True); ap.add_argument('--source-revision',required=True); args=ap.parse_args(argv)
    out=Path(args.output_dir).resolve(); frames=out/'shot_frames'; frames.mkdir(parents=True,exist_ok=True)
    scene=v35.build_v35_scene(out,args.source_revision)
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam is None: raise RuntimeError('missing_CAM_WIDE_INTERIOR')

    # 1.5 s physical establishing shot, 24 fps. Tiny human-held drift, not an advertising dolly.
    scene.render.fps=24; scene.frame_start=1; scene.frame_end=36
    scene.render.resolution_x=960; scene.render.resolution_y=540; scene.render.resolution_percentage=100
    scene.cycles.samples=12; scene.cycles.use_denoising=True
    scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
    cam.data.lens=24.0; cam.data.dof.use_dof=False

    key_camera(cam,1,(.030,-5.34,1.55),(-.05,2.20,1.10),-.06)
    key_camera(cam,12,(.012,-5.19,1.545),(-.045,2.27,1.095),.02)
    key_camera(cam,24,(-.010,-5.02,1.538),(-.050,2.34,1.09),-.03)
    key_camera(cam,36,(.006,-4.84,1.545),(-.040,2.42,1.085),.01)
    set_smooth_camera_fcurves(cam)

    scene.render.filepath=str(frames/'shot-frame-')
    shot_blend=out/'bien-anh-v35-shot.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(shot_blend))
    bpy.ops.render.render(animation=True)

    rendered=sorted(frames.glob('shot-frame-*.png'))
    if len(rendered)!=36:
        raise RuntimeError(f'expected_36_frames_got_{len(rendered)}')
    receipt={
        'schema':'daube.bien-anh.v35.physical-establishing-shot.v1',
        'status':'PHYSICAL_V35_ESTABLISHING_SHOT_FRAMES_PRODUCED_REVIEW_REQUIRED',
        'sourceRevision':args.source_revision,
        'shot':{
            'fps':24,'frames':36,'durationSeconds':1.5,'resolution':'960x540','cyclesSamples':12,
            'camera':'24mm subtle forward documentary drift','storyClock':'2026-06-14 06:12 Asia/Yangon',
        },
        'artifacts':{
            'blend':{'name':shot_blend.name,'bytes':shot_blend.stat().st_size,'sha256':sha256(shot_blend)},
            'firstFrame':{'name':rendered[0].name,'bytes':rendered[0].stat().st_size,'sha256':sha256(rendered[0])},
            'midFrame':{'name':rendered[len(rendered)//2].name,'bytes':rendered[len(rendered)//2].stat().st_size,'sha256':sha256(rendered[len(rendered)//2])},
            'lastFrame':{'name':rendered[-1].name,'bytes':rendered[-1].stat().st_size,'sha256':sha256(rendered[-1])},
        },
        'automaticPaidSpend':False,'promotionEligible':False,'fanOutEligible':False,
        'truthBoundary':'Environment-only V3.5 establishing shot. Review-required; no release/fan-out until visual, geography, socioeconomic and cultural QC pass.'
    }
    (out/'bien-anh-v35-shot-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False))

if __name__=='__main__': main()
