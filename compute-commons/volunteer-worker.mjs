#!/usr/bin/env node

import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { loadState, postBridge } from './volunteer-host.mjs';

export const WORKER_SCHEMA = 'daube.compute-commons-worker.v1';
export const TASK_SCHEMA = 'daube.volunteer-edge-task.v1';
export const KERNEL_ID = 'rgba-premultiply-u8-v1';
export const KERNEL_VERSION = 1;
export const TASK_MODE = 'public-rgba8-artifact-v1';
export const INPUT_MODE = 'public-rgba8-base64-v1';
export const MAX_PIXELS = 4096;
export const DEFAULT_STATE_PATH = path.join(os.homedir(), '.daube', 'compute-commons', 'volunteer.json');

export function buildRuntimeReceipt(state, { maxElements = MAX_PIXELS, sessionJobLimit = 20 } = {}) {
  if (!state?.executorId || !state?.workerToken) throw new Error('paired_worker_state_required');
  return Object.freeze({
    schema: 'daube.volunteer-edge-runtime-receipt.v1',
    consent: true,
    visibleComputeState: true,
    remoteCodeAllowed: false,
    arbitraryShellAllowed: false,
    publicSafeOnly: true,
    webgpu: false,
    deviceClass: String(state.deviceClass || 'cpu-public-artifact-worker').slice(0, 100),
    maxElements: integer(maxElements, 64, MAX_PIXELS, MAX_PIXELS),
    sessionJobLimit: integer(sessionJobLimit, 1, 100, 20),
    supportedKernels: [KERNEL_ID],
    supportedTaskModes: [TASK_MODE]
  });
}

export async function registerWorker(state, { bridgeUrl = state?.bridgeUrl, fetchImpl = globalThis.fetch } = {}) {
  assertPairedState(state);
  const reply = await postBridge(bridgeUrl, {
    action: 'register',
    executorId: state.executorId,
    receipt: buildRuntimeReceipt(state)
  }, { token: state.workerToken, fetchImpl });
  const session = reply?.session;
  if (!session || session.status !== 'READY') throw new Error('worker_session_not_ready');
  if (!Array.isArray(session.supportedKernels) || !session.supportedKernels.includes(KERNEL_ID)) {
    throw new Error('worker_session_kernel_not_admitted');
  }
  if (!Array.isArray(session.supportedTaskModes) || !session.supportedTaskModes.includes(TASK_MODE)) {
    throw new Error('worker_session_task_mode_not_admitted');
  }
  return session;
}

