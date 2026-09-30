import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const worker = fs.readFileSync(new URL('../farm/sovereign-agent/sovereign-ci-worker-v2.py', import.meta.url), 'utf8');
const installer = fs.readFileSync(new URL('../farm/sovereign-agent/install-sovereign-ci-toolchain-termux.sh', import.meta.url), 'utf8');

test('installer pins and launches sealed v2 while preserving least authority', () => {
  assert.match(installer, /PAYLOAD_REVISION=.*246dfaa1e6ff8668e87c6054ba557d57217613da/);
  assert.match(installer, /sovereign-ci-worker-v2\.py/);
  assert.match(installer, /workerProtocol: sealed-capsule-v2/);
  assert.match(installer, /sourceIdentityVisibleBeforeDecrypt.*False/);
  assert.match(installer, /paidSpendAuthorized: false/);
  assert.doesNotMatch(installer, /GITHUB_TOKEN|GH_TOKEN|runner[_-]token|sudo /i);
});

test('outer v2 job rejects source identity and arbitrary command metadata before decrypt', () => {
  assert.match(worker, /OUTER_JOB_SCHEMA = "daube\.sovereign-ci-worker-job\.v2"/);
  assert.match(worker, /CAPSULE_SCHEMA = "daube\.sovereign-ci-source-capsule\.v2"/);
  assert.match(worker, /CAPSULE_MANIFEST_PATH = "\.daube\/sovereign-ci-capsule\.v2\.json"/);
  assert.match(worker, /any\(key in job for key in \("targetId", "sourceRevision", "treeSha", "testPaths", "sourceManifestDigest", "repository", "repositoryPath", "command", "shell", "argv"\)\)/);
  assert.match(worker, /job_outer_metadata_or_command_forbidden/);
});

test('v2 decrypt path verifies capsule digest, exact revision, canonical file set and hashes before test', () => {
  assert.match(worker, /capsule_digest = sha256_bytes\(stable_json\(manifest\)\.encode\(\)\)/);
  assert.match(worker, /capsule_digest_mismatch/);
  assert.match(worker, /TARGETS\.get\(target_id\) != source_revision/);
  assert.match(worker, /capsule_target_revision_forbidden/);
  assert.match(worker, /source_manifest_digest = sha256_bytes\(stable_json\(\{"files": normalized_files\}\)\.encode\(\)\)/);
  assert.match(worker, /capsule_workspace_file_set_mismatch/);
  assert.match(worker, /capsule_source_file_digest_mismatch/);
  assert.match(worker, /capsule_test_path_missing/);
});

test('v2 test execution stays explicit node argv with runtime HOME/TMP outside source', () => {
  assert.match(worker, /argv = \["node", "--test", \*test_paths\]/);
  assert.match(worker, /home = runtime_root \/ "home"/);
  assert.match(worker, /tmp = runtime_root \/ "tmp"/);
  assert.doesNotMatch(worker, /shell=True|os\.system|npm test|npm run/);
});

test('pre-materialization failure never invents decrypted source identity', () => {
  assert.match(worker, /"capsuleVerified": False/);
  assert.match(worker, /"targetId": None/);
  assert.match(worker, /"sourceRevision": None/);
  assert.match(worker, /"treeSha": None/);
  assert.match(worker, /"sourceManifestDigest": None/);
  assert.match(worker, /"testPaths": \[\]/);
  assert.match(worker, /"workspaceMaterialized": False/);
  assert.match(worker, /"workspaceDigestBefore": None/);
  assert.match(worker, /"workspaceScrubbed": True/);
});

test('materialized result binds verified capsule, exact source and scrub-before-completion', () => {
  assert.match(worker, /"capsuleVerified": True/);
  assert.match(worker, /"targetId": capsule\["targetId"\]/);
  assert.match(worker, /"sourceRevision": capsule\["sourceRevision"\]/);
  assert.match(worker, /"testPaths": capsule\["testPaths"\]/);
  assert.match(worker, /source_mutated = before != after/);
  assert.match(worker, /result\["workspaceScrubbed"\] = True/);
});
