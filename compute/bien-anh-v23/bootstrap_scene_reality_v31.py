#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v30.py'
spec=importlib.util.spec_from_file_location('bien_anh_v30',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v30:{P}')
v30=importlib.util.module_from_spec(spec); spec.loader.exec_module(v30)
v29=v30.v29; v28=v30.v28; v27=v30.v27; v26=v30.v26; v25=v30.v25; v24=v30.v24; pbr=v30.pbr; base=v30.base


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


def create_faded_paint(name,base_color,edge_color):
    m=bpy.data.materials.new(name); m.use_nodes=True; nt=m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out=nt.nodes.new('ShaderNodeOutputMaterial'); bsdf=nt.nodes.new('ShaderNodeBsdfPrincipled')
    tex=nt.nodes.new('ShaderNodeTexCoord'); noise=nt.nodes.new('ShaderNodeTexNoise'); ramp=nt.nodes.new('ShaderNodeValToRGB'); bump=nt.nodes.new('ShaderNodeBump')
    noise.inputs['Scale'].default_value=7.0; noise.inputs['Detail'].default_value=5.0; noise.inputs['Roughness'].default_value=.74
    ramp.color_ramp.elements[0].color=(*edge_color,1); ramp.color_ramp.elements[1].color=(*base_color,1)
    bsdf.inputs['Roughness'].default_value=.91; bump.inputs['Strength'].default_value=.12; bump.inputs['Distance'].default_value=.02
    nt.links.new(tex.outputs['Object'],noise.inputs['Vector']); nt.links.new(noise.outputs['Fac'],ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'],bsdf.inputs['Base Color']); nt.links.new(noise.outputs['Fac'],bump.inputs['Height']); nt.links.new(bump.outputs['Normal'],bsdf.inputs['Normal']); nt.links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
    return m


def add_plank_door(name,yc,angle_deg,material,brace_material,width=.72,height=1.90,xhinge=-.515):
    th=math.radians(angle_deg); hinge_y=yc-width/2
    plank_w=width/5.0
    for i in range(5):
        local_y=(i+.5)*plank_w
        cx=xhinge-math.sin(th)*local_y
        cy=hinge_y+math.cos(th)*local_y
        plank=box(f'{name}_PLANK_{i+1}',(cx,cy,height/2+.03),(.038,plank_w-.006,height),material,.006,(0,0,th))
        plank.rotation_euler[1]=math.radians((i-2)*.20)
    for j,z in enumerate((.55,1.50),1):
        local_y=width/2
        cx=xhinge-math.sin(th)*local_y+.02*math.cos(th)
        cy=hinge_y+math.cos(th)*local_y+.02*math.sin(th)
        box(f'{name}_BRACE_{j}',(cx,cy,z),(.055,width-.08,.055),brace_material,.004,(0,0,th))
    return (th,hinge_y)


def add_corrugated_door(name,yc,angle_deg,material,width=.72,height=1.90,xhinge=-.515):
    th=math.radians(angle_deg); hinge_y=yc-width/2; local_y=width/2
    cx=xhinge-math.sin(th)*local_y; cy=hinge_y+math.cos(th)*local_y
    leaf=box(name,(cx,cy,height/2+.03),(.032,width,height),material,.004,(0,0,th))
    # cheap welded frame strips
    frame=mat(name+'_frame',(.09,.095,.085),.65,.25)
    for z in (.18,1.74): box(name+f'_H_{z}',(cx+.015*math.cos(th),cy+.015*math.sin(th),z),(.035,width-.06,.035),frame,.002,(0,0,th))
    return leaf


def add_hardware(name,yc,angle_deg,width=.72):
    th=math.radians(angle_deg); hinge_y=yc-width/2
    metal=mat(name+'_metal',(.09,.095,.085),.62,.31)
    # hinge plates at real hinge side
    for i,z in enumerate((.38,1.52),1):
        box(f'{name}_HINGE_{i}',(-.485,hinge_y+.035,z),(.028,.09,.055),metal,.002,(0,0,th))
    # latch near free edge
    local_y=width*.78; cx=-.515-math.sin(th)*local_y; cy=hinge_y+math.cos(th)*local_y
    box(name+'_LATCH',(cx+.022,cy,1.02),(.025,.10,.06),metal,.003,(0,0,th))


def add_undermaintained_practical(name,y,energy):
    diffuser=mat(name+'_aged_diffuser',(.61,.68,.65),.62)
    tube=box(name+'_TUBE',(0.02,y,2.16),(.05,.70,.032),diffuser,.007)
    m=tube.data.materials[0]; m.use_nodes=True; bsdf=m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Emission Color'].default_value=(.57,.68,.63,1); bsdf.inputs['Emission Strength'].default_value=1.15
    bpy.ops.object.light_add(type='AREA',location=(.02,y,2.07)); lamp=bpy.context.object; lamp.name=name+'_SPILL'; lamp.data.energy=energy; lamp.data.shape='RECTANGLE'; lamp.data.size=.48; lamp.data.size_y=.14; lamp.data.color=(.66,.73,.69); base.point_at(lamp,(0,y,.85))


def add_v31_reality():
    hide_prefixes(('V30_DOOR_','V30_LATCH_','V30_FLUOR_'))
    timber=bpy.data.materials.get('V29 metric weathered timber')
    if timber is None: timber=v29.metric_pbr('V31 timber',v25.WOOD_MAPS,scale=(1.2,1.2,1.2),normal_strength=.46,rough_fallback=.90)
    faded_blue=create_faded_paint('V31 faded blue-grey paint',(.18,.23,.22),(.07,.08,.072))
    faded_brown=create_faded_paint('V31 faded brown paint',(.19,.105,.055),(.055,.035,.022))
    corr=bpy.data.materials.get('V29 metric corrugated iron') or v29.metric_pbr('V31 corr',pbr.PBR['roof'],scale=(1.1,1.1,1.1),normal_strength=.58,rough_fallback=.78,metallic=.11)

    add_plank_door('V31_DOOR_1',-4.45,0.0,faded_blue,timber); add_hardware('V31_DOOR_1',-4.45,0.0)
    add_plank_door('V31_DOOR_2',-2.05,-11.0,faded_brown,timber); add_hardware('V31_DOOR_2',-2.05,-11.0)
    # room 3 remains split curtain/open depth from V3.0
    add_corrugated_door('V31_DOOR_4',2.75,3.0,corr); add_hardware('V31_DOOR_4',2.75,3.0)

    # A few small patch repairs around real contact/drainage zones.
    patch=mat('V31 cement patch',(.18,.17,.14),.96)
    for i,(y,z,sy,sz) in enumerate([(-3.40,.34,.28,.22),(-.82,.26,.22,.18),(1.58,.38,.26,.20),(3.86,.30,.30,.20)],1):
        v27.add_irregular_grime(f'V31_PATCH_{i}',-.497,y,z,sy,sz,patch,.5*i)

    # More believable weak practicals; daylight stays primary.
    add_undermaintained_practical('V31_FLUOR_A',-1.65,28)
    add_undermaintained_practical('V31_FLUOR_B',2.45,24)

    # Rain-driven wall base darkening and service-edge dampness.
    damp=mat('V31 base damp',(.07,.065,.055),.98)
    for i,(y,sy) in enumerate([(-4.8,.45),(-2.8,.32),(-.35,.40),(2.05,.36),(4.35,.42)],1):
        v27.add_irregular_grime(f'V31_BASE_DAMP_{i}',-.496,y,.16,sy,.13,damp,.7*i)

    scene=bpy.context.scene
    scene.view_settings.look='AgX - Medium Low Contrast'; scene.view_settings.exposure=.44
    scene.cycles.samples=48; scene.cycles.use_denoising=True
    scene.render.resolution_x=1280; scene.render.resolution_y=720
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.data.dof.use_dof=False; cam.data.lens=34.0; cam.location=(-.01,-5.06,1.48); base.point_at(cam,(-.10,2.35,1.07)); cam.rotation_euler[2]+=math.radians(-.05)


def patch_receipt(out:Path):
    path=out/'bien-anh-v23-public-bootstrap-receipt.json'; r=json.loads(path.read_text(encoding='utf-8'))
    r['schema']='daube.bien-anh.v31.repaired-door-lighting.v1'; r['visualRetakeVersion']='BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V3.1'; r['status']='PHYSICAL_WIDE_V31_REPAIRED_DOOR_REALISM_PRODUCED_REVIEW_REQUIRED'
    r['qcRender']={'samples':48,'resolution':'1280x720','denoising':True,'purpose':'repaired-door + under-maintained-light realism gate'}
    r['retakeTargets']=['plank-and-corrugated-door-construction','hinge-correct-hardware','weathered-paint-variation','weaker-fluorescent-practicals','rain-driven-base-damp','remove-clean-door-slab-read']
    r['automaticPaidSpend']=False; r['promotionEligible']=False; r['fanOutEligible']=False
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'; r['artifacts']['blend']={'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}; r['artifacts']['widePng']={'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    r['truthBoundary']='V3.1 physical WIDE candidate. Still review-required; no fan-out/location lock until visual/geography/socioeconomic/cultural QC passes.'
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',required=True); ap.add_argument('--source-revision',required=True); args=ap.parse_args(argv)
    v27.pbr.require_assets(); v25.require_v25_assets(); out=Path(args.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    v27.pbr.base.build_scene(out,args.source_revision); v27.v24.add_reality_reconstruction(); v27.v25.add_v25_refinement(); v27.v26.rebuild_room_fronts(); v27.v26.add_threshold_life(); v27.v26.add_real_exterior_plate(); v27.v26.retune_camera_light(); v27.add_v27_documentary_refinement(); v28.add_v28_physical_edge(); v29.retexture_large_surfaces(); v29.clean_and_repopulate(); v29.retune_scene(); v30.add_v30_details(); add_v31_reality()
    scene=bpy.context.scene; blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'; bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)
    v27.v26.patch_receipt(out); v28.patch_receipt(out); v29.patch_receipt(out); v30.patch_receipt(out); patch_receipt(out); print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))

if __name__=='__main__': main()
