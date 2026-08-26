#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v29_fix.py'
spec=importlib.util.spec_from_file_location('bien_anh_v29_fix',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v29_fix:{P}')
v29fix=importlib.util.module_from_spec(spec); spec.loader.exec_module(v29fix)
v29=v29fix.v29; v28=v29.v28; v27=v29.v27; v26=v29.v26; v25=v29.v25; v24=v29.v24; pbr=v29.pbr; base=v29.base


def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def mat(name,color,rough=.8,metal=0.0): return base.solid_mat(name,color,rough,metal)
def box(name,loc,dims,material,bevel=0.0,rot=(0,0,0)): return base.box(name,loc,dims,material,bevel,rot)


def hide_prefixes(prefixes):
    for o in bpy.data.objects:
        if any(o.name.startswith(p) for p in prefixes):
            o.hide_render=True; o.hide_viewport=True


def add_hinged_door(name,yc,angle_deg,material,width=.72,height=1.90,xhinge=-.515):
    """Door leaf with centre derived from a real hinge line rather than rotating around its centre."""
    hinge_y=yc-width/2
    th=math.radians(angle_deg)
    cx=xhinge-math.sin(th)*(width/2)
    cy=hinge_y+math.cos(th)*(width/2)
    leaf=box(name,(cx,cy,height/2+.03),(.045,width,height),material,.008,(0,0,th))
    return leaf


def add_split_curtain(name,yc,material_a,material_b):
    # Two dense drapes leave a real narrow gap into the room.
    v29.add_drape_dense(name+'_A',(-.505,yc-.19,1.47),.30,1.02,material_a,.075,.3)
    v29.add_drape_dense(name+'_B',(-.505,yc+.19,1.47),.30,1.02,material_b,.065,1.2)


def add_practical(name,y,energy=52):
    white=mat(name+'_diffuser',(.72,.78,.78),.45)
    tube=box(name+'_TUBE',(0.02,y,2.17),(.055,.76,.035),white,.008)
    if tube.data.materials:
        m=tube.data.materials[0]; m.use_nodes=True
        bsdf=m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Emission Color'].default_value=(.66,.78,.80,1)
            bsdf.inputs['Emission Strength'].default_value=2.0
    bpy.ops.object.light_add(type='AREA',location=(0.02,y,2.08))
    lamp=bpy.context.object; lamp.name=name+'_SPILL'; lamp.data.energy=energy; lamp.data.shape='RECTANGLE'; lamp.data.size=.55; lamp.data.size_y=.16; lamp.data.color=(.72,.80,.80)
    base.point_at(lamp,(0.0,y,.8))


def add_room_depth_detail():
    dark=mat('V30 dark room detail',(.018,.019,.017),.98)
    woven=mat('V30 woven mat',(0.18,.12,.065),.94)
    metal=mat('V30 dull cooking metal',(.20,.21,.19),.52,.25)
    # Visible only through the split-curtain room 3.
    box('V30_ROOM3_MAT',(-.88,.35,.025),(.55,.56,.025),woven,.006,(0,0,math.radians(3)))
    box('V30_ROOM3_LOW_SHELF',(-1.10,.51,.28),(.28,.40,.045),dark,.004)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.085,depth=.105,location=(-1.09,.50,.36))
    pot=bpy.context.object; pot.name='V30_ROOM3_POT'; pot.data.materials.append(metal)


def add_utility_detail():
    metal=mat('V30 dull electrical box',(.10,.105,.095),.66,.18)
    cable=mat('V30 cable rubber',(.012,.013,.012),.97)
    box('V30_METER_BOX',(-.51,1.58,1.82),(.055,.20,.26),metal,.004)
    v28.add_sag_wire('V30_METER_DROP',[(-.49,1.58,1.95),(-.48,1.58,1.48),(-.49,1.66,1.12)],.005,cable)
    box('V30_SWITCH_BOX',(-.505,-3.10,1.32),(.05,.10,.14),metal,.003)


def add_contact_grime():
    grime=mat('V30 jamb contact grime',(.055,.045,.033),.99)
    for i,(y,z,sy,sz,phase) in enumerate([
        (-4.45,.50,.18,.24,.4),(-2.05,.48,.16,.22,1.0),(.35,.46,.18,.25,1.7),(2.75,.50,.17,.23,2.4)
    ],1):
        v27.add_irregular_grime(f'V30_GRIME_{i}',-.497,y,z,sy,sz,grime,phase)


