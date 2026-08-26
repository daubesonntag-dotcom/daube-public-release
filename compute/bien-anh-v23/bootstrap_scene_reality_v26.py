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

HERE = Path(__file__).resolve().parent
V25_PATH = HERE / 'bootstrap_scene_reality_v25.py'
spec = importlib.util.spec_from_file_location('bien_anh_v25', V25_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v25:{V25_PATH}')
v25 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v25)
v24 = v25.v24
pbr = v25.pbr
base = v25.base

ASSETS_DIR = HERE / 'assets_runtime'
HLAING_PHOTO = ASSETS_DIR / 'hlaing_thar_yar_hut_cc0_1600.jpg'


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


def hide(names=(), prefixes=()):
    for obj in bpy.data.objects:
        if obj.name in names or any(obj.name.startswith(p) for p in prefixes):
            obj.hide_render = True
            obj.hide_viewport = True


def add_uv_photo_card(name, image_path: Path, y=10.35, width=6.2, height=4.1, z0=-0.15):
    mesh = bpy.data.meshes.new(name + '_MESH')
    verts = [(-width/2, y, z0), (width/2, y, z0), (width/2, y, z0+height), (-width/2, y, z0+height)]
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
    emission = nt.nodes.new('ShaderNodeEmission')
    emission.inputs['Strength'].default_value = 0.62
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(str(image_path), check_existing=True)
    nt.links.new(tex.outputs['Color'], emission.inputs['Color'])
    nt.links.new(emission.outputs['Emission'], out.inputs['Surface'])
    obj.data.materials.append(material)
    return obj


