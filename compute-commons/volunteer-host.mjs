#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign
} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STATE_SCHEMA = 'daube.compute-commons-volunteer-client-state.v1';
const ATTESTATION_SCHEMA = 'daube.community-host-attestation.v1';
const GPU_HOST_RECEIPT_SCHEMA = 'daube.creative-commons-host-receipt.v1';
const GPU_PROBE_SCHEMA = 'daube.creative-commons-gpu-runtime-probe.v1';
const MODES = new Set(['browser-webgpu', 'browser-cpu', 'local-gpu']);
const ID = /^[a-zA-Z0-9._:-]{3,160}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DEFAULT_STATE_PATH = path.join(os.homedir(), '.daube', 'compute-commons', 'volunteer.json');
const MAX_RESPONSE_CHARS = 1_048_576;

export class BridgeError extends Error {
  constructor(message, { status = null, body = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BridgeError';
    this.status = status;
    this.body = body;
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith('--')) throw new Error(`unexpected_argument:${item}`);
    const equal = item.indexOf('=');
    if (equal > 2) {
      options[item.slice(2, equal)] = item.slice(equal + 1);
      continue;
    }
    const key = item.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { command, options };
}

export function buildInterestBlock(state) {
  const lines = [
    'INTERESTED',
    `mode: ${state.mode}`,
    `host_pubkey_ed25519: ${state.publicKeyRawBase64Url}`
  ];
  if (state.deviceClass) lines.splice(2, 0, `device_class: ${state.deviceClass}`);
  if (state.availability) lines.splice(lines.length - 1, 0, `availability: ${state.availability}`);
  if (state.originText) lines.splice(lines.length - 1, 0, `origin: ${state.originText}`);
  if (state.originId) lines.splice(lines.length - 1, 0, `origin_id: ${state.originId}`);
  return lines.join('\n');
}

export function newIdentity({ mode, deviceClass = null, availability = null, originText = null, originId = null } = {}) {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (!MODES.has(normalizedMode)) throw new Error('mode_must_be_browser-webgpu_browser-cpu_or_local-gpu');
  if (originId && !ID.test(String(originId))) throw new Error('origin_id_invalid');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const publicRaw = Buffer.from(publicDer).subarray(-32);
  return {
    schema: STATE_SCHEMA,
    createdAt: new Date().toISOString(),
    mode: normalizedMode,
    executorId: `exec_${randomBytes(12).toString('hex')}`,
    hostId: `host_${randomBytes(12).toString('hex')}`,
    publicKeyRawBase64Url: publicRaw.toString('base64url'),
    privateKeyPkcs8Base64: Buffer.from(privateDer).toString('base64'),
    publicKeyFingerprintSha256: sha256(publicRaw),
    continuitySecret: randomBytes(32).toString('base64url'),
    deviceClass: cleanOptional(deviceClass, 120),
    availability: cleanOptional(availability, 120),
    originText: cleanOptional(originText, 120),
    originId: originId ? String(originId) : null,
    commentId: null,
    bridgeUrl: null,
    pendingToken: null,
    workerToken: null,
    gpuPairingToken: null,
    gpuAdmissionState: null,
    attestationOperationId: null,
    attestationState: null,
    revokedAt: null
  };
}

export async function saveState(state, file = DEFAULT_STATE_PATH) {
  const target = path.resolve(file);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await fs.chmod(temporary, 0o600).catch(() => {});
  await fs.rename(temporary, target);
  await fs.chmod(target, 0o600).catch(() => {});
  return target;
}

export async function loadState(file = DEFAULT_STATE_PATH) {
  const target = path.resolve(file);
  const state = JSON.parse(await fs.readFile(target, 'utf8'));
  if (state?.schema !== STATE_SCHEMA || !ID.test(String(state.executorId || '')) || !ID.test(String(state.hostId || ''))) {
    throw new Error('volunteer_state_invalid');
  }
  if (!MODES.has(state.mode)) throw new Error('volunteer_state_mode_invalid');
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(state.continuitySecret || ''))) throw new Error('volunteer_state_continuity_secret_invalid');
  return state;
}