export async function claimWorkerTask(state, { bridgeUrl = state?.bridgeUrl, blockMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  assertPairedState(state);
  const reply = await postBridge(bridgeUrl, {
    action: 'claim',
    executorId: state.executorId,
    taskMode: TASK_MODE,
    blockMs: integer(blockMs, 0, 5000, 2000)
  }, { token: state.workerToken, fetchImpl, timeoutMs: Math.max(10_000, Number(blockMs || 0) + 7000) });
  const claimed = reply?.claimed ?? null;
  if (!claimed) return null;
  if (!claimed.streamId || !claimed.task) throw new Error('worker_claim_contract_invalid');
  validateClaimedTask(claimed.task);
  return claimed;
}

export async function heartbeatWorkerTask(state, claimed, { bridgeUrl = state?.bridgeUrl, fetchImpl = globalThis.fetch } = {}) {
  assertPairedState(state);
  validateClaimEnvelope(claimed);
  const reply = await postBridge(bridgeUrl, {
    action: 'heartbeat',
    executorId: state.executorId,
    streamId: claimed.streamId,
    taskMode: TASK_MODE
  }, { token: state.workerToken, fetchImpl });
  if (reply?.ok !== true || reply?.state !== 'READY') throw new Error(`worker_heartbeat_not_ready:${reply?.state || 'unknown'}`);
  return reply;
}

export function executeFixedTask(task, { now = () => performance.now() } = {}) {
  validateClaimedTask(task);
  const started = Number(now());
  const inputBytes = decodeCanonicalBase64(task.rgbaInputBase64, MAX_PIXELS * 4, 'worker_input_base64_invalid');
  if (inputBytes.byteLength !== Number(task.elements) * 4) throw new Error('worker_input_byte_length_mismatch');
  if (sha256Bytes(inputBytes) !== task.inputSha256) throw new Error('worker_input_sha256_mismatch');

  const inputWords = rgbaWordsFromBytes(inputBytes);
  const outputWords = new Uint32Array(inputWords.length);
  for (let index = 0; index < inputWords.length; index += 1) outputWords[index] = rgbaPremultiplyWord(inputWords[index]);
  const outputBytes = rgbaBytesFromWords(outputWords);
  const outputSha256 = sha256Bytes(outputBytes);
  const firstValue = outputWords[0] >>> 0;
  const lastValue = outputWords[outputWords.length - 1] >>> 0;
  const checksumFnv1a32 = fnv1a32U32(outputWords);

  if (firstValue !== (Number(task.expectedFirstValue) >>> 0)) throw new Error('worker_expected_first_value_mismatch');
  if (lastValue !== (Number(task.expectedLastValue) >>> 0)) throw new Error('worker_expected_last_value_mismatch');
  if (checksumFnv1a32 !== (Number(task.expectedChecksumFnv1a32) >>> 0)) throw new Error('worker_expected_checksum_mismatch');
  if (outputSha256 !== task.expectedOutputSha256) throw new Error('worker_expected_output_sha256_mismatch');

  const ended = Number(now());
  const latencyMs = Math.max(0, Number.isFinite(ended - started) ? ended - started : 0);
  return Object.freeze({
    backend: 'cpu',
    elements: outputWords.length,
    firstValue,
    lastValue,
    checksumFnv1a32,
    outputRgbaBase64: Buffer.from(outputBytes).toString('base64'),
    latencyMs: Math.round(latencyMs * 1000) / 1000
  });
}

export async function completeWorkerTask(state, claimed, receipt, { bridgeUrl = state?.bridgeUrl, fetchImpl = globalThis.fetch } = {}) {
  assertPairedState(state);
  validateClaimEnvelope(claimed);
  const reply = await postBridge(bridgeUrl, {
    action: 'complete',
    executorId: state.executorId,
    streamId: claimed.streamId,
    taskRunId: claimed.task.taskRunId,
    taskMode: TASK_MODE,
    receipt
  }, { token: state.workerToken, fetchImpl });
  if (reply?.ok !== true) throw new Error('worker_completion_not_accepted');
  return reply;
}

export async function failWorkerTask(state, claimed, error, { bridgeUrl = state?.bridgeUrl, retryable = false, fetchImpl = globalThis.fetch } = {}) {
  assertPairedState(state);
  validateClaimEnvelope(claimed);
  return postBridge(bridgeUrl, {
    action: 'fail',
    executorId: state.executorId,
    streamId: claimed.streamId,
    taskRunId: claimed.task.taskRunId,
    taskMode: TASK_MODE,
    error: String(error instanceof Error ? error.message : error || 'worker_task_failed').slice(0, 500),
    retryable: retryable === true
  }, { token: state.workerToken, fetchImpl });
}

export async function runWorkerCycle(state, { bridgeUrl = state?.bridgeUrl, blockMs = 2000, fetchImpl = globalThis.fetch } = {}) {
  const session = await registerWorker(state, { bridgeUrl, fetchImpl });
  const claimed = await claimWorkerTask(state, { bridgeUrl, blockMs, fetchImpl });
  if (!claimed) return Object.freeze({ schema: WORKER_SCHEMA, status: 'IDLE', sessionExpiresAt: session.expiresAt || null });

  try {
    await heartbeatWorkerTask(state, claimed, { bridgeUrl, fetchImpl });
    const receipt = executeFixedTask(claimed.task);
    const completion = await completeWorkerTask(state, claimed, receipt, { bridgeUrl, fetchImpl });
    return Object.freeze({
      schema: WORKER_SCHEMA,
      status: 'PASS',
      taskRunId: claimed.task.taskRunId,
      kernelId: KERNEL_ID,
      taskMode: TASK_MODE,
      backend: 'cpu',
      evidenceDigest: completion.evidenceDigest || null,
      artifact: completion.artifact || null,
      latencyMs: receipt.latencyMs
    });
  } catch (error) {
    await failWorkerTask(state, claimed, error, { bridgeUrl, retryable: false, fetchImpl }).catch(() => undefined);
    throw error;
  }
}

export async function watchWorker(state, {
  bridgeUrl = state?.bridgeUrl,
  pollMs = 2500,
  blockMs = 2000,
  maxJobs = 0,
  fetchImpl = globalThis.fetch,
  signal = null,
  onEvent = event => console.log(JSON.stringify(event))
} = {}) {
  assertPairedState(state);
  const interval = integer(pollMs, 250, 60_000, 2500);
  const block = integer(blockMs, 0, 5000, 2000);
  const limit = integer(maxJobs, 0, 1_000_000, 0);
  let completed = 0;
  onEvent({ schema: WORKER_SCHEMA, status: 'STARTED', executorId: state.executorId, publicSafeOnly: true, localStop: 'Ctrl+C' });

  while (!signal?.aborted && (limit === 0 || completed < limit)) {
    try {
      const result = await runWorkerCycle(state, { bridgeUrl, blockMs: block, fetchImpl });
      onEvent(result);
      if (result.status === 'PASS') completed += 1;
    } catch (error) {
      onEvent({ schema: WORKER_SCHEMA, status: 'ERROR', error: String(error instanceof Error ? error.message : error).slice(0, 500) });
    }
    if (signal?.aborted || (limit > 0 && completed >= limit)) break;
    await sleep(interval, signal).catch(() => undefined);
  }

  const result = Object.freeze({ schema: WORKER_SCHEMA, status: 'STOPPED', completed });
  onEvent(result);
  return result;
}

export function validateClaimedTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('worker_task_required');
  if (task.schema !== TASK_SCHEMA) throw new Error('worker_task_schema_invalid');
  if (task.kernelId !== KERNEL_ID || Number(task.kernelVersion) !== KERNEL_VERSION) throw new Error('worker_kernel_not_admitted');
  if (task.taskMode !== TASK_MODE || task.inputMode !== INPUT_MODE) throw new Error('worker_task_mode_not_admitted');
  const elements = integer(task.elements, 64, MAX_PIXELS, null, 'worker_elements_invalid');
  if (task.publicSafeInput !== true || task.persistOutput !== true || task.reusableMediaOutput !== true) throw new Error('worker_public_artifact_contract_required');
  if (!/^[a-f0-9]{64}$/.test(String(task.inputSha256 || '').toLowerCase())) throw new Error('worker_input_sha256_invalid');
  if (!/^[a-f0-9]{64}$/.test(String(task.expectedOutputSha256 || '').toLowerCase())) throw new Error('worker_output_sha256_invalid');
  const bytes = decodeCanonicalBase64(task.rgbaInputBase64, MAX_PIXELS * 4, 'worker_input_base64_invalid');
  if (bytes.byteLength !== elements * 4) throw new Error('worker_input_byte_length_mismatch');
  for (const value of [task.expectedFirstValue, task.expectedLastValue, task.expectedChecksumFnv1a32]) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('worker_expected_value_invalid');
  }
  return true;
}

