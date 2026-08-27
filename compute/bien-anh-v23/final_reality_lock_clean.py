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
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets_runtime"
STATUS = "FINAL_REALITY_LOCK_WIDE_CANDIDATE_REVIEW_REQUIRED"


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.materials, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        pass


def load_image(name: str, noncolor=False):
    p = ASSETS / name
    if not p.exists() or p.stat().st_size == 0:
        raise RuntimeError(f"missing_asset:{p}")
    img = bpy.data.images.load(str(p), check_existing=True)
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    return img


def pbr_mat(name, diff, normal, rough, scale=1.0, tint=None, normal_strength=.35, wet=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])

    d = nt.nodes.new("ShaderNodeTexImage")
    d.image = load_image(diff)
    d.projection = "BOX"; d.projection_blend = .22
    nt.links.new(mapping.outputs["Vector"], d.inputs["Vector"])
    if tint:
        mix = nt.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"; mix.inputs[0].default_value = .48
        mix.inputs[2].default_value = (*tint, 1.0)
        nt.links.new(d.outputs["Color"], mix.inputs[1])
        nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        nt.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])

    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = load_image(normal, True); n.projection = "BOX"; n.projection_blend = .22
    nt.links.new(mapping.outputs["Vector"], n.inputs["Vector"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = normal_strength
    nt.links.new(n.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])

    r = nt.nodes.new("ShaderNodeTexImage")
    r.image = load_image(rough, True); r.projection = "BOX"; r.projection_blend = .22
    nt.links.new(mapping.outputs["Vector"], r.inputs["Vector"])
    if wet:
        noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 2.1; noise.inputs["Detail"].default_value = 5.0; noise.inputs["Roughness"].default_value = .72
        nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].position = .34; ramp.color_ramp.elements[0].color = (.16,.16,.16,1)
        ramp.color_ramp.elements[1].position = .67; ramp.color_ramp.elements[1].color = (.74,.74,.74,1)
        nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])

    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def solid(name, color, rough=.8, metal=0.0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    b=m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value=(*color,1); b.inputs["Roughness"].default_value=rough; b.inputs["Metallic"].default_value=metal
    return m


def box(name, loc, dims, mat, bevel=.01, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o=bpy.context.object; o.name=name; o.dimensions=dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat: o.data.materials.append(mat)
    if bevel:
        mod=o.modifiers.new("soft worn edges","BEVEL"); mod.width=bevel; mod.segments=2
    return o


def cyl(name, loc, radius, depth, mat, vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    o=bpy.context.object; o.name=name
    if mat: o.data.materials.append(mat)
    return o


def cable(name, pts, mat, radius=.006):
    cu=bpy.data.curves.new(name,"CURVE"); cu.dimensions="3D"; cu.bevel_depth=radius; cu.bevel_resolution=2; cu.resolution_u=8
    sp=cu.splines.new("BEZIER"); sp.bezier_points.add(len(pts)-1)
    for bp,p in zip(sp.bezier_points,pts):
        bp.co=p; bp.handle_left_type="AUTO"; bp.handle_right_type="AUTO"
    o=bpy.data.objects.new(name,cu); bpy.context.collection.objects.link(o); cu.materials.append(mat); return o


def point_at(obj, target):
    direction=Vector(target)-obj.location
    obj.rotation_euler=direction.to_track_quat("-Z","Y").to_euler()


def door_panel(name, y, mat, timber, angle=0.0):
    slab=box(name,(-.705,y,1.02),(.065,.80,1.98),mat,.008,(0,0,math.radians(angle)))
    # framed panel details close to camera-facing side
    x=-.667
    box(name+"_rail_top",(x,y,1.72),(.025,.66,.075),timber,.003)
    box(name+"_rail_mid",(x,y,1.08),(.025,.66,.065),timber,.003)
    box(name+"_rail_bot",(x,y,.34),(.025,.66,.075),timber,.003)
    box(name+"_stile_a",(x,y-.31,1.03),(.025,.055,1.75),timber,.003)
    box(name+"_stile_b",(x,y+.31,1.03),(.025,.055,1.75),timber,.003)
    return slab


def slipper(name, x, y, rot, mat):
    o=box(name,(x,y,.025),(.11,.28,.045),mat,.025,(0,0,math.radians(rot)))
    return o


def add_garment(name, loc, dims, mat, rot=0):
    o=box(name,loc,(dims[0],.018,dims[1]),mat,.006,(0,0,math.radians(rot)))
    return o


def build_scene(out: Path, revision: str):
    reset_scene()
    out.mkdir(parents=True,exist_ok=True)

    plaster=pbr_mat("FINAL worn plaster","worn_plaster_wall_diff_2k.jpg","worn_plaster_wall_nor_gl_2k.jpg","worn_plaster_wall_rough_2k.jpg",1.15,normal_strength=.45)
    floor=pbr_mat("FINAL post rain concrete","dirty_concrete_diff_2k.jpg","dirty_concrete_nor_gl_2k.jpg","dirty_concrete_rough_2k.jpg",1.1,normal_strength=.32,wet=True)
    roof=pbr_mat("FINAL old corrugated roof","worn_corrugated_iron_diff_2k.jpg","worn_corrugated_iron_nor_gl_2k.jpg","worn_corrugated_iron_rough_2k.jpg",1.1,normal_strength=.55)
    wood=pbr_mat("FINAL weathered wood","weathered_planks_diff_2k.jpg","weathered_planks_nor_gl_2k.jpg","weathered_planks_rough_2k.jpg",1.15,normal_strength=.45)
    door_blue=pbr_mat("FINAL blue painted old wood","weathered_planks_diff_2k.jpg","weathered_planks_nor_gl_2k.jpg","weathered_planks_rough_2k.jpg",1.15,tint=(.30,.40,.43),normal_strength=.38)
    door_brown=pbr_mat("FINAL brown painted old wood","weathered_planks_diff_2k.jpg","weathered_planks_nor_gl_2k.jpg","weathered_planks_rough_2k.jpg",1.15,tint=(.43,.29,.19),normal_strength=.38)
    dark=solid("FINAL room dark",(.012,.013,.012),.98)
    cablemat=solid("FINAL cable",(.012,.012,.011),.97)
    metal=solid("FINAL dull metal",(.13,.14,.14),.62,.15)
    concrete=plaster
    plastic_blue=solid("FINAL blue plastic",(.025,.18,.28),.78)
    plastic_green=solid("FINAL green plastic",(.03,.24,.16),.80)
    plastic_black=solid("FINAL black rubber",(.015,.016,.015),.95)
    cloth_white=solid("FINAL aged light cloth",(.61,.60,.54),.98)
    cloth_pink=solid("FINAL faded pink cloth",(.43,.23,.28),.98)
    cloth_dark=solid("FINAL dark cloth",(.07,.08,.09),.98)

    # Main corridor: 1.40m clear passage, 14m run.
    box("FLOOR",(0,0,-.045),(1.42,14.0,.09),floor,.008)
    box("PARAPET",(.63,0,.46),(.18,14.0,.92),concrete,.012)
    box("ROOF",(0,0,2.52),(1.78,14.2,.055),roof,.004)

    door_y=[-5.65,-4.12,-2.58,-1.02,.56,2.17,3.82,5.42]
    openings=[(y-.43,y+.43) for y in door_y]
    cursor=-6.95
    for i,(lo,hi) in enumerate(openings,1):
        if lo>cursor:
            box(f"LEFT_WALL_{i}",(-.76,(cursor+lo)/2,1.20),(.12,lo-cursor,2.40),plaster,.008)
        cursor=hi
    if cursor<6.95:
        box("LEFT_WALL_END",(-.76,(cursor+6.95)/2,1.20),(.12,6.95-cursor,2.40),plaster,.008)

    for i,y in enumerate(door_y,1):
        box(f"ROOM_DARK_{i}",(-1.06,y,1.00),(.52,.82,2.00),dark,.002)
        box(f"JAMB_A_{i}",(-.70,y-.43,1.02),(.09,.075,2.04),wood,.004)
        box(f"JAMB_B_{i}",(-.70,y+.43,1.02),(.09,.075,2.04),wood,.004)
        box(f"HEADER_{i}",(-.70,y,2.02),(.09,.90,.09),wood,.004)
        dm=door_blue if i in (1,2,4,6,8) else door_brown
        door_panel(f"DOOR_{i}",y,dm,wood,angle=0 if i not in (3,7) else (-3.5 if i==3 else 2.8))
        box(f"LATCH_{i}",(-.655,y+.25,1.02),(.035,.085,.06),metal,.003)

    # Open side columns and roof beams, slightly irregular.
    for i,y in enumerate([-6.55,-4.70,-2.82,-.93,.98,2.90,4.83,6.60],1):
        c=box(f"COLUMN_{i}",(.63,y,1.44),(.205,.205,2.88),concrete,.012)
        c.rotation_euler[1]=math.radians(((-1)**i)*(.10+.015*i))
    for i,y in enumerate([-6.4,-4.8,-3.2,-1.6,0,1.6,3.2,4.8,6.4],1):
        box(f"BEAM_{i}",(0,y,2.39),(1.68,.075,.105),wood,.004)

    # Utility wiring and boxes along lived wall.
    for i,(y,z) in enumerate([(-6.1,1.35),(-4.7,1.55),(-3.25,1.42),(-1.7,1.65),(.0,1.38),(1.7,1.57),(3.4,1.42),(5.2,1.62)],1):
        box(f"EBOX_{i}",(-.685,y,z),(.075,.15,.19),metal,.004)
    cable("MAIN_CABLE",[(-.69,-6.6,2.14),(-.69,-4.7,2.06),(-.69,-2.8,2.14),(-.69,-.9,2.04),(-.69,1.0,2.13),(-.69,3.0,2.03),(-.69,5.2,2.11),(-.69,6.6,2.07)],cablemat,.008)

    # Lived-in threshold traces.
    for j,(x,y,r) in enumerate([(-.48,-5.28,8),(-.35,-5.08,-11),(-.49,-3.75,4),(-.34,-3.58,-7),(-.47,-2.15,10),(-.45,-.62,-4),(-.34,-.49,12),(-.47,2.54,7),(-.34,2.70,-8),(-.45,4.16,5)],1):
        slipper(f"SLIPPER_{j}",x,y,r,plastic_black)
    for j,(x,y,rad,h,mat) in enumerate([(-.42,-4.92,.15,.28,plastic_blue),(-.40,-1.92,.14,.26,plastic_green),(-.43,1.18,.15,.29,plastic_blue),(-.42,4.62,.14,.26,plastic_green)],1):
        cyl(f"BUCKET_{j}",(x,y,h/2+.005),rad,h,mat)

    # Foreground blue rack with water containers.
    for z in (.19,.56,.93): box(f"RACK_SHELF_{z}",(-.47,-6.15,z),(.46,.53,.035),plastic_blue,.006)
    for x in (-.66,-.28):
        for y in (-6.38,-5.92): box(f"RACK_POST_{x}_{y}",(x,y,.56),(.038,.038,1.12),plastic_blue,.004)
    for i,(x,y,z,r,h) in enumerate([(-.52,-6.16,.34,.095,.32),(-.40,-6.14,.70,.10,.34),(-.55,-6.12,1.04,.09,.28)],1):
        bottle=cyl(f"WATER_{i}",(x,y,z),r,h,solid(f"water plastic {i}",(.10,.24,.28),.32),32)

    # Small garments and towels near doors.
    add_garment("TOWEL_1",(-.675,-3.12,1.55),(.34,.58),cloth_pink,-1)
    add_garment("SHIRT_1",(-.675,.95,1.62),(.34,.48),cloth_dark,1)
    add_garment("TOWEL_2",(-.675,4.45,1.57),(.30,.54),cloth_white,-1)

    # Exterior worker-settlement depth, low roofs and utility infrastructure.
    ground=solid("FINAL outside wet earth",(.095,.09,.075),.90)
    box("OUT_GROUND",(3.3,0,-.20),(5.3,14.5,.18),ground,.01)
    layers=[
        (2.2,-5.8,1.50,2.0,1.5,-2.0),(3.9,-5.0,1.62,2.6,1.7,1.2),(2.4,-3.5,1.46,2.2,1.55,-1.1),(4.3,-2.8,1.58,2.8,1.8,1.6),
        (2.3,-1.2,1.52,2.15,1.55,.6),(4.2,-.6,1.64,2.75,1.8,-1.3),(2.4,1.2,1.48,2.2,1.6,1.0),(4.4,1.9,1.60,2.9,1.85,-1.4),
        (2.3,3.5,1.55,2.25,1.55,-.8),(4.1,4.2,1.62,2.7,1.8,1.1),(2.5,5.7,1.48,2.3,1.55,-1.0),(4.5,5.9,1.56,2.7,1.75,.7),
    ]
    for i,(x,y,h,w,d,rz) in enumerate(layers,1):
        box(f"OUT_WALL_{i}",(x,y,h/2-.08),(w,d,h),plaster,.008,(0,0,math.radians(rz)))
        box(f"OUT_ROOF_{i}",(x,y,h+.04),(w+.35,d+.35,.055),roof,.004,(0,math.radians(((i%3)-1)*1.4),math.radians(rz)))
    for i,(x,y,r,h) in enumerate([(2.8,-4.2,.32,.72),(4.25,-1.7,.40,.86),(2.7,2.6,.34,.76),(4.3,4.8,.38,.82)],1):
        cyl(f"OUT_TANK_{i}",(x,y,1.18+h/2),r,h,plastic_blue)
    for i,(x,y) in enumerate([(2.0,-6.2),(4.8,-2.2),(2.2,2.0),(4.7,6.0)],1):
        box(f"POLE_{i}",(x,y,1.8),(.075,.075,3.6),wood,.006)
    cable("OUT_WIRE_A",[(2.0,-6.2,2.85),(3.5,-4.0,2.55),(4.8,-2.2,2.78)],cablemat,.005)
    cable("OUT_WIRE_B",[(4.8,-2.2,2.62),(3.4,.0,2.35),(2.2,2.0,2.62),(3.4,4.0,2.42),(4.7,6.0,2.66)],cablemat,.005)
    cable("LAUNDRY_LINE",[(1.8,.35,1.52),(4.4,.55,1.44)],cablemat,.003)
    for i,(x,y,z,mat) in enumerate([(2.1,.42,1.30,cloth_white),(2.65,.46,1.28,cloth_pink),(3.2,.49,1.31,cloth_dark),(3.75,.52,1.27,cloth_white)],1):
        add_garment(f"OUT_CLOTH_{i}",(x,y,z),(.28,.48),mat,0)

    # Fluorescent practicals with low intensity.
    emission=solid("tube white",(.82,.86,.85),.32)
    for i,y in enumerate([-4.2,-1.4,1.5,4.3],1):
        tube=box(f"TUBE_{i}",(0,y,2.34),(.055,.78,.035),emission,.008)
        data=bpy.data.lights.new(f"TUBE_LIGHT_{i}","AREA"); data.energy=18; data.shape="RECTANGLE"; data.size=.75; data.size_y=.05; data.color=(.73,.80,.82)
        lo=bpy.data.objects.new(f"TUBE_LIGHT_{i}",data); bpy.context.collection.objects.link(lo); lo.location=(0,y,2.28); lo.rotation_euler=(0,0,0)

    # HDRI world.
    world=bpy.data.worlds.new("FINAL_WORLD"); bpy.context.scene.world=world; world.use_nodes=True
    wn=world.node_tree.nodes; wl=world.node_tree.links
    for n in list(wn): wn.remove(n)
    outw=wn.new("ShaderNodeOutputWorld"); bg=wn.new("ShaderNodeBackground"); bg.inputs["Strength"].default_value=.42
    env=wn.new("ShaderNodeTexEnvironment"); env.image=load_image("overcast_soil_puresky_1k.hdr")
    wl.new(env.outputs["Color"],bg.inputs["Color"]); wl.new(bg.outputs["Background"],outw.inputs["Surface"])

    # Broad morning light from open side.
    ld=bpy.data.lights.new("OPEN_SKY","AREA"); ld.energy=520; ld.shape="RECTANGLE"; ld.size=7.5; ld.size_y=13.0; ld.color=(.72,.78,.82)
    lo=bpy.data.objects.new("OPEN_SKY",ld); bpy.context.collection.objects.link(lo); lo.location=(3.8,0,3.8); point_at(lo,(0,0,1.0))

    # Camera.
    cd=bpy.data.cameras.new("CAM_WIDE"); cam=bpy.data.objects.new("CAM_WIDE",cd); bpy.context.collection.objects.link(cam)
    cam.location=(.025,-6.35,1.55); cd.lens=24.0; cd.sensor_width=36.0; cd.dof.use_dof=False; point_at(cam,(-.04,2.65,1.08)); bpy.context.scene.camera=cam

    scene=bpy.context.scene
    scene.render.engine="BLENDER_EEVEE_NEXT" if False else "CYCLES"
    scene.cycles.samples=48; scene.cycles.use_denoising=True
    scene.render.resolution_x=1536; scene.render.resolution_y=864; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"; scene.render.image_settings.color_mode="RGB"; scene.render.film_transparent=False
    scene.view_settings.look="AgX - Medium Low Contrast"; scene.view_settings.exposure=.36

    blend=out/"bien-anh-final-reality-lock.blend"; png=out/"EP01_SC01_SH01_CAM01_WIDE_FINAL_REALITY_LOCK.png"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)

    receipt={
        "schema":"daube.bien-anh.final-reality-lock.clean.v1",
        "generatedAt":now_iso(),
        "sourceRevision":revision,
        "status":STATUS,
        "privacyClass":"PUBLIC_DISTRIBUTED_SANITIZED_ENVIRONMENT_ONLY",
        "sceneAuthority":"CLEAN_REBUILD_FROM_ZERO_NO_V2_V3_INHERITANCE",
        "visualAuthority":"Founder-approved real-world Hlaing Tharyar semi-open worker-hostel reference",
        "storyClock":"2026-06-14 06:12 Asia/Yangon post-rain",
        "camera":{"lensMm":24,"heightM":1.55,"resolution":"1536x864"},
        "render":{"engine":"Cycles","samples":48,"denoising":True},
        "automaticPaidSpend":False,"promotionEligible":False,"fanOutEligible":False,
        "artifacts":{"blend":{"name":blend.name,"bytes":blend.stat().st_size,"sha256":sha256(blend)},"widePng":{"name":png.name,"bytes":png.stat().st_size,"sha256":sha256(png)}},
        "truthBoundary":"FINAL REALITY LOCK WIDE candidate only. Founder visual + geography + socioeconomic + cultural QC required before shot/fan-out/location lock."
    }
    rp=out/"FINAL_REALITY_LOCK_RECEIPT.json"; rp.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return scene


def main():
    argv=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    ap=argparse.ArgumentParser(); ap.add_argument("--output-dir",required=True); ap.add_argument("--source-revision",required=True); args=ap.parse_args(argv)
    build_scene(Path(args.output_dir).resolve(),args.source_revision)


if __name__=="__main__": main()
