import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(process.env.STUDIO_STORAGE_SOURCE || new URL('../app.js', import.meta.url), 'utf8');
const project = () => ({id:'keep-id',theme:'moon-ink',mode:'craft',nodes:[{id:'keep-node',name:'Keep me',kind:'hero',x:20,y:30}],composeTray:['hero-first-light'],selection:['keep-node'],metadata:{revision:12,custom:'keep'},custom:'preserve'});
function boot(raw, errors = {}) {
  const elements = new Map(), writes = [];
  const element = () => ({textContent:'',innerHTML:'',value:'',dataset:{},style:{},children:[],handlers:{},
    classList:{add(){},remove(){},toggle(){}},replaceChildren(){this.children=[];},append(child){this.children.push(child);},
    addEventListener(type,handler){this.handlers[type]=handler;},getAttribute(){return '';}});
  // The real HTML starts with this status even before app.js runs.
  elements.set('#saveState', { ...element(), textContent: 'saved locally' });
  const context = vm.createContext({document:{body:{dataset:{}},querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);},querySelectorAll(){return [];},createElement:element},
    localStorage:{getItem(){if(errors.read)throw new Error('SecurityError');return raw;},setItem(key,value){if(errors.write)throw new Error(errors.write);writes.push(value);raw=value;}},setTimeout(){},clearTimeout(){}});
  vm.runInContext(source,context);
  return {elements,writes,stored:()=>raw,state:()=>JSON.parse(vm.runInContext('JSON.stringify(history.present)',context)),click(selector){elements.get(selector).handlers.click();}};
}
function locked(app) {
  assert.equal(app.elements.get('#qcScore').textContent,'0/8');
  assert.equal(app.elements.get('#shipButton').dataset.ready,'false');
}
test('missing/null/invalid revision metadata recovers without losing valid project fields or writing on boot',()=>{
  for(const metadata of [undefined,null,[],4,{revision:'bad',custom:'keep'},{revision:-1},{revision:1.2}]) {
    const saved={...project(),metadata};const raw=JSON.stringify(saved);const app=boot(raw);
    assert.equal(app.state().metadata.revision,0);
    for(const key of ['id','theme','mode','nodes','composeTray','selection','custom'])assert.deepEqual(app.state()[key],saved[key]);
    assert.equal(app.stored(),raw);assert.equal(app.writes.length,0);
    assert.equal(app.elements.get('#saveState').textContent,'not saved · recovered project metadata');locked(app);
    app.click('#addBlockButton');assert.equal(app.state().nodes.length,2);assert.equal(app.state().metadata.revision,1);
  }
});
test('valid project preserved exactly with no boot write',()=>{
  const saved=project(),raw=JSON.stringify(saved),app=boot(raw);
  assert.deepEqual(app.state(),saved);assert.equal(app.stored(),raw);assert.equal(app.writes.length,0);
  assert.equal(app.elements.get('#saveState').textContent,'saved locally');locked(app);
});
test('malformed JSON and invalid graph fall back without overwriting stored bytes',()=>{
  for(const raw of ['{broken','null','{}',JSON.stringify({...project(),nodes:[null]})]) {
    const app=boot(raw);assert.equal(app.state().nodes.length,0);assert.equal(app.stored(),raw);assert.equal(app.writes.length,0);
    assert.equal(app.elements.get('#saveState').textContent,'not saved · local project unavailable');locked(app);
  }
});
test('storage read security failure still allows an unsaved editable project',()=>{
  const app=boot(null,{read:true,write:'SecurityError'});
  assert.equal(app.elements.get('#saveState').textContent,'not saved · local project unavailable');
  app.click('#addBlockButton');assert.equal(app.state().nodes.length,1);
  assert.equal(app.elements.get('#saveState').textContent,'not saved · browser storage unavailable');locked(app);
});
for(const failure of ['QuotaExceededError','SecurityError']) {
  test(`${failure}: edits undo redo render and remain truthfully unsaved`,()=>{
    const raw=JSON.stringify(project()),app=boot(raw,{write:failure});
    for(const [button,count] of [['#addBlockButton',2],['#undoButton',1],['#redoButton',2]]) {
      app.click(button);assert.equal(app.state().nodes.length,count);assert.equal(app.elements.get('#nodeCount').textContent,String(count));
      assert.equal(app.elements.get('#saveState').textContent,'not saved · browser storage unavailable');locked(app);
    }
    assert.equal(app.stored(),raw);assert.equal(app.writes.length,0);
  });
}
test('successful later write clears unsaved status and persists current project',()=>{
  const errors={write:'QuotaExceededError'},app=boot(null,errors);
  assert.equal(app.elements.get('#saveState').textContent,'not saved yet');
  app.click('#addBlockButton');assert.equal(app.writes.length,0);
  errors.write=null;app.click('#addBlockButton');
  assert.equal(app.elements.get('#saveState').textContent,'saved locally');assert.deepEqual(JSON.parse(app.stored()),app.state());locked(app);
});
