import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const installer = read('farm/sovereign-agent/install-sovereign-ci-toolchain-termux.sh');
const attestor = read('farm/sovereign-agent/sovereign-ci-attest.py');
const worker = read('farm/sovereign-agent/sovereign-ci-worker.py');

test('Termux CI bootstrap uses packaged rage, Node 22+, and no runner credential', () => {
  assert.match(installer, /pkg install -y git python curl coreutils tar zstd rage/);
  assert.doesNotMatch(installer, /pkg install[^\n]*\bage\b/);
  assert.match(installer, /NODE_MAJOR >= 22/);
  assert.match(installer, /rage-keygen -o/);
  assert.match(installer, /chmod 0600 "\$AGE_IDENTITY"/);
  assert.match(installer, /RECIPIENT_FINGERPRINT/);
  assert.match(installer, /DAUBE_SOVEREIGN_CI_RELEASE_REVISION:-[a-f0-9]{40}/);
  assert.doesNotMatch(installer, /\bGITHUB_TOKEN\b|\bGH_TOKEN\b|\bRUNNER_TOKEN\b|config\.sh[^\n]*--token|^\s*sudo\s/m);
});

test('bootstrap schedules bounded proof and fixed worker without paid fallback', () => {
  assert.match(installer, /--job-id "\$ATTEST_JOB_ID" --period-ms 1800000/);
  assert.match(installer, /--job-id "\$WORKER_JOB_ID" --period-ms 900000/);
  assert.match(installer, /if \[\[ "\$ATTEST_RC" -eq 0 \]\]/);
  assert.match(installer, /paidSpendAuthorized: false/);
});

test('signed readiness binds rage X25519 recipient and minimum Node version', () => {
  assert.match(attestor, /MIN_NODE_MAJOR = 22/);
  assert.match(attestor, /"age": \["rage", "--version"\]/);
  assert.match(attestor, /AGE_RECIPIENT_RE/);
  assert.match(attestor, /hashlib\.sha256\(recipient\.encode\(\)\)\.hexdigest\(\)/);
  assert.match(attestor, /mode & 0o077/);
  assert.match(attestor, /"recipientType": "age-x25519"/);
  assert.match(attestor, /"githubCredentialRequiredOnHost": False/);
  assert.match(attestor, /"mergeAdmissionAuthorized": False/);
});

test('worker is immutable-target, explicit-node-test only, and shell-free', () => {
  assert.match(worker, /provider-fabric-smoke-v1.*3202b09c49f87fd733ad3afb84ac7be465b23301/s);
  assert.match(worker, /studio-runtime-smoke-v1.*ede6bb5d27cac26539b181330549f59dc6aff63a/s);
  assert.match(worker, /argv = \["node", "--test", \*test_paths\]/);
  assert.match(worker, /any\(key in job for key in \("command", "shell", "argv"\)\)/);
  assert.doesNotMatch(worker, /shell=True|os\.system|subprocess\.call\([^\n]*shell/);
});

test('worker validates encrypted archive before extraction and source before execution', () => {
  assert.match(worker, /sha256_bytes\(stable_json\(job\)\.encode\(\)\)/);
  assert.match(worker, /job_manifest_digest_mismatch/);
  assert.match(worker, /job_ciphertext_digest_mismatch/);
  assert.match(worker, /safe_archive_names/);
  assert.match(worker, /archive_path_escape/);
  assert.match(worker, /workspace_special_file_forbidden/);
  assert.match(worker, /source_manifest_digest_mismatch/);
});

test('runtime HOME and TMP stay outside source workspace and completion is scrub-first', () => {
  assert.match(worker, /def run_tests\(workspace: Path, runtime_root: Path/);
  assert.match(worker, /home = runtime_root \/ "home"/);
  assert.match(worker, /tmp = runtime_root \/ "tmp"/);
  assert.match(worker, /with tempfile\.TemporaryDirectory/);
  assert.match(worker, /result\["workspaceScrubbed"\] = True/);
  assert.match(worker, /workspaceMaterialized": False/);
  assert.match(worker, /workspaceDigestBefore": None/);
  assert.match(worker, /workspaceDigestAfter": None/);
});

test('expiry is parsed as timezone-aware UTC and output content is reduced to digests', () => {
  assert.match(worker, /datetime\.fromisoformat\(text\.replace\("Z", "\+00:00"\)\)/);
  assert.match(worker, /astimezone\(timezone\.utc\)\.timestamp\(\)/);
  assert.match(worker, /"stdoutDigest": sha256_bytes\(stdout\)/);
  assert.match(worker, /"stderrDigest": sha256_bytes\(stderr\)/);
  assert.doesNotMatch(worker, /"stdout": stdout|"stderr": stderr/);
});
