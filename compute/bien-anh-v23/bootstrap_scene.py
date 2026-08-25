#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy

PASSAGE_WIDTH = 1.40
PASSAGE_LENGTH = 12.0
HEIGHT = 2.45


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def sha256(path: Path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def mat(name, color, rough=0.7, metal=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m


def box(name, loc, dims, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o = bpy.context.object
    o.name = name
    o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        o.data.materials.append(material)
    if bevel > 0:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    return o


def cyl(name, loc, radius, depth, material, rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=depth, location=loc)
    o = bpy.context.object
    o.name = name
    if rot:
        o.rotation_euler = rot
    if material:
        o.data.materials.append(material)
    return o


def point_at(obj, target):
    direction = mathutils.Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def build_scene(output_dir: Path, source_revision: str):
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Materials
    floor_m = mat('wet-concrete', (0.16, 0.15, 0.13), 0.48)
    wall_m = mat('aged-plaster', (0.34, 0.32, 0.27), 0.86)
    patch_m = mat('patch-repair', (0.27, 0.28, 0.24), 0.93)
    door_m = mat('cheap-door', (0.17, 0.12, 0.08), 0.82)
    metal_m = mat('utility-metal', (0.08, 0.09, 0.08), 0.58, 0.28)
    parapet_m = mat('parapet', (0.20, 0.19, 0.16), 0.90)
    plastic_m = mat('plastic', (0.06, 0.12, 0.15), 0.74)
    rubber_m = mat('rubber', (0.025, 0.025, 0.025), 0.92)
    cloth_m = mat('cloth', (0.26, 0.16, 0.13), 0.96)
    roof_m = mat('corrugated-roof', (0.22, 0.23, 0.22), 0.72, 0.18)
    blue_m = mat('water-tank-blue', (0.04, 0.16, 0.28), 0.62)
    dark_m = mat('dark-metal', (0.03, 0.035, 0.035), 0.58, 0.35)

    half = PASSAGE_WIDTH / 2

    # Passage envelope: single-loaded semi-open worker hostel.
    box('FLOOR', (0, 0, -0.035), (PASSAGE_WIDTH, PASSAGE_LENGTH, 0.07), floor_m)
    box('LEFT_WALL', (-half + 0.04, 0, HEIGHT / 2), (0.08, PASSAGE_LENGTH, HEIGHT), wall_m)
    box('ROOF', (0.04, 0, HEIGHT), (PASSAGE_WIDTH + 0.24, PASSAGE_LENGTH, 0.09), roof_m)
    box('PARAPET', (half - 0.055, 0, 0.48), (0.11, PASSAGE_LENGTH - 0.25, 0.96), parapet_m)

    for i, y in enumerate([-4.8, -2.4, 0, 2.4, 4.8], 1):
        box(f'OPEN_POST_{i}', (half - 0.055, y, 1.66), (0.10, 0.12, 1.42), metal_m, 0.005)

    # Four room fronts on enclosed side only.
    for i, y in enumerate([-4.55, -2.15, 0.25, 2.65], 1):
        box(f'DOOR_{i}', (-half + 0.10, y, 1.0), (0.04, 0.82, 2.0), door_m, 0.008)
        box(f'DOOR_PATCH_{i}', (-half + 0.085, y + 0.18, 0.85), (0.012, 0.22, 0.34), patch_m)
        box(f'LATCH_{i}', (-half + 0.07, y - 0.22, 1.02), (0.025, 0.10, 0.08), metal_m, 0.003)

    # Motivated wall wear/repairs.
    repairs = [(-3.35, 0.52, 0.46, 0.72), (-0.95, 1.50, 0.34, 0.46), (1.45, 0.42, 0.50, 0.66), (3.85, 1.28, 0.42, 0.50)]
    for i, (y, z, sy, sz) in enumerate(repairs, 1):
        box(f'WALL_REPAIR_{i}', (-half + 0.035, y, z), (0.012, sy, sz), patch_m)

    # Surface-run electrical utilities.
    for i, y in enumerate([-4.6, -2.2, 0.2, 2.6, 4.55], 1):
        box(f'JBOX_{i}', (-half + 0.07, y, 2.02), (0.045, 0.14, 0.16), metal_m, 0.003)
        cyl(f'WIRE_{i}', (-half + 0.08, y, 2.18), 0.009, 1.0, dark_m, (math.radians(90), 0, 0))

    # Shared wash edge at far end.
    box('WASH_LEDGE', (0.40, 4.65, 0.42), (0.34, 0.72, 0.16), patch_m, 0.008)
    cyl('WATER_PIPE', (0.53, 4.55, 1.02), 0.028, 1.90, metal_m)
    box('DRAIN', (0.45, 4.42, 0.018), (0.22, 0.68, 0.035), dark_m)

    # Everyday occupation traces, asymmetric and edge-biased.
    traces = [
        ('SLIPPER_A', (-0.48, -4.05, 0.028), (0.16, 0.28, 0.035), rubber_m, 5),
        ('SLIPPER_B', (-0.42, -3.78, 0.028), (0.16, 0.28, 0.035), rubber_m, -8),
        ('CARTON', (0.45, -2.50, 0.14), (0.34, 0.30, 0.28), patch_m, 4),
        ('BAG', (-0.46, 0.80, 0.12), (0.30, 0.24, 0.24), cloth_m, -7),
        ('STOOL', (-0.43, 1.95, 0.18), (0.28, 0.28, 0.36), plastic_m, 0),
    ]
    for name, loc, dims, m, angle in traces:
        o = box(name, loc, dims, m, 0.012)
        o.rotation_euler[2] = math.radians(angle)

    cyl('BUCKET', (0.46, 2.55, 0.16), 0.16, 0.32, plastic_m)
    cyl('WATER_BOTTLE', (-0.50, 2.05, 0.12), 0.035, 0.24, plastic_m)
    box('TOWEL', (-0.60, 1.20, 1.56), (0.018, 0.34, 0.46), cloth_m)

    # Wet floor patches, not mirror-like.
    wet_m = mat('wet-patch', (0.10, 0.095, 0.085), 0.24)
    for i, (x, y, sx, sy) in enumerate([(0.15, -3.0, 0.50, 0.65), (-0.10, -0.7, 0.42, 0.50), (0.18, 2.2, 0.38, 0.80), (-0.20, 4.0, 0.46, 0.35)], 1):
        box(f'WET_{i}', (x, y, 0.004), (sx, sy, 0.008), wet_m)

    # Exterior worker/service-yard cues beyond parapet: modest sheds, tanks, pipes, industrial massing.
    for i, y in enumerate([-3.6, -0.8, 2.3], 1):
        box(f'EXT_SHED_{i}', (2.1, y, 0.65), (1.8, 2.2, 1.3), wall_m)
        roof = box(f'EXT_ROOF_{i}', (2.1, y, 1.40), (2.0, 2.4, 0.08), roof_m)
        roof.rotation_euler[1] = math.radians(6)

    for i, y in enumerate([-2.2, 1.5], 1):
        cyl(f'EXT_TANK_{i}', (3.0, y, 1.0), 0.42, 1.55, blue_m)
        cyl(f'EXT_TANK_PIPE_{i}', (2.62, y, 0.72), 0.035, 1.2, metal_m)

    box('EXT_FACTORY_A', (7.5, 0.8, 2.3), (7.0, 5.0, 4.6), mat('factory-a', (0.32, 0.34, 0.34), 0.72))
    box('EXT_FACTORY_B', (8.5, -5.0, 1.8), (5.0, 3.5, 3.6), mat('factory-b', (0.27, 0.29, 0.30), 0.74))
    cyl('EXT_CHIMNEY', (6.0, 3.5, 3.5), 0.14, 5.5, dark_m)

    # Simple poles/wires.
    for i, y in enumerate([-4, 0, 4], 1):
        cyl(f'EXT_POLE_{i}', (4.1, y, 2.3), 0.05, 4.6, dark_m)

    # Lighting: 06:12, overcast monsoon morning, already daylight after sunrise.
    world = bpy.data.worlds.new('WORLD')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.44, 0.50, 0.56, 1.0)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.38
    bpy.context.scene.world = world

    bpy.ops.object.light_add(type='AREA', location=(1.8, 0.0, 2.3))
    daylight = bpy.context.object
    daylight.name = 'OVERCAST_SIDE_LIGHT'
    daylight.data.energy = 700
    daylight.data.shape = 'RECTANGLE'
    daylight.data.size = 8.0
    daylight.data.size_y = 11.0
    daylight.rotation_euler = (math.radians(90), 0, math.radians(90))

    for i, y in enumerate([-4.0, -1.4, 1.2, 3.8], 1):
        bpy.ops.object.light_add(type='AREA', location=(0.0, y, 2.30))
        l = bpy.context.object
        l.name = f'FLUOR_{i}'
        l.data.energy = 80
        l.data.color = (0.78, 0.88, 1.0)
        l.data.shape = 'RECTANGLE'
        l.data.size = 0.7
        l.data.size_y = 0.08
        l.rotation_euler = (0, 0, 0)

    # Camera.
    bpy.ops.object.camera_add(location=(0.04, -5.15, 1.55))
    cam = bpy.context.object
    cam.name = 'CAM_WIDE_INTERIOR'
    cam.data.lens = 24.0
    bpy.context.scene.camera = cam
    import mathutils
    direction = mathutils.Vector((0.0, 2.0, 1.15)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if os.environ.get('DAUBE_FAST_PREVIEW') == '1' else 'CYCLES'
    if scene.render.engine == 'CYCLES':
        scene.cycles.samples = 16
        scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = -0.20

    output_dir.mkdir(parents=True, exist_ok=True)
    blend_path = output_dir / 'bien-anh-v23-public-bootstrap.blend'
    png_path = output_dir / 'plate-wide-interior-v23-public-bootstrap.png'
    receipt_path = output_dir / 'bien-anh-v23-public-bootstrap-receipt.json'

    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    scene.render.filepath = str(png_path)
    bpy.ops.render.render(write_still=True)

    if not blend_path.is_file() or not png_path.is_file():
        raise RuntimeError('physical artifacts missing')

    receipt = {
        'schema': 'daube.bien-anh.v23.public-bootstrap.v1',
        'generatedAt': now_iso(),
        'sourceRevision': source_revision,
        'status': 'PHYSICAL_WIDE_BOOTSTRAP_ARTIFACT_PRODUCED_REVIEW_REQUIRED',
        'privacyClass': 'PUBLIC_DISTRIBUTED_SANITIZED_ENVIRONMENT_ONLY',
        'regionBasis': 'Yangon Region',
        'townshipBasis': 'Hlaing Tharyar',
        'housingArchetype': 'A2_CHEAP_PRIVATE_SHARED_HOSTEL_LONG_HOUSE',
        'passageMorphology': 'SINGLE_LOADED_SEMI_OPEN',
        'topologyMeters': {'lengthY': PASSAGE_LENGTH, 'widthX': PASSAGE_WIDTH, 'heightZ': HEIGHT},
        'topologyEvidenceStatus': 'REFERENCE_ESTIMATE_CANDIDATE_NOT_MEASURED',
        'camera': {'role': 'PLATE-WIDE-INTERIOR', 'lensMm': 24.0, 'heightM': 1.55},
        'lighting': '06:12 post-rain overcast monsoon morning; daylight plus weak fluorescent practicals',
        'artifacts': {
            'blend': {'name': blend_path.name, 'bytes': blend_path.stat().st_size, 'sha256': sha256(blend_path)},
            'widePng': {'name': png_path.name, 'bytes': png_path.stat().st_size, 'sha256': sha256(png_path)},
        },
        'automaticPaidSpend': False,
        'promotionEligible': False,
        'fanOutEligible': False,
        'truthBoundary': 'Environment-only physical bootstrap render. Must pass geography, socioeconomic, cultural/language, lighting and Founder visual QC before any remaining-camera fan-out or location lock.'
    }
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--output-dir', required=True)
    p.add_argument('--source-revision', required=True)
    args = p.parse_args(argv)
    build_scene(Path(args.output_dir).resolve(), args.source_revision)


if __name__ == '__main__':
    main()
