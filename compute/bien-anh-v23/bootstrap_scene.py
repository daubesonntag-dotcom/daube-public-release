#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy
import mathutils

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


def solid_mat(name, color, rough=0.7, metal=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    return m


def noise_mat(name, color_a, color_b, scale=5.0, detail=4.0, rough=0.75, bump=0.08, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    bumpn = nt.nodes.new('ShaderNodeBump')
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = detail
    noise.inputs['Roughness'].default_value = 0.72
    ramp.color_ramp.elements[0].color = (*color_a, 1.0)
    ramp.color_ramp.elements[1].color = (*color_b, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    bumpn.inputs['Strength'].default_value = bump
    bumpn.inputs['Distance'].default_value = 0.045
    nt.links.new(tex.outputs['Generated'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(noise.outputs['Fac'], bumpn.inputs['Height'])
    nt.links.new(bumpn.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return m


def corrugated_mat(name, color_a, color_b):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex = nt.nodes.new('ShaderNodeTexCoord')
    wave = nt.nodes.new('ShaderNodeTexWave')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    bumpn = nt.nodes.new('ShaderNodeBump')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X'
    wave.inputs['Scale'].default_value = 36.0
    wave.inputs['Distortion'].default_value = 0.8
    noise.inputs['Scale'].default_value = 3.2
    noise.inputs['Detail'].default_value = 3.0
    ramp.color_ramp.elements[0].color = (*color_a, 1.0)
    ramp.color_ramp.elements[1].color = (*color_b, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.69
    bsdf.inputs['Metallic'].default_value = 0.18
    bumpn.inputs['Strength'].default_value = 0.34
    bumpn.inputs['Distance'].default_value = 0.035
    nt.links.new(tex.outputs['Generated'], wave.inputs['Vector'])
    nt.links.new(tex.outputs['Generated'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(wave.outputs['Color'], bumpn.inputs['Height'])
    nt.links.new(bumpn.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return m


def emission_mat(name, color, strength=3.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Emission Color'].default_value = (*color, 1.0)
    bsdf.inputs['Emission Strength'].default_value = strength
    bsdf.inputs['Roughness'].default_value = 0.35
    return m


def box(name, loc, dims, material, bevel=0.0, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        o.data.materials.append(material)
    if bevel > 0:
        mod = o.modifiers.new('soft-edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    return o


def cyl(name, loc, radius, depth, material, rot=(0.0, 0.0, 0.0), vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    if material:
        o.data.materials.append(material)
    return o


def sphere(name, loc, scale, material):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        o.data.materials.append(material)
    return o


def point_at(obj, target):
    direction = mathutils.Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def add_area(name, loc, target, energy, size, color):
    bpy.ops.object.light_add(type='AREA', location=loc)
    light = bpy.context.object
    light.name = name
    light.data.energy = energy
    light.data.shape = 'RECTANGLE'
    light.data.size = size
    light.data.size_y = size * 1.6
    light.data.color = color
    point_at(light, target)
    return light


def build_scene(output_dir: Path, source_revision: str):
    bpy.ops.wm.read_factory_settings(use_empty=True)

    floor_m = noise_mat('old damp concrete', (0.060, 0.055, 0.046), (0.18, 0.15, 0.115), 8.0, 5.0, 0.79, 0.20)
    wall_m = noise_mat('aged lime plaster', (0.17, 0.155, 0.12), (0.43, 0.38, 0.29), 4.5, 5.0, 0.90, 0.18)
    patch_m = noise_mat('mismatched cement repair', (0.17, 0.18, 0.15), (0.31, 0.29, 0.23), 6.0, 3.0, 0.94, 0.10)
    stain_m = noise_mat('humidity stain', (0.025, 0.033, 0.026), (0.11, 0.095, 0.058), 3.0, 4.0, 0.97, 0.05)
    door_m = noise_mat('weathered timber', (0.075, 0.038, 0.018), (0.24, 0.105, 0.042), 5.0, 3.0, 0.84, 0.11)
    blue_door_m = noise_mat('faded blue door', (0.055, 0.075, 0.078), (0.18, 0.24, 0.23), 6.0, 4.0, 0.84, 0.11)
    metal_m = solid_mat('utility galvanized metal', (0.085, 0.095, 0.090), 0.62, 0.24)
    rusty_m = noise_mat('oxidized metal', (0.065, 0.036, 0.020), (0.26, 0.105, 0.035), 4.0, 3.0, 0.72, 0.08, 0.16)
    parapet_m = noise_mat('stained parapet', (0.09, 0.085, 0.068), (0.25, 0.225, 0.17), 5.0, 5.0, 0.93, 0.16)
    plastic_blue = solid_mat('cheap blue plastic', (0.028, 0.13, 0.22), 0.76)
    plastic_green = solid_mat('cheap green plastic', (0.03, 0.18, 0.10), 0.78)
    plastic_red = solid_mat('faded red plastic', (0.23, 0.050, 0.038), 0.80)
    rubber_m = solid_mat('worn rubber', (0.015, 0.015, 0.013), 0.95)
    cloth_dark = noise_mat('dark cloth', (0.035, 0.027, 0.024), (0.12, 0.075, 0.058), 7.0, 2.0, 0.98, 0.02)
    cloth_pink = solid_mat('faded pink cloth', (0.34, 0.14, 0.15), 0.98)
    carton_m = noise_mat('used carton', (0.18, 0.095, 0.04), (0.36, 0.21, 0.09), 8.0, 2.0, 0.94, 0.04)
    roof_m = corrugated_mat('aged corrugated zinc', (0.13, 0.14, 0.135), (0.33, 0.29, 0.24))
    blue_m = noise_mat('water tank blue', (0.018, 0.075, 0.15), (0.05, 0.20, 0.33), 5.0, 2.0, 0.70, 0.05)
    wet_m = noise_mat('shallow wet patches', (0.025, 0.026, 0.023), (0.085, 0.072, 0.052), 5.0, 3.0, 0.17, 0.025)
    drain_m = solid_mat('dark drain metal', (0.018, 0.021, 0.020), 0.64, 0.32)
    fluores_m = emission_mat('fluorescent diffuser', (0.68, 0.78, 0.82), 2.1)

    half = PASSAGE_WIDTH / 2
    left_face = -half + 0.085
    open_x = half - 0.055

    box('FLOOR', (0, 0, -0.035), (PASSAGE_WIDTH, PASSAGE_LENGTH, 0.07), floor_m, 0.008)
    box('LEFT_WALL', (-half + 0.04, 0, HEIGHT / 2), (0.08, PASSAGE_LENGTH, HEIGHT), wall_m, 0.004)
    box('ROOF', (0.02, 0, HEIGHT), (PASSAGE_WIDTH + 0.24, PASSAGE_LENGTH, 0.09), roof_m, 0.004)
    box('PARAPET', (open_x, 0, 0.48), (0.11, PASSAGE_LENGTH - 0.25, 0.96), parapet_m, 0.014)

    for i, y in enumerate([-4.85, -2.45, -0.05, 2.35, 4.75], 1):
        box(f'OPEN_POST_{i}', (open_x, y, 1.65), (0.10, 0.13, 1.44), rusty_m, 0.004)
        box(f'ROOF_BEAM_{i}', (0.0, y, 2.34), (1.28, 0.08, 0.09), rusty_m, 0.003)

    door_ys = [-4.50, -2.08, 0.34, 2.76]
    for i, y in enumerate(door_ys, 1):
        dm = door_m if i in (1, 3) else blue_door_m
        box(f'DOOR_{i}', (left_face, y, 0.98), (0.038, 0.78, 1.90), dm, 0.010)
        box(f'FRAME_A_{i}', (left_face + 0.008, y - 0.42, 1.00), (0.035, 0.055, 2.02), rusty_m, 0.003)
        box(f'FRAME_B_{i}', (left_face + 0.008, y + 0.42, 1.00), (0.035, 0.055, 2.02), rusty_m, 0.003)
        box(f'FRAME_TOP_{i}', (left_face + 0.008, y, 1.99), (0.035, 0.88, 0.055), rusty_m, 0.003)
        for j, z in enumerate([0.55, 1.12, 1.62], 1):
            box(f'DOOR_RAIL_{i}_{j}', (left_face + 0.024, y, z), (0.012, 0.66, 0.035), rusty_m, 0.002)
        box(f'LATCH_{i}', (left_face + 0.032, y + 0.26, 0.98), (0.018, 0.13, 0.08), metal_m, 0.003)
        sphere(f'HANDLE_{i}', (left_face + 0.048, y + 0.25, 1.06), (0.022, 0.022, 0.022), rusty_m)
        sphere(f'HAND_GRIME_{i}', (left_face + 0.035, y + 0.25, 1.02), (0.010, 0.13, 0.20), stain_m)

    for i, (y, z, sy, sz) in enumerate([(-3.34, 0.47, 0.35, 0.50), (-0.86, 1.43, 0.27, 0.35), (1.52, 0.40, 0.36, 0.48), (4.00, 1.28, 0.32, 0.40)], 1):
        sphere(f'WALL_REPAIR_{i}', (left_face + 0.010, y, z), (0.012, sy, sz), patch_m)
    for i, (y, z, sy, sz) in enumerate([(-5.0, 0.20, 0.46, 0.18), (-2.9, 0.22, 0.32, 0.20), (-0.2, 0.18, 0.55, 0.17), (2.0, 0.24, 0.38, 0.21), (4.35, 0.19, 0.48, 0.16)], 1):
        sphere(f'HUMIDITY_STAIN_{i}', (left_face + 0.014, y, z), (0.014, sy, sz), stain_m)

    for i, y in enumerate([-4.65, -2.25, 0.18, 2.62, 4.55], 1):
        box(f'JBOX_{i}', (left_face + 0.025, y, 2.00), (0.045, 0.14, 0.16), metal_m, 0.003)
        cyl(f'WIRE_DROP_{i}', (left_face + 0.038, y, 2.18), 0.008, 0.44, rubber_m)
    box('MAIN_CONDUIT', (left_face + 0.025, -0.2, 2.24), (0.032, 9.9, 0.028), rubber_m, 0.002)

    box('WASH_LEDGE', (0.37, 4.70, 0.42), (0.40, 0.78, 0.18), patch_m, 0.010)
    cyl('WATER_PIPE', (0.52, 4.54, 1.02), 0.025, 1.78, metal_m)
    cyl('TAP_NECK', (0.43, 4.43, 1.28), 0.018, 0.28, metal_m, (math.radians(90), 0, 0))
    box('DRAIN', (0.43, 4.35, 0.012), (0.28, 0.74, 0.024), drain_m, 0.002)
    cyl('WASH_BUCKET_A', (0.18, 4.18, 0.15), 0.15, 0.30, plastic_blue)
    cyl('WASH_BUCKET_B', (-0.16, 4.30, 0.13), 0.13, 0.26, plastic_green)

    for i, (x, y, deg) in enumerate([(-0.49, -4.08, 8), (-0.38, -3.82, -12), (-0.50, -1.80, 14), (-0.46, 0.61, -6), (-0.48, 2.98, 10)], 1):
        o = box(f'SLIPPER_{i}', (x, y, 0.028), (0.16, 0.28, 0.035), rubber_m, 0.018)
        o.rotation_euler[2] = math.radians(deg)
    box('USED_CARTON', (0.43, -2.54, 0.15), (0.34, 0.30, 0.30), carton_m, 0.014, (0, 0, math.radians(5)))
    box('SOFT_BAG', (-0.43, 0.92, 0.12), (0.30, 0.25, 0.24), cloth_dark, 0.035, (0, 0, math.radians(-8)))
    cyl('BUCKET_BLUE', (0.45, 2.52, 0.16), 0.16, 0.32, plastic_blue)
    cyl('BUCKET_RED', (0.39, -0.92, 0.14), 0.14, 0.28, plastic_red)
    cyl('REUSED_BOTTLE_A', (-0.49, 2.03, 0.13), 0.036, 0.26, plastic_blue)
    cyl('REUSED_BOTTLE_B', (0.48, -3.38, 0.15), 0.040, 0.30, plastic_green)

    box('STOOL_SEAT', (-0.40, 1.84, 0.30), (0.30, 0.30, 0.055), plastic_blue, 0.025)
    for j, (dx, dy) in enumerate([(-0.11,-0.11),(-0.11,0.11),(0.11,-0.11),(0.11,0.11)], 1):
        box(f'STOOL_LEG_{j}', (-0.40 + dx, 1.84 + dy, 0.15), (0.045, 0.045, 0.30), plastic_blue, 0.012)

    box('LAUNDRY_LINE', (left_face + 0.06, 1.45, 1.82), (0.015, 1.20, 0.015), rubber_m)
    box('TOWEL_PINK', (left_face + 0.08, 1.15, 1.55), (0.025, 0.36, 0.48), cloth_pink, 0.006, (math.radians(2), 0, math.radians(3)))
    box('SHIRT_DARK', (left_face + 0.09, 1.68, 1.58), (0.028, 0.40, 0.44), cloth_dark, 0.008, (math.radians(-2), 0, math.radians(-4)))

    for i, (x,y,sx,sy) in enumerate([(0.14,-3.55,0.42,0.60),(-0.13,-2.80,0.30,0.34),(0.16,-1.12,0.38,0.48),(-0.10,0.15,0.28,0.62),(0.12,2.20,0.34,0.76),(-0.17,3.58,0.44,0.38)], 1):
        sphere(f'WET_PATCH_{i}', (x, y, 0.003), (sx, sy, 0.006), wet_m)
    box('EDGE_DAMP', (open_x - 0.11, 0.2, 0.004), (0.18, 8.5, 0.008), wet_m, 0.004)

    shed_wall_a = noise_mat('outside old masonry', (0.10,0.095,0.075), (0.28,0.25,0.20), 5.0, 4.0, 0.92, 0.12)
    shed_wall_b = noise_mat('outside patched plaster', (0.085,0.10,0.095), (0.23,0.25,0.22), 6.0, 4.0, 0.91, 0.12)
    shed_specs = [(2.05,-4.00,1.68,2.20,1.26,shed_wall_a,7),(2.36,-1.45,2.20,2.45,1.48,shed_wall_b,-5),(2.12,1.65,1.82,2.05,1.18,shed_wall_a,4),(3.55,3.25,2.35,2.50,1.55,shed_wall_b,-7)]
    for i,(x,y,sx,sy,sz,wm,roof_deg) in enumerate(shed_specs,1):
        box(f'EXT_SHED_{i}', (x,y,sz/2), (sx,sy,sz), wm, 0.015)
        roof = box(f'EXT_ROOF_{i}', (x,y,sz+0.10), (sx+0.28,sy+0.30,0.075), roof_m, 0.006)
        roof.rotation_euler[1] = math.radians(roof_deg)
        box(f'EXT_OPENING_{i}', (x-0.35,y-0.5,0.62), (0.05,0.55,0.78), rubber_m, 0.004)

    for i,(x,y) in enumerate([(3.15,-2.55),(3.00,0.55)],1):
        cyl(f'EXT_TANK_{i}', (x,y,0.95), 0.40, 1.48, blue_m, vertices=32)
        cyl(f'EXT_TANK_PIPE_{i}', (x-0.40,y,0.72), 0.03, 1.2, metal_m)
    box('EXT_LAUNDRY_LINE', (2.55,1.35,1.58), (0.018,3.8,0.018), rubber_m)
    for i,(y,m) in enumerate([(0.2,cloth_pink),(0.75,cloth_dark),(1.45,cloth_pink),(2.05,cloth_dark)],1):
        box(f'EXT_LAUNDRY_{i}', (2.53,y,1.34), (0.025,0.42,0.46), m, 0.004)

    box('EXT_DRAIN_CHANNEL', (1.05,0.0,0.02), (0.22,10.5,0.04), drain_m, 0.006)
    for i,y in enumerate([-4.2,-1.4,1.4,4.2],1):
        box(f'EXT_DRAIN_GRATE_{i}', (1.05,y,0.045), (0.20,0.55,0.025), metal_m, 0.003)

    factory_m = noise_mat('distant industrial concrete', (0.14,0.16,0.16), (0.27,0.29,0.29), 3.0, 2.0, 0.80, 0.06)
    box('EXT_FACTORY_A', (7.8,1.7,1.65), (5.8,4.0,3.3), factory_m, 0.02)
    box('EXT_FACTORY_B', (8.4,-4.0,1.35), (4.5,2.8,2.7), factory_m, 0.02)
    for i,(x,y,h) in enumerate([(4.8,-3.8,4.0),(5.2,0.0,3.8),(5.0,3.8,4.2)],1):
        cyl(f'EXT_POLE_{i}', (x,y,h/2), 0.045, h, rusty_m)
    cyl('EXT_CHIMNEY', (8.8,3.7,3.1), 0.13, 5.6, rusty_m, vertices=32)

    for i,y in enumerate([-4.25,-1.55,1.15,3.85],1):
        box(f'FLUOR_FIXTURE_{i}', (-0.10,y,2.355), (0.62,0.08,0.035), fluores_m, 0.004)
        bpy.ops.object.light_add(type='AREA', location=(-0.10,y,2.29))
        l = bpy.context.object
        l.name = f'FLUOR_LIGHT_{i}'
        l.data.energy = 42
        l.data.color = (0.72,0.82,0.88)
        l.data.shape = 'RECTANGLE'
        l.data.size = 0.62
        l.data.size_y = 0.08

    world = bpy.data.worlds.new('WORLD')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.25,0.30,0.34,1.0)
    bg.inputs['Strength'].default_value = 0.30
    bpy.context.scene.world = world
    add_area('OVERCAST_SKY_SIDE', (3.8,-0.3,3.6), (0.0,0.5,1.0), 520, 7.0, (0.70,0.79,0.86))
    add_area('SOFT_FAR_END', (0.1,5.5,2.3), (0.0,1.4,1.0), 180, 3.0, (0.78,0.82,0.82))

    bpy.ops.object.camera_add(location=(0.12,-5.18,1.50))
    cam = bpy.context.object
    cam.name = 'CAM_WIDE_INTERIOR'
    cam.data.lens = 27.0
    cam.data.sensor_width = 36.0
    point_at(cam, (-0.02,1.70,1.13))
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = False
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = -0.46

    output_dir.mkdir(parents=True, exist_ok=True)
    blend_path = output_dir / 'bien-anh-v23-public-bootstrap.blend'
    png_path = output_dir / 'plate-wide-interior-v23-public-bootstrap.png'
    receipt_path = output_dir / 'bien-anh-v23-public-bootstrap-receipt.json'

    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    scene.render.filepath = str(png_path)
    bpy.ops.render.render(write_still=True)

    if not blend_path.is_file() or not png_path.is_file() or png_path.stat().st_size <= 0:
        raise RuntimeError('physical artifacts missing')

    receipt = {
        'schema': 'daube.bien-anh.v23.public-bootstrap.v2',
        'generatedAt': now_iso(),
        'sourceRevision': source_revision,
        'status': 'PHYSICAL_WIDE_REALITY_RETAKE_ARTIFACT_PRODUCED_REVIEW_REQUIRED',
        'privacyClass': 'PUBLIC_DISTRIBUTED_SANITIZED_ENVIRONMENT_ONLY',
        'regionBasis': 'Yangon Region',
        'townshipBasis': 'Hlaing Tharyar',
        'housingArchetype': 'A2_CHEAP_SHARED_WORKER_HOSTEL_LONG_HOUSE',
        'passageMorphology': 'SINGLE_LOADED_SEMI_OPEN',
        'topologyMeters': {'lengthY': PASSAGE_LENGTH, 'widthX': PASSAGE_WIDTH, 'heightZ': HEIGHT},
        'topologyEvidenceStatus': 'REFERENCE_ESTIMATE_CANDIDATE_NOT_MEASURED',
        'camera': {'role': 'PLATE-WIDE-INTERIOR', 'lensMm': 27.0, 'heightM': 1.50},
        'lighting': '06:12 post-rain overcast monsoon morning; broad daylight plus weak fluorescent practicals',
        'retakeTargets': ['remove-greybox-read','motivated-surface-wear','lived-in-edge-clutter','credible-shared-wash-drainage','semi-open-worker-hostel-morphology','non-glamorous-overcast-morning-light','fragmented-industrial-service-edge'],
        'artifacts': {
            'blend': {'name': blend_path.name, 'bytes': blend_path.stat().st_size, 'sha256': sha256(blend_path)},
            'widePng': {'name': png_path.name, 'bytes': png_path.stat().st_size, 'sha256': sha256(png_path)}
        },
        'automaticPaidSpend': False,
        'promotionEligible': False,
        'fanOutEligible': False,
        'truthBoundary': 'Environment-only physical WIDE retake. Geography, socioeconomic, cultural/language, lighting and Founder visual QC are still required before fan-out or location lock.'
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
