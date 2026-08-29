const ACCESS_COOKIE = '__Secure-daube-account-access';
const REFRESH_COOKIE = '__Secure-daube-account-refresh';
const MAX_JSON_BYTES = 16_384;
const PROFILE_SELECT = 'user_id,display_name,status,account_origin,primary_provider,passport_code,daube_handle,native_since';

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
});

const PAGE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; manifest-src 'self'",
});

const ACCOUNT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f4f1e8">
  <title>D’AUBE Account</title>
  <link rel="stylesheet" href="/account/style.css">
</head>
<body>
  <main class="shell" aria-labelledby="account-title">
    <section class="brand" aria-label="D’AUBE SONNTAG">
      <span class="eyebrow">D’AUBE SONNTAG · PUBLIC ACCOUNT</span>
      <h1 id="account-title">One quiet doorway.</h1>
      <p class="lede">Sign in to your D’AUBE account without giving this surface Founder or Staff authority.</p>
      <div class="trust-grid" aria-label="Account security properties">
        <span>HttpOnly session</span><span>RLS-bound profile</span><span>No social OAuth required</span><span>Public trust zone only</span>
      </div>
    </section>

    <section class="card" aria-live="polite">
      <div id="signed-out-view">
        <div class="tabs" role="tablist" aria-label="Account action">
          <button id="signin-tab" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="signin-panel">Sign in</button>
          <button id="signup-tab" class="tab" type="button" role="tab" aria-selected="false" aria-controls="signup-panel">Create account</button>
        </div>

        <form id="signin-panel" class="panel" novalidate>
          <label>Email<input id="signin-email" name="email" type="email" autocomplete="email" inputmode="email" required maxlength="254"></label>
          <label>Password<input id="signin-password" name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="256"></label>
          <button class="primary" type="submit">Sign in</button>
        </form>

        <form id="signup-panel" class="panel hidden" novalidate>
          <label>Name<input id="signup-name" name="displayName" type="text" autocomplete="name" required minlength="2" maxlength="80"></label>
          <label>Email<input id="signup-email" name="email" type="email" autocomplete="email" inputmode="email" required maxlength="254"></label>
          <label>Password<input id="signup-password" name="password" type="password" autocomplete="new-password" required minlength="10" maxlength="256" aria-describedby="password-note"></label>
          <p id="password-note" class="hint">Use at least 10 characters. Email confirmation may be required before first sign in.</p>
          <button class="primary" type="submit">Create account</button>
        </form>
      </div>

      <div id="signed-in-view" class="hidden">
        <span class="status-dot" aria-hidden="true"></span><span class="eyebrow">SIGNED IN · PUBLIC-ACCOUNT</span>
        <h2 id="welcome">Welcome.</h2>
        <dl class="account-facts">
          <div><dt>Email</dt><dd id="session-email">—</dd></div>
          <div><dt>Account origin</dt><dd id="session-origin">—</dd></div>
          <div><dt>Provider</dt><dd id="session-provider">—</dd></div>
        </dl>
        <form id="profile-form" class="profile-form">
          <label>D’AUBE handle<input id="daube-handle" type="text" minlength="3" maxlength="24" pattern="[a-z0-9][a-z0-9_-]{2,23}" autocomplete="off" placeholder="your_handle"></label>
          <button type="submit" class="secondary">Save handle</button>
        </form>
        <button id="signout" class="ghost" type="button">Sign out</button>
      </div>

      <p id="message" class="message" role="status" aria-live="polite"></p>
      <noscript><p class="message error">JavaScript is required for account sign-in.</p></noscript>
    </section>
  </main>
  <script src="/account/app.js" defer></script>
