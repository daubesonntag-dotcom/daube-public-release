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
ASSETS = HERE / "assets_runtime"
V35_PATH = HERE / "bootstrap_scene_reality_v35.py"
spec = importlib.util.spec_from_file_location("bien_anh_v35", V35_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"unable_to_load_v35:{V35_PATH}")
v35 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v35)
base = v35.base

STATUS = "FINAL_REALITY_LOCK_WIDE_CANDIDATE_REVIEW_REQUIRED"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_image(name: str):
    p = ASSETS / name
    if not p.exists() or p.stat().st_size == 0:
        raise RuntimeError(f"missing_asset:{p}")
    return bpy.data.images.load(str(p), check_existing=True)


def world_pbr(name: str, diff_name: str, normal_name: str, rough_name: str, coord_obj, scale=(1.0, 1.0, 1.0), tint=None, normal_strength=0.35, rough_bias=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    texcoord = nt.nodes.new("ShaderNodeTexCoord")
    texcoord.object = coord_obj
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (*scale,)
    nt.links.new(texcoord.outputs["Object"], mapping.inputs["Vector"])

    diff = nt.nodes.new("ShaderNodeTexImage")
    diff.image = load_image(diff_name)
    nt.links.new(mapping.outputs["Vector"], diff.inputs["Vector"])
    if tint is not None:
        mix = nt.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 0.55
        mix.inputs[2].default_value = (*tint, 1.0)
        nt.links.new(diff.outputs["Color"], mix.inputs[1])
        nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        nt.links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])

    rough = nt.nodes.new("ShaderNodeTexImage")
    rough.image = load_image(rough_name)
    rough.image.colorspace_settings.name = "Non-Color"
    nt.links.new(mapping.outputs["Vector"], rough.inputs["Vector"])
    if rough_bias:
        mathnode = nt.nodes.new("ShaderNodeMath")
        mathnode.operation = "ADD"
        mathnode.inputs[1].default_value = rough_bias
        nt.links.new(rough.outputs["Color"], mathnode.inputs[0])
        nt.links.new(mathnode.outputs["Value"], bsdf.inputs["Roughness"])
    else:
        nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])

    normal_tex = nt.nodes.new("ShaderNodeTexImage")
    normal_tex.image = load_image(normal_name)
    normal_tex.image.colorspace_settings.name = "Non-Color"
    nt.links.new(mapping.outputs["Vector"], normal_tex.inputs["Vector"])
    normal = nt.nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = normal_strength
    nt.links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
    nt.links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def photo_backdrop():
    image = load_image("hlaing_thar_yar_hut_cc0_1600.jpg")
    mat = bpy.data.materials.new("FINAL CC0 Hlaing Thar Yar distant plate")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    emission = nt.nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 0.72
    nt.links.new(tex.outputs["Color"], emission.inputs["Color"])
    nt.links.new(emission.outputs["Emission"], out.inputs["Surface"])

    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(6.25, 0.35, 1.68), rotation=(0.0, math.radians(90.0), 0.0))
    p = bpy.context.object
    p.name = "FINAL_CC0_DISTANT_SETTLEMENT_PLATE"
    p.scale = (1.75, 6.45, 1.0)
    p.data.materials.append(mat)
    return p


