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
PBR_PATH = HERE / 'bootstrap_scene_pbr.py'
spec = importlib.util.spec_from_file_location('bien_anh_v23_pbr', PBR_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_pbr:{PBR_PATH}')
pbr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pbr)
base = pbr.base

REALITY_VERSION = 'BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V2.4'
REFERENCE_CLASS = 'DOCUMENTED_MIGRANT_PRIVATE_HOSTEL_MAKESHIFT_PASSAGE'


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


def cyl(name, loc, radius, depth, material, rot=(0.0, 0.0, 0.0), vertices=24):
    return base.cyl(name, loc, radius, depth, material, rot, vertices)


def hide_prefixes(prefixes):
    for obj in bpy.data.objects:
        if any(obj.name.startswith(p) for p in prefixes):
            obj.hide_render = True
            obj.hide_viewport = True


def corrugated_panel_material():
    return pbr.pbr_material(
        'V24 worn corrugated partition',
        pbr.PBR['roof'],
        scale=(3.0, 1.3, 1.0),
        normal_strength=0.78,
        rough_fallback=0.74,
        metallic=0.12,
    )


def timber_material():
    return base.noise_mat(
        'V24 rough repaired timber',
        (0.045, 0.028, 0.015),
        (0.18, 0.095, 0.035),
        7.0,
        3.0,
        0.90,
        0.12,
    )


def tarp_material(name, color, rough=0.58):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = 0.0
    return m


def add_irregular_sheet(name, x, y, z, width_y, height_z, material, tilt=0.0, dent=0.0):
    # A lightly irregular four-corner sheet reads less like perfect CAD than a cube.
    verts = [
        (x, y - width_y / 2, z - height_z / 2),
        (x + dent, y + width_y / 2, z - height_z / 2 + 0.015),
        (x - dent * 0.6, y + width_y / 2, z + height_z / 2),
        (x + dent * 0.4, y - width_y / 2, z + height_z / 2 - 0.02),
    ]
    mesh = bpy.data.meshes.new(name + '_MESH')
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.rotation_euler[1] = math.radians(tilt)
    solid = obj.modifiers.new('thin-sheet', 'SOLIDIFY')
    solid.thickness = 0.012
    solid.offset = 0.0
    bevel = obj.modifiers.new('edge-wear', 'BEVEL')
    bevel.width = 0.004
    bevel.segments = 1
    return obj


def add_drape(name, loc, width, height, material, sag=0.06, rotation_z=0.0):
    x, y, z = loc
    cols = 5
    rows = 5
    verts = []
    faces = []
    for r in range(rows):
        vz = z + height * (0.5 - r / (rows - 1))
        for c in range(cols):
            vy = y + width * (c / (cols - 1) - 0.5)
            wave = math.sin(c / (cols - 1) * math.pi) * sag
            vx = x + wave * (0.45 + 0.55 * r / (rows - 1))
            verts.append((vx, vy, vz))
    for r in range(rows - 1):
        for c in range(cols - 1):
            i = r * cols + c
            faces.append((i, i + 1, i + 1 + cols, i + cols))
    mesh = bpy.data.meshes.new(name + '_MESH')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.rotation_euler[2] = math.radians(rotation_z)
    solid = obj.modifiers.new('cloth-thickness', 'SOLIDIFY')
    solid.thickness = 0.003
    return obj


def add_tapered_bucket(name, loc, radius, height, material):
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=radius * 0.92, radius2=radius, depth=height, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    bevel = obj.modifiers.new('bucket-lip', 'BEVEL')
    bevel.width = 0.008
    bevel.segments = 2
    return obj


def add_bottle(name, loc, material, scale=1.0):
    x, y, z = loc
    body = cyl(name + '_BODY', (x, y, z), 0.038 * scale, 0.22 * scale, material, vertices=32)
    cyl(name + '_NECK', (x, y, z + 0.135 * scale), 0.019 * scale, 0.07 * scale, material, vertices=24)
    cap = mat(name + '_CAP_MAT', (0.18, 0.06, 0.025), 0.58)
    cyl(name + '_CAP', (x, y, z + 0.177 * scale), 0.021 * scale, 0.018 * scale, cap, vertices=24)
    return body


