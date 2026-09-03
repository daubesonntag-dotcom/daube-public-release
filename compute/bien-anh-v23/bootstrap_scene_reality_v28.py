#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v27.py'
spec=importlib.util.spec_from_file_location('bien_anh_v27',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v27:{P}')
v27=importlib.util.module_from_spec(spec); spec.loader.exec_module(v27)
v26=v27.v26; v25=v27.v25; v24=v27.v24; pbr=v27.pbr; base=v27.base
ASSETS_DIR=HERE/'assets_runtime'
HDRI=ASSETS_DIR/'overcast_soil_puresky_1k.hdr'


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


def add_sag_wire(name,pts,radius,material):
    c=bpy.data.curves.new(name+'_CURVE','CURVE'); c.dimensions='3D'; c.bevel_depth=radius; c.bevel_resolution=2
    s=c.splines.new('BEZIER'); s.bezier_points.add(len(pts)-1)
    for bp,p in zip(s.bezier_points,pts):
        bp.co=p; bp.handle_left_type='AUTO'; bp.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c); bpy.context.collection.objects.link(o); o.data.materials.append(material); return o


def add_distant_cloth(name,loc,w,h,material,sag=.05,rot=0):
    return v24.add_drape(name,loc,w,h,material,sag,rot)


def configure_hdri():
    if not HDRI.is_file() or HDRI.stat().st_size<10000:
        raise RuntimeError('missing_overcast_hdri')
    world=bpy.context.scene.world or bpy.data.worlds.new('WORLD')
    world.use_nodes=True
    nt=world.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out=nt.nodes.new('ShaderNodeOutputWorld')
    bg=nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value=.42
    env=nt.nodes.new('ShaderNodeTexEnvironment'); env.image=bpy.data.images.load(str(HDRI),check_existing=True)
    mapping=nt.nodes.new('ShaderNodeMapping'); tex=nt.nodes.new('ShaderNodeTexCoord')
    mapping.inputs['Rotation'].default_value[2]=math.radians(135)
    nt.links.new(tex.outputs['Generated'],mapping.inputs['Vector']); nt.links.new(mapping.outputs['Vector'],env.inputs['Vector'])
    nt.links.new(env.outputs['Color'],bg.inputs['Color']); nt.links.new(bg.outputs['Background'],out.inputs['Surface'])
    bpy.context.scene.world=world


def configure_subtle_compositor(scene):
    """Very small optical integration, using version-correct socket direction."""
    scene.render.use_compositing=True
    if bpy.app.version >= (5,0,0):
        nt=bpy.data.node_groups.new('V28_COMPOSITOR','CompositorNodeTree')
        scene.compositing_node_group=nt
        rl=nt.nodes.new('CompositorNodeRLayers')
        lens=nt.nodes.new('CompositorNodeLensdist')
        lens.inputs['Distortion'].default_value=.004
        lens.inputs['Dispersion'].default_value=.001
        comp=nt.nodes.new('NodeGroupOutput')
        nt.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
        nt.links.new(rl.outputs['Image'],lens.inputs['Image'])
        nt.links.new(lens.outputs['Image'],comp.inputs['Image'])
        return
    scene.use_nodes=True
    nt=scene.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    rl=nt.nodes.new('CompositorNodeRLayers')
    lens=nt.nodes.new('CompositorNodeLensdist'); lens.inputs['Distortion'].default_value=.004; lens.inputs['Dispersion'].default_value=.001
    comp=nt.nodes.new('CompositorNodeComposite')
    nt.links.new(rl.outputs['Image'],lens.inputs['Image']); nt.links.new(lens.outputs['Image'],comp.inputs['Image'])


