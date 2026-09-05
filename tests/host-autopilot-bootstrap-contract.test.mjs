import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const installer = readFileSync(new URL('../installers/install-host-autopilot-v1.sh', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../runtime/host-autopilot/run.py', import.meta.url), 'utf8');

test('autopilot bootstrap stages every direct run.py local import', () => {
  assert.match(runtime, /from chain import /);
  assert.match(installer, /FILES=\([^\n]*chain\.py/);
  assert.match(installer, /python3 -m py_compile[^\n]*chain\.py/);
});
