#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v31.py'
spec=importlib.util.spec_from_file_location('bien_anh_v31',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v31:{P}')
v31=importlib.util.module_from_spec(spec); spec.loader.exec_module(v31)
v30=v31.v30; v29=v31.v29; v28=v31.v28; v27=v31.v27; v26=v31.v26; v25=v31.v25; v24=v31.v24; pbr=v31.pbr; base=v31.base


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


def add_repaired_plank_door(name,yc,angle_deg,materials,width=.72,height=1.90,xhinge=-.515):
    th=math.radians(angle_deg); hinge_y=yc-width/2
    widths=[.132,.145,.128,.151,.141]
    offsets=[0.0,.006,-.004,.008,-.005]
    cursor=0.0
    for i,(pw,off) in enumerate(zip(widths,offsets),1):
        local_y=cursor+pw/2
        cx=xhinge-math.sin(th)*local_y + off*math.cos(th)
        cy=hinge_y+math.cos(th)*local_y + off*math.sin(th)
        plank=box(f'{name}_PLANK_{i}',(cx,cy,height/2+.03+(i%2)*.003),(.036,pw-.006,height-(i%3)*.006),materials[(i-1)%len(materials)],.004,(0,0,th))
        plank.rotation_euler[1]=math.radians((i-3)*.23)
        cursor+=pw
    brace=materials[-1]
    for j,z in enumerate((.54,1.47),1):
        local_y=width*.49
        cx=xhinge-math.sin(th)*local_y+.018*math.cos(th)
        cy=hinge_y+math.cos(th)*local_y+.018*math.sin(th)
        box(f'{name}_BRACE_{j}',(cx,cy,z),(.052,width-.10,.052),brace,.004,(0,0,th+math.radians(.6 if j==1 else -.4)))
    metal=mat(name+'_oxidized_hardware',(.075,.078,.068),.72,.24)
    for k,z in enumerate((.36,1.48),1):
        box(f'{name}_HINGE_{k}',(-.486,hinge_y+.032,z),(.027,.082,.052),metal,.002,(0,0,th))
    local_y=width*.78; cx=xhinge-math.sin(th)*local_y; cy=hinge_y+math.cos(th)*local_y
    box(name+'_LATCH',(cx+.02,cy,1.01),(.024,.095,.055),metal,.002,(0,0,th))


def add_garment(name,loc,kind,material,rot_deg=0.0):
    x,y,z=loc
    if kind=='shirt':
        pts=[(-.18,.22),(-.08,.28),(-.045,.20),(.045,.20),(.08,.28),(.18,.22),(.13,.10),(.08,.14),(.07,-.27),(-.07,-.27),(-.08,.14),(-.13,.10)]
    elif kind=='pants':
        pts=[(-.12,.27),(.12,.27),(.10,.02),(.085,-.30),(.015,-.30),(0.0,-.02),(-.015,-.30),(-.085,-.30),(-.10,.02)]
    else:
        pts=[(-.14,.23),(.14,.23),(.13,-.23),(-.13,-.23)]
    verts=[(x,y+px,z+pz) for px,pz in pts]
    mesh=bpy.data.meshes.new(name+'_MESH'); mesh.from_pydata(verts,[],[tuple(range(len(verts)))]); mesh.update()
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj); obj.rotation_euler[0]=math.radians(1.2); obj.rotation_euler[2]=math.radians(rot_deg); obj.data.materials.append(material)
    sol=obj.modifiers.new('cloth-thickness','SOLIDIFY'); sol.thickness=.0025
    sub=obj.modifiers.new('cloth-soften','SUBSURF'); sub.levels=1; sub.render_levels=1
    return obj


def add_jerrycan(name,loc,material,rot_deg=0.0):
    x,y,z=loc
    body=box(name,(x,y,z+.19),(.22,.16,.38),material,.025,(0,0,math.radians(rot_deg)))
    # handle reads as a real carry void rather than another box-prop silhouette.
    handle_mat=material
    box(name+'_HANDLE_TOP',(x,y,z+.43),(.11,.035,.025),handle_mat,.01,(0,0,math.radians(rot_deg)))
    box(name+'_HANDLE_L',(x-.048,y,z+.395),(.022,.035,.08),handle_mat,.008,(0,0,math.radians(rot_deg)))
    box(name+'_HANDLE_R',(x+.048,y,z+.395),(.022,.035,.08),handle_mat,.008,(0,0,math.radians(rot_deg)))
    return body


