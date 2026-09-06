import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const v12 = readFileSync(new URL('../installers/install-full-wave-mesh-lane-v12.sh', import.meta.url), 'utf8');
const attester = readFileSync(new URL('../installers/attest-full-wave-mesh-v12.sh', import.meta.url), 'utf8');

test('trusted root carrier skips only redundant platform convergence', () => {
  assert.match(v12, /DAUBE_TRUSTED_ROOT_CARRIER/);
  assert.match(v12, /trusted root carrier.*skip platform convergence/i);
  assert.match(v12, /install-ci-platform-wave-full-host-v1\.sh/);
  assert.match(v12, /install-freelancer-execution-mesh-v9\.sh/);
  assert.match(v12, /install-native-revenue-autopilot-v10\.sh/);
  assert.match(v12, /install-autonomous-business-operator-v11\.sh/);
  assert.match(v12, /\/opt\/daube\/control\/daube-ci-platform\/CONTROL_REVISION/);
  assert.doesNotMatch(v12, /DAUBE_TRUSTED_ROOT_CARRIER.*sudoers|DAUBE_TRUSTED_ROOT_CARRIER.*NOPASSWD/i);
});

test('V12 re-arms native autopilot chain boot persistence', () => {
  assert.match(v12, /BASE_TIMERS=\([\s\S]*daube-native-autopilot-chain\.timer/);
  assert.match(v12, /systemctl enable --now \"\$unit\"/);
});

test('attester repairs native chain persistence before admitting cached receipt', () => {
  const enablePos = attester.indexOf('systemctl enable --now daube-native-autopilot-chain.timer');
  const receiptPos = attester.indexOf('if receipt_ready; then');
  assert.notEqual(enablePos, -1);
  assert.notEqual(receiptPos, -1);
  assert.ok(enablePos < receiptPos);
  assert.match(attester, /systemctl is-enabled daube-native-autopilot-chain\.timer/);
});
