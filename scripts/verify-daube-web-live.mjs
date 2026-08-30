#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const targetUrl = process.env.DAUBE_WEB_LIVE_URL || 'https://daubesonntag.com/';
const sourceRevision = String(process.env.DAUBE_RELEASE_SHA || '').trim().toLowerCase();
const artifactDir = resolve(process.cwd(), 'artifacts', 'web-live');
const debugPort = Number(process.env.DAUBE_CHROME_DEBUG_PORT || 9333);
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const SHA_RE = /^[0-9a-f]{40}$/;

function fail(message) { throw new Error(`daube_web_live_verification_failed:${message}`); }
function assert(condition, message) { if (!condition) fail(message); }

async function fetchRevision(expected) {
  const url = new URL('/__daube/revision.json', expected);
  url.searchParams.set('exact-readback', sourceRevision.slice(0, 12));
  let last = 'unobserved';
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      last = `http_${response.status}`;
      if (response.ok) {
        const record = await response.json();
        assert(record?.schema === 'daube.web.source-revision.v1', 'revision_schema');
        assert(record?.repository === 'daubesonntag-dotcom/daube-web', 'revision_repository');
        assert(record?.sourceRevision === sourceRevision, 'revision_source_sha');
        assert(record?.admissionExpectedRevision === sourceRevision, 'revision_admission_sha');
        assert(record?.exactShaBound === true, 'revision_exact_sha_bound');
        assert(record?.runtimeClass === 'STATIC_WEB_ASSET', 'revision_runtime_class');
        assert(record?.publicEvidenceOnly === true, 'revision_public_evidence_boundary');
        return record;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : 'revision_fetch_error';
    }
    await sleep(2500);
  }
  fail(`revision_unavailable:${last}`);
}

function chromeExecutable() {
  const probe = spawnSync('bash', ['-lc', 'command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser'], { encoding: 'utf8' });
  const value = probe.stdout.trim();
  if (!value) fail('chrome_missing');
  return value;
}

async function waitForJson(url, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(700) });
      if (response.ok) return response.json();
    } catch {}
    await sleep(100);
  }
  fail('chrome_debug_endpoint_unavailable');
}

class CdpClient {
  constructor(url) { this.url = url; this.socket = null; this.nextId = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error('cdp_connect_timeout')), 10000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolvePromise(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); rejectPromise(new Error('cdp_connect_error')); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || 'cdp_error'));
      else pending.resolve(message.result ?? {});
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => { this.pending.delete(id); rejectPromise(new Error(`cdp_timeout:${method}`)); }, 20000);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(); }
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) fail('runtime_evaluation_exception');
  return result.result?.value;
}

async function waitForFlagship(client, expected) {
  for (let i = 0; i < 100; i += 1) {
    const state = await evaluate(client, `(() => ({
      href: location.href,
      ready: document.readyState,
      shell: Boolean(document.querySelector('main.flagshipShell')),
      heading: document.querySelector('h1#page-title')?.textContent || '',
      offers: Boolean(document.querySelector('#offers')),
      status: document.querySelector('.techStatusBrand')?.textContent || ''
    }))()`).catch(() => null);
    if (state?.ready === 'complete' && state.shell && state.offers && /Meaning/.test(state.heading) && /D.AUBE Digital Store/i.test(state.status)) {
      const current = new URL(state.href);
      if (current.origin === expected.origin && current.pathname === '/') return state;
    }
    await sleep(250);
  }
  fail('flagship_surface_timeout');
}

