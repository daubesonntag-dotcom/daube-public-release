#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, importlib.util, json, math, sys
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v32.py'
spec=importlib.util.spec_from_file_location('bien_anh_v32',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v32:{P}')
v32=importlib.util.module_from_spec(spec); spec.loader.exec_module(v32)
v31=v32.v31; v30=v32.v30; v29=v32.v29; v28=v32.v28; v27=v32.v27; v26=v32.v26; v25=v32.v25; v24=v32.v24; pbr=v32.pbr; base=v32.base
PH_ROOT=HERE/'assets_runtime'/'polyhaven'
_IMPORTED={}


def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()

def mat(name,color,rough=.8,metal=0.0): return base.solid_mat(name,color,rough,metal)

def hide_prefixes(prefixes):
    for o in bpy.data.objects:
        if any(o.name.startswith(p) for p in prefixes):
            o.hide_render=True; o.hide_viewport=True


def load_polyhaven_collection(slug:str):
    if slug in _IMPORTED: return _IMPORTED[slug]
    asset_dir=PH_ROOT/slug
    manifest=asset_dir/'DAUBE_ASSET_MANIFEST.json'
    if not manifest.is_file(): raise RuntimeError(f'missing_polyhaven_manifest:{slug}')
    info=json.loads(manifest.read_text(encoding='utf-8'))
    if info.get('license')!='CC0' or info.get('provider')!='Poly Haven': raise RuntimeError(f'asset_provenance_gate:{slug}')
    blends=sorted(asset_dir.glob('*.blend'))
    if not blends: blends=sorted(asset_dir.rglob('*.blend'))
    if not blends: raise RuntimeError(f'missing_polyhaven_blend:{slug}')
    blend=blends[0]
    before=set(bpy.data.images)
    with bpy.data.libraries.load(str(blend),link=False) as (src,dst):
        names=list(src.collections)
        if not names: raise RuntimeError(f'no_collection_in_asset:{slug}')
        pick=slug if slug in names else names[0]
        dst.collections=[pick]
    col=dst.collections[0]
    if col is None: raise RuntimeError(f'collection_append_failed:{slug}')
    # Rebind relative dependencies to the verified bundle folder after append.
    for img in bpy.data.images:
        if img in before or getattr(img,'packed_file',None): continue
        raw=img.filepath or ''
        candidate=None
        if raw.startswith('//'):
            candidate=(asset_dir/raw[2:]).resolve()
        else:
            p=Path(raw)
            if not p.is_file():
                found=list(asset_dir.rglob(p.name)) if p.name else []
                candidate=found[0] if found else None
        if candidate is not None and Path(candidate).is_file(): img.filepath=str(candidate)
    _IMPORTED[slug]=col
    return col


def instance_asset(slug:str,name:str,loc,rot=(0.0,0.0,0.0),scale=1.0):
    col=load_polyhaven_collection(slug)
    obj=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(obj)
    obj.instance_type='COLLECTION'; obj.instance_collection=col; obj.location=loc; obj.rotation_euler=tuple(math.radians(v) for v in rot); obj.scale=(scale,scale,scale)
    return obj


def add_macro_variation(material_name:str,noise_scale=.42,strength=.16):
    m=bpy.data.materials.get(material_name)
    if not m or not m.use_nodes: return
    nt=m.node_tree; bsdf=next((n for n in nt.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled'),None)
    if not bsdf: return
    links=[l for l in nt.links if l.to_node==bsdf and l.to_socket==bsdf.inputs['Base Color']]
    if not links: return
    src=links[0].from_socket
    for l in links: nt.links.remove(l)
    coord=nt.nodes.new('ShaderNodeTexCoord'); noise=nt.nodes.new('ShaderNodeTexNoise'); ramp=nt.nodes.new('ShaderNodeValToRGB'); mix=nt.nodes.new('ShaderNodeMixRGB')
    noise.inputs['Scale'].default_value=noise_scale; noise.inputs['Detail'].default_value=2.3; noise.inputs['Roughness'].default_value=.72
    ramp.color_ramp.elements[0].color=(.76,.73,.68,1); ramp.color_ramp.elements[1].color=(1.02,1.00,.96,1)
    mix.blend_type='MULTIPLY'; mix.inputs['Fac'].default_value=strength
    nt.links.new(coord.outputs['Object'],noise.inputs['Vector']); nt.links.new(noise.outputs['Fac'],ramp.inputs['Fac']); nt.links.new(src,mix.inputs[1]); nt.links.new(ramp.outputs['Color'],mix.inputs[2]); nt.links.new(mix.outputs['Color'],bsdf.inputs['Base Color'])


def add_door_nails():
    metal=mat('V33 oxidized nail head',(.075,.071,.061),.76,.22)
    positions=[(-.476,-4.69,.55),(-.476,-4.26,.55),(-.476,-4.69,1.47),(-.476,-4.26,1.47)]
    for i,(x,y,z) in enumerate(positions,1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,location=(x,y,z))
        o=bpy.context.object; o.name=f'V33_DOOR_NAIL_{i}'; o.scale=(.007,.011,.011); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); o.data.materials.append(metal)


def add_v33_scanned_assets():
    hide_prefixes(('V32_WATER_CAN_','V29_BROOM','V32_MOP_TRACK_'))
    add_macro_variation('V29 metric worn plaster',.34,.18)
    add_macro_variation('V29 metric damp concrete',.28,.12)

    # Real CC0 model assets; placed only where the existing story logic already requires cleaning/water storage.
    instance_asset('plastic_bottle_gallon','V33_GALLON_A',(0.31,4.43,.015),(0,0,-8),.94)
    instance_asset('plastic_bottle_gallon','V33_GALLON_B',(0.22,4.72,.015),(0,0,13),.88)
    instance_asset('plastic_broom','V33_BROOM',(0.43,3.88,.015),(3,-7,11),.96)
    add_door_nails()

    # Smaller, lower-contrast moisture traces replace the obvious grey polygon patches from V3.2.
    wet=mat('V33 subtle tracked moisture',(.072,.073,.066),.84)
    for i,(x,y,sx,sy,ph) in enumerate([(0.06,-2.75,.10,.28,.3),(-.03,.15,.08,.25,1.2),(0.08,3.05,.10,.30,2.1)],1):
        v32.add_irregular_floor_mark(f'V33_TRACK_{i}',x,y,sx,sy,wet,ph)

    scene=bpy.context.scene
    scene.view_settings.look='AgX - Medium Low Contrast'; scene.view_settings.exposure=.42
    scene.cycles.samples=64; scene.cycles.use_denoising=True
    scene.render.resolution_x=1280; scene.render.resolution_y=720
    cam=bpy.data.objects.get('CAM_WIDE_INTERIOR')
    if cam:
        cam.data.lens=33.0; cam.location=(.015,-5.03,1.48); base.point_at(cam,(-.08,2.42,1.06)); cam.rotation_euler[2]+=math.radians(-.03)


def patch_receipt(out:Path):
    path=out/'bien-anh-v23-public-bootstrap-receipt.json'; r=json.loads(path.read_text(encoding='utf-8'))
    manifests={}
    for slug in ('plastic_bottle_gallon','plastic_broom'):
        p=PH_ROOT/slug/'DAUBE_ASSET_MANIFEST.json'; manifests[slug]={'manifestSha256':sha256(p),'manifest':json.loads(p.read_text(encoding='utf-8'))}
    r['schema']='daube.bien-anh.v33.scanned-prop-macro-surface.v1'; r['visualRetakeVersion']='BA-MMR-HLAING-THARYAR-WORKER-HOSTEL-V3.3'; r['status']='PHYSICAL_WIDE_V33_SCANNED_PROP_REALISM_PRODUCED_REVIEW_REQUIRED'
    r['qcRender']={'samples':64,'resolution':'1280x720','denoising':True,'purpose':'CC0 scanned-prop + macro-surface realism gate'}
    r['assetBundles']=manifests
    r['retakeTargets']=['replace-procedural-water-can-and-broom','verified-CC0-model-bundles','macro-plaster-and-floor-variation','subtle-post-rain-tracks','door-hardware-microdetail']
    r['automaticPaidSpend']=False; r['promotionEligible']=False; r['fanOutEligible']=False
    blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'; r['artifacts']['blend']={'name':blend.name,'bytes':blend.stat().st_size,'sha256':sha256(blend)}; r['artifacts']['widePng']={'name':png.name,'bytes':png.stat().st_size,'sha256':sha256(png)}
    r['truthBoundary']='V3.3 physical WIDE candidate with verified CC0 model bundles. Still review-required; no fan-out/location lock until visual/geography/socioeconomic/cultural QC passes.'
    path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',required=True); ap.add_argument('--source-revision',required=True); args=ap.parse_args(argv)
    v27.pbr.require_assets(); v25.require_v25_assets(); out=Path(args.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
    v27.pbr.base.build_scene(out,args.source_revision); v27.v24.add_reality_reconstruction(); v27.v25.add_v25_refinement(); v27.v26.rebuild_room_fronts(); v27.v26.add_threshold_life(); v27.v26.add_real_exterior_plate(); v27.v26.retune_camera_light(); v27.add_v27_documentary_refinement(); v28.add_v28_physical_edge(); v29.retexture_large_surfaces(); v29.clean_and_repopulate(); v29.retune_scene(); v30.add_v30_details(); v31.add_v31_reality(); v32.add_v32_lived_in(); add_v33_scanned_assets()
    scene=bpy.context.scene; blend=out/'bien-anh-v23-public-bootstrap.blend'; png=out/'plate-wide-interior-v23-public-bootstrap.png'; bpy.ops.wm.save_as_mainfile(filepath=str(blend)); scene.render.filepath=str(png); bpy.ops.render.render(write_still=True)
    v27.v26.patch_receipt(out); v28.patch_receipt(out); v29.patch_receipt(out); v30.patch_receipt(out); v31.patch_receipt(out); v32.patch_receipt(out); patch_receipt(out); print(json.loads((out/'bien-anh-v23-public-bootstrap-receipt.json').read_text(encoding='utf-8')))

if __name__=='__main__': main()
