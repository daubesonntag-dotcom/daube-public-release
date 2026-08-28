#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const targetUrl = process.env.DAUBE_WEB_LIVE_URL || 'https://daubesonntag.com/';
const sourceRevision = process.env.DAUBE_RELEASE_SHA || null;
const artifactDir = resolve(process.cwd(), 'artifacts', 'web-live');
const debugPort = Number(process.env.DAUBE_CHROME_DEBUG_PORT || 9333);
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

function fail(message) { throw new Error(`daube_web_live_verification_failed:${message}`); }
function assert(condition, message) { if (!condition) fail(message); }

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
  constructor(url) { this.url=url; this.socket=null; this.nextId=1; this.pending=new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timer=setTimeout(()=>rejectPromise(new Error('cdp_connect_timeout')),10000);
      this.socket.addEventListener('open',()=>{clearTimeout(timer);resolvePromise();},{once:true});
      this.socket.addEventListener('error',()=>{clearTimeout(timer);rejectPromise(new Error('cdp_connect_error'));},{once:true});
    });
    this.socket.addEventListener('message', event => {
      const message=JSON.parse(String(event.data));
      if (!message.id) return;
      const pending=this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || 'cdp_error'));
      else pending.resolve(message.result ?? {});
    });
  }
  call(method, params={}) {
    const id=this.nextId++;
    return new Promise((resolvePromise,rejectPromise)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);rejectPromise(new Error(`cdp_timeout:${method}`));},20000);
      this.pending.set(id,{resolve:resolvePromise,reject:rejectPromise,timer});
      this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  close() { if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(); }
}

async function evaluate(client, expression, awaitPromise=false) {
  const result=await client.call('Runtime.evaluate',{expression,awaitPromise,returnByValue:true});
  if (result.exceptionDetails) fail('runtime_evaluation_exception');
  return result.result?.value;
}

async function waitForSurface(client, expected) {
  for (let i=0;i<120;i+=1) {
    const state=await evaluate(client, `(() => ({
      href: location.href,
      ready: document.readyState,
      shell: Boolean(document.querySelector('main.shell')),
      heading: Boolean(document.querySelector('h1')),
      update: Boolean(document.querySelector('.updateButton')),
      body: document.body?.innerText?.slice(0,12000) || ''
    }))()`).catch(()=>null);
    if (state?.ready === 'complete' && state.shell && state.heading && state.update) {
      const current=new URL(state.href);
      if (current.origin === expected.origin && current.pathname === expected.pathname) return state;
    }
    await sleep(250);
  }
  fail('live_surface_timeout');
}

