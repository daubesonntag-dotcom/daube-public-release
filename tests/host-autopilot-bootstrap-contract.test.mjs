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

test('autopilot bootstrap supports a trusted root recovery carrier without granting founder sudo', () => {
  assert.match(installer, /DAUBE_AUTOPILOT_USER/);
  assert.match(installer, /privileged\(\)/);
  assert.match(installer, /if \(\( EUID == 0 \)\)/);
  assert.match(installer, /install -o "\$USER_NAME" -g "\$USER_GROUP" -m 600/);
  assert.match(installer, /User=\$USER_NAME/);
});

test('autopilot bootstrap does not synchronously wait on long-running recovery starts', () => {
  assert.match(installer, /systemctl --no-block start daube-host-autopilot\.service/);
  assert.match(installer, /systemctl --no-block start daube-host-autopilot-watchdog\.service/);
  assert.doesNotMatch(installer, /privileged systemctl start daube-host-autopilot\.service/);
});