def add_v30_details():
    # Remove flat-looking earlier door leaves and laundry panels that survived the previous passes.
    hide_prefixes((
        'V26_DOOR_LEAF_','V26_LATCH_','V26_ROOM_CURTAIN_3','V29_LAUNDRY_','V25_LAUNDRY_','V24_CLOTH_',
        'V26_TSHIRT_','V26_PANTS_','V26_TOWEL_','V27_MOSQUITO_NET_','V27_CURTAIN_'
    ))

    timber=bpy.data.materials.get('V29 metric weathered timber')
    if timber is None:
        timber=v29.metric_pbr('V30 fallback timber',v25.WOOD_MAPS,scale=(1.2,1.2,1.2),normal_strength=.45,rough_fallback=.89)
    darkpaint=mat('V30 dark faded painted timber',(.065,.075,.072),.91)
    curtain_a=mat('V30 faded curtain brown',(.14,.085,.055),.99)
    curtain_b=mat('V30 faded curtain beige',(.24,.20,.15),.99)

    # Door occupancy states are deliberately nonuniform.
    add_hinged_door('V30_DOOR_1',-4.45,0.0,timber)
    add_hinged_door('V30_DOOR_2',-2.05,-12.0,darkpaint)
    add_split_curtain('V30_ROOM3_CURTAIN',.35,curtain_a,curtain_b)
    add_hinged_door('V30_DOOR_4',2.75,4.0,timber)

    # Simple cheap handles/latches, physically attached to leaves.
    latch=mat('V30 latch metal',(.10,.105,.095),.62,.30)
    for i,(y,x) in enumerate([(-4.45,-.47),(-2.05,-.43),(2.75,-.46)],1):
        box(f'V30_LATCH_{i}',(x,y+.22,1.02),(.028,.11,.06),latch,.003)

    add_room_depth_detail()
    add_utility_detail()
    add_contact_grime()

    # Two weak fluorescent practicals still on at 06:12 after rain.
    add_practical('V30_FLUOR_A',-1.65,48)
    add_practical('V30_FLUOR_B',2.45,42)

    # Soft daylight remains dominant; practicals should not turn the corridor cinematic.
    base.add_area('V30_OPEN_DAYLIGHT',(2.6,.35,3.0),(0.0,.2,1.0),390,6.5,(.73,.79,.82))

    scene=bpy.context.scene
    scene.view_settings.look='AgX - Medium Low Contrast'; scene.view_settings.exposure=.52
    scene.cycles.samples=40; scene.cycles.use_denoising=True
    scene.render.resolution_x=1280; scene.render.resolution_y=720
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.data.dof.use_dof=False
        cam.data.lens=33.0
        cam.location=(-.015,-5.08,1.49)
        base.point_at(cam,(-.10,2.35,1.08))
        cam.rotation_euler[2]+=math.radians(-.08)


def patch_receipt(out:Path):
    path=out/'bien-anh-v23-public-bootstrap-receipt.json'; r=json.loads(path.read_text(encoding='utf-8'))
    r['schema']='daube.bien-anh.v30.structural-detail.v1'
    r['visualRetakeVersion']='BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V3.0'
    r['status']='PHYSICAL_WIDE_V30_STRUCTURAL_DETAIL_REALISM_PRODUCED_REVIEW_REQUIRED'
    r['qcRender']={'samples':40,'resolution':'1280x720','denoising':True,'purpose':'hinged-door + practical-light realism gate'}
    r['retakeTargets']=['hinge-correct-door-leaves','nonuniform-room-occupancy','split-curtain-room-depth','weak-fluorescent-practicals','utility-detail','contact-driven-grime','remove-flat-laundry-panels']
    r['automaticPaidSpend']=False; r['promotionEligible']=False; r['fanOutEligible']=False
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'
    r['artifacts']['blend']={'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}
    r['artifacts']['widePng']={'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    r['truthBoundary']='V3.0 physical WIDE candidate. Still review-required; no fan-out/location lock until visual/geography/socioeconomic/cultural QC passes.'
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',required=True); ap.add_argument('--source-revision',required=True); args=ap.parse_args(argv)
    v27.pbr.require_assets(); v25.require_v25_assets()
    out=Path(args.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    v27.pbr.base.build_scene(out,args.source_revision)
    v27.v24.add_reality_reconstruction(); v27.v25.add_v25_refinement(); v27.v26.rebuild_room_fronts(); v27.v26.add_threshold_life(); v27.v26.add_real_exterior_plate(); v27.v26.retune_camera_light(); v27.add_v27_documentary_refinement(); v28.add_v28_physical_edge()
    v29.retexture_large_surfaces(); v29.clean_and_repopulate(); v29.retune_scene(); add_v30_details()
    scene=bpy.context.scene; blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)
    v27.v26.patch_receipt(out); v28.patch_receipt(out); v29.patch_receipt(out); patch_receipt(out)
    print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))

if __name__=='__main__': main()