function validateClaimEnvelope(claimed) {
  if (!claimed || typeof claimed !== 'object' || !/^\d+-\d+$/.test(String(claimed.streamId || ''))) throw new Error('worker_claim_stream_invalid');
  validateClaimedTask(claimed.task);
}

function assertPairedState(state) {
  if (!state || !state.executorId || !state.workerToken || !state.bridgeUrl) throw new Error('paired_worker_state_required');
  if (state.attestationState !== 'COMMITTED' || state.revokedAt) throw new Error('worker_host_not_committed');
}

export function rgbaPremultiplyWord(word) {
  const value = Number(word) >>> 0;
  const r = value & 255;
  const g = (value >>> 8) & 255;
  const b = (value >>> 16) & 255;
  const a = (value >>> 24) & 255;
  const pr = Math.floor((r * a + 127) / 255);
  const pg = Math.floor((g * a + 127) / 255);
  const pb = Math.floor((b * a + 127) / 255);
  return (pr | (pg << 8) | (pb << 16) | (a << 24)) >>> 0;
}

export function rgbaWordsFromBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength % 4 !== 0) throw new Error('worker_rgba_bytes_invalid');
  const words = new Uint32Array(bytes.byteLength / 4);
  for (let i = 0; i < words.length; i += 1) {
    const o = i * 4;
    words[i] = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  }
  return words;
}

