#!/usr/bin/env python3
from __future__ import annotations
import importlib.util
from pathlib import Path
import bpy

HERE=Path(__file__).resolve().parent
P=HERE/'bootstrap_scene_reality_v29.py'
spec=importlib.util.spec_from_file_location('bien_anh_v29',P)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v29:{P}')
v29=importlib.util.module_from_spec(spec)
spec.loader.exec_module(v29)


def metric_pbr_fixed(name,maps,scale=(1.0,1.0,1.0),normal_strength=.4,rough_fallback=.85,metallic=0.0):
    m=bpy.data.materials.new(name)
    m.use_nodes=True
    nt=m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out=nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf=nt.nodes.new('ShaderNodeBsdfPrincipled')
    coord=nt.nodes.new('ShaderNodeTexCoord')
    mapping=nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value=scale

    diff=nt.nodes.new('ShaderNodeTexImage')
    diff.image=bpy.data.images.load(str(maps['diff']),check_existing=True)
    diff.projection='BOX'; diff.projection_blend=.28

    nor=nt.nodes.new('ShaderNodeTexImage')
    nor.image=bpy.data.images.load(str(maps['normal']),check_existing=True)
    nor.image.colorspace_settings.name='Non-Color'
    nor.projection='BOX'; nor.projection_blend=.28

    rough=nt.nodes.new('ShaderNodeTexImage')
    rough.image=bpy.data.images.load(str(maps['rough']),check_existing=True)
    rough.image.colorspace_settings.name='Non-Color'
    rough.projection='BOX'; rough.projection_blend=.28

    normal=nt.nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value=normal_strength
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

v29.metric_pbr=metric_pbr_fixed

if __name__=='__main__':
    v29.main()
