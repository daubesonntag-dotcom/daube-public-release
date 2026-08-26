#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v33.py'
spec=importlib.util.spec_from_file_location('bien_anh_v33',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v33:{P}')
v33=importlib.util.module_from_spec(spec); spec.loader.exec_module(v33)
v32=v33.v32; v31=v33.v31; v30=v33.v30; v29=v33.v29; v28=v33.v28; v27=v33.v27; v26=v33.v26; v25=v33.v25; pbr=v33.pbr; base=v33.base


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

def hide_names(names):
    for n in names:
        o=bpy.data.objects.get(n)
        if o: o.hide_render=True; o.hide_viewport=True


def add_open_bucket(name,loc,radius,height,material):
    return v29.add_open_bucket(name,loc,radius,height,material)


def add_door(name,yc,angle,material,xhinge=-.70,width=.76,height=1.92):
    return v30.add_hinged_door(name,yc,angle,material,width,height,xhinge)


def add_cable(name,pts,radius,material):
    return v28.add_sag_wire(name,pts,radius,material)


def add_garment(name,loc,kind,material,rot=0.0):
    return v32.add_garment(name,loc,kind,material,rot)


def add_v35_reference_authority():
    # V3.5 resets the visible corridor morphology to the founder-approved visual authority:
    # long semi-open worker-hostel balcony, room fronts on one side, concrete parapet/columns on the other.
    # The reference guides morphology and density only; no named real facility is reconstructed.
    hide_names(('LEFT_WALL','RIGHT_WALL'))
    hide_prefixes((
        'V24_','V25_','V26_','V27_','V28_','V29_LAUNDRY_','V29_WASH_BUCKET','V29_BROOM',
        'V30_','V31_','V32_','V33_DOOR_','V33_GALLON_','V33_BROOM',
    ))

    floor_mat=bpy.data.materials.get('V29 metric damp concrete') or v29.metric_pbr(
        'V35 old damp concrete',pbr.PBR['floor'],scale=(1.45,1.45,1.45),normal_strength=.36,rough_fallback=.84)
    plaster=bpy.data.materials.get('V29 metric worn plaster') or v29.metric_pbr(
        'V35 worn plaster',pbr.PBR['wall'],scale=(1.10,1.10,1.10),normal_strength=.38,rough_fallback=.92)
    corr=bpy.data.materials.get('V29 metric corrugated iron') or v29.metric_pbr(
        'V35 corrugated iron',pbr.PBR['roof'],scale=(1.12,1.12,1.12),normal_strength=.62,rough_fallback=.77,metallic=.10)
    timber=bpy.data.materials.get('V29 metric weathered timber') or v29.metric_pbr(
        'V35 weathered timber',v25.WOOD_MAPS,scale=(1.18,1.18,1.18),normal_strength=.48,rough_fallback=.90)
    concrete=mat('V35 stained structural concrete',(.29,.28,.25),.95)
    dark=mat('V35 room darkness',(.012,.013,.012),.99)
    cable=mat('V35 cable rubber',(.009,.010,.009),.98)
    metal=mat('V35 dull utility metal',(.12,.125,.115),.68,.18)
    bluepaint=v31.create_faded_paint('V35 faded blue-grey door',(.20,.25,.25),(.065,.07,.065))
    brownpaint=v31.create_faded_paint('V35 faded brown door',(.20,.12,.072),(.060,.038,.026))
    cloth_dark=mat('V35 washed dark cloth',(.055,.065,.072),.99)
    cloth_pink=mat('V35 washed pale pink cloth',(.36,.18,.22),.99)
    cloth_white=mat('V35 aged light cloth',(.55,.54,.49),.99)
    plastic_blue=mat('V35 cheap blue plastic',(.03,.15,.20),.84)
    plastic_green=mat('V35 cheap green plastic',(.04,.20,.14),.84)

    # Corridor proportions: 1.40 m clear passage, 12 m run, 2.48 m roof datum.
    floor=bpy.data.objects.get('FLOOR')
    if floor:
        floor.hide_render=False; floor.hide_viewport=False
        floor.location=(0,0,-.035); floor.dimensions=(1.40,12.0,.07)
        floor.data.materials.clear(); floor.data.materials.append(floor_mat)

    # Left room-front wall, segmented around five non-uniform doors.
    door_centers=[-4.55,-2.20,.18,2.62,4.72]
    openings=[(d-.42,d+.42) for d in door_centers]
    cursor=-5.98; seg=1
    for lo,hi in openings:
        if lo>cursor:
            box(f'V35_LEFT_WALL_{seg}',(-.74,(cursor+lo)/2,1.18),(.10,lo-cursor,2.36),plaster,.006); seg+=1
        cursor=hi
    if cursor<5.98:
        box(f'V35_LEFT_WALL_{seg}',(-.74,(cursor+5.98)/2,1.18),(.10,5.98-cursor,2.36),plaster,.006)

    # Dark room depth behind door openings.
    for i,y in enumerate(door_centers,1):
        box(f'V35_ROOM_DARK_{i}',(-1.12,y,1.00),(.62,.80,2.0),dark,.002)

    # Door states intentionally nonuniform: closed, ajar, patched, old blue-grey.
    add_door('V35_DOOR_1',door_centers[0],-1.5,brownpaint,xhinge=-.70)
    add_door('V35_DOOR_2',door_centers[1],-8.0,bluepaint,xhinge=-.70)
    add_door('V35_DOOR_3',door_centers[2],-16.0,timber,xhinge=-.70)
    add_door('V35_DOOR_4',door_centers[3],3.5,bluepaint,xhinge=-.70)
    add_door('V35_DOOR_5',door_centers[4],-4.0,brownpaint,xhinge=-.70)

    # Door jambs/headers and cheap hardware.
    for i,y in enumerate(door_centers,1):
        box(f'V35_JAMB_A_{i}',(-.70,y-.44,1.02),(.09,.08,2.04),timber,.004)
        box(f'V35_JAMB_B_{i}',(-.70,y+.44,1.02),(.09,.08,2.04),timber,.004)
        box(f'V35_HEADER_{i}',(-.70,y,2.02),(.09,.90,.09),timber,.004)
        box(f'V35_LATCH_{i}',(-.655,y+.24,1.03),(.035,.10,.07),metal,.003)

    # Right open edge: parapet + irregularly weathered concrete columns.
    box('V35_PARAPET',(.63,0,.46),(.18,12.0,.92),concrete,.01)
    col_y=[-5.55,-3.55,-1.52,.55,2.62,4.68]
    for i,y in enumerate(col_y,1):
        c=box(f'V35_COLUMN_{i}',(.63,y,1.43),(.20,.20,2.86),concrete,.01)
        c.rotation_euler[1]=math.radians(((-1)**i)*.10)

    # Roof: corrugated continuous run with timber/steel purlins, like a practical hostel balcony.
    box('V35_ROOF',(0,0,2.48),(1.62,12.15,.055),corr,.004)
    for i,y in enumerate([-5.6,-4.0,-2.4,-.8,.8,2.4,4.0,5.6],1):
        box(f'V35_ROOF_BEAM_{i}',(0,y,2.36),(1.58,.065,.10),timber,.004)

    # Under-maintained fluorescent tubes, daylight remains dominant.
    for i,(y,energy) in enumerate([(-3.25,24),(-.15,22),(3.05,20)],1):
        v31.add_undermaintained_practical(f'V35_FLUOR_{i}',y,energy)

    # Old electrical boxes and exposed cable runs along the wall.
    for i,(y,z) in enumerate([(-5.1,1.34),(-3.1,1.58),(-.75,1.42),(1.25,1.72),(3.65,1.40)],1):
        box(f'V35_EBOX_{i}',(-.68,y,z),(.08,.15,.20),metal,.004)
    add_cable('V35_CABLE_MAIN',[(-.68,-5.75,2.13),(-.68,-3.2,2.06),(-.68,-.6,2.15),(-.68,2.0,2.02),(-.68,5.65,2.10)],.008,cable)
    add_cable('V35_CABLE_DROP',[(-.68,-.75,2.15),(-.68,-.75,1.75),(-.68,-.75,1.42)],.005,cable)

    # Lived-in threshold clutter. High-information, asymmetric, no art-directed repetition.
    rubber=mat('V35 worn sandal rubber',(.018,.018,.016),.96)
    for name,loc,rot in [
        ('A1',(-.49,-4.30,.015),7),('A2',(-.36,-4.10,.015),-12),
        ('B1',(-.49,-2.02,.015),4),('B2',(-.33,-1.86,.015),-8),
        ('C1',(-.46,.46,.015),10),('D1',(-.43,2.90,.015),-5),('D2',(-.30,3.03,.015),12),
    ]:
        v29.add_slipper(f'V35_SLIPPER_{name}',loc,rot=rot,material=rubber)
    add_open_bucket('V35_BUCKET_A',(-.42,-.82,.015),.14,.27,plastic_blue)
    add_open_bucket('V35_BUCKET_B',(-.40,3.65,.015),.13,.25,plastic_green)
    add_open_bucket('V35_BUCKET_C',(.43,4.70,.015),.15,.29,plastic_blue)

    # Re-use verified scanned props where available, placed against wall/common-use zones.
    for n,loc,scale in [
        ('V33_GALLON_A',(-.48,-5.05,.015),(.72,.72,.72)),
        ('V33_GALLON_B',(-.46,-4.80,.015),(.65,.65,.65)),
        ('V33_BROOM',(-.48,1.12,.02),(.82,.82,.82)),
    ]:
        o=bpy.data.objects.get(n)
        if o:
            o.hide_render=False; o.hide_viewport=False; o.location=loc; o.scale=scale

    # Cheap blue rack near first room; contents are simple because distant/detail scale is low.
    rackmat=mat('V35 blue rack plastic',(.02,.12,.18),.80)
    for z in (.18,.54,.90): box(f'V35_RACK_SHELF_{z}',(-.47,-5.32,z),(.45,.48,.035),rackmat,.005)
    for x in (-.65,-.29):
        for y in (-5.52,-5.12): box(f'V35_RACK_POST_{x}_{y}',(x,y,.54),(.035,.035,1.08),rackmat,.004)

    # Clothes/hanging traces around doors and exterior settlement.
    add_garment('V35_SHIRT_A',(-.69,-1.18,1.63),'shirt',cloth_dark,-1.5)
    add_garment('V35_TOWEL_A',(-.68,1.82,1.60),'towel',cloth_pink,.5)
    add_garment('V35_SHIRT_B',(-.69,3.38,1.62),'shirt',cloth_white,1.2)

    # Industrial-worker settlement outside: layered low roofs, service lanes, tanks, utility poles.
    ground=mat('V35 outside wet ground',(.11,.105,.09),.93)
    box('V35_OUT_GROUND',(3.3,0,-.20),(5.0,12.5,.16),ground,.01)
    roofmat=corr
    wallmat=plaster
    sheds=[
        (2.4,-4.4,1.05,2.3,1.8,1.70,-2.0),(4.2,-3.2,1.00,2.8,2.0,1.62,1.2),
        (2.7,-.8,1.08,2.5,1.9,1.72,-1.0),(4.3,.9,1.02,2.7,2.1,1.64,1.8),
        (2.5,3.2,1.06,2.4,1.8,1.68,-1.4),(4.4,4.3,1.03,2.8,2.0,1.65,.8),
    ]
    for i,(x,y,z,w,d,h,rz) in enumerate(sheds,1):
        box(f'V35_OUT_WALL_{i}',(x,y,h/2-.08),(w,d,h),wallmat,.006,(0,0,math.radians(rz)))
        box(f'V35_OUT_ROOF_{i}',(x,y,h+.04),(w+.35,d+.35,.055),roofmat,.004,(0,math.radians((i%3-1)*1.8),math.radians(rz)))
    # Water tanks and utility poles are simple distant silhouettes.
    tankmat=mat('V35 blue water tank',(.025,.17,.25),.58)
    for i,(x,y) in enumerate([(3.0,-2.6),(4.1,2.6)],1):
        bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.38,depth=.72,location=(x,y,1.48)); t=bpy.context.object; t.name=f'V35_WATER_TANK_{i}'; t.data.materials.append(tankmat)
    for i,(x,y) in enumerate([(2.0,-5.4),(4.7,-1.8),(2.2,4.8)],1):
        box(f'V35_OUT_POLE_{i}',(x,y,1.75),(.075,.075,3.5),timber,.005)
    add_cable('V35_OUT_WIRE_A',[(2.0,-5.4,2.8),(3.4,-3.3,2.55),(4.7,-1.8,2.75)],.005,cable)
    add_cable('V35_OUT_WIRE_B',[(4.7,-1.8,2.58),(3.5,1.4,2.30),(2.2,4.8,2.55)],.005,cable)

    # Distant laundry lines between sheds.
    line=mat('V35 laundry line',(.03,.03,.028),.97)
    add_cable('V35_LAUNDRY_LINE_A',[(2.0,-.1,1.55),(4.4,.1,1.48)],.003,line)
    add_cable('V35_LAUNDRY_LINE_B',[(2.1,3.5,1.45),(4.5,3.7,1.42)],.003,line)
    for i,(x,y,z,c) in enumerate([(2.5,0,1.43,cloth_white),(3.0,.03,1.40,cloth_pink),(3.6,.05,1.41,cloth_dark),(2.6,3.6,1.34,cloth_pink),(3.3,3.63,1.31,cloth_white),(3.9,3.65,1.33,cloth_dark)],1):
        v29.add_drape_dense(f'V35_OUT_CLOTH_{i}',(x,y,z),.30,.48,c,.035,i*.4)

    # Industrial chimney silhouette — distant context, not tied to a named real factory.
    chimney=mat('V35 chimney concrete',(.24,.235,.22),.91)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.12,depth=4.2,location=(5.0,4.9,2.10)); ch=bpy.context.object; ch.name='V35_DISTANT_CHIMNEY'; ch.data.materials.append(chimney)

    # Wet-floor logic: shallow irregular strips near open edge and traffic path, not mirror-like puddle cards.
    wet=mat('V35 shallow wet film',(.055,.055,.050),.34)
    for i,(x,y,sx,sy,rz) in enumerate([(.20,-4.9,.46,.95,2),(.18,-2.8,.40,.72,-3),(.16,-.7,.48,.86,1),(.20,1.55,.44,.80,-2),(.17,3.75,.50,.92,3)],1):
        box(f'V35_WET_PATCH_{i}',(x,y,.009),(sx,sy,.006),wet,.002,(0,0,math.radians(rz)))

    # Overcast 06:12 lighting: broad daylight from open side, weak practicals still on.
    v28.configure_hdri()
    for o in bpy.data.objects:
        if o.type=='LIGHT' and not o.name.startswith('V35_FLUOR'):
            o.hide_render=True; o.hide_viewport=True
    base.add_area('V35_OPEN_SKY',(3.1,.15,3.7),(0,.15,1.0),470,7.0,(.71,.77,.80))

    scene=bpy.context.scene
    scene.view_settings.look='AgX - Medium Low Contrast'; scene.view_settings.exposure=.38
    scene.cycles.samples=64; scene.cycles.use_denoising=True
    scene.render.resolution_x=1280; scene.render.resolution_y=720; scene.render.resolution_percentage=100
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.data.dof.use_dof=False; cam.data.lens=24.0; cam.location=(.03,-5.34,1.55); base.point_at(cam,(-.05,2.20,1.10)); cam.rotation_euler[2]+=math.radians(-.08)