def add_slipper(name, loc, material, rot_deg=0.0):
    x, y, z = loc
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=10, location=(x, y, z))
    sole = bpy.context.object
    sole.name = name
    sole.scale = (0.07, 0.14, 0.017)
    sole.rotation_euler[2] = math.radians(rot_deg)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sole.data.materials.append(material)
    strap = box(name + '_STRAP', (x, y + 0.015, z + 0.025), (0.09, 0.05, 0.015), material, 0.012, (0, 0, math.radians(rot_deg)))
    return sole, strap


def add_reality_reconstruction():
    scene = bpy.context.scene

    # Hide the polished semi-open dorm morphology. V2.4 reconstructs a documented
    # makeshift migrant-hostel passage rather than decorating the older concrete set.
    hide_prefixes((
        'PARAPET', 'OPEN_POST_', 'ROOF_BEAM_', 'WASH_LEDGE', 'WATER_PIPE',
        'TAP_NECK', 'DRAIN', 'WASH_BUCKET_', 'SLIPPER_', 'USED_CARTON', 'SOFT_BAG',
        'BUCKET_', 'REUSED_BOTTLE_', 'STOOL_', 'LAUNDRY_LINE', 'TOWEL_', 'SHIRT_',
        'WET_PATCH_', 'EDGE_DAMP', 'OUTSIDE_', 'SHED_', 'SERVICE_', 'EXT_', 'ROOF',
    ))

    corr = corrugated_panel_material()
    timber = timber_material()
    dirty_plaster = pbr.pbr_material(
        'V24 dirty patched inner plaster',
        pbr.PBR['wall'],
        scale=(1.2, 3.0, 1.0),
        normal_strength=0.48,
        rough_fallback=0.90,
    )
    concrete = pbr.pbr_material(
        'V24 ingrained damp floor',
        pbr.PBR['floor'],
        scale=(1.1, 6.5, 1.0),
        normal_strength=0.46,
        rough_fallback=0.86,
    )
    black_rubber = mat('V24 worn black rubber', (0.013, 0.014, 0.012), 0.96)
    plastic_blue = mat('V24 faded blue plastic', (0.026, 0.105, 0.16), 0.78)
    plastic_green = mat('V24 faded green plastic', (0.035, 0.13, 0.075), 0.80)
    plastic_cream = mat('V24 old cream plastic', (0.31, 0.29, 0.22), 0.84)
    aluminum = mat('V24 dull aluminum', (0.20, 0.21, 0.19), 0.52, 0.30)
    cloth_a = mat('V24 faded maroon cloth', (0.20, 0.055, 0.055), 0.96)
    cloth_b = mat('V24 washed blue cloth', (0.08, 0.13, 0.16), 0.97)
    cloth_c = mat('V24 faded beige cloth', (0.30, 0.25, 0.18), 0.98)
    tarp_blue = tarp_material('V24 blue-green tarp', (0.035, 0.16, 0.17), 0.60)
    tarp_dark = tarp_material('V24 old black tarp', (0.025, 0.027, 0.024), 0.78)
    wet = mat('V24 soaked concrete irregular', (0.045, 0.047, 0.040), 0.48)

    # Narrow the visible walking strip to ~1.05 m without pretending this is a measured building.
    floor = bpy.data.objects.get('FLOOR')
    if floor:
        floor.dimensions.x = 1.12
        floor.location.x = -0.04
        floor.data.materials.clear()
        floor.data.materials.append(concrete)

    left_wall = bpy.data.objects.get('LEFT_WALL')
    if left_wall:
        left_wall.location.x = -0.58
        left_wall.data.materials.clear()
        left_wall.data.materials.append(dirty_plaster)

    # Right side becomes patched corrugated sheet partitions with imperfect joints.
    # Small discontinuities allow overcast daylight to leak through without reading as a designed balcony.
    for i, (y, sy, z, sz, tilt, dent) in enumerate([
        (-5.05, 1.22, 1.12, 2.18, 0.8, 0.018),
        (-3.75, 1.15, 1.10, 2.15, -0.5, 0.013),
        (-2.48, 1.12, 1.13, 2.20, 0.4, 0.019),
        (-1.20, 1.18, 1.08, 2.10, -0.7, 0.010),
        (0.12, 1.22, 1.12, 2.18, 0.6, 0.016),
        (1.48, 1.20, 1.11, 2.17, -0.3, 0.012),
        (2.78, 1.15, 1.10, 2.14, 0.5, 0.018),
        (4.04, 1.12, 1.12, 2.18, -0.4, 0.014),
        (5.18, 0.92, 1.07, 2.08, 0.3, 0.011),
    ], 1):
        add_irregular_sheet(f'V24_CORR_PARTITION_{i:02d}', 0.50, y, z, sy, sz, corr, tilt, dent)

    # Cheap timber frame and repeated repairs.
    for i, y in enumerate([-5.55, -4.35, -3.12, -1.88, -0.62, 0.72, 2.02, 3.32, 4.58, 5.50], 1):
        post = box(f'V24_TIMBER_POST_{i:02d}', (0.49, y, 1.14), (0.075, 0.085, 2.25), timber, 0.005)
        post.rotation_euler[1] = math.radians((i % 3 - 1) * 0.45)
    for i, y in enumerate([-4.70, -2.25, 0.20, 2.65, 5.02], 1):
        box(f'V24_CROSS_BRACE_{i:02d}', (0.10, y, 2.17), (0.83, 0.065, 0.075), timber, 0.004, (0, math.radians(1.2 if i % 2 else -1.0), 0))

    # Roof becomes low, patched corrugated/tarp rather than a clean continuous slab.
    for i, (y, sy, matl, zoff, tilt) in enumerate([
        (-4.65, 2.2, corr, 2.28, 0.5),
        (-2.35, 2.0, tarp_dark, 2.25, -0.7),
        (-0.20, 2.3, corr, 2.29, 0.3),
        (2.15, 2.0, tarp_blue, 2.24, -0.5),
        (4.45, 2.25, corr, 2.28, 0.4),
    ], 1):
        sheet = box(f'V24_ROOF_PATCH_{i:02d}', (-0.02, y, zoff), (1.22, sy, 0.035), matl, 0.003)
        sheet.rotation_euler[1] = math.radians(tilt)

    # Clothes and utility items are asymmetric and concentrated at thresholds, not evenly styled.
    add_drape('V24_CLOTH_01', (-0.51, -3.28, 1.55), 0.40, 0.52, cloth_a, 0.045, 2.5)
    add_drape('V24_CLOTH_02', (-0.50, -0.72, 1.46), 0.34, 0.46, cloth_b, 0.050, -3.0)
    add_drape('V24_CLOTH_03', (-0.50, 2.10, 1.60), 0.44, 0.56, cloth_c, 0.040, 1.5)
    add_drape('V24_CLOTH_04', (0.47, 3.18, 1.52), 0.36, 0.48, cloth_a, 0.035, -2.0)

    for idx, (x, y, rot) in enumerate([
        (-0.42, -4.16, 9), (-0.31, -3.92, -15),
        (-0.43, -1.65, 6), (0.39, -0.86, -8),
        (-0.40, 1.02, 12), (0.38, 2.52, -5),
    ], 1):
        add_slipper(f'V24_SLIPPER_{idx:02d}', (x, y, 0.035), black_rubber, rot)

    add_tapered_bucket('V24_BUCKET_A', (0.36, -2.42, 0.16), 0.15, 0.31, plastic_blue)
    add_tapered_bucket('V24_BUCKET_B', (-0.38, 3.72, 0.14), 0.13, 0.27, plastic_green)
    add_tapered_bucket('V24_BASIN', (0.32, 4.60, 0.11), 0.22, 0.18, plastic_cream)
    add_bottle('V24_REUSED_WATER_A', (-0.42, -0.38, 0.13), plastic_blue, 1.0)
    add_bottle('V24_REUSED_WATER_B', (0.38, 1.62, 0.14), plastic_green, 1.1)

    # Common wash/drain edge at the far end.
    box('V24_WASH_BLOCK', (0.18, 5.25, 0.36), (0.62, 0.45, 0.25), dirty_plaster, 0.012)
    cyl('V24_WATER_PIPE', (0.44, 5.12, 0.86), 0.024, 1.20, aluminum, vertices=32)
    cyl('V24_TAP', (0.36, 5.02, 1.10), 0.018, 0.22, aluminum, (math.radians(90), 0, 0), 24)
    box('V24_DRAIN_CHANNEL', (0.37, 3.60, 0.015), (0.12, 3.8, 0.028), aluminum, 0.004)

    # A small old fan and simple cooking/storage traces, keeping the corridor passable.
    box('V24_FAN_STAND', (-0.39, 4.35, 0.28), (0.05, 0.05, 0.55), aluminum, 0.005)
    cyl('V24_FAN_HEAD', (-0.39, 4.35, 0.58), 0.16, 0.05, aluminum, (math.radians(90), 0, 0), 32)
    cyl('V24_COOK_POT', (0.35, 0.54, 0.10), 0.12, 0.16, aluminum, vertices=32)
    box('V24_STORAGE_CRATE', (0.36, -4.50, 0.15), (0.32, 0.34, 0.30), timber, 0.010, (0, 0, math.radians(4.0)))

    # Irregular damp zones — few, motivated near edge/drain, not decorative mirror puddles.
    for i, (x, y, sx, sy) in enumerate([
        (0.28, -3.05, 0.18, 0.52),
        (0.31, 0.82, 0.14, 0.72),
        (0.28, 3.75, 0.20, 0.88),
        (-0.18, 4.62, 0.20, 0.42),
    ], 1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=12, location=(x, y, 0.002))
        puddle = bpy.context.object
        puddle.name = f'V24_DAMP_ZONE_{i:02d}'
        puddle.scale = (sx, sy, 0.004)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        puddle.data.materials.append(wet)

    # Thin electrical wiring along the timber frame, with slight sag represented by curves.
    wire_mat = black_rubber
    for i, (y0, y1, z0) in enumerate([(-5.4, -1.2, 2.02), (-1.0, 2.8, 2.06), (2.6, 5.3, 1.98)], 1):
        curve = bpy.data.curves.new(f'V24_WIRE_{i:02d}_CURVE', 'CURVE')
        curve.dimensions = '3D'
        curve.bevel_depth = 0.006
        curve.bevel_resolution = 2
        spl = curve.splines.new('BEZIER')
        spl.bezier_points.add(2)
        pts = [(0.46, y0, z0), (0.47, (y0 + y1) / 2, z0 - 0.08), (0.46, y1, z0 + 0.01)]
        for bp, co in zip(spl.bezier_points, pts):
            bp.co = co
            bp.handle_left_type = 'AUTO'
            bp.handle_right_type = 'AUTO'
        obj = bpy.data.objects.new(f'V24_WIRE_{i:02d}', curve)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(wire_mat)

    # Far end: only a restrained industrial/service glimpse, not a scenic courtyard.
    old_masonry = pbr.pbr_material('V24 far old masonry', pbr.PBR['wall'], scale=(1.4, 2.5, 1.0), normal_strength=0.36, rough_fallback=0.90)
    box('V24_FAR_SERVICE_WALL', (0.10, 6.15, 1.05), (2.2, 0.10, 2.10), old_masonry, 0.006)
    box('V24_FAR_CORR_GATE', (0.02, 5.92, 1.15), (0.88, 0.05, 1.70), corr, 0.003, (0, 0, math.radians(1.1)))

    # Documentary camera: human height, mild asymmetry, no hero framing.
    cam = bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.location = (0.03, -5.34, 1.43)
        cam.data.lens = 30.0
        cam.data.sensor_width = 36.0
        base.point_at(cam, (-0.05, 1.75, 1.05))
        cam.rotation_euler[2] += math.radians(0.25)

    # Replace glam light with overcast monsoon morning + weak practical spill.
    for obj in list(bpy.data.objects):
        if obj.type == 'LIGHT' and obj.name in {'OVERCAST_SKY_SIDE', 'SOFT_FAR_END'}:
            bpy.data.objects.remove(obj, do_unlink=True)
    base.add_area('V24_OVERCAST_LEAK', (2.4, -0.8, 3.0), (0.0, 0.2, 1.0), 280, 5.0, (0.68, 0.76, 0.79))
    base.add_area('V24_FAR_MORNING', (0.0, 6.0, 2.2), (0.0, 2.0, 1.0), 145, 2.4, (0.76, 0.79, 0.77))
    world = scene.world
    if world and world.use_nodes:
        bg = world.node_tree.nodes.get('Background')
        if bg:
            bg.inputs['Color'].default_value = (0.17, 0.20, 0.205, 1.0)
            bg.inputs['Strength'].default_value = 0.22

    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.view_settings.look = 'AgX - Medium Low Contrast'
    scene.view_settings.exposure = -0.28


