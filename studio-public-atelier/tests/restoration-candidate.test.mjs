import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const record = JSON.parse(readFileSync(new URL('restoration-candidate.v1.json', root), 'utf8'));
const gitBlob = (path) => {
  const content = readFileSync(new URL(path, root));
  return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
};

test('candidate identity matches the exact seven executable source blobs', () => {
  const paths = ['app.js', 'bootstrap.js', 'icon.svg', 'index.html', 'manifest.webmanifest', 'styles.css', 'sw.js'];
  assert.deepEqual(record.artifactDigestScope, paths);
  assert.deepEqual(Object.keys(record.gitBlobIds), paths);
  const hash = createHash('sha256');
  for (const path of paths) {
    const sha = gitBlob(path);
    assert.equal(record.gitBlobIds[path], sha, path);
    hash.update(`${path}\0${sha}\0`);
  }
  assert.equal(record.artifactDigest, `sha256:${hash.digest('hex')}`);
});

test('candidate cannot represent historical stable metadata as current release approval', () => {
  assert.equal(record.state, 'REVIEW_ONLY_NOT_DEPLOYED');
  assert.equal(record.releaseApproved, false);
  assert.equal(record.deployment.approvedTarget, null);
  assert.equal(record.deployment.redirectChanged, false);
  assert.equal(record.rollback.safeLiveRollbackVerified, false);
  for (const [path, sha] of Object.entries(record.historicalMetadata.gitBlobIds)) {
    assert.equal(gitBlob(path), sha, path);
  }
  const historical = JSON.parse(readFileSync(new URL('release-passport.v1.json', root), 'utf8'));
  assert.notEqual(record.artifactDigest, historical.artifactDigest);
  assert.equal(record.publicBoundary.aiExecutionExposed, false);
  assert.equal(record.publicBoundary.productionMutationExposed, false);
  assert.equal(record.publicBoundary.releaseAuthorityExposed, false);
});