</body>
</html>`;

const ACCOUNT_CSS = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f211d;background:#f4f1e8;line-height:1.5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 10%,rgba(221,255,58,.2),transparent 28rem),linear-gradient(145deg,#f8f5ec,#ebe7dc);color:#1f211d}.shell{width:min(1040px,calc(100% - 32px));min-height:100vh;margin:auto;display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(28px,6vw,88px);align-items:center;padding:48px 0}.brand{max-width:560px}.eyebrow{font-size:.72rem;letter-spacing:.16em;font-weight:750;text-transform:uppercase;color:#62675a}h1{font-size:clamp(3rem,8vw,7.2rem);line-height:.88;letter-spacing:-.065em;margin:.35em 0 .28em;font-weight:760;max-width:8ch}.lede{font-size:clamp(1rem,2vw,1.22rem);max-width:42ch;color:#5b5f55}.trust-grid{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}.trust-grid span{border:1px solid rgba(31,33,29,.15);border-radius:999px;padding:7px 11px;font-size:.78rem;background:rgba(255,255,255,.45)}.card{background:rgba(255,255,255,.72);border:1px solid rgba(31,33,29,.12);box-shadow:0 24px 80px rgba(43,45,38,.12);backdrop-filter:blur(20px);border-radius:28px;padding:clamp(22px,4vw,38px)}.tabs{display:grid;grid-template-columns:1fr 1fr;background:#efede5;border-radius:14px;padding:4px;margin-bottom:24px}.tab{border:0;border-radius:11px;padding:11px 12px;background:transparent;font:inherit;font-weight:700;color:#676b61;cursor:pointer}.tab.active{background:#fff;color:#20221e;box-shadow:0 2px 10px rgba(20,20,18,.08)}.panel,.profile-form{display:grid;gap:16px}label{display:grid;gap:7px;font-size:.82rem;font-weight:700;color:#4f534b}input{width:100%;font:inherit;border:1px solid #c9c8c0;border-radius:13px;background:rgba(255,255,255,.86);color:#20221e;padding:13px 14px;outline:none}input:focus-visible,button:focus-visible{outline:3px solid rgba(126,154,0,.35);outline-offset:2px;border-color:#7e9a00}.primary,.secondary,.ghost{font:inherit;font-weight:760;border-radius:13px;min-height:48px;padding:12px 16px;cursor:pointer}.primary{border:1px solid #20221e;background:#20221e;color:white}.secondary{border:1px solid #697253;background:#edf5d1;color:#293019}.ghost{margin-top:16px;border:1px solid #c9c8c0;background:transparent;color:#30332d;width:100%}button:disabled{opacity:.55;cursor:wait}.hint,.message{font-size:.82rem;color:#70746a}.message{min-height:1.5em;margin:18px 0 0}.message.error{color:#9b342d}.message.success{color:#42600b}.hidden{display:none!important}.status-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#8daf12;margin-right:7px}.card h2{font-size:2rem;margin:.45em 0 .7em;letter-spacing:-.035em}.account-facts{display:grid;gap:10px;margin:0 0 24px}.account-facts div{display:grid;grid-template-columns:120px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid rgba(31,33,29,.09)}dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:#777b70}dd{margin:0;font-size:.9rem;overflow-wrap:anywhere}@media(max-width:780px){.shell{grid-template-columns:1fr;padding:38px 0 48px;align-items:start}.brand{padding-top:24px}h1{font-size:clamp(3.6rem,18vw,6.5rem)}.card{border-radius:22px}.trust-grid{margin-bottom:4px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}@media(prefers-color-scheme:dark){:root{color:#eeeade;background:#171914}body{background:radial-gradient(circle at 15% 10%,rgba(194,230,29,.09),transparent 28rem),linear-gradient(145deg,#171914,#20231c);color:#eeeade}.eyebrow,.lede,.hint,.message{color:#afb3a7}.trust-grid span{border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.04)}.card{background:rgba(30,33,27,.78);border-color:rgba(255,255,255,.11)}.tabs{background:#252820}.tab{color:#aeb1a7}.tab.active{background:#35392e;color:#f2efe5}.panel label,.profile-form label{color:#ced1c7}input{background:#20231c;border-color:#4e5248;color:#f2efe5}.primary{background:#e9efcf;border-color:#e9efcf;color:#1d2116}.secondary{background:#303b1c;color:#dceeb0;border-color:#596b32}.ghost{border-color:#4e5248;color:#ddd9cf}.account-facts div{border-color:rgba(255,255,255,.1)}dt{color:#a7aa9f}}`;