def add_irregular_floor_mark(name,x,y,sx,sy,material,phase):
    pts=[]
    for i in range(12):
        a=2*math.pi*i/12
        rr=1.0+.18*math.sin(i*1.9+phase)+.08*math.cos(i*.8-phase)
        pts.append((x+math.cos(a)*sx*rr,y+math.sin(a)*sy*rr,.006))
    mesh=bpy.data.meshes.new(name+'_MESH'); mesh.from_pydata(pts,[],[tuple(range(len(pts)))]); mesh.update()
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj); obj.data.materials.append(material)
    return obj


def add_room_depth():
    woven=mat('V32 thin sleeping mat',(0.14,.105,.055),.96)
    cloth=mat('V32 folded blanket',(.10,.075,.055),.99)
    dark=mat('V32 room shadow',(.014,.015,.014),.99)
    # room 3: a small occupied volume visible only through the curtain gap.
    box('V32_ROOM3_BACK',(-1.18,.35,1.02),(.05,.72,1.95),dark,.002)
    box('V32_ROOM3_SLEEP_MAT',(-.92,.34,.026),(.50,.60,.025),woven,.004,(0,0,math.radians(3)))
    box('V32_ROOM3_FOLDED_BLANKET',(-.95,.53,.075),(.30,.20,.075),cloth,.018,(0,0,math.radians(-4)))


def add_v32_lived_in():
    # Remove the last visually flat/regular elements identified in V3.1 physical QC.
    hide_prefixes(('V31_DOOR_1_','V31_DOOR_2_','V31_DOOR_4','V29_LAUNDRY_A','V29_LAUNDRY_B','V30_ROOM3_POT'))

    timber=bpy.data.materials.get('V29 metric weathered timber') or v29.metric_pbr('V32 timber',v25.WOOD_MAPS,scale=(1.2,1.2,1.2),normal_strength=.45,rough_fallback=.90)
    faded_a=v31.create_faded_paint('V32 faded smoke-blue paint',(.145,.18,.17),(.055,.06,.052))
    faded_b=v31.create_faded_paint('V32 faded brown paint',(.16,.09,.045),(.045,.03,.018))
    bare=v31.create_faded_paint('V32 bare repaired timber',(.22,.13,.065),(.075,.045,.023))
    corr=bpy.data.materials.get('V29 metric corrugated iron') or v29.metric_pbr('V32 corr',pbr.PBR['roof'],scale=(1.1,1.1,1.1),normal_strength=.58,rough_fallback=.79,metallic=.10)

    add_repaired_plank_door('V32_DOOR_1',-4.45,-1.2,[faded_a,bare,faded_a,bare])
    add_repaired_plank_door('V32_DOOR_2',-2.05,-9.0,[faded_b,bare,faded_b,bare])
    # Corrugated room-4 door gets an improvised timber repair strip and slight non-square alignment.
    v31.add_corrugated_door('V32_DOOR_4',2.75,2.2,corr)
    box('V32_DOOR_4_REPAIR',(-.485,2.84,1.08),(.055,.53,.055),timber,.004,(0,0,math.radians(2.2)))

    # Human-use traces stay concentrated at thresholds/common wash edge.
    cloth_maroon=mat('V32 washed maroon garment',(.16,.045,.042),.99)
    cloth_blue=mat('V32 washed blue-grey garment',(.055,.085,.10),.99)
    cloth_beige=mat('V32 sun-faded beige garment',(.25,.205,.15),.99)
    add_garment('V32_SHIRT_A',(-.487,-2.72,1.48),'shirt',cloth_maroon,-1.5)
    add_garment('V32_PANTS_A',(-.486,-2.42,1.45),'pants',cloth_blue,1.2)
    add_garment('V32_TOWEL_A',(-.486,3.10,1.42),'towel',cloth_beige,-.8)

    plastic=mat('V32 faded water-can plastic',(.035,.105,.11),.86)
    add_jerrycan('V32_WATER_CAN_A',(0.34,4.38,.01),plastic,-4)
    add_jerrycan('V32_WATER_CAN_B',(0.30,4.72,.01),plastic,5)

    # Functional electrical repair history.
    boxmat=mat('V32 aged junction box',(.09,.095,.085),.71,.17)
    cable=mat('V32 black cable rubber',(.012,.013,.012),.98)
    box('V32_JUNCTION_A',(-.505,-.72,1.84),(.05,.14,.17),boxmat,.003)
    v28.add_sag_wire('V32_DROP_A',[(-.49,-.72,1.93),(-.485,-.70,1.55),(-.49,-.62,1.30)],.0048,cable)
    box('V32_TAPED_SPLICE',(-.492,1.90,1.88),(.025,.085,.035),cable,.004)

    # Repeating wall texture is broken by motivated repair/stain overlays rather than random dirt everywhere.
    patch=mat('V32 pale cement repair',(.19,.18,.15),.98)
    darkdamp=mat('V32 humid base stain',(.058,.052,.043),.99)
    for i,(y,z,sy,sz,ph) in enumerate([(-3.72,.74,.20,.28,.3),(-1.18,1.18,.15,.22,1.1),(1.12,.62,.22,.20,2.0),(3.62,1.08,.17,.24,2.8)],1):
        v27.add_irregular_grime(f'V32_REPAIR_{i}',-.496,y,z,sy,sz,patch,ph)
    for i,(y,sy,ph) in enumerate([(-4.55,.34,.5),(-2.15,.24,1.4),(.52,.28,2.2),(3.42,.30,3.1)],1):
        v27.add_irregular_grime(f'V32_BASE_STAIN_{i}',-.495,y,.13,sy,.12,darkdamp,ph)

    # Cleaning traffic / post-rain moisture follows the circulation path, not decorative puddle symmetry.
    wet=mat('V32 tracked damp concrete',(.055,.058,.053),.72)
    for i,(x,y,sx,sy,ph) in enumerate([(.04,-3.42,.16,.46,.2),(-.02,-1.30,.12,.38,1.0),(.06,1.08,.13,.42,1.8),(.10,3.68,.16,.48,2.6)],1):
        add_irregular_floor_mark(f'V32_MOP_TRACK_{i}',x,y,sx,sy,wet,ph)

    add_room_depth()

    # Practical tubes should read old and weak, not pristine studio bars.
    for o in bpy.data.objects:
        if o.name.startswith('V31_FLUOR_') and o.type=='MESH':
            o.scale.y*=.92
    for o in bpy.data.objects:
        if o.name.startswith('V31_FLUOR_') and o.type=='LIGHT':
            o.data.energy*=.72
            o.data.color=(.66,.72,.66)

    scene=bpy.context.scene
    scene.view_settings.look='AgX - Medium Low Contrast'; scene.view_settings.exposure=.38
    scene.cycles.samples=56; scene.cycles.use_denoising=True
    scene.render.resolution_x=1280; scene.render.resolution_y=720
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.data.dof.use_dof=False; cam.data.lens=35.0; cam.location=(-.015,-5.02,1.47); base.point_at(cam,(-.11,2.42,1.06)); cam.rotation_euler[2]+=math.radians(-.04)


