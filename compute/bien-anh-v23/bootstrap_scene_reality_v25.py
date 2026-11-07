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
V24_PATH = HERE / 'bootstrap_scene_reality_v24.py'
spec = importlib.util.spec_from_file_location('bien_anh_v24', V24_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v24:{V24_PATH}')
v24 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v24)
base = v24.base
pbr = v24.pbr

ASSETS_DIR = HERE / 'assets_runtime'
WOOD_MAPS = {
    'diff': ASSETS_DIR / 'weathered_planks_diff_1k.jpg',
    'normal': ASSETS_DIR / 'weathered_planks_nor_gl_1k.jpg',
    'rough': ASSETS_DIR / 'weathered_planks_rough_1k.jpg',
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def require_v25_assets():
    missing = [str(p) for p in WOOD_MAPS.values() if not p.is_file() or p.stat().st_size < 1024]
    if missing:
        raise RuntimeError('missing_v25_assets:' + ','.join(missing))


def brighten_pbr(mat, value=1.25, saturation=0.88):
    if not mat or not mat.use_nodes:
        return
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'), None)
    diff = next((n for n in nt.nodes if n.bl_idname == 'ShaderNodeTexImage' and n.image and '_diff_' in Path(n.image.filepath).name), None)
    if not bsdf or not diff:
        return
    for link in list(nt.links):
        if link.to_node == bsdf and link.to_socket == bsdf.inputs['Base Color']:
            nt.links.remove(link)
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    hsv.inputs['Saturation'].default_value = saturation
    hsv.inputs['Value'].default_value = value
    nt.links.new(diff.outputs['Color'], hsv.inputs['Color'])
    nt.links.new(hsv.outputs['Color'], bsdf.inputs['Base Color'])


def mat(name, color, rough=0.8, metal=0.0):
    return base.solid_mat(name, color, rough, metal)


def box(name, loc, dims, material, bevel=0.0, rot=(0.0, 0.0, 0.0)):
    return base.box(name, loc, dims, material, bevel, rot)


def cyl(name, loc, radius, depth, material, rot=(0.0, 0.0, 0.0), vertices=32):
    return base.cyl(name, loc, radius, depth, material, rot, vertices)


def add_round_basin(name, loc, radius, height, material):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius * 0.78, minor_radius=0.025, major_segments=40, minor_segments=10, location=(loc[0], loc[1], loc[2] + height * 0.48))
    rim = bpy.context.object
    rim.name = name + '_RIM'
    rim.data.materials.append(material)
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=radius, depth=height, location=loc)
    body = bpy.context.object
    body.name = name
    body.data.materials.append(material)
    return body


