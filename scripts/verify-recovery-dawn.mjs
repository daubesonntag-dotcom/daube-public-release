#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const artifactDir = resolve(root, 'artifacts', 'recovery-dawn');
const url = process.env.DAUBE_RECOVERY_PREVIEW_URL || 'http://127.0.0.1:4179/recovery/';
const debugPort = Number(process.env.DAUBE_CHROME_DEBUG_PORT || 9338);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fail(message){ throw new Error(`recovery_dawn_verification_failed:${message}`); }
function assert(value,message){ if(!value) fail(message); }
function chromeExecutable(){
  const p=spawnSync('bash',['-lc','command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser'],{encoding:'utf8'});
  const v=p.stdout.trim(); if(!v) fail('chrome_missing'); return v;
}
async function waitJson(target, attempts=120){
  for(let i=0;i<attempts;i++){try{const r=await fetch(target,{signal:AbortSignal.timeout(700)});if(r.ok)return r.json();}catch{} await sleep(100);} fail('chrome_debug_unavailable');
}
class CDP{
  constructor(ws){this.ws=ws;this.socket=null;this.id=1;this.pending=new Map();}
  async connect(){this.socket=new WebSocket(this.ws);await new Promise((ok,bad)=>{const t=setTimeout(()=>bad(new Error('connect_timeout')),10000);this.socket.addEventListener('open',()=>{clearTimeout(t);ok();},{once:true});this.socket.addEventListener('error',()=>{clearTimeout(t);bad(new Error('connect_error'));},{once:true});});this.socket.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.t);m.error?p.bad(new Error(m.error.message||'cdp_error')):p.ok(m.result??{});});}
  call(method,params={}){const id=this.id++;return new Promise((ok,bad)=>{const t=setTimeout(()=>{this.pending.delete(id);bad(new Error(`cdp_timeout:${method}`));},20000);this.pending.set(id,{ok,bad,t});this.socket.send(JSON.stringify({id,method,params}));});}
  close(){if(this.socket?.readyState===WebSocket.OPEN)this.socket.close();}
}
async function evaluate(c,expression){const r=await c.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)fail('runtime_evaluation_exception');return r.result?.value;}
async function waitReady(c){for(let i=0;i<100;i++){const s=await evaluate(c,`({ready:document.readyState,hero:!!document.querySelector('.hero'),title:document.querySelector('h1')?.textContent||''})`).catch(()=>null);if(s?.ready==='complete'&&s.hero&&s.title) return;await sleep(100);}fail('surface_timeout');}
async function exerciseScrollReveal(c, viewportHeight){
  const total=await evaluate(c,'Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)');
  const step=Math.max(260,Math.floor(viewportHeight*.72));
  for(let y=0;y<total;y+=step){await evaluate(c,`window.scrollTo({top:${y},behavior:'instant'})`);await sleep(95);}
  await evaluate(c,'window.scrollTo({top:0,behavior:"instant"})');
  await sleep(180);
}