const ACCOUNT_JS = `(()=>{'use strict';const q=(s)=>document.querySelector(s);const msg=q('#message');const signedOut=q('#signed-out-view');const signedIn=q('#signed-in-view');const signinTab=q('#signin-tab');const signupTab=q('#signup-tab');const signinPanel=q('#signin-panel');const signupPanel=q('#signup-panel');function message(text,type){msg.textContent=text||'';msg.className='message'+(type?' '+type:'')}function busy(form,on){for(const el of form.querySelectorAll('button,input'))el.disabled=on}function tab(which){const signIn=which==='signin';signinTab.classList.toggle('active',signIn);signupTab.classList.toggle('active',!signIn);signinTab.setAttribute('aria-selected',String(signIn));signupTab.setAttribute('aria-selected',String(!signIn));signinPanel.classList.toggle('hidden',!signIn);signupPanel.classList.toggle('hidden',signIn);message('')}signinTab.addEventListener('click',()=>tab('signin'));signupTab.addEventListener('click',()=>tab('signup'));async function api(path,options){const res=await fetch(path,Object.assign({headers:{'content-type':'application/json'},credentials:'same-origin'},options||{}));let body={};try{body=await res.json()}catch{}return{res,body}}function showUser(user){signedOut.classList.add('hidden');signedIn.classList.remove('hidden');q('#welcome').textContent='Welcome'+(user.displayName?' back, '+user.displayName:'')+'.';q('#session-email').textContent=user.email||'Private';q('#session-origin').textContent=user.accountOrigin||'—';q('#session-provider').textContent=user.primaryProvider||'—';q('#daube-handle').value=user.daubeHandle||''}function showSignedOut(){signedIn.classList.add('hidden');signedOut.classList.remove('hidden')}signinPanel.addEventListener('submit',async(e)=>{e.preventDefault();message('Signing in…');busy(signinPanel,true);try{const{res,body}=await api('/account/api/signin',{method:'POST',body:JSON.stringify({email:q('#signin-email').value,password:q('#signin-password').value})});if(!res.ok)throw new Error(body.error||'signin_failed');showUser(body.user);message('Signed in securely.','success')}catch(err){message(err.message==='rate_limited'?'Too many attempts. Try again shortly.':'Sign in failed. Check your email and password.','error')}finally{busy(signinPanel,false)}});signupPanel.addEventListener('submit',async(e)=>{e.preventDefault();message('Creating account…');busy(signupPanel,true);try{const{res,body}=await api('/account/api/signup',{method:'POST',body:JSON.stringify({displayName:q('#signup-name').value,email:q('#signup-email').value,password:q('#signup-password').value})});if(!res.ok)throw new Error(body.error||'signup_failed');if(body.user){showUser(body.user);message('Account created and signed in.','success')}else{tab('signin');q('#signin-email').value=q('#signup-email').value;message('Account request accepted. Check your email to confirm, then sign in here.','success')}}catch(err){message(err.message==='rate_limited'?'Too many attempts. Try again shortly.':'Account creation is unavailable for that request.','error')}finally{busy(signupPanel,false)}});q('#profile-form').addEventListener('submit',async(e)=>{e.preventDefault();const form=e.currentTarget;busy(form,true);message('Saving…');try{const raw=q('#daube-handle').value.trim();const{res,body}=await api('/account/api/profile',{method:'PATCH',body:JSON.stringify({daubeHandle:raw||null})});if(!res.ok)throw new Error(body.error||'profile_failed');showUser(body.user);message('Handle saved.','success')}catch(err){message(err.message==='handle_conflict'?'That handle is already in use.':'Could not save that handle.','error')}finally{busy(form,false)}});q('#signout').addEventListener('click',async()=>{message('Signing out…');try{await api('/account/api/session',{method:'DELETE',body:'{}'});}finally{showSignedOut();message('Signed out.','success')}});(async()=>{try{const{res,body}=await api('/account/api/session',{method:'GET',headers:{}});if(res.ok&&body.user){showUser(body.user);message('Session restored.','success')}else showSignedOut()}catch{showSignedOut()}})();})();`;

