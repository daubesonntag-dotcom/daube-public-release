import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildSourceRevisionRecord,
  verifySourceRevisionArtifact,
  writeSourceRevisionArtifact
} from './source-revision-artifact.mjs';

const SHA = 'dfdcd971ef1d9f49c7448e0b6ec41702e8ddfc4a';
const OTHER_SHA = '1111111111111111111111111111111111111111';
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'daube-source-revision-public-'));

test('writes and verifies an exact-SHA public revision artifact', () => {
  const root = tempDir();
  const result = writeSourceRevisionArtifact({ cwd: root, outDir: 'dist', gitHead: SHA, expectedSha: SHA, now: '2026-08-29T12:00:00.000Z' });
  assert.equal(result.record.sourceRevision, SHA);
  assert.equal(result.record.admissionExpectedRevision, SHA);
  assert.equal(result.record.exactShaBound, true);
  assert.equal(result.record.publicEvidenceOnly, true);
  assert.equal(verifySourceRevisionArtifact({ cwd: root, outDir: 'dist', expectedSha: SHA }).record.sourceRevision, SHA);
});

test('fails closed on admission SHA mismatch', () => {
  assert.throws(() => buildSourceRevisionRecord({ gitHead: SHA, expectedSha: OTHER_SHA }), /DAUBE_RELEASE_SHA mismatch/);
});

test('does not fabricate exact admission on an unbound build', () => {
  const record = buildSourceRevisionRecord({ gitHead: SHA, expectedSha: '', now: '2026-08-29T12:00:00.000Z' });
  assert.equal(record.sourceRevision, SHA);
  assert.equal(record.admissionExpectedRevision, null);
  assert.equal(record.exactShaBound, false);
});

test('never serializes unrelated environment secrets', () => {
  const root = tempDir();
  const result = writeSourceRevisionArtifact({
    cwd: root,
    outDir: 'dist',
    gitHead: SHA,
    env: { DAUBE_RELEASE_SHA: SHA, CLOUDFLARE_API_TOKEN: 'never-write-this', OPENAI_API_KEY: 'never-write-that' },
    now: '2026-08-29T12:00:00.000Z'
  });
  const body = fs.readFileSync(result.outputPath, 'utf8');
  assert.doesNotMatch(body, /never-write|CLOUDFLARE_API_TOKEN|OPENAI_API_KEY/);
});

test('rejects foreign schema artifacts', () => {
  const root = tempDir();
  const file = path.join(root, 'dist', '__daube', 'revision.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schema: 'foreign.v1', repository: 'other/repo', sourceRevision: SHA, publicEvidenceOnly: true }));
  assert.throws(() => verifySourceRevisionArtifact({ cwd: root, outDir: 'dist' }), /unexpected source revision schema/);
});
