#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path
import bpy

HERE = Path(__file__).resolve().parent
V28_PATH = HERE / 'bootstrap_scene_reality_v28.py'
spec = importlib.util.spec_from_file_location('bien_anh_v28', V28_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f'unable_to_load_v28:{V28_PATH}')
v28 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v28)

# V2.5 creates the real PBR material during add_v25_refinement(); V2.8 only needs
# a resolver for that already-materialized datablock. Fail closed if lineage changes.
def _resolve_weathered_plank(name: str):
    material = bpy.data.materials.get('V25 weathered plank repair')
    if material is None:
        raise RuntimeError('v28_weathered_plank_material_missing')
    material.name = name
    return material

v28.v25.pbr_wood_material = _resolve_weathered_plank

if __name__ == '__main__':
    v28.main()
