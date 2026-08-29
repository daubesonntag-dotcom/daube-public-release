import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAccountWorker, ACCOUNT_EDGE_TRUTH_BOUNDARY } from './worker.mjs';

const RELEASE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SUPABASE_URL = 'https://wilqsqndjgckqxbjptxm.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_ynfcB4JbyYhNhkPkPBc4wg_3ZPF0gl6';
const ENV = Object.freeze({
  DAUBE_RELEASE_SHA: RELEASE_SHA,
  DAUBE_SUPABASE_URL: SUPABASE_URL,
  DAUBE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
});

function req(path, init = {}) {
  return new Request(`https://commerce.daubesonntag.com${path}`, init);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('serves Account UI with strict browser security headers', async () => {
  const response = await createAccountWorker().fetch(req('/account'), ENV);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const csp = response.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  const body = await response.text();
  assert.match(body, /D’AUBE Account/);
  assert.match(body, /PUBLIC ACCOUNT/);
  assert.match(body, /\/account\/style\.css/);
  assert.match(body, /\/account\/app\.js/);
  assert.doesNotMatch(body, /access_token|refresh_token|service[_ -]?role/i);
});

test('health is fail-closed and pins exact source revision', async () => {
  const worker = createAccountWorker();
  const ready = await worker.fetch(req('/account/healthz'), ENV);
  assert.equal(ready.status, 200);
  const body = await ready.json();
  assert.deepEqual(body, {
    schema: 'daube.account-edge.health.v1',
    status: 'READY',
    sourceRevision: RELEASE_SHA,
    trustZone: 'public-account',
    supabasePublishableOnly: true,
    serviceRoleCredentialPresent: false,
    founderStaffAuthorityPresent: false,
    cookieSessionHttpOnly: true,
    profileAuthorization: 'supabase-user-jwt-rls',
    routeScope: '/account*',
  });

  const bad = await worker.fetch(req('/account/healthz'), {
    ...ENV,
    DAUBE_RELEASE_SHA: 'not-a-sha',
  });
  assert.equal(bad.status, 503);
  assert.equal((await bad.json()).status, 'UNAVAILABLE');
});

test('cross-origin mutation is rejected before identity-provider access', async () => {
  let calls = 0;
  const worker = createAccountWorker({ fetchImpl: async () => { calls += 1; throw new Error('must_not_call'); } });
  const response = await worker.fetch(req('/account/api/signin', {
    method: 'POST',
    headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'long-password' }),
  }), ENV);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: 'origin_not_allowed' });
  assert.equal(calls, 0);
});

test('invalid registration is rejected locally', async () => {
  let calls = 0;
  const worker = createAccountWorker({ fetchImpl: async () => { calls += 1; throw new Error('must_not_call'); } });
  const response = await worker.fetch(req('/account/api/signup', {
    method: 'POST',
    headers: { origin: 'https://commerce.daubesonntag.com', 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'x', email: 'bad', password: 'short' }),
  }), ENV);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_registration');
  assert.equal(calls, 0);
});

test('anonymous session fails closed and clears both secure cookies', async () => {
  const response = await createAccountWorker().fetch(req('/account/api/session'), ENV);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { ok: false, error: 'signed_out' });
  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /__Secure-daube-account-access=/);
  assert.match(setCookie, /__Secure-daube-account-refresh=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\/account/i);
  assert.doesNotMatch(setCookie, /Domain=/i);
});

test('successful sign in stores tokens only in HttpOnly cookies and returns public-account identity', async () => {
  const access = 'a'.repeat(96);
  const refresh = 'r'.repeat(48);
  const userId = '123e4567-e89b-42d3-a456-426614174000';
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    seen.push({ path: parsed.pathname + parsed.search, method: init.method ?? 'GET', authorization: new Headers(init.headers).get('authorization') });
    if (parsed.pathname === '/auth/v1/token' && parsed.searchParams.get('grant_type') === 'password') {
      return jsonResponse({ access_token: access, refresh_token: refresh, expires_in: 3600 });
    }
    if (parsed.pathname === '/auth/v1/user') {
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${access}`);
      return jsonResponse({ id: userId, email: 'member@example.com', is_anonymous: false, identities: [{ provider: 'email' }] });
    }
    if (parsed.pathname === '/rest/v1/daube_customer_profiles') {
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${access}`);
      assert.equal(parsed.searchParams.get('user_id'), `eq.${userId}`);
      return jsonResponse([{
        user_id: userId,
        display_name: 'Member',
        status: 'active',
        account_origin: 'daube_native',
        primary_provider: 'email',
        passport_code: null,
        daube_handle: 'member',
        native_since: '2026-08-29T00:00:00Z',
      }]);
    }
    throw new Error(`unexpected_fetch:${parsed.pathname}`);
  };
  const worker = createAccountWorker({ fetchImpl });
  const response = await worker.fetch(req('/account/api/signin', {
    method: 'POST',
    headers: {
      origin: 'https://commerce.daubesonntag.com',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: 'member@example.com', password: 'correct-password' }),
  }), ENV);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.trustZone, 'public-account');
  assert.equal(body.user.id, userId);
  assert.equal(body.user.primaryProvider, 'email');
  assert.equal(body.user.daubeHandle, 'member');
  assert.equal('access_token' in body, false);
  assert.equal('refresh_token' in body, false);
  assert.equal('accessToken' in body, false);
  assert.equal('refreshToken' in body, false);
  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /__Secure-daube-account-access=/);
  assert.match(setCookie, /__Secure-daube-account-refresh=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Path=\/account/i);
  assert.equal(seen.length, 3);
});

test('unknown account API is method-closed', async () => {
  const response = await createAccountWorker().fetch(req('/account/api/unknown'), ENV);
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { ok: false, error: 'method_not_allowed' });
});

test('source contract contains no privileged key or external provider authority', async () => {
  const source = await readFile(new URL('./worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sb_secret_|service_role|SERVICE_ROLE|SUPABASE_SERVICE/i);
  assert.doesNotMatch(source, /FOUNDER[_ -]?TOKEN|STAFF[_ -]?TOKEN/i);
  assert.doesNotMatch(source, /google\.com\/oauth|facebook\.com\/dialog\/oauth|appleid\.apple\.com/i);
  assert.equal(ACCOUNT_EDGE_TRUTH_BOUNDARY.trustZone, 'public-account');
  assert.equal(ACCOUNT_EDGE_TRUTH_BOUNDARY.serviceRoleCredentialRequired, false);
  assert.equal(ACCOUNT_EDGE_TRUTH_BOUNDARY.founderOrStaffAuthorityGranted, false);
  assert.equal(ACCOUNT_EDGE_TRUTH_BOUNDARY.externalGitIntegrationRequired, false);
  assert.equal(ACCOUNT_EDGE_TRUTH_BOUNDARY.vercelRequired, false);
});
