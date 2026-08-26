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
v32=v33.v32; v31=v33.v31; v30=v33.v30; v29=v33.v29; v28=v33.v28; v27=v33.v27; v26=v33.v26; v25=v33.v25; v24=v33.v24; pbr=v33.pbr; base=v33.base


def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
def mat(name,color,rough=.8,metal=0.0): return base.solid_mat(name,color,rough,metal)
def box(name,loc,dims,material,bevel=0.0,rot=(0,0,0)): return base.box(name,loc,dims,material,bevel,rot)

def hide_prefixes(prefixes):
    for o in bpy.data.objects:
        if any(o.name.startswith(p) for p in prefixes): o.hide_render=True; o.hide_viewport=True

def hide_names(names):
    for n in names:
        o=bpy.data.objects.get(n)
        if o: o.hide_render=True; o.hide_viewport=True


def add_corr_panel(name,x,y,length,height,material,tilt=0.0,zoff=0.0):
    p=box(name,(x,y,height/2+zoff),(.035,length,height),material,.003,(0,0,math.radians(tilt)))
    p.rotation_euler[1]=math.radians(tilt*.20)
    return p


def add_bare_bulb(name,y,energy=12):
    bulb=mat(name+'_glass',(.70,.74,.69),.45)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,radius=.035,location=(0,y,1.96))
    b=bpy.context.object; b.name=name+'_BULB'; b.data.materials.append(bulb)
    bsdf=b.data.materials[0].node_tree.nodes.get('Principled BSDF') if b.data.materials and b.data.materials[0].use_nodes else None
    if bsdf:
        bsdf.inputs['Emission Color'].default_value=(.58,.66,.58,1); bsdf.inputs['Emission Strength'].default_value=1.3
    cable=mat(name+'_wire',(.012,.013,.012),.98)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.004,depth=.28,location=(0,y,2.12))
    c=bpy.context.object; c.name=name+'_DROP'; c.data.materials.append(cable)
    bpy.ops.object.light_add(type='POINT',location=(0,y,1.94)); l=bpy.context.object; l.name=name+'_LIGHT'; l.data.energy=energy; l.data.color=(.62,.69,.61); l.data.shadow_soft_size=.14


