#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
import mathutils

HERE = Path(__file__).resolve().parent
V26_PATH = HERE / 'bootstrap_scene_reality_v26.py'
spec = importlib.util.spec_from_file_location('bien_anh_v26', V26_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v26:{V26_PATH}')
v26 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v26)
v25 = v26.v25
v24 = v26.v24
pbr = v26.pbr
base = v26.base
HLAING_PHOTO = v26.HLAING_PHOTO


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def mat(name, color, rough=0.8, metal=0.0):
    return base.solid_mat(name, color, rough, metal)


def box(name, loc, dims, material, bevel=0.0, rot=(0.0, 0.0, 0.0)):
    return base.box(name, loc, dims, material, bevel, rot)


def hide(names=(), prefixes=(), contains=()):
    for obj in bpy.data.objects:
        if obj.name in names or any(obj.name.startswith(p) for p in prefixes) or any(s in obj.name for s in contains):
            obj.hide_render = True
            obj.hide_viewport = True


def add_side_photo_plate(name: str, image_path: Path, x=2.25, y0=-6.2, y1=6.2, z0=-0.25, z1=3.0):
    if not image_path.is_file():
        raise RuntimeError('missing_v27_hlaing_photo')
    mesh = bpy.data.meshes.new(name + '_MESH')
    verts = [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)]
    mesh.from_pydata(verts, [], [(0,1,2,3)])
    mesh.update()
    uv = mesh.uv_layers.new(name='UVMap')
    coords = [(0,0),(1,0),(1,1),(0,1)]
    for loop, coord in zip(uv.data, coords):
        loop.uv = coord
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    material = bpy.data.materials.new(name + '_MAT')
    material.use_nodes = True
    nt = material.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(image_path), check_existing=True)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    obj.data.materials.append(material)
    return obj