def add_v28_physical_edge():
    hide_prefixes((
        'V27_HLAING_SIDE_SET_EXTENSION','V26_HLAING_CC0_SET_EXTENSION',
        'V24_SLIPPER_','V24_BUCKET_','V24_BASIN','V24_REUSED_WATER_','V24_FAN_','V24_COOK_POT',
        'V24_STORAGE_CRATE','V24_DAMP_ZONE_','V27_RICE_SACK','V27_LAUNDRY_BAG','V27_OPEN_BASKET',
        'V24_FAR_SERVICE_WALL','V24_FAR_CORR_GATE'
    ))

    concrete=pbr.pbr_material('V28 exterior dirty concrete',pbr.PBR['floor'],scale=(1.4,5.0,1),normal_strength=.34,rough_fallback=.90)
    plaster=pbr.pbr_material('V28 exterior patched plaster',pbr.PBR['wall'],scale=(1.2,3.5,1),normal_strength=.38,rough_fallback=.92)
    corr=pbr.pbr_material('V28 corrugated service roof',pbr.PBR['roof'],scale=(4.5,1.2,1),normal_strength=.72,rough_fallback=.73,metallic=.16)
    wood=pbr.pbr_material('V28 weathered timber',v25.WOOD_MAPS,scale=(1.4,2.4,1.0),normal_strength=.52,rough_fallback=.88)
    v25.brighten_pbr(wood,1.14,.90)
    rubber=mat('V28 cable rubber',(0.012,0.013,0.012),.97)
    cloth_a=mat('V28 faded laundry blue',(0.065,0.10,0.12),.98)
    cloth_b=mat('V28 faded laundry beige',(0.26,0.22,0.17),.98)
    drain=mat('V28 drain dark concrete',(0.03,0.035,0.032),.94)

    box('V28_SERVICE_GROUND',(2.35,0,-.10),(3.6,12.5,.18),concrete,.015)
    box('V28_DRAIN_CHANNEL',(0.86,0,-.015),(.22,11.5,.09),drain,.01)

    sheds=[
        (2.15,-3.85,1.25,2.0,2.05,1.72,-2.0),
        (3.05,-.85,1.35,2.45,2.25,1.88,1.4),
        (2.35,2.85,1.22,2.15,2.05,1.68,-1.1),
    ]
    for i,(x,y,z,w,d,h,rz) in enumerate(sheds,1):
        box(f'V28_SHED_WALL_{i}',(x,y,h/2-.02),(w,d,h),plaster,.008,(0,0,math.radians(rz)))
        box(f'V28_SHED_ROOF_{i}',(x,y,h+.07),(w+.28,d+.35,.065),corr,.004,(0,math.radians((i-2)*1.3),math.radians(rz)))
        dark=mat(f'V28_SHED_DARK_{i}',(.012,.013,.012),.99)
        box(f'V28_SHED_DOOR_{i}',(x-.01,y-d*.49,h*.48),(.58,.045,h*.88),dark,.002,(0,0,math.radians(rz)))
        box(f'V28_SHED_LINTEL_{i}',(x-.01,y-d*.50,h*.93),(.72,.07,.07),wood,.004,(0,0,math.radians(rz)))

    for i,(x,y) in enumerate([(1.25,-5.1),(3.85,-1.6),(1.45,4.6)],1):
        box(f'V28_UTILITY_POST_{i}',(x,y,1.65),(.085,.085,3.3),wood,.006)
    add_sag_wire('V28_EXT_WIRE_A',[(1.25,-5.1,2.65),(2.25,-3.2,2.43),(3.85,-1.6,2.62)],.006,rubber)
    add_sag_wire('V28_EXT_WIRE_B',[(3.85,-1.6,2.40),(2.9,1.6,2.20),(1.45,4.6,2.38)],.005,rubber)

    add_distant_cloth('V28_EXT_CLOTH_A',(1.55,-2.65,1.38),.32,.44,cloth_a,.04,-2)
    add_distant_cloth('V28_EXT_CLOTH_B',(2.90,2.25,1.28),.38,.50,cloth_b,.04,1.5)

    repair=mat('V28 floor repair',(0.12,0.115,0.10),.93)
    box('V28_REPAIR_STRIP_A',(0.18,-1.8,.012),(.12,.82,.018),repair,.003,(0,0,math.radians(4)))
    box('V28_REPAIR_STRIP_B',(-.15,2.65,.012),(.10,.64,.018),repair,.003,(0,0,math.radians(-6)))

    for o in bpy.data.objects:
        if o.type=='LIGHT' and not o.name.startswith('V28'):
            o.hide_render=True; o.hide_viewport=True
    base.add_area('V28_OPENING_BOUNCE',(2.0,.2,2.8),(0,.3,1.0),260,5.0,(.72,.78,.82))

    configure_hdri()
    scene=bpy.context.scene
    scene.view_settings.look='AgX - Medium Low Contrast'; scene.view_settings.exposure=.20
    scene.cycles.samples=24; scene.cycles.use_denoising=True
    scene.render.resolution_x=1280; scene.render.resolution_y=720
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.location=(-.03,-5.12,1.52); cam.data.lens=31.0; base.point_at(cam,(-.08,2.15,1.08)); cam.rotation_euler[2]+=math.radians(-.22)
        cam.data.dof.use_dof=True; cam.data.dof.focus_distance=6.2; cam.data.dof.aperture_fstop=6.3

    configure_subtle_compositor(scene)


def patch_receipt(out:Path):
    path=out/'bien-anh-v23-public-bootstrap-receipt.json'; r=json.loads(path.read_text(encoding='utf-8'))
    r['schema']='daube.bien-anh.v28.physical-industrial-edge.v2'
    r['visualRetakeVersion']='BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V2.8'
    r['status']='PHYSICAL_WIDE_V28_INDUSTRIAL_EDGE_REALISM_PRODUCED_REVIEW_REQUIRED'
    r['qcRender']={'samples':24,'resolution':'1280x720','denoising':True,'purpose':'physical realism gate'}
    r['retakeTargets']=['no-photo-card-set-extension','physical-service-edge-depth','remove-primitive-clutter','real-overcast-hdri-light','low-cost-shed-morphology','drainage-and-utility-logic','subtle-documentary-optics']
    r['hdri']={'asset':'overcast_soil_puresky','provider':'Poly Haven','license':'CC0','file':HDRI.name,'sha256':sha256(HDRI),'bytes':HDRI.stat().st_size}
    r['automaticPaidSpend']=False; r['promotionEligible']=False; r['fanOutEligible']=False
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'
    r['artifacts']['blend']={'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}
    r['artifacts']['widePng']={'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    r['truthBoundary']='V2.8 physical industrial-edge realism WIDE candidate. Still review-required; no fan-out/location lock until visual/geography/socioeconomic/cultural QC passes.'
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser(); p.add_argument('--output-dir',required=True); p.add_argument('--source-revision',required=True); args=p.parse_args(argv)
    v27.pbr.require_assets(); v27.v25.require_v25_assets()
    out=Path(args.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    v27.pbr.base.build_scene(out,args.source_revision); v27.v24.add_reality_reconstruction(); v27.v25.add_v25_refinement(); v27.v26.rebuild_room_fronts(); v27.v26.add_threshold_life(); v27.v26.add_real_exterior_plate(); v27.v26.retune_camera_light(); v27.add_v27_documentary_refinement(); add_v28_physical_edge()
    scene=bpy.context.scene; blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)
    v27.v26.patch_receipt(out); patch_receipt(out); print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))

if __name__=='__main__': main()