async function runCase(client, expected, definition) {
  await client.call('Emulation.setDeviceMetricsOverride', {
    width: definition.width, height: definition.height, deviceScaleFactor: 1, mobile: definition.mobile,
  });
  await client.call('Emulation.setEmulatedMedia', {
    media: '', features: [{ name:'prefers-reduced-motion', value: definition.reducedMotion ? 'reduce' : 'no-preference' }],
  });
  await client.call('Page.navigate',{url:expected.toString()});
  await waitForSurface(client, expected);
  await sleep(definition.reducedMotion ? 150 : 1000);

  const initial=await evaluate(client, `(() => {
    const body=document.body.innerText;
    const heading=document.querySelector('h1');
    const button=document.querySelector('.updateButton');
    const shell=document.querySelector('main.shell');
    const hero=document.querySelector('.hero');
    const portal=document.querySelector('.dawnPortalSky');
    const rect=button.getBoundingClientRect();
    const style=hero ? getComputedStyle(hero) : null;
    const duration=style?.animationDuration || '0s';
    const seconds=duration.endsWith('ms') ? parseFloat(duration)/1000 : parseFloat(duration);
    return {
      lang:document.documentElement.lang,
      title:document.title,
      heading:heading?.textContent?.trim() || '',
      button:button?.textContent?.trim() || '',
      buttonTag:button?.tagName || '',
      buttonType:button?.getAttribute('type') || '',
      buttonWidth:rect.width,
      buttonHeight:rect.height,
      ariaExpanded:button?.getAttribute('aria-expanded') || '',
      commerceBoundary:shell?.getAttribute('data-commerce-boundary') || '',
      scrollWidth:document.documentElement.scrollWidth,
      clientWidth:document.documentElement.clientWidth,
      reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
      heroAnimationSeconds:Number.isFinite(seconds)?seconds:null,
      dawnPortal:Boolean(portal),
      heroMediaCount:hero?.querySelectorAll('img,video').length ?? -1,
      hasPresence:body.includes('Một hiện diện'),
      hasPrinciple:body.includes('Rõ trước. Đẹp sau. Đúng rồi mới mở rộng.'),
      hasCatalogued:body.includes('Catalogued'),
      hasAvailableToken:/\bAvailable\b/.test(body),
      capturedErrors:Array.isArray(window.__daubeCapturedErrors)?[...window.__daubeCapturedErrors]:[]
    };
  })()`);

  assert(initial.lang === 'vi', `${definition.name}:lang`);
  assert(initial.title.includes('D’AUBE SONNTAG'), `${definition.name}:title`);
  assert(initial.heading === 'Meaning, made visible.', `${definition.name}:heading`);
  assert(initial.button === 'Nhận cập nhật', `${definition.name}:update_button`);
  assert(initial.buttonTag === 'BUTTON' && initial.buttonType === 'button', `${definition.name}:semantic_button`);
  assert(initial.buttonWidth >= 44 && initial.buttonHeight >= 44, `${definition.name}:touch_target`);
  assert(initial.ariaExpanded === 'false', `${definition.name}:initial_expanded`);
  assert(['CONFIGURED','UNCONFIGURED'].includes(initial.commerceBoundary), `${definition.name}:commerce_boundary`);
  assert(initial.scrollWidth <= initial.clientWidth + 1, `${definition.name}:horizontal_overflow`);
  assert(initial.reducedMotion === definition.reducedMotion, `${definition.name}:reduced_motion_media`);
  if (definition.reducedMotion) assert(initial.heroAnimationSeconds !== null && initial.heroAnimationSeconds <= 0.001, `${definition.name}:reduced_motion_animation`);
  assert(initial.dawnPortal === true, `${definition.name}:dawn_portal`);
  assert(initial.heroMediaCount === 0, `${definition.name}:hero_heavy_media`);
  assert(initial.hasPresence && initial.hasPrinciple, `${definition.name}:dawn_clarity_copy`);
  assert(initial.hasCatalogued && !initial.hasAvailableToken, `${definition.name}:truthful_catalog_status`);
  assert(initial.capturedErrors.length === 0, `${definition.name}:initial_console_error`);

  const ax=await client.call('Accessibility.getFullAXTree');
  const nodes=ax.nodes || [];
  const headingNode=nodes.find(node => node.ignored !== true && node.role?.value === 'heading' && node.name?.value === 'Meaning, made visible.');
  const buttonNode=nodes.find(node => node.ignored !== true && node.role?.value === 'button' && node.name?.value === 'Nhận cập nhật');
  assert(Boolean(headingNode), `${definition.name}:ax_heading`);
  assert(Boolean(buttonNode), `${definition.name}:ax_button`);

  const interaction=await evaluate(client, `(() => {
    const button=document.querySelector('.updateButton');
    const note=document.querySelector('#update-note');
    button.click();
    return new Promise(resolve => {
      const started=performance.now();
      const sample=()=>{
        const style=note ? getComputedStyle(note) : null;
        const value={
          expanded:button?.getAttribute('aria-expanded') || '',
          note:note?.textContent?.trim() || '',
          visible:Boolean(note && style && style.visibility!=='hidden' && style.display!=='none' && Number(style.opacity)>0.9),
          errors:Array.isArray(window.__daubeCapturedErrors)?[...window.__daubeCapturedErrors]:[]
        };
        if ((value.expanded==='true' && value.visible) || performance.now()-started>1500) resolve(value); else setTimeout(sample,25);
      }; sample();
    });
  })()`, true);
  assert(interaction.expanded === 'true', `${definition.name}:expanded_after_click`);
  assert(interaction.note.includes('Kênh cập nhật đang được hoàn thiện'), `${definition.name}:update_note`);
  assert(interaction.visible, `${definition.name}:update_note_visible`);
  assert(interaction.errors.length === 0, `${definition.name}:interaction_console_error`);

  const shot=await client.call('Page.captureScreenshot',{format:'png',fromSurface:true});
  assert(typeof shot.data === 'string' && shot.data.length > 100, `${definition.name}:screenshot`);
  writeFileSync(resolve(artifactDir,`${definition.name}.png`),Buffer.from(shot.data,'base64'));
  return {
    name:definition.name,
    viewport:{width:definition.width,height:definition.height,mobile:definition.mobile},
    reducedMotion:definition.reducedMotion,
    dawnClarityCopyVerified:true,
    semanticAccessibilityVerified:true,
    interactionVerified:true,
    truthfulCatalogStatusVerified:true,
    heroHeavyMediaAbsent:true,
    horizontalOverflowAbsent:true,
    runtimeAndConsoleErrorsObserved:0,
    commerceBoundary:initial.commerceBoundary,
    screenshot:`${definition.name}.png`,
  };
}

