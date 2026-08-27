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
BASE_PATH = HERE / "final_reality_lock.py"
spec = importlib.util.spec_from_file_location("final_lock_base", BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"unable_to_load_final_lock:{BASE_PATH}
")
final = importlib.util.module_from_spec(spec)
spec.loader.exec_module(final)
v35 = final.v35
base = final.base

STATUS = "FINAL_REALITY_LOCK_WIDE_CANDIDATE_REVIEW_REQUIRED"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def box_projection(material):
    if not material or not material.use_nodes:
        return
    for node in material.node_tree.nodes:
        if node.bl_idname == "ShaderNodeTexImage":
            node.projection = "BOX"
            node.projection_blend = 0.18


def converge_scene(scene):
    final.apply_final_reality_lock(scene)

    # Fix the actual projection defect that made vertical surfaces turn into stripes.
    for name in (
        "FINAL continuous worn plaster",
        "FINAL continuous worn damp concrete",
        "FINAL continuous worn corrugated roof",
        "FINAL faded blue painted timber",
        "FINAL faded brown painted timber",
    ):
        box_projection(bpy.data.materials.get(name))

    wall_mat = bpy.data.materials.get("FINAL continuous worn plaster")
    floor_mat = bpy.data.materials.get("FINAL continuous worn damp concrete")
    roof_mat = bpy.data.materials.get("FINAL continuous worn corrugated roof")

    # Remove the photographic card entirely: it was visibly a card in physical pixels.
    plate = bpy.data.objects.get("FINAL_CC0_DISTANT_SETTLEMENT_PLATE")
    if plate:
        plate.hide_render = True
        plate.hide_viewport = True

    # Remove rectangular puddle cards. Wetness now comes from the continuous floor PBR.
    for obj in bpy.data.objects:
        if obj.name.startswith("V35_WET_PATCH_"):
            obj.hide_render = True
            obj.hide_viewport = True

    # Concrete parapet/columns need the same physical wear language as the hostel wall.
    for obj in bpy.data.objects:
        if obj.name == "V35_PARAPET" or obj.name.startswith("V35_COLUMN_"):
            if wall_mat and hasattr(obj.data, "materials"):
                obj.data.materials.clear(); obj.data.materials.append(wall_mat)

    # Restore the authored exterior shells, but make them PBR instead of flat boxes.
    for obj in bpy.data.objects:
        if obj.name.startswith("V35_OUT_WALL_"):
            obj.hide_render = False; obj.hide_viewport = False
            if wall_mat:
                obj.data.materials.clear(); obj.data.materials.append(wall_mat)
        elif obj.name.startswith("V35_OUT_ROOF_"):
            obj.hide_render = False; obj.hide_viewport = False
            if roof_mat:
                obj.data.materials.clear(); obj.data.materials.append(roof_mat)

    # Dense low-rise worker-settlement depth: overlapping roofs at multiple distances.
    # Deterministic placements, no named real facility reconstruction.
    if wall_mat and roof_mat:
        layers = [
            (2.05,-5.25,1.04,1.55,1.15,1.52,-2.2),
            (3.35,-4.85,.98,2.05,1.25,1.46,1.3),
            (4.65,-4.20,1.08,2.20,1.35,1.62,-1.0),
            (2.25,-3.05,.96,1.85,1.30,1.44,.7),
            (3.60,-2.55,1.05,2.30,1.40,1.58,-1.7),
            (4.85,-1.65,1.00,2.10,1.35,1.50,1.1),
            (2.20,-.70,1.02,1.80,1.25,1.53,-.8),
            (3.65,.05,1.08,2.25,1.40,1.62,1.5),
            (4.85,.95,.96,2.15,1.30,1.44,-1.2),
            (2.15,1.85,1.05,1.90,1.30,1.58,.8),
            (3.55,2.75,1.00,2.30,1.45,1.50,-1.4),
            (4.75,3.55,1.07,2.15,1.35,1.61,.9),
            (2.35,4.55,.98,1.85,1.25,1.47,-.6),
            (3.85,5.00,1.04,2.20,1.35,1.56,1.2),
        ]
        for i,(x,y,z,w,d,h,rz) in enumerate(layers,1):
            wall = base.box(f"FINAL_SETTLEMENT_WALL_{i}",(x,y,h/2-.10),(w,d,h),wall_mat,.008,(0,0,math.radians(rz)))
            roof = base.box(f"FINAL_SETTLEMENT_ROOF_{i}",(x,y,h+.035),(w+.30,d+.32,.052),roof_mat,.004,(0,math.radians(((i%3)-1)*1.1),math.radians(rz)))

    # Add practical tanks in varied sizes for readable lived infrastructure.
    tank_mat = bpy.data.materials.get("V35 blue water tank")
    if tank_mat:
        for i,(x,y,r,h) in enumerate([(2.7,-3.7,.28,.62),(4.0,-.95,.36,.78),(2.6,2.45,.31,.68),(4.35,4.15,.35,.76)],1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r,depth=h,location=(x,y,1.20+h/2))
            o=bpy.context.object; o.name=f"FINAL_WATER_TANK_{i}"; o.data.materials.append(tank_mat)

    # Add a second laundry layer nearer the open side for parallax and human scale.
    line_mat = bpy.data.materials.get("V35 laundry line")
    cloth_a = bpy.data.materials.get("V35 aged light cloth")
    cloth_b = bpy.data.materials.get("V35 washed pale pink cloth")
    cloth_c = bpy.data.materials.get("V35 washed dark cloth")
    if line_mat and cloth_a and cloth_b and cloth_c:
        v35.add_cable("FINAL_LAUNDRY_LINE_NEAR",[(1.55,-1.95,1.52),(4.35,-1.75,1.45)],.003,line_mat)
        for i,(x,y,z,mat) in enumerate([(1.95,-1.84,1.40,cloth_a),(2.55,-1.82,1.37,cloth_b),(3.22,-1.79,1.39,cloth_c),(3.82,-1.77,1.36,cloth_a)],1):
            v35.v29.add_drape_dense(f"FINAL_LAUNDRY_{i}",(x,y,z),.29,.46,mat,.033,i*.7)

    # Neutral documentary exposure; no bright studio-white concrete.
    scene.view_settings.look = "AgX - Medium Low Contrast"
    scene.view_settings.exposure = 0.42
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1536
    scene.render.resolution_y = 864


def patch_receipt(out: Path):
    path = out / "bien-anh-v23-public-bootstrap-receipt.json"
    r = json.loads(path.read_text(encoding="utf-8"))
    r["schema"] = "daube.bien-anh.final-reality-lock.v2"
    r["status"] = STATUS
    r["internalConvergence"] = {
        "projectionFix": "BOX_0.18",
        "photoCardRemoved": True,
        "rectangularWetCardsRemoved": True,
        "exterior": "dense layered 3D worker-settlement PBR",
        "newVersionLabelCreated": False,
    }
    r["promotionEligible"] = False
    r["fanOutEligible"] = False
    r["automaticPaidSpend"] = False
    r["truthBoundary"] = "FINAL REALITY LOCK only. WIDE must pass Founder visual + geography + socioeconomic + cultural QC before shot/fan-out."
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
    converge_scene(scene)
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
    final.patch_receipt(out)
    patch_receipt(out)
    print(json.dumps(json.loads((out / "bien-anh-v23-public-bootstrap-receipt.json").read_text(encoding="utf-8")), ensure_ascii=False))


if __name__ == "__main__":
    main()