async function runCase(client, expected, definition) {
  await client.call('Emulation.setDeviceMetricsOverride', {
    width: definition.width,
    height: definition.height,
    deviceScaleFactor: 1,
    mobile: definition.mobile,
  });
  await client.call('Emulation.setEmulatedMedia', {
    media: '',
    features: [{ name: 'prefers-reduced-motion', value: definition.reducedMotion ? 'reduce' : 'no-preference' }],
  });
  const navigationUrl = new URL(expected);
  navigationUrl.searchParams.set('exact-sha', sourceRevision.slice(0, 12));
  await client.call('Page.navigate', { url: navigationUrl.toString() });
  await waitForFlagship(client, expected);
  await sleep(700);

  const state = await evaluate(client, `(() => {
    const shell = document.querySelector('main.flagshipShell');
    const body = document.body?.innerText || '';
    const heading = document.querySelector('h1#page-title');
    const orderLink = document.querySelector('a[href="/order-status"]');
    const productLinks = [...document.querySelectorAll('a[href^="/products/"]')];
    const styles = [...document.styleSheets].map(s => s.href || 'inline');
    const scripts = [...document.scripts].map(s => s.src || 'inline');
    return {
      title: document.title,
      rootLang: document.documentElement.lang,
      shellLang: shell?.getAttribute('lang') || '',
      languagePolicy: shell?.getAttribute('data-language-policy') || '',
      commerceBoundary: shell?.getAttribute('data-commerce-boundary') || '',
      heading: (heading?.textContent || '').replace(/\\s+/g, ' ').trim(),
      digitalStore: body.includes('D’AUBE DIGITAL STORE') || body.includes('D’AUBE Digital Store'),
      capabilityWeb: body.includes('Web & Product'),
      capabilityAutomation: body.includes('Automation'),
      operatingProof: body.includes('Evidence before claims.'),
      about: body.includes('ABOUT D’AUBE'),
      orderLink: Boolean(orderLink),
      productLinkCount: productLinks.length,
      storeState: body.includes('Public catalog connection is active.') ? 'READY' : (body.includes('Catalog verification is pending.') ? 'PENDING' : 'UNKNOWN'),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      styles,
      scripts,
      errors: Array.isArray(window.__daubeCapturedErrors) ? [...window.__daubeCapturedErrors] : []
    };
  })()`);

  assert(state.title.includes('D’AUBE SONNTAG'), `${definition.name}:title`);
  assert(state.shellLang === 'en', `${definition.name}:shell_lang`);
  assert(state.languagePolicy === 'en-primary-vi-help', `${definition.name}:language_policy`);
  assert(['CONFIGURED', 'UNCONFIGURED'].includes(state.commerceBoundary), `${definition.name}:commerce_boundary`);
  assert(/Meaning/.test(state.heading) && /made visible/.test(state.heading), `${definition.name}:heading`);
  assert(state.digitalStore && state.capabilityWeb && state.capabilityAutomation && state.operatingProof && state.about, `${definition.name}:flagship_markers`);
  assert(state.orderLink, `${definition.name}:order_status_link`);
  assert(['READY', 'PENDING'].includes(state.storeState), `${definition.name}:truthful_store_state`);
  assert(state.horizontalOverflow === false, `${definition.name}:horizontal_overflow`);
  assert(state.reducedMotion === definition.reducedMotion, `${definition.name}:reduced_motion_media`);
  assert(state.scripts.some((value) => value.includes('/assets/')), `${definition.name}:compiled_script_asset`);
  assert(state.styles.some((value) => value.includes('/assets/')), `${definition.name}:compiled_style_asset`);
  assert(state.errors.length === 0, `${definition.name}:console_errors`);

  const ax = await client.call('Accessibility.getFullAXTree');
  const nodes = ax.nodes || [];
  assert(nodes.some((node) => node.ignored !== true && node.role?.value === 'heading' && /Meaning/.test(node.name?.value || '')), `${definition.name}:ax_heading`);
  assert(nodes.some((node) => node.ignored !== true && node.role?.value === 'link' && /Order status/i.test(node.name?.value || '')), `${definition.name}:ax_order_link`);

  const shot = await client.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  assert(typeof shot.data === 'string' && shot.data.length > 100, `${definition.name}:screenshot`);
  writeFileSync(resolve(artifactDir, `${definition.name}.png`), Buffer.from(shot.data, 'base64'));

  return {
    name: definition.name,
    viewport: { width: definition.width, height: definition.height, mobile: definition.mobile },
    reducedMotion: definition.reducedMotion,
    commerceBoundary: state.commerceBoundary,
    storeState: state.storeState,
    productLinkCount: state.productLinkCount,
    compiledAssetSurfaceVerified: true,
    accessibilityTreeVerified: true,
    horizontalOverflowAbsent: true,
    runtimeAndConsoleErrorsObserved: 0,
    screenshot: `${definition.name}.png`,
  };
}

const expected = new URL(targetUrl);
assert(expected.protocol === 'https:', 'target_must_be_https');
assert(expected.hostname === 'daubesonntag.com' || expected.hostname === 'www.daubesonntag.com', 'target_host_invalid');
assert(SHA_RE.test(sourceRevision), 'source_revision_required');
mkdirSync(artifactDir, { recursive: true });

const revision = await fetchRevision(expected);
const profile = `/tmp/daube-live-chrome-${process.pid}`;
const chrome = chromeExecutable();
const child = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore'] });
let client;
try {
  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  let page;
  for (let i = 0; i < 100 && !page; i += 1) {
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!page) await sleep(100);
  }
  assert(page, 'page_target_missing');
  client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await Promise.all([client.call('Page.enable'), client.call('Runtime.enable'), client.call('Accessibility.enable')]);
  await client.call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const errors=[]; Object.defineProperty(window,'__daubeCapturedErrors',{value:errors}); window.addEventListener('error',e=>errors.push(String(e.message||'error').slice(0,240))); window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason||'rejection').slice(0,240))); const old=console.error.bind(console); console.error=(...args)=>{errors.push(args.map(String).join(' ').slice(0,240));old(...args);}; })();` });
  const version = await client.call('Browser.getVersion');
  const cases = [];
  cases.push(await runCase(client, expected, { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false, reducedMotion: false }));
  cases.push(await runCase(client, expected, { name: 'mobile-390x844-reduced', width: 390, height: 844, mobile: true, reducedMotion: true }));
  const receipt = {
    schema: 'daube.web.live-browser-evidence.v2',
    sourceRevision,
    target: expected.toString(),
    revision,
    browser: version.product || null,
    exactRevisionBound: true,
    cases,
    currentFlagshipSurfaceVerified: true,
    compiledAssetSurfaceVerified: true,
    browserInteractionVerified: true,
    accessibilityTreeVerified: true,
    productionDeploymentVerified: true,
    founderVisualAcceptance: false,
    paidSpendAuthorized: false,
    verifiedAt: new Date().toISOString(),
  };
  writeFileSync(resolve(artifactDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, schema: receipt.schema, sourceRevision, caseCount: cases.length, revisionExact: true }));
} finally {
  client?.close();
  child.kill('SIGTERM');
  rmSync(profile, { recursive: true, force: true });
}