function json(status, body, headers = new Headers()) {
  for (const [key, value] of Object.entries(JSON_HEADERS)) headers.set(key, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function asset(body, type, head = false, extra = {}) {
  const headers = new Headers(PAGE_HEADERS);
  headers.set('content-type', type);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(head ? '' : body, { status: 200, headers });
}

function strictReleaseSha(value) {
  const sha = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('release_sha_invalid');
  return sha;
}

function authConfig(env) {
  let url;
  try { url = new URL(String(env.DAUBE_SUPABASE_URL || '')); } catch { throw new Error('supabase_url_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9]{20}\.supabase\.co$/i.test(url.hostname)) throw new Error('supabase_url_invalid');
  const publishableKey = String(env.DAUBE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey) || publishableKey.length > 256) throw new Error('publishable_key_invalid');
  return { url, publishableKey };
}

function sameOriginMutation(request) {
  const expected = new URL(request.url).origin;
  const origin = (request.headers.get('origin') || '').trim();
  if (origin) return origin === expected;
  const site = (request.headers.get('sec-fetch-site') || '').trim().toLowerCase();
  return site === 'same-origin' || site === 'none';
}

async function readJsonObject(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new Error('json_required');
  const declared = (request.headers.get('content-length') || '').trim();
  if (/^\d+$/.test(declared) && Number(declared) > MAX_JSON_BYTES) throw new Error('body_too_large');
  const raw = await request.text();
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) throw new Error('body_invalid');
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error('body_invalid'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('body_invalid');
  return body;
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('email_invalid');
  return email;
}

function normalizePassword(value, minimum) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < minimum || password.length > 256) throw new Error('password_invalid');
  return password;
}

function normalizeDisplayName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2 || name.length > 80) throw new Error('display_name_invalid');
  return name;
}

function normalizeUuid(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('user_invalid');
  return id;
}

function normalizeAccess(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (token.length < 64 || token.length > 8192 || /\s/.test(token)) throw new Error('access_invalid');
  return token;
}

function normalizeRefresh(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (token.length < 16 || token.length > 8192 || /\s/.test(token)) throw new Error('refresh_invalid');
  return token;
}

function normalizeExpires(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 60 || n > 86_400) return 3600;
  return Math.floor(n);
}

function cookies(request) {
  const map = new Map();
  for (const chunk of (request.headers.get('cookie') || '').split(';')) {
    const i = chunk.indexOf('=');
    if (i <= 0) continue;
    const key = chunk.slice(0, i).trim();
    const raw = chunk.slice(i + 1).trim();
    try { map.set(key, decodeURIComponent(raw)); } catch {}
  }
  return map;
}

function setSessionCookies(headers, access, refresh, ttl) {
  const accessAge = Math.max(60, Math.min(ttl, 3600));
  headers.append('set-cookie', ACCESS_COOKIE + '=' + encodeURIComponent(access) + '; Max-Age=' + accessAge + '; Path=/account; HttpOnly; Secure; SameSite=Lax; Priority=High');
  headers.append('set-cookie', REFRESH_COOKIE + '=' + encodeURIComponent(refresh) + '; Max-Age=2592000; Path=/account; HttpOnly; Secure; SameSite=Lax; Priority=High');
}

function clearSessionCookies(headers) {
  headers.append('set-cookie', ACCESS_COOKIE + '=; Max-Age=0; Path=/account; HttpOnly; Secure; SameSite=Lax; Priority=High');
  headers.append('set-cookie', REFRESH_COOKIE + '=; Max-Age=0; Path=/account; HttpOnly; Secure; SameSite=Lax; Priority=High');
}

async function supabaseFetch(env, fetchImpl, path, init = {}, bearer) {
  const config = authConfig(env);
  const headers = new Headers(init.headers || {});
  headers.set('accept', 'application/json');
  headers.set('apikey', config.publishableKey);
  if (bearer) headers.set('authorization', 'Bearer ' + bearer);
  if (init.body) headers.set('content-type', 'application/json');
  return fetchImpl(new URL(path, config.url), { ...init, headers, redirect: 'error' });
}

async function verifiedUser(env, fetchImpl, token) {
  const response = await supabaseFetch(env, fetchImpl, '/auth/v1/user', { method: 'GET' }, token);
  if (!response.ok) throw new Error('session_invalid');
  let body;
  try { body = await response.json(); } catch { throw new Error('session_invalid'); }
  if (!body || typeof body !== 'object' || body.is_anonymous === true) throw new Error('session_invalid');
  return { ...body, id: normalizeUuid(body.id) };
}

