import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const file of [
  'install-freelancer-execution-mesh-v9.sh',
  'install-native-revenue-autopilot-v10.sh',
  'install-autonomous-business-operator-v11.sh',
]) {
  const script = readFileSync(new URL(`../installers/${file}`, import.meta.url), 'utf8');
  test(`${file} keeps workers founder-owned under trusted root carrier`, () => {
    assert.match(script, /DAUBE_TRUSTED_ROOT_CARRIER/);
    assert.match(script, /founder_daubesonntag_com/);
    assert.match(script, /SERVICE_USER/);
    assert.match(script, /chown/);
    assert.match(script, /User=\$SERVICE_USER/);
    assert.doesNotMatch(script, /DAUBE_TRUSTED_ROOT_CARRIER.*NOPASSWD|DAUBE_TRUSTED_ROOT_CARRIER.*sudoers/i);
  });
}