export function redactState(state) {
  return {
    schema: state.schema,
    createdAt: state.createdAt,
    mode: state.mode,
    executorId: state.executorId,
    hostId: state.hostId,
    publicKeyRawBase64Url: state.publicKeyRawBase64Url,
    publicKeyFingerprintSha256: state.publicKeyFingerprintSha256,
    deviceClass: state.deviceClass,
    availability: state.availability,
    originText: state.originText,
    originId: state.originId,
    commentId: state.commentId,
    bridgeUrl: state.bridgeUrl,
    attestationOperationId: state.attestationOperationId,
    attestationState: state.attestationState,
    hasPendingToken: Boolean(state.pendingToken),
    hasWorkerToken: Boolean(state.workerToken),
    hasGpuPairingToken: Boolean(state.gpuPairingToken),
    gpuAdmissionState: state.gpuAdmissionState,
    revokedAt: state.revokedAt
  };
}

export async function postBridge(url, payload, { token = null, fetchImpl = globalThis.fetch, timeoutMs = 30_000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new BridgeError('fetch_unavailable');
  const target = normalizeHttpsUrl(url);
  let response;
  try {
    response = await fetchImpl(target, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'D-AUBE-Compute-Commons-Volunteer/1.0',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new BridgeError('bridge_transport_failed', { cause: error });
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new BridgeError('bridge_response_too_large', { status: response.status });
  let body;
  try { body = JSON.parse(text || '{}'); } catch { throw new BridgeError('bridge_response_not_json', { status: response.status }); }
  if (!response.ok || body?.ok !== true) {
    throw new BridgeError(String(body?.detail || body?.error || `bridge_http_${response.status}`), { status: response.status, body });
  }
  return body;
}

export async function pairAndAttest(state, {
  bridgeUrl,
  commentId,
  acceptCommonsPublicSafe = false,
  selfAttestOneHost = false,
  fetchImpl = globalThis.fetch
} = {}) {
  if (acceptCommonsPublicSafe !== true) throw new Error('explicit_flag_required:--accept-commons-public-safe');
  if (selfAttestOneHost !== true) throw new Error('explicit_flag_required:--self-attest-one-host');
  const comment = Number(commentId);
  if (!Number.isSafeInteger(comment) || comment <= 0) throw new Error('comment_id_invalid');
  const target = normalizeHttpsUrl(bridgeUrl);

  const challengeReply = await postBridge(target, {
    action: 'public-pair-challenge',
    executorId: state.executorId,
    commentId: comment
  }, { fetchImpl });
  const challenge = challengeReply.challenge;
  if (!challenge?.message || challenge.executorId !== state.executorId) throw new Error('challenge_contract_invalid');
  if (challenge.publicKeyFingerprint !== state.publicKeyFingerprintSha256) throw new Error('challenge_public_key_fingerprint_mismatch');
  if (challenge.mode !== state.mode) throw new Error('challenge_mode_mismatch');
  if (state.originId && challenge.originId !== state.originId) throw new Error('challenge_origin_mismatch');

  const privateKey = createPrivateKey({
    key: Buffer.from(state.privateKeyPkcs8Base64, 'base64'),
    format: 'der',
    type: 'pkcs8'
  });
  const signature = sign(null, Buffer.from(challenge.message, 'utf8'), privateKey).toString('base64url');
  const claim = await postBridge(target, {
    action: 'public-pair-claim',
    executorId: state.executorId,
    leadId: challenge.leadId,
    challengeId: challenge.challengeId,
    signature
  }, { fetchImpl });
  const pendingToken = claim?.pendingPairing?.token;
  if (!pendingToken || claim.state !== 'PENDING_HOST_ATTESTATION') throw new Error('pending_pairing_contract_invalid');

  const operationId = state.attestationOperationId || `op_${randomBytes(16).toString('hex')}`;
  const originId = challenge.originId;
  const receipt = {
    schema: ATTESTATION_SCHEMA,
    hostId: state.hostId,
    operationId,
    originId,
    explicitHostConsent: true,
    commonsOptIn: true,
    physicalHostAttested: true,
    publicSafeOnly: true,
    hiddenCompute: false,
    remoteCodeAllowed: false,
    arbitraryShellAllowed: false,
    commercialOptIn: false
  };

  let attestation;
  try {
    attestation = await postBridge(target, {
      action: 'host-attest',
      executorId: state.executorId,
      receipt,
      hostContinuitySecret: state.continuitySecret
    }, { token: pendingToken, fetchImpl });
  } catch (error) {
    attestation = await recoverAttestation(target, state, operationId, pendingToken, fetchImpl, error);
  }
  if (attestation?.outcome?.state && attestation.outcome.state !== 'COMMITTED') throw new Error(`attestation_not_committed:${attestation.outcome.state}`);

  const upgrade = await postBridge(target, {
    action: 'public-pair-upgrade',
    executorId: state.executorId,
    hostId: state.hostId,
    operationId,
    hostContinuitySecret: state.continuitySecret
  }, { token: pendingToken, fetchImpl });
  if (!upgrade?.pairing?.token || upgrade.state !== 'ADMITTED_WORKER_TOKEN_ISSUED') throw new Error('worker_upgrade_contract_invalid');

  return {
    ...state,
    commentId: comment,
    bridgeUrl: target,
    originId,
    pendingToken,
    workerToken: upgrade.pairing.token,
    gpuPairingToken: upgrade?.gpuPairing?.token || null,
    gpuAdmissionState: upgrade.gpuAdmissionState || null,
    attestationOperationId: operationId,
    attestationState: 'COMMITTED',
    pairedAt: new Date().toISOString(),
    revokedAt: null
  };
}

async function recoverAttestation(url, state, operationId, token, fetchImpl, originalError) {
  let lastError = originalError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const status = await postBridge(url, {
        action: 'host-attest-status',
        executorId: state.executorId,
        hostId: state.hostId,
        operationId,
        hostContinuitySecret: state.continuitySecret
      }, { token, fetchImpl });
      if (status?.outcome?.state === 'COMMITTED' && status.outcome.committed === true) return status;
      if (['SUPERSEDED', 'NOT_OWNED', 'DIFFERENT_OPERATION'].includes(status?.outcome?.state)) {
        throw new Error(`attestation_terminal_state:${status.outcome.state}`);
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function revokeHost(state, { bridgeUrl = state.bridgeUrl, fetchImpl = globalThis.fetch } = {}) {
  const token = state.workerToken || state.pendingToken;
  if (!token) throw new Error('no_pairing_token_available');
  const reply = await postBridge(bridgeUrl, {
    action: 'host-attest-revoke',
    executorId: state.executorId,
    hostId: state.hostId,
    hostContinuitySecret: state.continuitySecret
  }, { token, fetchImpl });
  return {
    ...state,
    pendingToken: null,
    workerToken: null,
    gpuPairingToken: null,
    gpuAdmissionState: null,
    attestationState: reply.revoked === false ? 'NOT_PRESENT' : 'REVOKED',
    revokedAt: new Date().toISOString()
  };
}

export async function registerGpu(state, options = {}, { fetchImpl = globalThis.fetch } = {}) {
  if (!state.gpuPairingToken) throw new Error('gpu_pairing_token_missing');
  const url = normalizeHttpsUrl(options.gpuBridgeUrl);
  if (options.acceptGpuSelfReport !== true) throw new Error('explicit_flag_required:--accept-gpu-self-report');
  const vendor = requiredText(options.vendor, 'gpu_vendor_required', 80);
  const name = requiredText(options.name, 'gpu_name_required', 160);
  const vramGiB = finite(options.vramGiB, 1, 512, 'gpu_vram_invalid');
  const runtimeRevision = String(options.runtimeRevision || '').trim().toLowerCase();
  if (!HEX64.test(runtimeRevision)) throw new Error('runtime_revision_must_be_sha256');
  const supportedWorkloads = csv(options.workloads, 'gpu_workloads_required');
  const workflowDigests = csv(options.workflowDigests, 'workflow_digests_required').map(value => value.toLowerCase());
  if (!workflowDigests.every(value => HEX64.test(value))) throw new Error('workflow_digest_invalid');
  const modelProfiles = csv(options.modelProfiles, 'model_profiles_required');

  const receipt = {
    schema: GPU_HOST_RECEIPT_SCHEMA,
    executorId: state.executorId,
    explicitConsent: true,
    visibleComputeState: true,
    localStopAvailable: true,
    pullOnly: true,
    commercialWorkloads: false,
    privateAssetsAllowed: false,
    arbitraryRemoteCodeAllowed: false,
    arbitraryShellAllowed: false,
    gpu: {
      vendor,
      name,
      vramGiB,
      driverVersion: cleanOptional(options.driverVersion, 80),
      cudaVersion: cleanOptional(options.cudaVersion, 80)
    },
    supportedWorkloads,
    workflowDigests,
    modelProfiles,
    runtimeRevision,
    maxSessionMinutes: integer(options.maxSessionMinutes, 5, 120, 30),
    maxJobsPerSession: integer(options.maxJobsPerSession, 1, 20, 4),
    cooldownSeconds: integer(options.cooldownSeconds, 0, 600, 30)
  };
  const reply = await postBridge(url, { action: 'register', executorId: state.executorId, receipt }, {
    token: state.gpuPairingToken,
    fetchImpl
  });
  return { reply, gpuBridgeUrl: url, receipt };
}

export async function submitMeasuredGpuProbe(state, { gpuBridgeUrl, probeFile } = {}, { fetchImpl = globalThis.fetch } = {}) {
  if (!state.gpuPairingToken) throw new Error('gpu_pairing_token_missing');
  const probe = JSON.parse(await fs.readFile(path.resolve(String(probeFile || '')), 'utf8'));
  if (probe?.schema !== GPU_PROBE_SCHEMA) throw new Error('gpu_probe_schema_invalid');
  if (probe.executorId !== state.executorId) throw new Error('gpu_probe_executor_mismatch');
  if (probe.arbitraryCodeExecuted !== false || probe.arbitraryShellExecuted !== false || probe.productionEligible === true) {
    throw new Error('gpu_probe_safety_contract_invalid');
  }
  if (!HEX64.test(String(probe.probeDigest || '').toLowerCase())) throw new Error('gpu_probe_digest_invalid');
  return postBridge(gpuBridgeUrl, { action: 'probe', executorId: state.executorId, probe }, {
    token: state.gpuPairingToken,
    fetchImpl
  });
}

function normalizeHttpsUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('bridge_url_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('bridge_url_https_required');
  return url.toString();
}

function cleanOptional(value, max) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length > max || /[\u0000-\u001f\u007f]/.test(text)) throw new Error('optional_text_invalid');
  return text;
}

function requiredText(value, code, max) {
  const text = cleanOptional(value, max);
  if (!text) throw new Error(code);
  return text;
}

function finite(value, min, max, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(code);
  return number;
}

function integer(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return Math.max(min, Math.min(max, Math.trunc(finite(value, min, max, 'integer_out_of_range'))));
}

function csv(value, code) {
  const items = [...new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))];
  if (items.length === 0) throw new Error(code);
  return items;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function boolOption(options, name) {
  return options[name] === true || String(options[name] || '').toLowerCase() === 'true';
}

function help() {
  return `D’AUBE Compute Commons volunteer host client\n\nCommands:\n  init --mode local-gpu|browser-webgpu|browser-cpu [--device-class ...] [--availability ...] [--origin ...] [--origin-id ...]\n  interest\n  pair --comment-id ID --bridge-url https://... --accept-commons-public-safe --self-attest-one-host\n  show\n  revoke [--bridge-url https://...]\n  gpu-register --gpu-bridge-url https://... --vendor NVIDIA --name ... --vram-gib 12 --runtime-revision <64hex> --workloads creative-runtime-probe --workflow-digests <64hex,...> --model-profiles <id,...> --accept-gpu-self-report\n  gpu-probe --gpu-bridge-url https://... --probe-file measured-probe.json\n\nGlobal:\n  --state PATH   Override ${DEFAULT_STATE_PATH}\n\nSafety:\n  This client never asks for a D’AUBE root secret. Keep the state file private: it contains your Ed25519 private key, continuity secret and short-lived capability tokens. Public volunteer capacity is PUBLIC_SAFE-only, pull-only, zero-paid-spend, no arbitrary shell/code, and revocable by the host.`;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  const stateFile = String(options.state || DEFAULT_STATE_PATH);

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(help());
    return;
  }
  if (command === 'init') {
    try { await fs.access(path.resolve(stateFile)); throw new Error('state_already_exists_refusing_to_overwrite'); } catch (error) {
      if (error?.message === 'state_already_exists_refusing_to_overwrite') throw error;
    }
    const state = newIdentity({
      mode: options.mode,
      deviceClass: options['device-class'],
      availability: options.availability,
      originText: options.origin,
      originId: options['origin-id']
    });
    const saved = await saveState(state, stateFile);
    console.log(`State created: ${saved}`);
    console.log('\nPost only this public block on daube-public-release#96:\n');
    console.log(buildInterestBlock(state));
    return;
  }

  const state = await loadState(stateFile);
  if (command === 'interest') {
    console.log(buildInterestBlock(state));
    return;
  }
  if (command === 'show') {
    console.log(JSON.stringify(redactState(state), null, 2));
    return;
  }
  if (command === 'pair') {
    const updated = await pairAndAttest(state, {
      bridgeUrl: options['bridge-url'],
      commentId: options['comment-id'],
      acceptCommonsPublicSafe: boolOption(options, 'accept-commons-public-safe'),
      selfAttestOneHost: boolOption(options, 'self-attest-one-host')
    });
    await saveState(updated, stateFile);
    console.log(JSON.stringify(redactState(updated), null, 2));
    return;
  }
  if (command === 'revoke') {
    const updated = await revokeHost(state, { bridgeUrl: options['bridge-url'] || state.bridgeUrl });
    await saveState(updated, stateFile);
    console.log(JSON.stringify(redactState(updated), null, 2));
    return;
  }
  if (command === 'gpu-register') {
    const result = await registerGpu(state, {
      gpuBridgeUrl: options['gpu-bridge-url'],
      vendor: options.vendor,
      name: options.name,
      vramGiB: options['vram-gib'],
      runtimeRevision: options['runtime-revision'],
      workloads: options.workloads,
      workflowDigests: options['workflow-digests'],
      modelProfiles: options['model-profiles'],
      driverVersion: options['driver-version'],
      cudaVersion: options['cuda-version'],
      maxSessionMinutes: options['max-session-minutes'],
      maxJobsPerSession: options['max-jobs-per-session'],
      cooldownSeconds: options['cooldown-seconds'],
      acceptGpuSelfReport: boolOption(options, 'accept-gpu-self-report')
    });
    console.log(JSON.stringify({ ok: true, registration: result.reply.session, truthBoundary: 'Registration is self-reported capability only; it is NOT measured GPU capacity.' }, null, 2));
    return;
  }
  if (command === 'gpu-probe') {
    const result = await submitMeasuredGpuProbe(state, {
      gpuBridgeUrl: options['gpu-bridge-url'],
      probeFile: options['probe-file']
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`unsupported_command:${command}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`D’AUBE volunteer client error: ${message}`);
    process.exitCode = 1;
  });
}