def add_sag_wire(name, points, radius, material):
    curve = bpy.data.curves.new(name + '_CURVE', type='CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for bp, p in zip(spline.bezier_points, points):
        bp.co = p
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def add_soft_sack(name, loc, scale, material, rot_z=0.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler[2] = math.radians(rot_z)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    bevel = obj.modifiers.new('softened-seams', 'BEVEL')
    bevel.width = 0.015
    bevel.segments = 2
    return obj


def add_open_basket(name, loc, scale, material):
    x,y,z = loc
    sx,sy,sz = scale
    box(name+'_BOTTOM', (x,y,z), (sx,sy,0.025), material, 0.006)
    box(name+'_L', (x-sx/2+0.018,y,z+sz/2), (0.035,sy,sz), material, 0.008)
    box(name+'_R', (x+sx/2-0.018,y,z+sz/2), (0.035,sy,sz), material, 0.008)
    box(name+'_F', (x,y-sy/2+0.018,z+sz/2), (sx,0.035,sz), material, 0.008)
    box(name+'_B', (x,y+sy/2-0.018,z+sz/2), (sx,0.035,sz), material, 0.008)


def add_irregular_grime(name, x, y, z, sy, sz, material, phase=0.0):
    pts=[]
    for i in range(10):
        a=2*math.pi*i/10 + phase
        ry=sy*(0.72+0.24*math.sin(i*1.7+phase))
        rz=sz*(0.68+0.28*math.cos(i*1.3-phase))
        pts.append((x, y+math.cos(a)*ry, z+math.sin(a)*rz))
    mesh=bpy.data.meshes.new(name+'_MESH')
    mesh.from_pydata(pts,[],[tuple(range(len(pts)))])
    mesh.update()
    obj=bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    solid=obj.modifiers.new('thin-grime','SOLIDIFY')
    solid.thickness=0.002
    return obj


def add_v27_documentary_refinement():
    hide(
        prefixes=(
            'V24_BUCKET','V24_BOTTLE','V24_BASIN','V24_STOOL','V24_WET','V25_BUCKET','V25_BASIN',
            'V25_STOOL','V25_BOTTLE','V26_THRESHOLD_SLIPPER','V26_HLAING_CC0_SET_EXTENSION'
        ),
        contains=('SPHERE','ROUND_PROP')
    )

    for idx in (2,4,6,8):
        obj=bpy.data.objects.get(f'V24_CORR_PARTITION_{idx:02d}')
        if obj:
            obj.hide_render=True
            obj.hide_viewport=True

    add_side_photo_plate('V27_HLAING_SIDE_SET_EXTENSION', HLAING_PHOTO)

    rubber=mat('V27 aged cable rubber',(0.012,0.013,0.012),0.96)
    sack=mat('V27 woven rice sack',(0.28,0.25,0.18),0.97)
    plastic=mat('V27 faded plastic basket',(0.055,0.18,0.19),0.83)
    grime=mat('V27 contact grime',(0.055,0.045,0.032),0.99)
    curtain=mat('V27 washed floral curtain base',(0.18,0.13,0.10),0.98)
    mosquito=mat('V27 mosquito net',(0.37,0.40,0.34),0.99)

    add_sag_wire('V27_MAIN_SAG_WIRE',[(-0.47,-5.3,2.06),(-0.50,-1.8,1.94),(-0.46,1.8,2.02),(-0.48,5.0,1.91)],0.0065,rubber)
    add_sag_wire('V27_RIGHT_SAG_WIRE',[(0.47,-4.7,2.01),(0.44,-1.0,1.88),(0.48,2.8,1.96)],0.0055,rubber)

    add_soft_sack('V27_RICE_SACK_A',(-0.39,-3.25,0.18),(0.17,0.24,0.28),sack,-7)
    add_soft_sack('V27_LAUNDRY_BAG_A',(0.35,1.38,0.16),(0.16,0.22,0.24),curtain,11)
    add_open_basket('V27_OPEN_BASKET_A',(0.32,-1.22,0.03),(0.30,0.36,0.20),plastic)

    v24.add_drape('V27_MOSQUITO_NET_ROOM_2',(-0.49,-2.05,1.44),0.62,1.05,mosquito,0.10,-1.5)
    v24.add_drape('V27_CURTAIN_ROOM_4',(-0.49,2.76,1.48),0.58,0.98,curtain,0.08,2.2)

    for i,(y,z,sy,sz,ph) in enumerate([
        (-4.45,0.55,0.18,0.25,0.2),(-2.05,0.45,0.22,0.20,0.8),(0.35,0.52,0.20,0.26,1.3),(2.75,0.48,0.24,0.22,2.0)
    ],1):
        add_irregular_grime(f'V27_JAMB_GRIME_{i}',-0.515,y,z,sy,sz,grime,ph)

    for i,(x,y,sy,sz) in enumerate([(0.22,-3.0,0.24,0.14),(0.18,-0.4,0.18,0.12),(0.20,3.6,0.28,0.16)],1):
        add_irregular_grime(f'V27_FLOOR_DAMP_{i}',x,y,0.007,sy,sz,mat('V27 damp concrete '+str(i),(0.055,0.058,0.052),0.48),0.4*i)

    scene=bpy.context.scene
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.location=(0.00,-5.15,1.53)
        cam.data.lens=30.0
        base.point_at(cam,(-0.10,2.35,1.10))
        cam.rotation_euler[2]+=math.radians(-0.35)

    scene.view_settings.look='AgX - Medium Low Contrast'
    scene.view_settings.exposure=0.62
    scene.cycles.samples=48
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1280
    scene.render.resolution_y=720
    if scene.world and scene.world.use_nodes:
        bg=scene.world.node_tree.nodes.get('Background')
        if bg:
            bg.inputs['Strength'].default_value=0.68

    base.add_area('V27_OVERCAST_SIDE',(3.4,-0.3,3.2),(0.0,0.2,1.0),760,6.0,(0.73,0.80,0.84))


def patch_receipt(out: Path):
    path=out/'bien-anh-v23-public-bootstrap-receipt.json'
    receipt=json.loads(path.read_text(encoding='utf-8'))
    receipt['schema']='daube.bien-anh.v27.documentary-realism.v1'
    receipt['visualRetakeVersion']='BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V2.7'
    receipt['status']='PHYSICAL_WIDE_V27_DOCUMENTARY_REALISM_PRODUCED_REVIEW_REQUIRED'
    receipt['qcRender']={'samples':48,'resolution':'1280x720','denoising':True,'purpose':'fast realism gate before final-sample render'}
    receipt['retakeTargets']=[
        'remove-obvious-primitive-props','irregular-openings-with-real-location-depth','soft-household-items',
        'sagging-utility-wires','occupied-room-curtain-net-depth','contact-driven-grime','documentary-camera-not-archviz',
        '0612-overcast-broad-daylight'
    ]
    receipt['automaticPaidSpend']=False
    receipt['promotionEligible']=False
    receipt['fanOutEligible']=False
    blend=out/'bien-anh-v23-public-bootstrap.blend'
    png=out/'plate-wide-interior-v23-public-bootstrap.png'
    receipt['artifacts']['blend']={'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}
    receipt['artifacts']['widePng']={'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    receipt['truthBoundary']='V2.7 documentary-realism fast physical WIDE QC candidate. Still review-required; no fan-out/location lock until geography + socioeconomic + cultural + visual QC passes.'
    path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser=argparse.ArgumentParser()
    parser.add_argument('--output-dir',required=True)
    parser.add_argument('--source-revision',required=True)
    args=parser.parse_args(argv)

    pbr.require_assets()
    v25.require_v25_assets()
    out=Path(args.output_dir).resolve()
    out.mkdir(parents=True,exist_ok=True)

    pbr.base.build_scene(out,args.source_revision)
    v24.add_reality_reconstruction()
    v25.add_v25_refinement()
    v26.rebuild_room_fronts()
    v26.add_threshold_life()
    v26.add_real_exterior_plate()
    v26.retune_camera_light()
    add_v27_documentary_refinement()

    scene=bpy.context.scene
    blend=out/'bien-anh-v23-public-bootstrap.blend'
    png=out/'plate-wide-interior-v23-public-bootstrap.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    scene.render.filepath=str(png)
    bpy.ops.render.render(write_still=True)
    v26.patch_receipt(out)
    patch_receipt(out)
    print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))


if __name__=='__main__':
    main()
