import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), 'utf8');

const html = read('index.html');
const css = read('v12.css');
const scene = read('v14-scene.js');

assert.match(html, /V14 Grand Reliquary/i, 'page must identify the V14 luxury release');
assert.match(html, /3c6689fa-97cc-4e74-9195-e0475a961ede\.png/, 'page must use the approved luxury rose hero');
assert.match(html, /v14-scene\.js/, 'page must boot the V14 scene engine');
assert.match(scene, /three\.quarks@0\.17\.1/, 'V14 must pin the approved Quarks VFX stack');
assert.match(scene, /MeshPhysicalMaterial/, 'V14 must retain physical refractive glass');
assert.match(scene, /clocheBounds/, 'petals must be constrained to the glass volume');
assert.match(scene, /petalCascade/, 'authored timeline must expose petal cascade control');
assert.match(scene, /__DAUBE_QA__/, 'deterministic browser frame seeking must remain available');
assert.match(css, /v14-petal-fallback/, 'low-power fallback must have an in-glass petal treatment');

console.log('V14 contract PASS');
