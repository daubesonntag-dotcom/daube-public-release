#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
BASE_PATH = HERE / 'bootstrap_scene.py'
spec = importlib.util.spec_from_file_location('bien_anh_v23_bootstrap_base', BASE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_base:{BASE_PATH}')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

ASSETS_DIR = HERE / 'assets_runtime'

PBR = {
    'floor': {
        'diff': ASSETS_DIR / 'dirty_concrete_diff_1k.jpg',
        'normal': ASSETS_DIR / 'dirty_concrete_nor_gl_1k.jpg',
        'rough': ASSETS_DIR / 'dirty_concrete_rough_1k.jpg',
    },
    'wall': {
        'diff': ASSETS_DIR / 'worn_plaster_wall_diff_1k.jpg',
        'normal': ASSETS_DIR / 'worn_plaster_wall_nor_gl_1k.jpg',
        'rough': ASSETS_DIR / 'worn_plaster_wall_rough_1k.jpg',
    },
    'roof': {
        'diff': ASSETS_DIR / 'worn_corrugated_iron_diff_1k.jpg',
        'normal': ASSETS_DIR / 'worn_corrugated_iron_nor_gl_1k.jpg',
        'rough': ASSETS_DIR / 'worn_corrugated_iron_rough_1k.jpg',
    },
}


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def require_assets():
    missing = [str(path) for maps in PBR.values() for path in maps.values() if not path.is_file() or path.stat().st_size < 1024]
    if missing:
        raise RuntimeError('missing_pbr_assets:' + ','.join(missing))


def load_image(path: Path, non_color=False):
    img = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def pbr_material(name: str, maps: dict, scale=(1.0, 1.0, 1.0), normal_strength=0.45, rough_fallback=0.72, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)

    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    texcoord = nt.nodes.new('ShaderNodeTexCoord')
    mapping = nt.nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = scale

    diff = nt.nodes.new('ShaderNodeTexImage')
    diff.image = load_image(maps['diff'])
    diff.projection = 'BOX'
    diff.projection_blend = 0.28

    normal_tex = nt.nodes.new('ShaderNodeTexImage')
    normal_tex.image = load_image(maps['normal'], non_color=True)
    normal_tex.projection = 'BOX'
    normal_tex.projection_blend = 0.28
    normal = nt.nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = normal_strength

    rough_tex = nt.nodes.new('ShaderNodeTexImage')
    rough_tex.image = load_image(maps['rough'], non_color=True)
    rough_tex.projection = 'BOX'
    rough_tex.projection_blend = 0.28

    bsdf.inputs['Roughness'].default_value = rough_fallback
    bsdf.inputs['Metallic'].default_value = metallic

    nt.links.new(texcoord.outputs['Generated'], mapping.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], diff.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], normal_tex.inputs['Vector'])
    nt.links.new(mapping.outputs['Vector'], rough_tex.inputs['Vector'])
    nt.links.new(diff.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(normal_tex.outputs['Color'], normal.inputs['Color'])
    nt.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(rough_tex.outputs['Color'], bsdf.inputs['Roughness'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


def pbr_noise_override(name, color_a, color_b, scale=5.0, detail=4.0, rough=0.75, bump=0.08, metal=0.0):
    low = name.lower()
    if name == 'old damp concrete':
        return pbr_material(name, PBR['floor'], scale=(1.1, 5.0, 1.0), normal_strength=0.34, rough_fallback=0.78)
    if name in {'aged lime plaster', 'outside old masonry', 'outside patched plaster'}:
        return pbr_material(name, PBR['wall'], scale=(1.0, 4.8, 1.0), normal_strength=0.36, rough_fallback=0.86)
    if 'shallow wet patches' in low:
        # Damp, not mirror decals: dark and moderately rough so patches read as soaked concrete.
        return base.solid_mat(name, (0.025, 0.030, 0.027), 0.39, 0.0)
    return ORIGINAL_NOISE(name, color_a, color_b, scale, detail, rough, bump, metal)


def pbr_roof_override(name, color_a, color_b):
    return pbr_material(name, PBR['roof'], scale=(5.5, 1.0, 1.0), normal_strength=0.65, rough_fallback=0.68, metallic=0.18)


def patch_receipt(output_dir: Path):
    receipt_path = output_dir / 'bien-anh-v23-public-bootstrap-receipt.json'
    receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
    receipt['schema'] = 'daube.bien-anh.v23.public-bootstrap.v3-pbr'
    receipt['status'] = 'PHYSICAL_WIDE_PBR_REALITY_RETAKE_ARTIFACT_PRODUCED_REVIEW_REQUIRED'
    receipt['pbrAssetProvenance'] = {
        'provider': 'Poly Haven',
        'license': 'CC0',
        'runtimeApiUsed': False,
        'assets': {
            key: {
                map_name: {
                    'filename': path.name,
                    'sha256': file_sha(path),
                    'bytes': path.stat().st_size,
                }
                for map_name, path in maps.items()
            }
            for key, maps in PBR.items()
        },
        'sourcePages': [
            'https://polyhaven.com/a/dirty_concrete',
            'https://polyhaven.com/a/worn_plaster_wall',
            'https://polyhaven.com/a/worn_corrugated_iron',
        ],
    }
    receipt['retakeTargets'] = list(dict.fromkeys(receipt.get('retakeTargets', []) + [
        'photographic-pbr-floor',
        'photographic-pbr-wall',
        'photographic-pbr-corrugated-roof',
        'remove-procedural-puddle-decal-read',
    ]))
    receipt['promotionEligible'] = False
    receipt['fanOutEligible'] = False
    receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


ORIGINAL_NOISE = base.noise_mat
base.noise_mat = pbr_noise_override
base.corrugated_mat = pbr_roof_override


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--output-dir', required=True)
    p.add_argument('--source-revision', required=True)
    args = p.parse_args(argv)
    require_assets()
    out = Path(args.output_dir).resolve()
    base.build_scene(out, args.source_revision)
    patch_receipt(out)


if __name__ == '__main__':
    main()