async function runCase(c,def){
  await c.call('Emulation.setDeviceMetricsOverride',{width:def.width,height:def.height,deviceScaleFactor:1,mobile:def.mobile});
  await c.call('Emulation.setEmulatedMedia',{media:'',features:[{name:'prefers-reduced-motion',value:def.reduced?'reduce':'no-preference'}]});
  await c.call('Page.navigate',{url}); await waitReady(c); await sleep(def.reduced?120:950);
  if(!def.reduced) await exerciseScrollReveal(c,def.height);
  const state=await evaluate(c,`(()=>{
    const q=s=>document.querySelector(s); const qa=s=>[...document.querySelectorAll(s)];
    const body=document.body.innerText; const normalizedBody=body.toLocaleLowerCase('vi-VN'); const first=q('.button'); const rect=first?.getBoundingClientRect();
    return {
      lang:document.documentElement.lang,title:document.title,h1:q('h1')?.textContent?.replace(/\\s+/g,' ').trim()||'',
      principle:q('#principle-title')?.textContent?.replace(/\\s+/g,' ').trim()||'',
      cards:qa('.card').length,night:!!q('.night'),orb:!!q('.orb'),arch:!!q('.archOuter'),
      heroMedia:q('.heroVisual')?.querySelectorAll('img,video').length??-1,
      recovery:normalizedBody.includes('public recovery surface online'),truth:normalizedBody.includes('recovery ≠ final sovereign production'),
      width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
      touchW:rect?.width||0,touchH:rect?.height||0,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      revealHidden:qa('[data-reveal]').filter(x=>getComputedStyle(x).opacity==='0').length,
      errors:Array.isArray(window.__daubeErrors)?window.__daubeErrors:[]
    };
  })()`);
  assert(state.lang==='vi',`${def.name}:lang`);
  assert(state.title.includes('D’AUBE SONNTAG'),`${def.name}:title`);
  assert(state.h1.includes('Một hiện diện đủ rõ')&&state.h1.includes('hiểu bạn.'),`${def.name}:hero_copy`);
  assert(state.principle.includes('Rõ trước. Đẹp sau.')&&state.principle.includes('Đúng rồi mới mở rộng.'),`${def.name}:principle`);
  assert(state.cards===3,`${def.name}:cards`); assert(state.night&&state.orb&&state.arch,`${def.name}:art_direction`);
  assert(state.heroMedia===0,`${def.name}:hero_media_dependency`); assert(state.recovery&&state.truth,`${def.name}:truth_boundary`);
  assert(state.scroll<=state.width+1,`${def.name}:horizontal_overflow`); assert(state.touchW>=44&&state.touchH>=44,`${def.name}:touch_target`);
  assert(state.reduced===def.reduced,`${def.name}:reduced_motion_query`); assert(state.revealHidden===0,`${def.name}:all_reveals_visible_after_journey`);
  assert(state.errors.length===0,`${def.name}:runtime_errors`);
  const ax=await c.call('Accessibility.getFullAXTree');
  const nodes=ax.nodes||[];
  assert(nodes.some(n=>n.ignored!==true&&n.role?.value==='heading'&&String(n.name?.value||'').includes('Một hiện diện đủ rõ')),`${def.name}:ax_heading`);
  assert(nodes.some(n=>n.ignored!==true&&n.role?.value==='link'&&String(n.name?.value||'').includes('Khám phá D’AUBE')),`${def.name}:ax_primary_link`);
  const shot=await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true});
  const path=resolve(artifactDir,`${def.name}.png`);writeFileSync(path,Buffer.from(shot.data,'base64'));
  return {name:def.name,viewport:{width:def.width,height:def.height,mobile:def.mobile},reducedMotion:def.reduced,checks:'PASS',allRevealsVisible:true,screenshot:`${def.name}.png`};
}

mkdirSync(artifactDir,{recursive:true});
const chrome=chromeExecutable();const profile=`/tmp/daube-recovery-chrome-${process.pid}`;
const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
let c;
try{
  await waitJson(`http://127.0.0.1:${debugPort}/json/version`);const targets=await waitJson(`http://127.0.0.1:${debugPort}/json/list`);const page=targets.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);assert(page,'page_target_missing');
  c=new CDP(page.webSocketDebuggerUrl);await c.connect();await Promise.all([c.call('Page.enable'),c.call('Runtime.enable'),c.call('Accessibility.enable')]);
  await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const a=[];Object.defineProperty(window,'__daubeErrors',{value:a});addEventListener('error',e=>a.push(String(e.message||'error').slice(0,200)));addEventListener('unhandledrejection',e=>a.push(String(e.reason||'rejection').slice(0,200)));})();`});
  const cases=[];cases.push(await runCase(c,{name:'desktop-1440x900',width:1440,height:900,mobile:false,reduced:false}));cases.push(await runCase(c,{name:'mobile-390x844-reduced',width:390,height:844,mobile:true,reduced:true}));
  const receipt={schema:'daube.recovery-dawn-clarity-browser.v2',ok:true,cases,privateSourceRequired:false,externalMediaRequired:false,truthBoundaryPreserved:true,fullPageVisualEvidence:true,verifiedAt:new Date().toISOString()};writeFileSync(resolve(artifactDir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({ok:true,cases:cases.length}));
}finally{
  c?.close();
  if(child.exitCode===null){
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolveExit=>child.once('exit',resolveExit)),sleep(750)]);
  }
  try{rmSync(profile,{recursive:true,force:true,maxRetries:4,retryDelay:100});}catch{}
}
