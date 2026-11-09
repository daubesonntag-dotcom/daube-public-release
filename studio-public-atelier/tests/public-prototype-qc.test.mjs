import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.STUDIO_APP_SOURCE || new URL('../app.js',import.meta.url),'utf8');
function boot(nodes=[]) {
  const elements=new Map();
  function element(){return {textContent:'',innerHTML:'',value:'',dataset:{},style:{},children:[],handlers:{},
    classList:{add(){},remove(){},toggle(){}},replaceChildren(){this.children=[];},append(child){this.children.push(child);},
    addEventListener(type,handler){this.handlers[type]=handler;},getAttribute(){return '';}};}
  const project={id:'test',theme:'golden-dawn',mode:'craft',nodes,composeTray:[],selection:[],metadata:{revision:0}};
  const context=vm.createContext({document:{body:{dataset:{}},querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},querySelectorAll(){return [];},createElement:element},
    localStorage:{getItem(){return JSON.stringify(project);},setItem(){}},setTimeout(){return 1;},clearTimeout(){}});
  vm.runInContext(source,context);
  return {elements,context,click(selector){elements.get(selector).handlers.click();}};
}
function assertLocked(app){
  assert.equal(app.elements.get('#qcScore').textContent,'0/8');
  assert.equal(app.elements.get('#shipState').textContent,'PUBLIC RELEASE LOCKED');
  assert.equal(app.elements.get('#shipButton').dataset.ready,'false');
  const rows=app.elements.get('#gateList').children;
  assert.equal(rows.length,8);
  for(const row of rows)assert.ok(row.innerHTML.endsWith('<b>NOT VERIFIED</b>'));
}
for(const [name,nodes] of [
  ['empty scene',[]],
  ['catalog-approved asset',[{id:'hero',name:'First Light Portal',kind:'hero',assetId:'hero-first-light',x:50,y:50}]],
  ['arbitrary node',[{id:'custom',name:'Custom',kind:'atelier-block',x:50,y:50}]],
])test(`${name}: actual review click creates no PASS receipts`,()=>{
  const app=boot(nodes);app.click('#runPrototypeQC');assertLocked(app);
  assert.equal(app.elements.get('#toast').textContent,'Preview only. No quality checks were executed and no evidence was created.');
});
test('repeated prototype review stays unverified',()=>{
  const app=boot();for(let i=0;i<5;i++){app.click('#runPrototypeQC');assertLocked(app);}
});
test('edits, undo and redo after review stay unverified',()=>{
  const app=boot();app.click('#runPrototypeQC');
  app.click('#addBlockButton');assert.equal(app.elements.get('#nodeCount').textContent,'1');assertLocked(app);
  app.click('#undoButton');assert.equal(app.elements.get('#nodeCount').textContent,'0');assertLocked(app);
  app.click('#redoButton');assert.equal(app.elements.get('#nodeCount').textContent,'1');assertLocked(app);
});
test('AI preview and ship remain simulation-only and locked',()=>{
  const app=boot();app.elements.get('#aiTools').children[0].handlers.click();
  assert.ok(app.elements.get('#commandReceipt').textContent.includes('no execution / no upload'));
  app.click('#shipButton');assert.equal(app.elements.get('#toast').textContent,'Public shell cannot publish. Release authority stays in the private D’AUBE runtime.');assertLocked(app);
});
test('service-worker update message does not claim verification',async()=>{
  const elements=new Map();const listeners={};let registered;const ready=new Promise(resolve=>{registered=resolve;});const worker={state:'installed',addEventListener(type,fn){listeners[type]=fn;}};
  const registration={installing:worker,addEventListener(type,fn){listeners[type]=fn;registered();}};
  const context=vm.createContext({window:{addEventListener(){}},document:{querySelector(selector){if(selector==='.top-actions')return null;if(!elements.has(selector))elements.set(selector,{textContent:'',classList:{add(){},remove(){}}});return elements.get(selector);}},navigator:{serviceWorker:{controller:{},async register(){return registration;}}},fetch:async()=>({ok:false,status:503}),console:{warn(){}},setTimeout(){return 1;},clearTimeout(){}});
  vm.runInContext(readFileSync(new URL('../bootstrap.js',import.meta.url),'utf8'),context);
  await ready;listeners.updatefound();listeners.statechange();
  assert.equal(elements.get('#toast').textContent,'A Public Atelier update is ready. Reload when convenient.');
});
