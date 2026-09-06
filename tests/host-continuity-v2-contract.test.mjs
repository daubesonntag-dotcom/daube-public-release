import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const installerUrl = new URL('../installers/install-host-continuity-v2.sh', import.meta.url);
async function source() { return readFile(installerUrl, 'utf8'); }

test('host continuity v2 installer exists', () => {
  assert.equal(existsSync(installerUrl), true);
});

test('installer is exact-host exact-source and uses only reviewed local repair paths', async () => {
  const s = await source();
  assert.match(s, /EXPECTED_HOST=['"]daube-host-01['"]/);
  assert.match(s, /EXPECTED_USER=['"]founder_daubesonntag_com['"]/);
  assert.match(s, /EXPECTED_COMPUTE_SHA=['"]968b634cd87c3dc27b8686dbf695ed3954ce21dc['"]/);
  assert.match(s, /git -C "\$COMPUTE_REPO" merge --ff-only refs\/remotes\/origin\/main/);
  assert.match(s, /sudo -n true/);
  for (const script of [
    'npm run test:remote-control-persistence',
    'npm run test:sovereign-execution',
    'npm run test:host-ops-supervisor-all',
    'sudo -n bash scripts/install-sovereign-execution-fabric.sh',
    'sudo -n bash scripts/install-host-ops-supervisor-safe.sh',
    'sudo -n bash scripts/install-remote-control-agent.sh',
  ]) assert.ok(s.includes(script), `missing ${script}`);
});

test('installer verifies localhost health and forbids provider authority expansion', async () => {
  const s = await source();
  assert.match(s, /127\.0\.0\.1:8787\/healthz/);
  assert.match(s, /productionAuthorityExpanded/);
  assert.match(s, /0\.0\.0\.0|public Compute Mesh listener/);
  for (const forbidden of ['gcloud compute', 'firewall-rules', 'billing', 'iam ', 'metadata startup-script', 'curl | bash', 'force-push']) {
    assert.equal(s.includes(forbidden), false, `forbidden token ${forbidden}`);
  }
});