def add_soft_sack(name, loc, scale, material, rot=0.0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.rotation_euler[2] = math.radians(rot)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def add_v25_refinement():
    scene = bpy.context.scene

    # Surface brightness correction: V2.4 physical evidence was materially too dark.
    for material_name, value, saturation in [
        ('V24 worn corrugated partition', 1.45, 0.82),
        ('V24 dirty patched inner plaster', 1.28, 0.86),
        ('V24 ingrained damp floor', 1.20, 0.90),
        ('V24 far old masonry', 1.25, 0.88),
    ]:
        brighten_pbr(bpy.data.materials.get(material_name), value, saturation)

    # Real weathered timber texture replaces procedural-looking repair boards.
    wood = pbr.pbr_material('V25 weathered plank repair', WOOD_MAPS, scale=(1.4, 2.4, 1.0), normal_strength=0.52, rough_fallback=0.88)
    brighten_pbr(wood, 1.18, 0.90)
    for obj in bpy.data.objects:
        if obj.name.startswith('V24_TIMBER_POST_') or obj.name.startswith('V24_CROSS_BRACE_') or obj.name == 'V24_STORAGE_CRATE':
            obj.data.materials.clear()
            obj.data.materials.append(wood)

    # Patch a few left-side wall sections with mismatched timber boards, a documented low-cost repair language.
    for i, (y, sy, z, sz, angle) in enumerate([
        (-4.95, 0.55, 0.62, 0.72, 0.5),
        (-3.08, 0.38, 1.42, 0.42, -0.7),
        (-0.95, 0.45, 0.72, 0.58, 0.8),
        (1.58, 0.42, 1.35, 0.46, -0.4),
        (3.78, 0.52, 0.58, 0.68, 0.6),
    ], 1):
        panel = box(f'V25_LEFT_WOOD_PATCH_{i:02d}', (-0.525, y, z), (0.025, sy, sz), wood, 0.004)
        panel.rotation_euler[0] = math.radians(angle)

    # More believable threshold life: asymmetrical cloth, basins, sacks, bottles, a small shelf.
    cloth_green = mat('V25 washed green cloth', (0.075, 0.18, 0.12), 0.98)
    cloth_mustard = mat('V25 faded mustard cloth', (0.30, 0.20, 0.065), 0.98)
    cloth_grey = mat('V25 faded grey cloth', (0.16, 0.17, 0.16), 0.98)
    cloth_blue = mat('V25 faded blue cloth', (0.07, 0.12, 0.20), 0.98)
    plastic_aqua = mat('V25 aqua plastic', (0.035, 0.19, 0.18), 0.78)
    plastic_red = mat('V25 faded red plastic', (0.23, 0.055, 0.04), 0.82)
    sack_mat = mat('V25 woven sack', (0.26, 0.20, 0.13), 0.94)
    metal = mat('V25 dull pot metal', (0.24, 0.25, 0.23), 0.48, 0.28)

    v24.add_drape('V25_LAUNDRY_01', (-0.49, -4.18, 1.48), 0.34, 0.48, cloth_green, 0.045, -2.0)
    v24.add_drape('V25_LAUNDRY_02', (-0.49, -2.58, 1.55), 0.42, 0.54, cloth_mustard, 0.055, 2.5)
    v24.add_drape('V25_LAUNDRY_03', (0.46, -1.18, 1.45), 0.30, 0.42, cloth_grey, 0.040, -2.8)
    v24.add_drape('V25_LAUNDRY_04', (-0.49, 0.96, 1.52), 0.38, 0.50, cloth_blue, 0.050, 1.5)
    v24.add_drape('V25_LAUNDRY_05', (0.46, 2.82, 1.50), 0.34, 0.46, cloth_green, 0.045, -1.5)
    v24.add_drape('V25_LAUNDRY_06', (-0.49, 4.12, 1.48), 0.40, 0.52, cloth_grey, 0.050, 2.0)

    add_round_basin('V25_BASIN_A', (0.31, -3.50, 0.10), 0.18, 0.12, plastic_aqua)
    add_round_basin('V25_BASIN_B', (-0.34, 2.18, 0.09), 0.16, 0.11, plastic_red)
    add_soft_sack('V25_SACK_A', (-0.34, -2.15, 0.16), (0.16, 0.21, 0.20), sack_mat, -8)
    add_soft_sack('V25_SACK_B', (0.32, 1.36, 0.14), (0.14, 0.18, 0.17), sack_mat, 6)

    box('V25_LOW_SHELF', (-0.35, 3.26, 0.42), (0.28, 0.54, 0.045), wood, 0.006)
    box('V25_LOW_SHELF_LEG_A', (-0.35, 3.05, 0.22), (0.035, 0.035, 0.40), wood, 0.004)
    box('V25_LOW_SHELF_LEG_B', (-0.35, 3.47, 0.22), (0.035, 0.035, 0.40), wood, 0.004)
    cyl('V25_POT', (-0.34, 3.26, 0.50), 0.105, 0.13, metal, vertices=40)

    # Replace the set-like blocked end with an actual exterior depth stack.
    for name in ['V24_FAR_SERVICE_WALL', 'V24_FAR_CORR_GATE']:
        obj = bpy.data.objects.get(name)
        if obj:
            obj.hide_render = True
            obj.hide_viewport = True

    ground = pbr.pbr_material('V25 wet exterior ground', pbr.PBR['floor'], scale=(2.0, 5.0, 1.0), normal_strength=0.40, rough_fallback=0.78)
    brighten_pbr(ground, 1.10, 0.82)
    corr = bpy.data.materials.get('V24 worn corrugated partition')
    masonry = bpy.data.materials.get('V24 far old masonry') or bpy.data.materials.get('V24 dirty patched inner plaster')

    box('V25_OUTSIDE_GROUND', (0.10, 8.10, -0.06), (4.4, 4.2, 0.08), ground, 0.006)
    # Fragmented service sheds and rooflines, deliberately mundane rather than scenic.
    box('V25_SHED_L_A', (-1.15, 8.15, 0.80), (1.25, 1.75, 1.60), masonry, 0.008)
    box('V25_SHED_L_ROOF', (-1.12, 8.12, 1.70), (1.45, 1.95, 0.07), corr, 0.004, (0, math.radians(-5), 0))
    box('V25_SHED_R_A', (1.40, 9.10, 0.72), (1.35, 1.55, 1.44), corr, 0.006)
    box('V25_SHED_R_ROOF', (1.38, 9.05, 1.55), (1.55, 1.75, 0.07), corr, 0.004, (0, math.radians(4), 0))
    box('V25_BACK_WALL', (0.10, 10.10, 0.95), (3.8, 0.10, 1.90), masonry, 0.006)

    utility = mat('V25 utility pole', (0.055, 0.060, 0.055), 0.72, 0.24)
    cyl('V25_UTILITY_POLE', (1.82, 8.60, 1.85), 0.055, 3.7, utility, vertices=20)
    box('V25_UTILITY_CROSSBAR', (1.82, 8.60, 3.25), (0.80, 0.06, 0.06), utility, 0.004)
    for idx, z in enumerate([3.18, 3.32], 1):
        curve = bpy.data.curves.new(f'V25_EXT_WIRE_{idx}_CURVE', 'CURVE')
        curve.dimensions = '3D'
        curve.bevel_depth = 0.005
        curve.bevel_resolution = 1
        spl = curve.splines.new('BEZIER')
        spl.bezier_points.add(2)
        pts = [(-1.8, 7.5, z), (0.1, 8.2, z - 0.12), (2.2, 9.1, z + 0.02)]
        for bp, co in zip(spl.bezier_points, pts):
            bp.co = co
            bp.handle_left_type = 'AUTO'
            bp.handle_right_type = 'AUTO'
        obj = bpy.data.objects.new(f'V25_EXT_WIRE_{idx}', curve)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(utility)

    # A few service containers outside; no decorative greenery or polished courtyard cues.
    v24.add_tapered_bucket('V25_OUTSIDE_BUCKET', (-0.78, 7.30, 0.16), 0.15, 0.31, plastic_aqua)
    cyl('V25_OUTSIDE_DRUM', (0.94, 8.20, 0.36), 0.28, 0.72, plastic_blue := mat('V25 old blue drum', (0.035, 0.095, 0.14), 0.76), vertices=40)

    # Light must read as 06:12 after sunrise, overcast, not a night tunnel.
    for obj in list(bpy.data.objects):
        if obj.type == 'LIGHT' and obj.name.startswith(('V24_', 'OVERCAST_', 'SOFT_')):
            bpy.data.objects.remove(obj, do_unlink=True)
    base.add_area('V25_SKY_FILL', (2.8, -0.8, 3.4), (0.0, 0.4, 1.0), 620, 6.0, (0.72, 0.79, 0.80))
    base.add_area('V25_END_DAYLIGHT', (0.0, 7.3, 3.0), (0.0, 2.2, 1.0), 520, 4.0, (0.78, 0.80, 0.77))
    base.add_area('V25_NEAR_SOFT_BOUNCE', (-1.2, -3.8, 2.2), (0.0, -0.5, 1.0), 135, 2.4, (0.62, 0.69, 0.68))

    if scene.world and scene.world.use_nodes:
        bg = scene.world.node_tree.nodes.get('Background')
        if bg:
            bg.inputs['Color'].default_value = (0.29, 0.32, 0.32, 1.0)
            bg.inputs['Strength'].default_value = 0.42

    cam = bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.location = (0.02, -5.26, 1.46)
        cam.data.lens = 28.0
        base.point_at(cam, (-0.03, 2.15, 1.08))
        cam.rotation_euler[2] += math.radians(0.18)

    scene.cycles.samples = 56
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.view_settings.look = 'AgX - Medium Low Contrast'
    scene.view_settings.exposure = 0.18


def patch_receipt(out: Path):
    path = out / 'bien-anh-v23-public-bootstrap-receipt.json'
    receipt = json.loads(path.read_text(encoding='utf-8'))
    receipt['schema'] = 'daube.bien-anh.v25.reality-reconstruction.v1'
    receipt['visualRetakeVersion'] = 'BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V2.5'
    receipt['status'] = 'PHYSICAL_WIDE_V25_REALITY_RECONSTRUCTION_PRODUCED_REVIEW_REQUIRED'
    receipt['retakeTargets'] = [
        'correct-0612-daylight-level',
        'remove-dark-tunnel-read',
        'weathered-timber-photographic-pbr',
        'non-primitive-threshold-life-traces',
        'exterior-industrial-depth-not-flat-backdrop',
        'documented-hostel-material-language',
        'no-poverty-caricature',
    ]
    receipt['additionalPbrAsset'] = {
        'provider': 'Poly Haven',
        'asset': 'weathered_planks',
        'license': 'CC0',
        'source': 'https://polyhaven.com/a/weathered_planks',
        'maps': {k: {'filename': p.name, 'sha256': sha256(p), 'bytes': p.stat().st_size} for k, p in WOOD_MAPS.items()},
    }
    receipt['camera'] = {'role': 'PLATE-WIDE-INTERIOR', 'lensMm': 28.0, 'heightM': 1.46}
    receipt['lighting'] = '06:12 Yangon post-rain overcast daylight; physically brighter than V2.4 dark-tunnel failure; weak interior bounce only'
    receipt['automaticPaidSpend'] = False
    receipt['promotionEligible'] = False
    receipt['fanOutEligible'] = False
    blend = out / 'bien-anh-v23-public-bootstrap.blend'
    png = out / 'plate-wide-interior-v23-public-bootstrap.png'
    receipt['artifacts']['blend'] = {'name': blend.name, 'bytes': blend.stat().st_size, 'sha256': sha256(blend)}
    receipt['artifacts']['widePng'] = {'name': png.name, 'bytes': png.stat().st_size, 'sha256': sha256(png)}
    receipt['truthBoundary'] = 'V2.5 physical sanitized WIDE candidate. Still review-required; no camera fan-out or location lock until visual/geography/socioeconomic/cultural QC passes.'
    path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--source-revision', required=True)
    args = parser.parse_args(argv)

    pbr.require_assets()
    require_v25_assets()
    out = Path(args.output_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)

    pbr.base.build_scene(out, args.source_revision)
    v24.add_reality_reconstruction()
    add_v25_refinement()

    scene = bpy.context.scene
    blend = out / 'bien-anh-v23-public-bootstrap.blend'
    png = out / 'plate-wide-interior-v23-public-bootstrap.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    scene.render.filepath = str(png)
    bpy.ops.render.render(write_still=True)
    patch_receipt(out)
    print(json.loads((out / 'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))


if __name__ == '__main__':
    main()