def add_tshirt(name, x, y, z, width, height, material, rot=0.0):
    # Flat garment silhouette with sleeves, not a decorative rectangle.
    w = width / 2
    h = height
    pts_yz = [
        (-w*0.38, h*0.50), (-w*0.95, h*0.28), (-w*0.72, h*0.08),
        (-w*0.42, h*0.18), (-w*0.36, -h*0.50), (w*0.36, -h*0.50),
        (w*0.42, h*0.18), (w*0.72, h*0.08), (w*0.95, h*0.28), (w*0.38, h*0.50),
    ]
    verts = [(x, y + yy, z + zz) for yy, zz in pts_yz]
    mesh = bpy.data.meshes.new(name + '_MESH')
    mesh.from_pydata(verts, [], [tuple(range(len(verts)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.rotation_euler[0] = math.radians(rot)
    solid = obj.modifiers.new('cloth-thickness', 'SOLIDIFY')
    solid.thickness = 0.003
    return obj


def add_pants(name, x, y, z, width, height, material, rot=0.0):
    w = width / 2
    h = height
    pts = [
        (-w, h/2), (w, h/2), (w*0.88, -h/2), (w*0.14, -h/2),
        (0, -h*0.05), (-w*0.14, -h/2), (-w*0.88, -h/2),
    ]
    verts = [(x, y + yy, z + zz) for yy, zz in pts]
    mesh = bpy.data.meshes.new(name + '_MESH')
    mesh.from_pydata(verts, [], [tuple(range(len(verts)))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.rotation_euler[0] = math.radians(rot)
    solid = obj.modifiers.new('cloth-thickness', 'SOLIDIFY')
    solid.thickness = 0.003
    return obj


def rebuild_room_fronts():
    # V2.5 physical evidence showed a flat plaster slab with decorative door-like panels.
    # Rebuild as real wall segments with actual gaps, jambs, thresholds and room depth.
    hide(
        names=('LEFT_WALL',),
        prefixes=('DOOR_', 'FRAME_', 'DOOR_RAIL_', 'LATCH_', 'HANDLE_', 'HAND_GRIME_',
                  'WALL_REPAIR_', 'HUMIDITY_STAIN_', 'V24_CLOTH_', 'V25_LAUNDRY_')
    )

    plaster = bpy.data.materials.get('V24 dirty patched inner plaster')
    wood = bpy.data.materials.get('V25 weathered plank repair')
    corr = bpy.data.materials.get('V24 worn corrugated partition')
    if not plaster or not wood or not corr:
        raise RuntimeError('v26_expected_materials_missing')
    dark_room = mat('V26 unlit room interior', (0.012, 0.013, 0.012), 0.98)
    threshold = mat('V26 worn threshold concrete', (0.12, 0.11, 0.09), 0.90)
    latch = mat('V26 cheap latch metal', (0.10, 0.105, 0.095), 0.60, 0.32)

    xwall = -0.58
    door_centers = [-4.45, -2.05, 0.35, 2.75]
    door_w = 0.78
    y_min, y_max = -6.0, 6.0
    cursor = y_min
    for idx, yc in enumerate(door_centers, 1):
        gap_start = yc - door_w/2
        seg_len = gap_start - cursor
        if seg_len > 0.04:
            box(f'V26_WALL_SEG_{idx:02d}', (xwall, cursor + seg_len/2, 1.18), (0.09, seg_len, 2.36), plaster, 0.004)
        cursor = yc + door_w/2
    if y_max - cursor > 0.04:
        box('V26_WALL_SEG_END', (xwall, cursor + (y_max-cursor)/2, 1.18), (0.09, y_max-cursor, 2.36), plaster, 0.004)

    for idx, yc in enumerate(door_centers, 1):
        # Dark room volume behind each physical opening.
        box(f'V26_ROOM_BACK_{idx}', (-1.28, yc, 1.05), (0.08, 0.72, 2.10), dark_room, 0.0)
        box(f'V26_ROOM_SIDE_A_{idx}', (-0.92, yc-door_w/2, 1.05), (0.72, 0.05, 2.10), dark_room, 0.0)
        box(f'V26_ROOM_SIDE_B_{idx}', (-0.92, yc+door_w/2, 1.05), (0.72, 0.05, 2.10), dark_room, 0.0)
        box(f'V26_ROOM_FLOOR_{idx}', (-0.92, yc, 0.01), (0.72, door_w, 0.03), threshold, 0.003)

        box(f'V26_JAMB_A_{idx}', (-0.535, yc-door_w/2, 1.02), (0.06, 0.055, 2.04), wood, 0.004)
        box(f'V26_JAMB_B_{idx}', (-0.535, yc+door_w/2, 1.02), (0.06, 0.055, 2.04), wood, 0.004)
        box(f'V26_HEADER_{idx}', (-0.535, yc, 2.02), (0.06, door_w+0.10, 0.07), wood, 0.004)
        box(f'V26_THRESHOLD_{idx}', (-0.52, yc, 0.035), (0.16, door_w, 0.07), threshold, 0.006)

        # Three closed/ajar leaves and one curtain-like opening create nonuniform use.
        if idx != 3:
            leaf = box(f'V26_DOOR_LEAF_{idx}', (-0.50, yc, 1.00), (0.045, door_w-0.08, 1.92), wood, 0.006)
            angle = {1: 0.0, 2: -7.0, 4: 3.0}[idx]
            leaf.rotation_euler[2] = math.radians(angle)
            box(f'V26_LATCH_{idx}', (-0.47, yc+0.23, 1.00), (0.025, 0.12, 0.07), latch, 0.003)
        else:
            curtain_mat = mat('V26 faded room curtain', (0.16, 0.10, 0.07), 0.98)
            v24.add_drape('V26_ROOM_CURTAIN_3', (-0.50, yc, 1.46), door_w-0.12, 1.05, curtain_mat, 0.055, 0.0)

    # A few mismatched corrugated repair patches around openings.
    for i, (yc, z, sy, sz) in enumerate([(-3.25,0.55,0.42,0.62),(-0.86,1.42,0.32,0.38),(1.55,0.54,0.40,0.58),(3.90,1.30,0.36,0.42)],1):
        box(f'V26_CORR_WALL_PATCH_{i}', (-0.525, yc, z), (0.025, sy, sz), corr, 0.003, (0,0,math.radians((i%2)*1.2-0.6)))


def add_threshold_life():
    rubber = mat('V26 slipper rubber', (0.018,0.019,0.017), 0.96)
    cloth1 = mat('V26 shirt muted red', (0.18,0.055,0.045), 0.98)
    cloth2 = mat('V26 shirt washed teal', (0.045,0.14,0.14), 0.98)
    cloth3 = mat('V26 pants dark navy', (0.03,0.045,0.065), 0.98)
    cloth4 = mat('V26 towel beige', (0.27,0.22,0.16), 0.98)

    # Cluster footwear by actual door thresholds instead of even corridor scatter.
    for i, (x,y,r) in enumerate([
        (-0.38,-4.28,8),(-0.28,-4.08,-10),(-0.39,-1.88,5),(-0.30,-1.68,-7),
        (-0.38,0.54,11),(-0.28,2.92,-6),(-0.38,3.10,7),
    ],1):
        v24.add_slipper(f'V26_THRESHOLD_SLIPPER_{i}', (x,y,0.034), rubber, r)

    # Garment silhouettes instead of rectangular color cards.
    add_tshirt('V26_TSHIRT_A', -0.49, -3.45, 1.54, 0.42, 0.55, cloth1, -2)
    add_tshirt('V26_TSHIRT_B', -0.49, -0.75, 1.50, 0.38, 0.50, cloth2, 2)
    add_pants('V26_PANTS_A', 0.46, 1.72, 1.52, 0.34, 0.62, cloth3, -1)
    v24.add_drape('V26_TOWEL_A', (-0.49, 3.68, 1.48), 0.36, 0.50, cloth4, 0.045, 1.5)

    # Narrow simple clothes lines, no gibberish signage.
    box('V26_LINE_LEFT', (-0.47, -1.45, 1.95), (0.015, 5.0, 0.015), rubber, 0.0)
    box('V26_LINE_RIGHT', (0.45, 1.30, 1.92), (0.015, 3.2, 0.015), rubber, 0.0)


def add_real_exterior_plate():
    if not HLAING_PHOTO.is_file() or HLAING_PHOTO.stat().st_size < 10000:
        raise RuntimeError('missing_hlaing_cc0_photo')
    # Keep 3D sheds in front so the photograph is only a distant set extension, not a fake full scene.
    add_uv_photo_card('V26_HLAING_CC0_SET_EXTENSION', HLAING_PHOTO, y=10.42, width=6.5, height=4.3, z0=-0.18)


def retune_camera_light():
    scene = bpy.context.scene
    cam = bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.location = (0.05,-5.30,1.45)
        cam.data.lens = 27.0
        base.point_at(cam, (-0.06,2.50,1.02))
        cam.rotation_euler[2] += math.radians(0.12)

    # V2.6 keeps daylight documentary-neutral; no crushed blacks.
    scene.view_settings.look = 'AgX - Medium Low Contrast'
    scene.view_settings.exposure = 0.36
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    if scene.world and scene.world.use_nodes:
        bg = scene.world.node_tree.nodes.get('Background')
        if bg:
            bg.inputs['Strength'].default_value = 0.52


def patch_receipt(out: Path):
    path = out / 'bien-anh-v23-public-bootstrap-receipt.json'
    receipt = json.loads(path.read_text(encoding='utf-8'))
    receipt['schema'] = 'daube.bien-anh.v26.structural-realism.v1'
    receipt['visualRetakeVersion'] = 'BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V2.6'
    receipt['status'] = 'PHYSICAL_WIDE_V26_STRUCTURAL_REALISM_PRODUCED_REVIEW_REQUIRED'
    receipt['passageMorphology'] = 'NARROW_MAKESHIFT_PRIVATE_HOSTEL_WITH_PHYSICAL_ROOM_OPENINGS'
    receipt['retakeTargets'] = [
        'physical-room-openings-not-flat-panels',
        'recessed-room-depth',
        'threshold-clutter-motivated-by-occupancy',
        'garment-silhouettes-not-color-cards',
        'real-hlaing-thar-yar-cc0-distant-set-extension',
        '0612-daylight-no-crushed-blacks',
        'documentary-not-archviz',
    ]
    receipt['cc0LocationSetExtension'] = {
        'source': 'Wikimedia Commons',
        'title': 'Hut at Yangon Suburb Hlaing Thar Yar.JPG',
        'license': 'CC0 1.0',
        'author': 'mydaydream89',
        'sourcePage': 'https://commons.wikimedia.org/wiki/File:Hut_at_Yangon_Suburb_Hlaing_Thar_Yar.JPG',
        'filename': HLAING_PHOTO.name,
        'sha256': sha256(HLAING_PHOTO),
        'bytes': HLAING_PHOTO.stat().st_size,
        'use': 'distant exterior set-extension only; foreground hostel remains physical Blender geometry',
    }
    receipt['camera'] = {'role':'PLATE-WIDE-INTERIOR','lensMm':27.0,'heightM':1.45}
    receipt['automaticPaidSpend'] = False
    receipt['promotionEligible'] = False
    receipt['fanOutEligible'] = False
    blend = out / 'bien-anh-v23-public-bootstrap.blend'
    png = out / 'plate-wide-interior-v23-public-bootstrap.png'
    receipt['artifacts']['blend'] = {'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}
    receipt['artifacts']['widePng'] = {'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    receipt['truthBoundary'] = 'V2.6 structural-reality physical WIDE candidate. Still review-required; no fan-out/location lock until Founder + geography + socioeconomic + cultural QC passes.'
    path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir',required=True)
    parser.add_argument('--source-revision',required=True)
    args = parser.parse_args(argv)

    pbr.require_assets()
    v25.require_v25_assets()
    out = Path(args.output_dir).resolve()
    out.mkdir(parents=True,exist_ok=True)

    pbr.base.build_scene(out,args.source_revision)
    v24.add_reality_reconstruction()
    v25.add_v25_refinement()
    rebuild_room_fronts()
    add_threshold_life()
    add_real_exterior_plate()
    retune_camera_light()

    scene = bpy.context.scene
    blend = out / 'bien-anh-v23-public-bootstrap.blend'
    png = out / 'plate-wide-interior-v23-public-bootstrap.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    scene.render.filepath = str(png)
    bpy.ops.render.render(write_still=True)
    patch_receipt(out)
    print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))


if __name__ == '__main__':
    main()
