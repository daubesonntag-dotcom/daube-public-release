import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildInterestBlock,
  newIdentity,
  pairAndAttest,
  redactState,
  registerGpu,
  revokeHost
} from './volunteer-host.mjs';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); }
  };
}

function bridgeFetch(state) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async fetch(_url, options) {
      calls += 1;
      const body = JSON.parse(options.body);
      if (body.action === 'public-pair-challenge') {
        return response({
          ok: true,
          challenge: {
            leadId: 'lead_1234567890abcdef',
            challengeId: 'ch_1234567890abcdef',
            executorId: state.executorId,
            publicKeyFingerprint: state.publicKeyFingerprintSha256,
            mode: state.mode,
            originId: 'daube-public-release-github',
            message: 'DAUBE_VOLUNTEER_EDGE_PUBLIC_PAIR_V1\nmock=true'
          }
        });
      }
      if (body.action === 'public-pair-claim') {
        return response({ ok: true, state: 'PENDING_HOST_ATTESTATION', pendingPairing: { token: 'pending-token' } });
      }
      if (body.action === 'host-attest') {
        assert.equal(body.receipt.explicitHostConsent, true);
        assert.equal(body.receipt.commonsOptIn, true);
        assert.equal(body.receipt.publicSafeOnly, true);
        assert.equal(body.receipt.hiddenCompute, false);
        assert.equal(body.receipt.remoteCodeAllowed, false);
        assert.equal(body.receipt.arbitraryShellAllowed, false);
        assert.equal(body.receipt.commercialOptIn, false);
        return response({ ok: true, outcome: 'created', auditCommitted: true });
      }
      if (body.action === 'public-pair-upgrade') {
        return response({
          ok: true,
          state: 'ADMITTED_WORKER_TOKEN_ISSUED',
          pairing: { token: 'worker-token' },
          gpuPairing: state.mode === 'local-gpu' ? { token: 'gpu-token' } : null,
          gpuAdmissionState: state.mode === 'local-gpu' ? 'GPU_PAIRING_TOKEN_ISSUED_NOT_MEASURED' : 'GPU_PAIRING_NOT_REQUESTED'
        });
      }
      if (body.action === 'host-attest-revoke') return response({ ok: true, revoked: true });
      if (body.action === 'register') return response({ ok: true, session: { registrationState: 'PAIRED_CAPABILITY_REGISTERED_NOT_MEASURED' } });
      return response({ ok: false, error: 'unexpected_action' }, 422);
    }
  };
}

test('identity material is generated locally and public interest block excludes secrets', () => {
  const state = newIdentity({ mode: 'local-gpu', deviceClass: 'NVIDIA 8-12 GB' });
  assert.match(state.executorId, /^exec_/);
  assert.match(state.hostId, /^host_/);
  assert.match(state.publicKeyRawBase64Url, /^[A-Za-z0-9_-]{43}$/);
  assert.match(state.continuitySecret, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(state.privateKeyPkcs8Base64.length, 0);
  const block = buildInterestBlock(state);
  assert.match(block, /^INTERESTED/m);
  assert.match(block, /host_pubkey_ed25519:/);
  assert.equal(block.includes(state.privateKeyPkcs8Base64), false);
  assert.equal(block.includes(state.continuitySecret), false);
});

test('redacted state never exposes local private key, continuity secret, or capability tokens', () => {
  const state = {
    ...newIdentity({ mode: 'browser-cpu' }),
    pendingToken: 'pending-secret',
    workerToken: 'worker-secret',
    gpuPairingToken: 'gpu-secret'
  };
  const encoded = JSON.stringify(redactState(state));
  assert.equal(encoded.includes(state.privateKeyPkcs8Base64), false);
  assert.equal(encoded.includes(state.continuitySecret), false);
  assert.equal(encoded.includes('pending-secret'), false);
  assert.equal(encoded.includes('worker-secret'), false);
  assert.equal(encoded.includes('gpu-secret'), false);
});

test('pair flow requires explicit Commons and physical-host self-attestation flags', async () => {
  const state = newIdentity({ mode: 'browser-cpu' });
  await assert.rejects(
    pairAndAttest(state, { bridgeUrl: 'https://example.invalid/bridge', commentId: 1 }),
    /accept-commons-public-safe/
  );
  await assert.rejects(
    pairAndAttest(state, { bridgeUrl: 'https://example.invalid/bridge', commentId: 1, acceptCommonsPublicSafe: true }),
    /self-attest-one-host/
  );
});

test('mocked signed pairing reaches committed attestation and worker upgrade without root secret', async () => {
  const state = newIdentity({ mode: 'local-gpu' });
  const mock = bridgeFetch(state);
  const paired = await pairAndAttest(state, {
    bridgeUrl: 'https://example.invalid/bridge',
    commentId: 6000000001,
    acceptCommonsPublicSafe: true,
    selfAttestOneHost: true,
    fetchImpl: mock.fetch
  });
  assert.equal(paired.attestationState, 'COMMITTED');
  assert.equal(paired.workerToken, 'worker-token');
  assert.equal(paired.gpuPairingToken, 'gpu-token');
  assert.equal(paired.gpuAdmissionState, 'GPU_PAIRING_TOKEN_ISSUED_NOT_MEASURED');
  assert.ok(mock.calls >= 4);
});

test('revoke removes local capability tokens after server withdrawal acknowledgement', async () => {
  const state = { ...newIdentity({ mode: 'browser-cpu' }), workerToken: 'worker-token', bridgeUrl: 'https://example.invalid/bridge' };
  const mock = bridgeFetch(state);
  const revoked = await revokeHost(state, { fetchImpl: mock.fetch });
  assert.equal(revoked.attestationState, 'REVOKED');
  assert.equal(revoked.workerToken, null);
  assert.equal(revoked.pendingToken, null);
  assert.equal(revoked.gpuPairingToken, null);
});

test('GPU registration remains explicitly self-reported and cannot masquerade as measured capacity', async () => {
  const state = { ...newIdentity({ mode: 'local-gpu' }), gpuPairingToken: 'gpu-token' };
  const mock = bridgeFetch(state);
  const digest = createHash('sha256').update('workflow').digest('hex');
  const revision = createHash('sha256').update('runtime').digest('hex');
  await assert.rejects(
    registerGpu(state, {
      gpuBridgeUrl: 'https://example.invalid/gpu', vendor: 'NVIDIA', name: 'GPU', vramGiB: 12,
      runtimeRevision: revision, workloads: 'creative-runtime-probe', workflowDigests: digest, modelProfiles: 'probe-v1'
    }, { fetchImpl: mock.fetch }),
    /accept-gpu-self-report/
  );
  const result = await registerGpu(state, {
    gpuBridgeUrl: 'https://example.invalid/gpu', vendor: 'NVIDIA', name: 'GPU', vramGiB: 12,
    runtimeRevision: revision, workloads: 'creative-runtime-probe', workflowDigests: digest, modelProfiles: 'probe-v1',
    acceptGpuSelfReport: true
  }, { fetchImpl: mock.fetch });
  assert.equal(result.reply.session.registrationState, 'PAIRED_CAPABILITY_REGISTERED_NOT_MEASURED');
});