async function customerProfile(env, fetchImpl, token, userId) {
  const query = new URLSearchParams({ select: PROFILE_SELECT, user_id: 'eq.' + userId, limit: '1' });
  const response = await supabaseFetch(env, fetchImpl, '/rest/v1/daube_customer_profiles?' + query.toString(), { method: 'GET' }, token);
  if (!response.ok) throw new Error('profile_unavailable');
  let rows;
  try { rows = await response.json(); } catch { throw new Error('profile_unavailable'); }
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') throw new Error('profile_unavailable');
  const row = rows[0];
  if (row.user_id !== userId || row.status !== 'active') throw new Error('profile_inactive');
  if (row.account_origin !== 'daube_native' && row.account_origin !== 'federated') throw new Error('profile_invalid');
  const provider = typeof row.primary_provider === 'string' ? row.primary_provider.trim() : '';
  if (!provider || provider.length > 64) throw new Error('profile_invalid');
  return {
    user_id: userId,
    display_name: typeof row.display_name === 'string' ? row.display_name.slice(0, 80) : '',
    account_origin: row.account_origin,
    primary_provider: provider,
    passport_code: typeof row.passport_code === 'string' ? row.passport_code.slice(0, 128) : null,
    daube_handle: typeof row.daube_handle === 'string' ? row.daube_handle.slice(0, 24) : null,
    native_since: typeof row.native_since === 'string' ? row.native_since.slice(0, 64) : null,
  };
}

function publicUser(user, profile) {
  const providers = [];
  if (Array.isArray(user.identities)) {
    for (const identity of user.identities.slice(0, 16)) {
      const provider = identity && typeof identity === 'object' && typeof identity.provider === 'string' ? identity.provider.trim().toLowerCase() : '';
      if (provider && provider.length <= 64 && !providers.includes(provider)) providers.push(provider);
    }
  }
  if (!providers.length) providers.push(profile.primary_provider);
  return Object.freeze({
    id: user.id,
    email: typeof user.email === 'string' ? user.email.slice(0, 254) : null,
    displayName: profile.display_name,
    accountOrigin: profile.account_origin,
    primaryProvider: profile.primary_provider,
    passportCode: profile.passport_code,
    daubeHandle: profile.daube_handle,
    nativeSince: profile.native_since,
    identityProviders: providers,
    trustZone: 'public-account',
  });
}

async function profileForToken(env, fetchImpl, token) {
  const user = await verifiedUser(env, fetchImpl, token);
  const profile = await customerProfile(env, fetchImpl, token, user.id);
  return { user, profile };
}

