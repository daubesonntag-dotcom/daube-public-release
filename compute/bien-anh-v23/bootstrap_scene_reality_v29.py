#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v28.py'
spec=importlib.util.spec_from_file_location('bien_anh_v28',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v28:{P}')
v28=importlib.util.module_from_spec(spec); spec.loader.exec_module(v28)
v27=v28.v27; v26=v28.v26; v25=v28.v25; v24=v28.v24; pbr=v28.pbr; base=v28.base
ASSETS_DIR=HERE/'assets_runtime'


def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def mat(name,color,rough=.8,metal=0.0):
    return base.solid_mat(name,color,rough,metal)


def box(name,loc,dims,material,bevel=0.0,rot=(0,0,0)):
    return base.box(name,loc,dims,material,bevel,rot)


def hide_prefixes(prefixes):
    for o in bpy.data.objects:
        if any(o.name.startswith(p) for p in prefixes):
            o.hide_render=True
            o.hide_viewport=True


def metric_pbr(name,maps,scale=(1.0,1.0,1.0),normal_strength=.4,rough_fallback=.85,metallic=0.0):
    """PBR using Object coordinates, so texel density follows scene metres instead of normalized object bounds."""
    m=bpy.data.materials.new(name)
    m.use_nodes=True
    nt=m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out=nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf=nt.nodes.new('ShaderNodeBsdfPrincipled')
    coord=nt.nodes.new('ShaderNodeTexCoord')
    mapping=nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value=scale

    diff=nt.nodes.new('ShaderNodeTexImage'); diff.image=bpy.data.images.load(str(maps['diff']),check_existing=True); diff.projection='BOX'; diff.projection_blend=.28
    nor=nt.nodes.new('ShaderNodeTexImage'); nor.image=bpy.data.images.load(str(maps['normal']),check_existing=True); nor.colorspace_settings.name='Non-Color'; nor.projection='BOX'; nor.projection_blend=.28
    rough=nt.nodes.new('ShaderNodeTexImage'); rough.image=bpy.data.images.load(str(maps['rough']),check_existing=True); rough.colorspace_settings.name='Non-Color'; rough.projection='BOX'; rough.projection_blend=.28
    normal=nt.nodes.new('ShaderNodeNormalMap'); normal.inputs['Strength'].default_value=normal_strength
    bsdf.inputs['Roughness'].default_value=rough_fallback
    bsdf.inputs['Metallic'].default_value=metallic

    nt.links.new(coord.outputs['Object'],mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'],diff.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'],nor.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'],rough.inputs['Vector'])
    nt.links.new(diff.outputs['Color'],bsdf.inputs['Base Color'])
    nt.links.new(nor.outputs['Color'],normal.inputs['Color'])
    nt.links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])
    nt.links.new(rough.outputs['Color'],bsdf.inputs['Roughness'])
    nt.links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
    return m


def retexture_large_surfaces():
    floor=metric_pbr('V29 metric damp concrete',pbr.PBR['floor'],scale=(1.55,1.55,1.55),normal_strength=.34,rough_fallback=.88)
    plaster=metric_pbr('V29 metric worn plaster',pbr.PBR['wall'],scale=(1.15,1.15,1.15),normal_strength=.34,rough_fallback=.91)
    corr=metric_pbr('V29 metric corrugated iron',pbr.PBR['roof'],scale=(1.10,1.10,1.10),normal_strength=.58,rough_fallback=.76,metallic=.12)
    timber=metric_pbr('V29 metric weathered timber',v25.WOOD_MAPS,scale=(1.20,1.20,1.20),normal_strength=.46,rough_fallback=.89)

    for o in bpy.data.objects:
        target=None
        if o.name in {'FLOOR','V28_SERVICE_GROUND'} or o.name.startswith('V28_REPAIR_STRIP_'):
            target=floor
        elif o.name.startswith(('V26_WALL_SEG_','V28_SHED_WALL_')):
            target=plaster
        elif o.name.startswith(('V24_CORR_PARTITION_','V24_ROOF_PATCH_','V28_SHED_ROOF_')):
            target=corr
        elif o.name.startswith(('V26_JAMB_','V26_HEADER_','V26_DOOR_LEAF_','V28_UTILITY_POST_','V28_SHED_LINTEL_')):
            target=timber
        if target and hasattr(o.data,'materials'):
            o.data.materials.clear(); o.data.materials.append(target)