def apply_final_reality_lock(scene):
    # Keep the V3.5 corridor morphology, but replace the most procedural-looking
    # large surfaces with continuous world-space PBR and use a licensed CC0
    # Hlaing Thar Yar image only as distant VFX set-extension beyond 3D parallax geometry.
    coord = bpy.data.objects.new("FINAL_WORLD_TEXCOORD", None)
    bpy.context.scene.collection.objects.link(coord)
    coord.location = (0.17, -0.31, 0.08)

    wall_mat = world_pbr(
        "FINAL continuous worn plaster",
        "worn_plaster_wall_diff_2k.jpg",
        "worn_plaster_wall_nor_gl_2k.jpg",
        "worn_plaster_wall_rough_2k.jpg",
        coord,
        scale=(0.48, 0.48, 0.48),
        normal_strength=0.42,
        rough_bias=0.05,
    )
    floor_mat = world_pbr(
        "FINAL continuous worn damp concrete",
        "dirty_concrete_diff_2k.jpg",
        "dirty_concrete_nor_gl_2k.jpg",
        "dirty_concrete_rough_2k.jpg",
        coord,
        scale=(0.72, 0.72, 0.72),
        normal_strength=0.30,
        rough_bias=0.06,
    )
    roof_mat = world_pbr(
        "FINAL continuous worn corrugated roof",
        "worn_corrugated_iron_diff_2k.jpg",
        "worn_corrugated_iron_nor_gl_2k.jpg",
        "worn_corrugated_iron_rough_2k.jpg",
        coord,
        scale=(0.55, 0.55, 0.55),
        normal_strength=0.55,
        rough_bias=0.02,
    )
    blue_door = world_pbr(
        "FINAL faded blue painted timber",
        "weathered_planks_diff_2k.jpg",
        "weathered_planks_nor_gl_2k.jpg",
        "weathered_planks_rough_2k.jpg",
        coord,
        scale=(0.80, 0.80, 0.80),
        tint=(0.27, 0.36, 0.39),
        normal_strength=0.38,
        rough_bias=0.08,
    )
    brown_door = world_pbr(
        "FINAL faded brown painted timber",
        "weathered_planks_diff_2k.jpg",
        "weathered_planks_nor_gl_2k.jpg",
        "weathered_planks_rough_2k.jpg",
        coord,
        scale=(0.76, 0.76, 0.76),
        tint=(0.38, 0.24, 0.15),
        normal_strength=0.38,
        rough_bias=0.08,
    )

    for obj in bpy.data.objects:
        if obj.name.startswith("V35_LEFT_WALL_"):
            obj.data.materials.clear(); obj.data.materials.append(wall_mat)
        elif obj.name == "FLOOR":
            obj.data.materials.clear(); obj.data.materials.append(floor_mat)
        elif obj.name == "V35_ROOF":
            obj.data.materials.clear(); obj.data.materials.append(roof_mat)
        elif obj.name in {"V35_DOOR_1", "V35_DOOR_4"}:
            obj.data.materials.clear(); obj.data.materials.append(blue_door)
        elif obj.name in {"V35_DOOR_2", "V35_DOOR_5"}:
            obj.data.materials.clear(); obj.data.materials.append(brown_door)

    # The old procedural outside boxes were the strongest CG cue.
    # Keep a few foreground tanks/poles/laundry for parallax, hide boxy settlement shells.
    for obj in bpy.data.objects:
        if obj.name.startswith("V35_OUT_WALL_") or obj.name.startswith("V35_OUT_ROOF_"):
            obj.hide_render = True
            obj.hide_viewport = True
    photo_backdrop()

    # Add a few imperfect corrugated foreground roof strips so the photo plate
    # reads as distant settlement depth, not as a card pasted against the parapet.
    corr = roof_mat
    for i, (x, y, z, sx, sy, rz) in enumerate([
        (2.55, -3.9, 1.35, 2.2, 2.1, -1.4),
        (3.05, -0.9, 1.20, 2.4, 2.0, 1.1),
        (2.70, 2.55, 1.28, 2.3, 2.2, -0.8),
    ], 1):
        o = base.box(f"FINAL_PARALLAX_ROOF_{i}", (x, y, z), (sx, sy, 0.045), corr, 0.003, (0, math.radians((i-2)*1.3), math.radians(rz)))
        o.rotation_euler[2] += math.radians(rz)

    # Break pristine verticals slightly; tiny construction drift only.
    for i in range(1, 7):
        o = bpy.data.objects.get(f"V35_COLUMN_{i}")
        if o:
            o.rotation_euler[1] += math.radians(((-1) ** i) * (0.13 + 0.02 * i))
            o.rotation_euler[2] += math.radians((i - 3.5) * 0.025)

    # Photographic QC profile: enough detail to judge realism, still fast.
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1536
    scene.render.resolution_y = 864
    scene.render.resolution_percentage = 100
    scene.view_settings.look = "AgX - Medium Low Contrast"
    scene.view_settings.exposure = 0.22

    cam = bpy.data.objects.get("CAM_WIDE_INTERIOR")
    if cam:
        cam.data.lens = 24.0
        cam.location = (0.025, -5.28, 1.56)
        base.point_at(cam, (-0.04, 2.45, 1.06))


def patch_receipt(out: Path):
    path = out / "bien-anh-v23-public-bootstrap-receipt.json"
    r = json.loads(path.read_text(encoding="utf-8"))
    r["schema"] = "daube.bien-anh.final-reality-lock.v1"
    r["status"] = STATUS
    r["visualAuthority"] = "Founder-approved real-world Hlaing Tharyar semi-open worker-hostel reference"
    r["renderProfile"] = {"samples": 32, "resolution": "1536x864", "denoising": True, "purpose": "FINAL REALITY LOCK photographic WIDE gate"}
    r["vfxSetExtension"] = {"asset": "hlaing_thar_yar_hut_cc0_1600.jpg", "license": "CC0 / Wikimedia Commons provenance", "role": "distant exterior only", "topologyAuthority": False}
    r["promotionEligible"] = False
    r["fanOutEligible"] = False
    r["automaticPaidSpend"] = False
    r["truthBoundary"] = "Single FINAL REALITY LOCK WIDE candidate. No shot/fan-out/location lock until Founder photographic, geography, socioeconomic and cultural QC PASS."
    blend = out / "bien-anh-v23-public-bootstrap.blend"
    png = out / "plate-wide-interior-v23-public-bootstrap.png"
    r["artifacts"]["blend"] = {"name": blend.name, "bytes": blend.stat().st_size, "sha256": sha256(blend)}
    r["artifacts"]["widePng"] = {"name": png.name, "bytes": png.stat().st_size, "sha256": sha256(png)}
    path.write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--source-revision", required=True)
    args = ap.parse_args(argv)

    out = Path(args.output_dir).resolve()
    scene = v35.build_v35_scene(out, args.source_revision)
    apply_final_reality_lock(scene)
    blend = out / "bien-anh-v23-public-bootstrap.blend"
    png = out / "plate-wide-interior-v23-public-bootstrap.png"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    scene.render.filepath = str(png)
    bpy.ops.render.render(write_still=True)
    v35.v27.v26.patch_receipt(out)
    v35.v28.patch_receipt(out)
    v35.v29.patch_receipt(out)
    v35.v30.patch_receipt(out)
    v35.v31.patch_receipt(out)
    v35.v32.patch_receipt(out)
    v35.v33.patch_receipt(out)
    v35.patch_receipt(out)
    patch_receipt(out)
    print(json.dumps(json.loads((out / "bien-anh-v23-public-bootstrap-receipt.json").read_text(encoding="utf-8")), ensure_ascii=False))


if __name__ == "__main__":
    main()