def patch_receipt(out: Path):
    receipt_path = out / 'bien-anh-v23-public-bootstrap-receipt.json'
    receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
    receipt['schema'] = 'daube.bien-anh.v24.reality-reconstruction.v1'
    receipt['visualRetakeVersion'] = REALITY_VERSION
    receipt['referenceClass'] = REFERENCE_CLASS
    receipt['status'] = 'PHYSICAL_WIDE_V24_REALITY_RECONSTRUCTION_PRODUCED_REVIEW_REQUIRED'
    receipt['realityEvidence'] = [
        {
            'source': 'Frontier Myanmar',
            'url': 'https://www.frontiermyanmar.net/en/rural-migrants-return-to-hlaing-tharyar-and-an-uncertain-future/',
            'use': 'documented makeshift migrant-worker hostel morphology in Hlaing Tharyar',
        },
        {
            'source': 'The Irrawaddy',
            'url': 'https://www.irrawaddy.com/news/burma/rapid-migration-and-lack-of-cheap-housing-fuels-yangon-slum-growth.html',
            'use': '10x10-ft room shared by four workers; 14 rooms/56 people/three toilets example',
        },
    ]
    receipt['topologyMeters']['widthX'] = 1.12
    receipt['topologyEvidenceStatus'] = 'REFERENCE_ESTIMATE_CANDIDATE_NOT_MEASURED'
    receipt['passageMorphology'] = 'NARROW_MAKESHIFT_PRIVATE_HOSTEL_PASSAGE'
    receipt['retakeTargets'] = [
        'documentary-not-archviz',
        'corrugated-and-timber-repair-history',
        'non-staged-threshold-life-traces',
        'shared-water-and-drain-logic',
        'irregular-post-rain-dampness',
        'weak-overcast-monsoon-morning',
        'no-scenic-courtyard-read',
        'no-poverty-caricature',
    ]
    receipt['automaticPaidSpend'] = False
    receipt['promotionEligible'] = False
    receipt['fanOutEligible'] = False
    receipt['truthBoundary'] = (
        'Physical sanitized V2.4 WIDE reality candidate. It is based on documented Hlaing Tharyar '
        'migrant-worker housing morphology but does not reproduce or accuse any real facility. '
        'Founder + geography + socioeconomic + cultural/language QC remain mandatory.'
    )
    blend = out / 'bien-anh-v23-public-bootstrap.blend'
    png = out / 'plate-wide-interior-v23-public-bootstrap.png'
    receipt['artifacts']['blend'] = {'name': blend.name, 'bytes': blend.stat().st_size, 'sha256': sha256(blend)}
    receipt['artifacts']['widePng'] = {'name': png.name, 'bytes': png.stat().st_size, 'sha256': sha256(png)}
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--source-revision', required=True)
    args = parser.parse_args(argv)

    pbr.require_assets()
    out = Path(args.output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)

    # Build PBR baseline first, then reconstruct and re-render from the same physical scene.
    pbr.base.build_scene(out, args.source_revision)
    add_reality_reconstruction()

    scene = bpy.context.scene
    blend_path = out / 'bien-anh-v23-public-bootstrap.blend'
    png_path = out / 'plate-wide-interior-v23-public-bootstrap.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    scene.render.filepath = str(png_path)
    bpy.ops.render.render(write_still=True)
    patch_receipt(out)
    print(receipt := json.loads((out / 'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))


if __name__ == '__main__':
    main()