def add_slipper(name,loc,length=.255,width=.105,rot=0.0,material=None):
    x,y,z=loc
    pts=[
        (-width*.48,-length*.47),(width*.48,-length*.45),(width*.56,-length*.18),
        (width*.52,length*.18),(width*.32,length*.48),(-width*.32,length*.50),
        (-width*.52,length*.20),(-width*.56,-length*.18)
    ]
    verts=[(x+px,y+py,z) for px,py in pts]
    mesh=bpy.data.meshes.new(name+'_SOLE_MESH'); mesh.from_pydata(verts,[],[tuple(range(len(verts)))]); mesh.update()
    sole=bpy.data.objects.new(name+'_SOLE',mesh); bpy.context.collection.objects.link(sole); sole.rotation_euler[2]=math.radians(rot)
    if material: sole.data.materials.append(material)
    sol=sole.modifiers.new('sole-thickness','SOLIDIFY'); sol.thickness=.018
    bev=sole.modifiers.new('sole-edge','BEVEL'); bev.width=.008; bev.segments=2

    strap_mat=material or mat(name+'_strap',(0.02,0.02,0.018),.92)
    for idx,sign in enumerate((-1,1),1):
        curve=bpy.data.curves.new(f'{name}_STRAP_{idx}_CURVE','CURVE'); curve.dimensions='3D'; curve.bevel_depth=.008; curve.bevel_resolution=2
        spl=curve.splines.new('BEZIER'); spl.bezier_points.add(2)
        p0=(x+sign*width*.32,y-length*.05,z+.018)
        p1=(x,y+length*.16,z+.065)
        p2=(x+sign*width*.12,y+length*.30,z+.022)
        for bp,p in zip(spl.bezier_points,(p0,p1,p2)):
            bp.co=p; bp.handle_left_type='AUTO'; bp.handle_right_type='AUTO'
        ob=bpy.data.objects.new(f'{name}_STRAP_{idx}',curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(strap_mat); ob.rotation_euler[2]=math.radians(rot)
    return sole


def add_open_bucket(name,loc,radius=.15,height=.30,material=None):
    x,y,z=loc
    verts=[]; faces=[]; seg=40
    rb=radius*.88; rt=radius
    for ring,(r,zz) in enumerate(((rb,z),(rt,z+height))):
        for i in range(seg):
            a=2*math.pi*i/seg; verts.append((x+r*math.cos(a),y+r*math.sin(a),zz))
    for i in range(seg):
        j=(i+1)%seg; faces.append((i,j,seg+j,seg+i))
    faces.append(tuple(reversed(range(seg))))
    mesh=bpy.data.meshes.new(name+'_MESH'); mesh.from_pydata(verts,[],faces); mesh.update()
    obj=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(obj)
    if material: obj.data.materials.append(material)
    sol=obj.modifiers.new('bucket-wall','SOLIDIFY'); sol.thickness=.008
    bev=obj.modifiers.new('bucket-lip','BEVEL'); bev.width=.005; bev.segments=2
    bpy.ops.mesh.primitive_torus_add(major_radius=radius*.96,minor_radius=.008,major_segments=40,minor_segments=8,location=(x,y,z+height))
    rim=bpy.context.object; rim.name=name+'_RIM'
    if material: rim.data.materials.append(material)
    return obj


def add_broom(name,base_loc,lean=(.10,.04),material_handle=None,material_bristle=None):
    x,y,z=base_loc
    dx,dy=lean
    handle=material_handle or mat(name+'_wood',(0.18,0.10,0.045),.88)
    bristle=material_bristle or mat(name+'_bristle',(0.22,0.17,0.09),.96)
    length=1.25
    # cylinder aligned along vector using helper point_at semantics on a thin cylinder
    bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=.012,depth=length,location=(x+dx/2,y+dy/2,z+length/2))
    h=bpy.context.object; h.name=name+'_HANDLE'; h.data.materials.append(handle)
    # small lean around local X/Y is enough for documentary-scale prop
    h.rotation_euler[0]=math.radians(-dy*25); h.rotation_euler[1]=math.radians(dx*25)
    for i in range(9):
        off=(i-4)*.018
        box(f'{name}_BRISTLE_{i}',(x+off,y,z+.09),(.015,.055,.18),bristle,.003,(math.radians(5),0,0))


def add_drape_dense(name,loc,width,height,material,sag=.055,phase=.0):
    x,y,z=loc; cols=9; rows=9; verts=[]; faces=[]
    for r in range(rows):
        rz=r/(rows-1); zz=z+height*(.5-rz)
        for c in range(cols):
            cx=c/(cols-1); yy=y+width*(cx-.5)
            wave=math.sin(cx*math.pi)*sag*(.55+.45*rz)+math.sin((c+r)*1.7+phase)*.006
            verts.append((x+wave,yy,zz))
    for r in range(rows-1):
        for c in range(cols-1):
            i=r*cols+c; faces.append((i,i+1,i+1+cols,i+cols))
    mesh=bpy.data.meshes.new(name+'_MESH'); mesh.from_pydata(verts,[],faces); mesh.update()
    o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o); o.data.materials.append(material)
    sol=o.modifiers.new('cloth-thickness','SOLIDIFY'); sol.thickness=.0025
    sub=o.modifiers.new('cloth-subdivision','SUBSURF'); sub.levels=1; sub.render_levels=1
    return o


