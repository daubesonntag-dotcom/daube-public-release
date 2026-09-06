import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const path = new URL('../installers/install-host-continuity-v7-resilience-ed25519.sh', import.meta.url);
async function src(){ return fs.readFile(path, 'utf8'); }

test('uses a service-scoped openssl compatibility shim instead of mutating the mesh identity', async () => {
  const s = await src();
  assert.match(s, /daube-resilience-mesh-agent\.service/);
  assert.match(s, /20-ed25519-oneshot-compat\.conf/);
  assert.match(s, /Environment="PATH=/);
  assert.doesNotMatch(s, /rm .*mesh-ed25519|genpkey.*mesh-ed25519|rotate.*key/i);
});

test('buffers pkeyutl Ed25519 stdin to a stat-able temporary file and injects -in', async () => {
  const s = await src();
  assert.match(s, /pkeyutl/);
  assert.match(s, /-sign/);
  assert.match(s, /-rawin/);
  assert.match(s, /mktemp/);
  assert.match(s, /cat >"\$tmp"/);
  assert.match(s, /"\$REAL" "\$@" -in "\$tmp"/);
  assert.match(s, /umask 077/);
});

test('self-tests the compatibility path with an ephemeral Ed25519 key before service restart', async () => {
  const s = await src();
  assert.match(s, /genpkey -algorithm ED25519/);
  assert.match(s, /pkeyutl -verify -rawin -pubin/);
  assert.match(s, /compatibility shim signature verification failed/);
});

test('restart is bounded and refuses to claim success while the original one-shot error remains', async () => {
  const s = await src();
  assert.match(s, /systemctl start "\$SERVICE"/);
  assert.match(s, /SERVICE_RC=\$\?/);
  assert.match(s, /unable to determine file size for oneshot operation/);
  assert.match(s, /Public Key operation error/);
  assert.match(s, /RESILIENCE_MESH_ED25519_V7_VERIFIED/);
  assert.doesNotMatch(s, /gcloud compute firewall|billing|iam /i);
});
