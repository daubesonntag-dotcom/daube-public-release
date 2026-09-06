import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const path = new URL('../installers/install-host-continuity-v6.sh', import.meta.url);
async function src(){ return fs.readFile(path, 'utf8'); }

test('captures updater start status instead of exiting before receipt readback', async () => {
  const s = await src();
  assert.match(s, /set \+e[\s\S]*systemctl start daube-host-autonomous-update\.service[\s\S]*UPDATER_RC=\$\?[\s\S]*set -e/);
  assert.match(s, /LATEST_RECEIPT=/);
  assert.match(s, /OUTCOME=/);
});

test('only healthy settled updater receipts can continue', async () => {
  const s = await src();
  assert.match(s, /NO_CHANGE\|ACTIVATED/);
  assert.match(s, /HOLD_ROLLBACK_REQUIRED/);
  assert.match(s, /HOLD_LOCK_BUSY/);
  assert.match(s, /HOLD_BASELINE_UNHEALTHY/);
  assert.match(s, /exit 5[0-9]/);
});

test('proves exact main and strict localhost-only socket boundary before recovery', async () => {
  const s = await src();
  assert.match(s, /merge --ff-only refs\/remotes\/origin\/main/);
  assert.match(s, /productionAuthorityExpanded/);
  assert.match(s, /127\.0\.0\.1:8787/);
  assert.match(s, /NON_LOOPBACK_8787_FORBIDDEN/);
});

test('reconciles reviewed runtimes and installs bounded remote-agent watchdog', async () => {
  const s = await src();
  assert.match(s, /install-sovereign-execution-fabric\.sh/);
  assert.match(s, /install-host-ops-supervisor-safe-v2\.sh/);
  assert.match(s, /install-remote-control-agent\.sh/);
  assert.match(s, /OnUnitActiveSec=2min/);
  assert.match(s, /NOW - LAST >= 600/);
  assert.doesNotMatch(s, /gcloud compute firewall|billing|iam /i);
});