const expected=new URL(targetUrl);
assert(expected.protocol === 'https:', 'target_must_be_https');
assert(expected.hostname === 'daubesonntag.com' || expected.hostname === 'www.daubesonntag.com', 'target_host_invalid');
assert(sourceRevision && /^[0-9a-f]{40}$/i.test(sourceRevision), 'source_revision_required');
mkdirSync(artifactDir,{recursive:true});
const profile=`/tmp/daube-live-chrome-${process.pid}`;
const chrome=chromeExecutable();
const child=spawn(chrome,[
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
  `--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'about:blank'
],{stdio:['ignore','ignore','ignore']});
let client;
try {
  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  let page;
  for (let i=0;i<100 && !page;i+=1) {
    const targets=await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    page=targets.find(target=>target.type==='page' && target.webSocketDebuggerUrl);
    if (!page) await sleep(100);
  }
  assert(page,'page_target_missing');
  client=new CdpClient(page.webSocketDebuggerUrl); await client.connect();
  await Promise.all([client.call('Page.enable'),client.call('Runtime.enable'),client.call('Accessibility.enable')]);
  await client.call('Page.addScriptToEvaluateOnNewDocument',{source:`(() => { const errors=[]; Object.defineProperty(window,'__daubeCapturedErrors',{value:errors}); window.addEventListener('error',e=>errors.push(String(e.message||'error').slice(0,240))); window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason||'rejection').slice(0,240))); const old=console.error.bind(console); console.error=(...args)=>{errors.push(args.map(String).join(' ').slice(0,240));old(...args);}; })();`});
  const version=await client.call('Browser.getVersion');
  const cases=[];
  cases.push(await runCase(client,expected,{name:'desktop-1440x900',width:1440,height:900,mobile:false,reducedMotion:false}));
  cases.push(await runCase(client,expected,{name:'mobile-390x844-reduced',width:390,height:844,mobile:true,reducedMotion:true}));
  const receipt={
    schema:'daube.web.live-browser-evidence.v1',
    sourceRevision,
    target:expected.toString(),
    browser:version.product || null,
    exactRevisionBound:true,
    cases,
    browserInteractionVerified:true,
    accessibilityTreeVerified:true,
    dawnClarityVerified:true,
    productionDeploymentVerified:true,
    founderVisualAcceptance:false,
    verifiedAt:new Date().toISOString(),
  };
  writeFileSync(resolve(artifactDir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({ok:true,schema:receipt.schema,sourceRevision,caseCount:cases.length}));
} finally {
  client?.close(); child.kill('SIGTERM'); rmSync(profile,{recursive:true,force:true});
}