async function sessionFromRequest(request, env, fetchImpl) {
  const jar = cookies(request);
  const rawAccess = jar.get(ACCESS_COOKIE) || '';
  const rawRefresh = jar.get(REFRESH_COOKIE) || '';
  if (rawAccess) {
    try {
      const access = normalizeAccess(rawAccess);
      const { user, profile } = await profileForToken(env, fetchImpl, access);
      return { access, refresh: rawRefresh || null, expiresIn: 3600, user, profile, rotated: false };
    } catch {}
  }
  if (!rawRefresh) return null;
  let refresh;
  try { refresh = normalizeRefresh(rawRefresh); } catch { return null; }
  const response = await supabaseFetch(env, fetchImpl, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
  if (!response.ok) return null;
  let body;
  try { body = await response.json(); } catch { return null; }
  let access, nextRefresh;
  try { access = normalizeAccess(body.access_token); nextRefresh = normalizeRefresh(body.refresh_token); } catch { return null; }
  try {
    const { user, profile } = await profileForToken(env, fetchImpl, access);
    return { access, refresh: nextRefresh, expiresIn: normalizeExpires(body.expires_in), user, profile, rotated: true };
  } catch { return null; }
}

async function signIn(request, env, fetchImpl) {
  if (!sameOriginMutation(request)) return json(403, { ok: false, error: 'origin_not_allowed' });
  let body;
  try { body = await readJsonObject(request); } catch { return json(400, { ok: false, error: 'invalid_request' }); }
  let email, password;
  try { email = normalizeEmail(body.email); password = normalizePassword(body.password, 8); } catch { return json(400, { ok: false, error: 'invalid_credentials' }); }
  const response = await supabaseFetch(env, fetchImpl, '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (response.status === 429) return json(429, { ok: false, error: 'rate_limited' });
  if (!response.ok) return json(401, { ok: false, error: 'invalid_credentials' });
  let session;
  try { session = await response.json(); } catch { return json(502, { ok: false, error: 'identity_provider_invalid' }); }
  let access, refresh;
  try { access = normalizeAccess(session.access_token); refresh = normalizeRefresh(session.refresh_token); } catch { return json(502, { ok: false, error: 'identity_provider_invalid' }); }
  try {
    const { user, profile } = await profileForToken(env, fetchImpl, access);
    const headers = new Headers();
    setSessionCookies(headers, access, refresh, normalizeExpires(session.expires_in));
    return json(200, { ok: true, user: publicUser(user, profile) }, headers);
  } catch { return json(403, { ok: false, error: 'account_unavailable' }); }
}

async function signUp(request, env, fetchImpl) {
  if (!sameOriginMutation(request)) return json(403, { ok: false, error: 'origin_not_allowed' });
  let body;
  try { body = await readJsonObject(request); } catch { return json(400, { ok: false, error: 'invalid_request' }); }
  let email, password, displayName;
  try { email = normalizeEmail(body.email); password = normalizePassword(body.password, 10); displayName = normalizeDisplayName(body.displayName); } catch { return json(400, { ok: false, error: 'invalid_registration' }); }
  const response = await supabaseFetch(env, fetchImpl, '/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password, data: { display_name: displayName } }) });
  if (response.status === 429) return json(429, { ok: false, error: 'rate_limited' });
  if (!response.ok) return json(400, { ok: false, error: 'registration_unavailable' });
  let session;
  try { session = await response.json(); } catch { return json(502, { ok: false, error: 'identity_provider_invalid' }); }
  if (!session.access_token || !session.refresh_token) return json(200, { ok: true, confirmationRequired: true, user: null });
  let access, refresh;
  try { access = normalizeAccess(session.access_token); refresh = normalizeRefresh(session.refresh_token); } catch { return json(502, { ok: false, error: 'identity_provider_invalid' }); }
  try {
    const { user, profile } = await profileForToken(env, fetchImpl, access);
    const headers = new Headers();
    setSessionCookies(headers, access, refresh, normalizeExpires(session.expires_in));
    return json(200, { ok: true, confirmationRequired: false, user: publicUser(user, profile) }, headers);
  } catch { return json(200, { ok: true, confirmationRequired: true, user: null }); }
}

async function getSession(request, env, fetchImpl) {
  const session = await sessionFromRequest(request, env, fetchImpl);
  if (!session) {
    const headers = new Headers();
    clearSessionCookies(headers);
    return json(401, { ok: false, error: 'signed_out' }, headers);
  }
  const headers = new Headers();
  if (session.rotated && session.refresh) setSessionCookies(headers, session.access, session.refresh, session.expiresIn);
  return json(200, { ok: true, user: publicUser(session.user, session.profile) }, headers);
}

async function updateProfile(request, env, fetchImpl) {
  if (!sameOriginMutation(request)) return json(403, { ok: false, error: 'origin_not_allowed' });
  const session = await sessionFromRequest(request, env, fetchImpl);
  if (!session) return json(401, { ok: false, error: 'signed_out' });
  if (session.profile.account_origin !== 'daube_native') return json(403, { ok: false, error: 'native_account_required' });
  let body;
  try { body = await readJsonObject(request); } catch { return json(400, { ok: false, error: 'invalid_request' }); }
  if (Object.keys(body).some((key) => key !== 'daubeHandle')) return json(400, { ok: false, error: 'invalid_request' });
  const raw = body.daubeHandle;
  const handle = raw === null ? null : typeof raw === 'string' ? raw.trim().toLowerCase() : '__invalid__';
  if (handle !== null && handle !== '' && !/^[a-z0-9][a-z0-9_-]{2,23}$/.test(handle)) return json(400, { ok: false, error: 'handle_invalid' });
  const query = new URLSearchParams({ user_id: 'eq.' + session.user.id });
  const response = await supabaseFetch(env, fetchImpl, '/rest/v1/daube_customer_profiles?' + query.toString(), { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify({ daube_handle: handle || null }) }, session.access);
  if (response.status === 409) return json(409, { ok: false, error: 'handle_conflict' });
  if (!response.ok) return json(409, { ok: false, error: 'profile_update_failed' });
  try {
    const profile = await customerProfile(env, fetchImpl, session.access, session.user.id);
    return json(200, { ok: true, user: publicUser(session.user, profile) });
  } catch { return json(502, { ok: false, error: 'profile_update_failed' }); }
}

async function signOut(request, env, fetchImpl) {
  if (!sameOriginMutation(request)) return json(403, { ok: false, error: 'origin_not_allowed' });
  const jar = cookies(request);
  const rawAccess = jar.get(ACCESS_COOKIE) || '';
  if (rawAccess) {
    try { await supabaseFetch(env, fetchImpl, '/auth/v1/logout', { method: 'POST', body: '{}' }, normalizeAccess(rawAccess)); } catch {}
  }
  const headers = new Headers();
  clearSessionCookies(headers);
  return json(200, { ok: true, signedOut: true }, headers);
}

function health(env) {
  let sourceRevision = null;
  let configured = false;
  try { sourceRevision = strictReleaseSha(env.DAUBE_RELEASE_SHA); authConfig(env); configured = true; } catch {}
  return json(configured ? 200 : 503, {
    schema: 'daube.account-edge.health.v1',
    status: configured ? 'READY' : 'UNAVAILABLE',
    sourceRevision,
    trustZone: 'public-account',
    supabasePublishableOnly: true,
    serviceRoleCredentialPresent: false,
    founderStaffAuthorityPresent: false,
    cookieSessionHttpOnly: true,
    profileAuthorization: 'supabase-user-jwt-rls',
    routeScope: '/account*',
  });
}

export function createAccountWorker({ fetchImpl = fetch } = {}) {
  return Object.freeze({
    async fetch(request, env) {
      try {
        const url = new URL(request.url);
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const head = request.method === 'HEAD';
        if ((request.method === 'GET' || head) && path === '/account') return asset(ACCOUNT_HTML, 'text/html; charset=utf-8', head);
        if ((request.method === 'GET' || head) && path === '/account/style.css') return asset(ACCOUNT_CSS, 'text/css; charset=utf-8', head);
        if ((request.method === 'GET' || head) && path === '/account/app.js') return asset(ACCOUNT_JS, 'text/javascript; charset=utf-8', head);
        if ((request.method === 'GET' || head) && path === '/account/healthz') return head ? new Response('', { status: 200, headers: JSON_HEADERS }) : health(env);
        if (path === '/account/api/signin' && request.method === 'POST') return signIn(request, env, fetchImpl);
        if (path === '/account/api/signup' && request.method === 'POST') return signUp(request, env, fetchImpl);
        if (path === '/account/api/session' && request.method === 'GET') return getSession(request, env, fetchImpl);
        if (path === '/account/api/session' && request.method === 'DELETE') return signOut(request, env, fetchImpl);
        if (path === '/account/api/profile' && request.method === 'PATCH') return updateProfile(request, env, fetchImpl);
        if (path.startsWith('/account/api/')) return json(405, { ok: false, error: 'method_not_allowed' });
        return json(404, { ok: false, error: 'account_route_not_found' });
      } catch {
        return json(503, { ok: false, error: 'account_runtime_configuration_invalid' });
      }
    },
  });
}

export const ACCOUNT_EDGE_TRUTH_BOUNDARY = Object.freeze({
  trustZone: 'public-account',
  serviceRoleCredentialRequired: false,
  publishableKeyOnly: true,
  browserReceivesAccessToken: false,
  browserReceivesRefreshToken: false,
  accessCookieHttpOnlySecure: true,
  refreshCookieHttpOnlySecure: true,
  mutationRequiresSameOrigin: true,
  profileMutationRunsUnderUserRls: true,
  founderOrStaffAuthorityGranted: false,
  externalGitIntegrationRequired: false,
  vercelRequired: false,
});

export default createAccountWorker();
