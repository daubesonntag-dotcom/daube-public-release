import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../assets/work-v11-grand-tour.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../assets/work-v11-grand-tour.js', import.meta.url), 'utf8');

test('homepage loads V11 Grand Tour layer', () => {
  assert.match(index, /work-v11-grand-tour\.css/);
  assert.match(index, /work-v11-grand-tour\.js/);
});

test('V11 provides HUD, scene choreography and reduced-motion fallback', () => {
  assert.match(css, /grand-tour-hud/);
  assert.match(css, /grand-scene/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(js, /grand-tour-hud/);
  assert.match(js, /grandScene/);
  assert.match(js, /focus-mode/);
});
