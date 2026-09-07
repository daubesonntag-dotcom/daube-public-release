import { chromium } from '@playwright/test';
import axe from 'axe-core';
import fs from 'node:fs/promises';
import path from 'node:path';
const BASE=process.env.QA_URL||'http://127.0.0.1:4173/campaigns/first-light/';
const out=new URL('./artifacts/',import.meta.url);await fs.mkdir(out,{recursive:true});
const frames=[0,500,1500,2800,4200,5700,7200];
const viewports=[{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}];
const report={url:BASE,frames,viewports:[],console:[],axe:[],timestamp:new Date().toISOString()};
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
for(const vp of viewports){
 const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},deviceScaleFactor:1,colorScheme:'dark',reducedMotion:'no-preference'});
 const page=await context.newPage();
 page.on('console',m=>{if(['error','warning','warn'].includes(m.type()))report.console.push({viewport:vp.name,type:m.type(),text:m.text()})});
 page.on('pageerror',e=>report.console.push({viewport:vp.name,type:'pageerror',text:String(e)}));
 const item={...vp,frames:[]};
 for(const ms of frames){
   const u=new URL(BASE);u.searchParams.set('name','QC Rose');u.searchParams.set('qa','1');u.searchParams.set('frame',String(ms));
   await page.goto(u.toString(),{waitUntil:'networkidle',timeout:60000});
   await page.waitForFunction(()=>!!window.__DAUBE_QA__,null,{timeout:30000});
   await page.evaluate(async ms=>{await window.__DAUBE_QA__.seek(ms/1000);},ms);
   await page.waitForTimeout(180);
   const file=`${vp.name}-${String(ms).padStart(4,'0')}ms.png`;
   await page.screenshot({path:path.join(out.pathname,file),fullPage:false,animations:'disabled'});
   const state=await page.evaluate(()=>({tier:document.body.dataset.vfxTier,ready:document.body.classList.contains('scene-ready'),open:document.getElementById('opening')?.classList.contains('is-open'),copy:document.querySelector('.reveal-note')?.getBoundingClientRect().toJSON?.()}));
   item.frames.push({ms,file,state});
   if(ms===0){
     await page.addScriptTag({content:axe.source});
     const a=await page.evaluate(async()=>await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
     const serious=a.violations.filter(v=>['serious','critical'].includes(v.impact));
     report.axe.push({viewport:vp.name,violations:serious.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.length}))});
   }
 }
 report.viewports.push(item);await context.close();
}
await browser.close();
await fs.writeFile(new URL('./artifacts/report.json',import.meta.url),JSON.stringify(report,null,2));
const badConsole=report.console.filter(x=>x.type==='pageerror'||x.type==='error');
const badAxe=report.axe.flatMap(x=>x.violations);
console.log(JSON.stringify({frames:report.viewports.reduce((n,v)=>n+v.frames.length,0),badConsole:badConsole.length,badAxe:badAxe.length},null,2));
if(badConsole.length||badAxe.length)process.exitCode=1;