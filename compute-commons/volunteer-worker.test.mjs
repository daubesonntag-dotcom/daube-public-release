import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildRuntimeReceipt,
  executeFixedTask,
  fnv1a32U32,
  KERNEL_ID,
  rgbaBytesFromWords,
  rgbaPremultiplyWord,
  runWorkerCycle,
  TASK_MODE,
  validateClaimedTask
} from './volunteer-worker.mjs';

const bridgeUrl = 'https://example.test/api/workforce/volunteer-edge-bridge';
const state = {
  executorId: 'exec_test_123',
  hostId: 'host_test_123',
  workerToken: 'worker-token-local-test',
  bridgeUrl,
  attestationState: 'COMMITTED',
  revokedAt: null,
  deviceClass: 'test-cpu'
};

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function taskFixture() {
  const input = new Uint32Array(64);
  for (let i = 0; i < input.length; i += 1) {
    const r = (i * 17 + 13) & 255;
    const g = (i * 29 + 7) & 255;
    const b = (i * 43 + 3) & 255;
    const a = (i * 61 + 191) & 255;
    input[i] = (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
  }
  const output = new Uint32Array([...input].map(rgbaPremultiplyWord));
  const inputBytes = rgbaBytesFromWords(input);
  const outputBytes = rgbaBytesFromWords(output);
  return {
    schema: 'daube.volunteer-edge-task.v1',
    taskRunId: 'wft_1234567890abcdef',
    kernelId: KERNEL_ID,
    kernelVersion: 1,
    taskMode: TASK_MODE,
    elements: 64,
    expectedFirstValue: output[0],
    expectedLastValue: output[output.length - 1],
    expectedChecksumFnv1a32: fnv1a32U32(output),
    inputMode: 'public-rgba8-base64-v1',
    rgbaInputBase64: Buffer.from(inputBytes).toString('base64'),
    inputSha256: sha256(inputBytes),
    expectedOutputSha256: sha256(outputBytes),
    publicSafeInput: true,
    persistOutput: true,
    reusableMediaOutput: true,
    attempt: 0
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('runtime receipt advertises only fixed public-safe capability', () => {
  const receipt = buildRuntimeReceipt(state);
  assert.deepEqual(receipt.supportedKernels, [KERNEL_ID]);
  assert.deepEqual(receipt.supportedTaskModes, [TASK_MODE]);
  assert.equal(receipt.publicSafeOnly, true);
  assert.equal(receipt.remoteCodeAllowed, false);
  assert.equal(receipt.arbitraryShellAllowed, false);
});

test('fixed CPU kernel reproduces server-bound expected evidence', () => {
  const task = taskFixture();
  const receipt = executeFixedTask(task, { now: (() => { let x = 1; return () => (x += 0.5); })() });
  assert.equal(receipt.backend, 'cpu');
  assert.equal(receipt.elements, 64);
  assert.equal(receipt.firstValue, task.expectedFirstValue);
  assert.equal(receipt.lastValue, task.expectedLastValue);
  assert.equal(receipt.checksumFnv1a32, task.expectedChecksumFnv1a32);
  assert.equal(sha256(Buffer.from(receipt.outputRgbaBase64, 'base64')), task.expectedOutputSha256);
});

test('worker rejects arbitrary kernel or non-public artifact contracts', () => {
  assert.throws(() => validateClaimedTask({ ...taskFixture(), kernelId: 'arbitrary-code-v1' }), /kernel_not_admitted/);
  assert.throws(() => validateClaimedTask({ ...taskFixture(), publicSafeInput: false }), /public_artifact_contract_required/);
});

test('worker rejects tampered input before sending a completion', () => {
  const task = taskFixture();
  const raw = Buffer.from(task.rgbaInputBase64, 'base64');
  raw[0] ^= 0xff;
  const tampered = { ...task, rgbaInputBase64: raw.toString('base64') };
  assert.throws(() => executeFixedTask(tampered), /input_sha256_mismatch/);
});

test('one cycle registers, claims, heartbeats and completes without arbitrary execution', async () => {
  const task = taskFixture();
  const actions = [];
  let completionReceipt = null;
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    actions.push(body.action);
    assert.equal(init.headers.Authorization, 'Bearer worker-token-local-test');
    if (body.action === 'register') return jsonResponse({ ok: true, session: { status: 'READY', expiresAt: new Date(Date.now() + 60_000).toISOString(), supportedKernels: [KERNEL_ID], supportedTaskModes: [TASK_MODE] } });
    if (body.action === 'claim') return jsonResponse({ ok: true, claimed: { streamId: '1-0', task } });
    if (body.action === 'heartbeat') return jsonResponse({ ok: true, state: 'READY' });
    if (body.action === 'complete') { completionReceipt = body.receipt; return jsonResponse({ ok: true, taskRunId: task.taskRunId, evidenceDigest: 'a'.repeat(64), artifact: { sha256: task.expectedOutputSha256 } }); }
    throw new Error(`unexpected_action:${body.action}`);
  };
  const result = await runWorkerCycle(state, { fetchImpl, blockMs: 0 });
  assert.deepEqual(actions, ['register', 'claim', 'heartbeat', 'complete']);
  assert.equal(result.status, 'PASS');
  assert.equal(completionReceipt.backend, 'cpu');
  assert.equal(sha256(Buffer.from(completionReceipt.outputRgbaBase64, 'base64')), task.expectedOutputSha256);
});

test('idle cycle does not invent work', async () => {
  const actions = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body); actions.push(body.action);
    if (body.action === 'register') return jsonResponse({ ok: true, session: { status: 'READY', supportedKernels: [KERNEL_ID], supportedTaskModes: [TASK_MODE] } });
    if (body.action === 'claim') return jsonResponse({ ok: true, claimed: null });
    throw new Error('unexpected');
  };
  const result = await runWorkerCycle(state, { fetchImpl, blockMs: 0 });
  assert.equal(result.status, 'IDLE');
  assert.deepEqual(actions, ['register', 'claim']);
});

test('worker reports a fixed-contract failure instead of completing tampered work', async () => {
  const task = { ...taskFixture(), expectedOutputSha256: 'f'.repeat(64) };
  const actions = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body); actions.push(body.action);
    if (body.action === 'register') return jsonResponse({ ok: true, session: { status: 'READY', supportedKernels: [KERNEL_ID], supportedTaskModes: [TASK_MODE] } });
    if (body.action === 'claim') return jsonResponse({ ok: true, claimed: { streamId: '2-0', task } });
    if (body.action === 'heartbeat') return jsonResponse({ ok: true, state: 'READY' });
    if (body.action === 'fail') { assert.equal(body.retryable, false); return jsonResponse({ ok: true, state: 'failed' }); }
    throw new Error(`unexpected_action:${body.action}`);
  };
  await assert.rejects(() => runWorkerCycle(state, { fetchImpl, blockMs: 0 }), /expected_output_sha256_mismatch/);
  assert.deepEqual(actions, ['register', 'claim', 'heartbeat', 'fail']);
});