def build_v35_scene(out:Path,source_revision:str):
    v27.pbr.require_assets(); v25.require_v25_assets(); out.mkdir(parents=True,exist_ok=True)
    v27.pbr.base.build_scene(out,source_revision)
    v27.v24.add_reality_reconstruction(); v27.v25.add_v25_refinement(); v27.v26.rebuild_room_fronts(); v27.v26.add_threshold_life(); v27.v26.add_real_exterior_plate(); v27.v26.retune_camera_light(); v27.add_v27_documentary_refinement(); v28.add_v28_physical_edge(); v29.retexture_large_surfaces(); v29.clean_and_repopulate(); v29.retune_scene(); v30.add_v30_details(); v31.add_v31_reality(); v32.add_v32_lived_in(); v33.add_v33_scanned_assets(); add_v35_reference_authority()
    return bpy.context.scene


def patch_receipt(out:Path):
    path=out/'bien-anh-v23-public-bootstrap-receipt.json'; r=json.loads(path.read_text(encoding='utf-8'))
    r['schema']='daube.bien-anh.v35.founder-visual-authority.v1'; r['visualRetakeVersion']='BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V3.5'; r['status']='PHYSICAL_WIDE_V35_VISUAL_AUTHORITY_PRODUCED_REVIEW_REQUIRED'
    r['morphologyBasis']={'referenceClass':'founder-approved semi-open Hlaing Tharyar worker-hostel visual authority','passageWidthMeters':1.40,'widthEvidenceStatus':'FOUNDER_VISUAL_AUTHORITY_CANDIDATE_NOT_MEASURED','construction':'worn plaster room-front wall + old mixed doors + concrete parapet/columns + corrugated roof + exposed utilities + industrial-worker settlement outside','canonClock':'2026-06-14 06:12 Asia/Yangon','note':'Visual reference overlay year is not story canon; V3.5 preserves the locked 2026 story clock. No named real facility is reconstructed.'}
    r['qcRender']={'samples':64,'resolution':'1280x720','denoising':True,'purpose':'founder visual-authority morphology + lived-in realism gate'}
    r['retakeTargets']=['semi-open-balcony-corridor','worn-plaster-and-mixed-door-history','concrete-parapet-columns','post-rain-wet-floor','threshold-life-density','industrial-worker-settlement-exterior','overcast-0612-light','no-gibberish-signage']
    r['automaticPaidSpend']=False; r['promotionEligible']=False; r['fanOutEligible']=False
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'; r['artifacts']['blend']={'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}; r['artifacts']['widePng']={'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    r['truthBoundary']='V3.5 physical WIDE candidate matched to founder-approved visual authority. No fan-out/location lock until visual/geography/socioeconomic/cultural QC passes.'
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',required=True); ap.add_argument('--source-revision',required=True); args=ap.parse_args(argv)
    out=Path(args.output_dir).resolve(); scene=build_v35_scene(out,args.source_revision)
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)
    v27.v26.patch_receipt(out); v28.patch_receipt(out); v29.patch_receipt(out); v30.patch_receipt(out); v31.patch_receipt(out); v32.patch_receipt(out); v33.patch_receipt(out); patch_receipt(out)
    print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))

if __name__=='__main__': main()