export function rgbaBytesFromWords(words) {
  if (!(words instanceof Uint32Array) || words.length === 0 || words.length > MAX_PIXELS) throw new Error('worker_rgba_words_invalid');
  const bytes = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i += 1) {
    const value = words[i] >>> 0;
    const o = i * 4;
    bytes[o] = value & 255;
    bytes[o + 1] = (value >>> 8) & 255;
    bytes[o + 2] = (value >>> 16) & 255;
    bytes[o + 3] = (value >>> 24) & 255;
  }
  return bytes;
}

export function fnv1a32U32(values) {
  let hash = 0x811c9dc5;
  for (const raw of values) {
    const value = Number(raw) >>> 0;
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (value >>> shift) & 255;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

function decodeCanonicalBase64(value, maxBytes, code) {
  const text = typeof value === 'string' ? value : '';
  if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error(code);
  if (text.length > Math.ceil(maxBytes / 3) * 4 + 4) throw new Error(code);
  const bytes = Buffer.from(text, 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes || bytes.toString('base64') !== text) throw new Error(code);
  return new Uint8Array(bytes);
}

function sha256Bytes(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function integer(value, min, max, fallback, code = 'integer_out_of_range') {
  if (value === undefined || value === null || value === '') {
    if (fallback === null) throw new Error(code);
    return fallback;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(code);
  return number;
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  });
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) throw new Error(`unexpected_argument:${item}`);
    const key = item.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) { options[key] = next; i += 1; } else options[key] = true;
  }
  return { command, options };
}

function help() {
  return `D’AUBE Compute Commons fixed worker V1\n\nCommands:\n  once [--state PATH] [--bridge-url https://...] [--block-ms 2000]\n  watch [--state PATH] [--bridge-url https://...] [--poll-ms 2500] [--block-ms 2000] [--max-jobs N]\n\nSafety:\n  Only ${KERNEL_ID}/${TASK_MODE} is supported. No arbitrary shell, code, secrets, private assets or production mutation. The worker is pull-only and stops locally with Ctrl+C.`;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (['help', '--help', '-h'].includes(command)) { console.log(help()); return; }
  const state = await loadState(String(options.state || DEFAULT_STATE_PATH));
  const bridgeUrl = options['bridge-url'] || state.bridgeUrl;
  if (command === 'once') {
    const result = await runWorkerCycle(state, { bridgeUrl, blockMs: options['block-ms'] });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'watch') {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await watchWorker(state, {
      bridgeUrl,
      pollMs: options['poll-ms'],
      blockMs: options['block-ms'],
      maxJobs: options['max-jobs'],
      signal: controller.signal
    });
    return;
  }
  throw new Error(`unsupported_command:${command}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(`D’AUBE volunteer worker error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