def clean_and_repopulate():
    hide_prefixes((
        'V24_CLOTH_','V25_LAUNDRY_','V25_SACK_','V25_BASIN_','V25_POT','V25_LOW_SHELF',
        'V26_TSHIRT_','V26_PANTS_','V26_TOWEL_','V26_THRESHOLD_SLIPPER_',
        'V27_MOSQUITO_NET_','V27_CURTAIN_','V28_EXT_CLOTH_'
    ))
    rubber=mat('V29 worn sandal rubber',(0.018,0.018,0.016),.96)
    blue=mat('V29 faded blue plastic',(0.035,0.13,0.16),.82)
    broomwood=mat('V29 broom handle wood',(0.18,0.09,0.035),.90)
    bristle=mat('V29 broom bristle',(0.23,0.16,0.07),.97)
    cloth_a=mat('V29 washed maroon cloth',(0.17,0.055,0.05),.99)
    cloth_b=mat('V29 washed grey-blue cloth',(0.08,0.105,0.12),.99)

    # Threshold footwear clusters, not corridor decoration.
    add_slipper('V29_SLIPPER_A1',(-.38,-4.20,.025),rot=9,material=rubber)
    add_slipper('V29_SLIPPER_A2',(-.27,-4.04,.025),rot=-11,material=rubber)
    add_slipper('V29_SLIPPER_B1',(-.38,.54,.025),rot=6,material=rubber)
    add_slipper('V29_SLIPPER_B2',(-.27,.70,.025),rot=-8,material=rubber)

    # Only a few high-information lived-in objects.
    add_open_bucket('V29_WASH_BUCKET',(0.34,4.55,.015),.14,.27,blue)
    add_broom('V29_BROOM',(0.40,3.92,.02),(.08,-.03),broomwood,bristle)
    add_drape_dense('V29_LAUNDRY_A',(-.49,-2.76,1.52),.38,.52,cloth_a,.055,.4)
    add_drape_dense('V29_LAUNDRY_B',(0.48,2.22,1.48),.32,.46,cloth_b,.045,1.1)


def retune_scene():
    scene=bpy.context.scene
    scene.view_settings.look='AgX - Medium Low Contrast'
    scene.view_settings.exposure=.38
    scene.cycles.samples=32
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1280; scene.render.resolution_y=720
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.data.dof.use_dof=False
        cam.data.lens=32.0
        cam.location=(-.02,-5.10,1.50)
        base.point_at(cam,(-.10,2.30,1.06))
        cam.rotation_euler[2]+=math.radians(-.12)


def patch_receipt(out:Path):
    path=out/'bien-anh-v23-public-bootstrap-receipt.json'; r=json.loads(path.read_text(encoding='utf-8'))
    r['schema']='daube.bien-anh.v29.metric-material-human-scale.v1'
    r['visualRetakeVersion']='BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V2.9'
    r['status']='PHYSICAL_WIDE_V29_METRIC_MATERIAL_REALISM_PRODUCED_REVIEW_REQUIRED'
    r['qcRender']={'samples':32,'resolution':'1280x720','denoising':True,'purpose':'metric-material + human-scale realism gate'}
    r['retakeTargets']=['metric-texel-density','remove-stretched-object-textures','remove-egg-sack-and-flat-laundry-read','threshold-motivated-footwear','open-bucket-and-broom-human-scale','deep-focus-documentary-camera']
    r['automaticPaidSpend']=False; r['promotionEligible']=False; r['fanOutEligible']=False
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'
    r['artifacts']['blend']={'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}
    r['artifacts']['widePng']={'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    r['truthBoundary']='V2.9 physical WIDE candidate. Still review-required; no fan-out/location lock until visual/geography/socioeconomic/cultural QC passes.'
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',required=True); ap.add_argument('--source-revision',required=True); args=ap.parse_args(argv)
    v27.pbr.require_assets(); v25.require_v25_assets()
    out=Path(args.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    v27.pbr.base.build_scene(out,args.source_revision)
    v27.v24.add_reality_reconstruction(); v27.v25.add_v25_refinement(); v27.v26.rebuild_room_fronts(); v27.v26.add_threshold_life(); v27.v26.add_real_exterior_plate(); v27.v26.retune_camera_light(); v27.add_v27_documentary_refinement(); v28.add_v28_physical_edge()
    retexture_large_surfaces(); clean_and_repopulate(); retune_scene()
    scene=bpy.context.scene; blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)
    v27.v26.patch_receipt(out); v28.patch_receipt(out); patch_receipt(out)
    print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))

if __name__=='__main__': main()