def patch_receipt(out:Path):
    path=out/'bien-anh-v23-public-bootstrap-receipt.json'; r=json.loads(path.read_text(encoding='utf-8'))
    r['schema']='daube.bien-anh.v32.lived-in-causal-wear.v1'; r['visualRetakeVersion']='BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V3.2'; r['status']='PHYSICAL_WIDE_V32_LIVED_IN_REALISM_PRODUCED_REVIEW_REQUIRED'
    r['qcRender']={'samples':56,'resolution':'1280x720','denoising':True,'purpose':'lived-in causal-wear realism gate'}
    r['retakeTargets']=['irregular-repaired-door-planks','garment-silhouette-not-flat-panel','threshold-water-storage','functional-electrical-repair-history','motived-wall-repair-overlays','tracked-post-rain-cleaning-moisture','occupied-room-depth','weaker-aged-practicals']
    r['automaticPaidSpend']=False; r['promotionEligible']=False; r['fanOutEligible']=False
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'; r['artifacts']['blend']={'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}; r['artifacts']['widePng']={'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    r['truthBoundary']='V3.2 physical WIDE candidate. Still review-required; no fan-out/location lock until visual/geography/socioeconomic/cultural QC passes.'
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',required=True); ap.add_argument('--source-revision',required=True); args=ap.parse_args(argv)
    v27.pbr.require_assets(); v25.require_v25_assets(); out=Path(args.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    v27.pbr.base.build_scene(out,args.source_revision); v27.v24.add_reality_reconstruction(); v27.v25.add_v25_refinement(); v27.v26.rebuild_room_fronts(); v27.v26.add_threshold_life(); v27.v26.add_real_exterior_plate(); v27.v26.retune_camera_light(); v27.add_v27_documentary_refinement(); v28.add_v28_physical_edge(); v29.retexture_large_surfaces(); v29.clean_and_repopulate(); v29.retune_scene(); v30.add_v30_details(); v31.add_v31_reality(); add_v32_lived_in()
    scene=bpy.context.scene; blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'; bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)
    v27.v26.patch_receipt(out); v28.patch_receipt(out); v29.patch_receipt(out); v30.patch_receipt(out); v31.patch_receipt(out); patch_receipt(out); print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))

if __name__=='__main__': main()