def add_v34_reference_morphology():
    # Remove the formal/semi-open concrete-service-corridor read. Retain only the verified props and causal wear layers.
    hide_names(('LEFT_WALL','RIGHT_WALL'))
    hide_prefixes((
        'V24_CORR_PARTITION_','V24_TIMBER_POST_','V24_CROSS_BRACE_','V24_ROOF_PATCH_',
        'V25_OUTSIDE_','V25_SHED_','V25_BACK_WALL','V25_UTILITY_',
        'V26_WALL_SEG_','V26_JAMB_','V26_HEADER_','V26_DOOR_LEAF_',
        'V28_SERVICE_','V28_DRAIN_','V28_SHED_','V28_UTILITY_','V28_EXT_','V28_REPAIR_',
        'V31_FLUOR_','V32_DOOR_','V33_DOOR_NAIL_'
    ))

    floor=bpy.data.objects.get('FLOOR')
    if floor:
        floor.dimensions.x=.96; floor.location.x=0.0
    corr=bpy.data.materials.get('V29 metric corrugated iron') or v29.metric_pbr('V34 corr',pbr.PBR['roof'],scale=(1.05,1.05,1.05),normal_strength=.60,rough_fallback=.79,metallic=.10)
    timber=bpy.data.materials.get('V29 metric weathered timber') or v29.metric_pbr('V34 timber',v25.WOOD_MAPS,scale=(1.15,1.15,1.15),normal_strength=.48,rough_fallback=.91)
    faded=v31.create_faded_paint('V34 faded patch timber',(.13,.11,.075),(.045,.038,.025))
    tarp_dark=mat('V34 dark weathered tarp',(.025,.032,.030),.88)
    tarp_teal=mat('V34 faded teal tarp',(.028,.12,.12),.84)

    # LEFT: small room fronts interrupted by cheap doors. Coordinates are reference-estimated, not measured.
    door_centers=[-4.45,-2.15,.20,2.65,4.70]
    openings=[(d-.36,d+.36) for d in door_centers]
    cursor=-5.95
    seg=1
    for lo,hi in openings:
        if lo>cursor:
            add_corr_panel(f'V34_LEFT_PANEL_{seg}',-.49,(cursor+lo)/2,lo-cursor,2.08,corr,(-1)**seg*.35); seg+=1
        cursor=hi
    if cursor<5.95: add_corr_panel(f'V34_LEFT_PANEL_{seg}',-.49,(cursor+5.95)/2,5.95-cursor,2.08,corr,.25)

    # Non-uniform cheap doors: mostly plank/corrugated, no boutique-dorm uniformity.
    v32.add_repaired_plank_door('V34_DOOR_1',door_centers[0],-.5,[faded,timber,faded,timber],xhinge=-.49)
    v31.add_corrugated_door('V34_DOOR_2',door_centers[1],-5.5,corr,xhinge=-.49)
    v32.add_repaired_plank_door('V34_DOOR_3',door_centers[2],-10.0,[timber,faded,timber,faded],xhinge=-.49)
    v31.add_corrugated_door('V34_DOOR_4',door_centers[3],2.0,corr,xhinge=-.49)
    v32.add_repaired_plank_door('V34_DOOR_5',door_centers[4],-3.0,[faded,timber,timber,faded],xhinge=-.49)

    # RIGHT: makeshift corrugated partition rather than an airy courtyard; joints deliberately imperfect.
    right_segments=[(-5.35,1.10,-.25),(-4.15,1.15,.35),(-2.88,1.25,-.30),(-1.55,1.18,.22),(-.22,1.28,-.18),(1.15,1.22,.30),(2.48,1.24,-.26),(3.82,1.18,.20),(5.08,.95,-.15)]
    for i,(y,l,t) in enumerate(right_segments,1): add_corr_panel(f'V34_RIGHT_PANEL_{i}',.49,y,l,2.02,corr,t,.01*(i%2))

    # Timber posts are rough support/repair members, not evenly spaced architectural columns.
    for i,(x,y,lean) in enumerate([(-.47,-5.65,.45),(-.47,-3.05,-.35),(-.47,-.85,.30),(-.47,1.65,-.28),(-.47,4.08,.38),(.47,-4.72,-.32),(.47,-1.95,.40),(.47,.78,-.27),(.47,3.42,.33)],1):
        p=box(f'V34_SUPPORT_{i}',(x,y,1.05),(.072,.082,2.12),timber,.004); p.rotation_euler[1]=math.radians(lean)

    # Low patched roof: corrugated + tarp pieces with narrow daylight leaks.
    roof_parts=[(-5.05,1.55,corr,.25),(-3.32,1.45,tarp_dark,-.35),(-1.62,1.62,corr,.18),(.12,1.50,tarp_teal,-.22),(1.84,1.48,corr,.32),(3.52,1.58,tarp_dark,-.28),(5.12,1.35,corr,.18)]
    for i,(y,l,m,t) in enumerate(roof_parts,1):
        r=box(f'V34_ROOF_{i}',(0,y,2.10),(1.04,l,.032),m,.003); r.rotation_euler[1]=math.radians(t)

    # Keep only one weak bare bulb; daylight leaks through roof/joints are primary at 06:12.
    add_bare_bulb('V34_BULB',.95,10)
    base.add_area('V34_ROOF_LEAK_A',(0,-2.55,2.55),(0,0,1),115,1.35,(.64,.73,.74))
    base.add_area('V34_ROOF_LEAK_B',(.05,2.95,2.50),(0,0,1),95,1.15,(.64,.72,.72))

    # Existing verified broom/gallon remain at the common wash end; pull them against the wall in the narrower passage.
    for n,loc in [('V33_GALLON_A',(.34,4.38,.015)),('V33_GALLON_B',(.30,4.68,.015)),('V33_BROOM',(.41,3.92,.015))]:
        o=bpy.data.objects.get(n)
        if o: o.location=loc

    # Sparse clothing uses the circulation edge/roof support, matching real hostel use without staging every bay.
    cloth=mat('V34 washed dark cloth',(.08,.055,.045),.99)
    v32.add_garment('V34_HANGING_SHIRT',(-.47,1.58,1.55),'shirt',cloth,-1.0)

    # Floor tone becomes older/darker; moisture is encoded in roughness/material rather than visible grey cards.
    floor_mat=bpy.data.materials.get('V29 metric damp concrete')
    if floor_mat and floor_mat.use_nodes:
        bsdf=next((n for n in floor_mat.node_tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled'),None)
        if bsdf: bsdf.inputs['Roughness'].default_value=.91

    scene=bpy.context.scene
    scene.view_settings.look='AgX - Medium Low Contrast'; scene.view_settings.exposure=.20
    scene.cycles.samples=72; scene.cycles.use_denoising=True
    scene.render.resolution_x=1280; scene.render.resolution_y=720
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.data.dof.use_dof=False; cam.data.lens=29.0; cam.location=(.02,-5.32,1.49); base.point_at(cam,(-.02,2.15,1.06)); cam.rotation_euler[2]+=math.radians(-.10)


def patch_receipt(out:Path):
    path=out/'bien-anh-v23-public-bootstrap-receipt.json'; r=json.loads(path.read_text(encoding='utf-8'))
    r['schema']='daube.bien-anh.v34.hlaing-tharyar-reference-morphology.v1'; r['visualRetakeVersion']='BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V3.4'; r['status']='PHYSICAL_WIDE_V34_REFERENCE_MORPHOLOGY_PRODUCED_REVIEW_REQUIRED'
    r['morphologyBasis']={'referenceClass':'documented Hlaing Tharyar migrant/private worker-hostel corridor','passageWidthMeters':.96,'widthEvidenceStatus':'REFERENCE_ESTIMATE_NOT_MEASURED','construction':'mixed corrugated sheet + timber repair + patched roof/tarp','note':'Converged toward documented real hostel morphology; not a reconstruction of a named real facility.'}
    r['qcRender']={'samples':72,'resolution':'1280x720','denoising':True,'purpose':'reference-morphology realism gate'}
    r['retakeTargets']=['narrower-reference-estimated-passage','corrugated-timber-room-fronts','patched-low-roof','remove-airy-concrete-service-corridor-read','single-weak-bulb-plus-roof-daylight-leaks','verified-CC0-cleaning-water-props']
    r['automaticPaidSpend']=False; r['promotionEligible']=False; r['fanOutEligible']=False
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'; r['artifacts']['blend']={'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}; r['artifacts']['widePng']={'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    r['truthBoundary']='V3.4 physical WIDE reference-morphology candidate. Geometry dimensions remain reference-estimated, not measured from a specific hostel. No fan-out/location lock until visual/geography/socioeconomic/cultural QC passes.'
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',required=True); ap.add_argument('--source-revision',required=True); args=ap.parse_args(argv)
    v27.pbr.require_assets(); v25.require_v25_assets(); out=Path(args.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    v27.pbr.base.build_scene(out,args.source_revision); v27.v24.add_reality_reconstruction(); v27.v25.add_v25_refinement(); v27.v26.rebuild_room_fronts(); v27.v26.add_threshold_life(); v27.v26.add_real_exterior_plate(); v27.v26.retune_camera_light(); v27.add_v27_documentary_refinement(); v28.add_v28_physical_edge(); v29.retexture_large_surfaces(); v29.clean_and_repopulate(); v29.retune_scene(); v30.add_v30_details(); v31.add_v31_reality(); v32.add_v32_lived_in(); v33.add_v33_scanned_assets(); add_v34_reference_morphology()
    scene=bpy.context.scene; blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'; bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)
    v27.v26.patch_receipt(out); v28.patch_receipt(out); v29.patch_receipt(out); v30.patch_receipt(out); v31.patch_receipt(out); v32.patch_receipt(out); v33.patch_receipt(out); patch_receipt(out); print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))

if __name__=='__main__': main()
