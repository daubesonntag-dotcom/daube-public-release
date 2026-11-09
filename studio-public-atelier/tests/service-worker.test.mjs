import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://studio.example/atelier/';
const cacheName = 'daube-studio-public-v1.1.1-qc-storage-r2';
function boot(faults = {}) {
  const handlers = {}, stores = new Map(), calls = [];
  let network = async () => new Response('network', { headers: {'content-type':'text/html'} });
  const key = value => typeof value === 'string' ? value : value.url;
  const caches = {
    async open(name) {
      if (faults.open) throw new Error('cache open failed');
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(urls) { if (faults.addAll) throw new Error('precache failed'); calls.push(['addAll', ...urls]); for (const url of urls) store.set(url, new Response('precache')); },
        async match(request) { if (faults.match) throw new Error('cache read failed'); return store.get(key(request))?.clone(); },
        async put(request, response) { if (faults.put) throw new Error('cache write failed'); store.set(key(request), response.clone()); calls.push(['put',key(request)]); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { calls.push(['delete',name]); return stores.delete(name); },
  };
  vm.runInNewContext(source, {
    URL, Response, caches, fetch: async request => { calls.push(['fetch',request.url]); return network(request); },
    self: {registration:{scope},location:{origin:'https://studio.example'},
      addEventListener(type, handler) { handlers[type] = handler; },
      async skipWaiting() { calls.push(['skipWaiting']); },
      clients:{async claim() { calls.push(['claim']); }},
    },
  });
  return { stores, calls, caches, setNetwork(fn) { network = fn; },
    async lifecycle(type) { let promise; handlers[type]({waitUntil(p) { promise=p; }}); await promise; },
    request(path, options={}) {
      let promise;
      handlers.fetch({request:{url:new URL(path,scope).href,method:'GET',mode:'cors',...options},respondWith(p) { promise=p; }});
      return promise;
    },
  };
}

test('private/API and arbitrary same-origin paths are not intercepted', () => {
  const app=boot();
  for(const path of ['/api/me','/atelier/api/projects','/atelier/private','/atelier/other.js','/atelier/nested/app.js','/atelier/app.js/extra']) {
    assert.equal(app.request(path),undefined);
    assert.equal(app.request(path,{mode:'navigate'}),undefined);
  }
  assert.deepEqual(app.calls,[]);
});
test('only exact static shell paths without queries are cached', async () => {
  const app=boot();
  for(const path of ['app.js','styles.css','bootstrap.js','manifest.webmanifest','icon.svg']) {
    assert.equal(await (await app.request(path)).text(),'network');
    assert.equal(await (await app.request(path)).text(),'network');
    assert.equal(app.calls.filter(c=>c[0]==='fetch'&&c[1]===scope+path).length,1);
    assert.equal(app.request(path+'?token=private'),undefined);
  }
  assert.equal(app.request('../app.js'),undefined);
  assert.equal(app.request('app.js',{mode:'navigate'}),undefined);
});
test('foreign origin and non-GET requests are not intercepted', () => {
  const app=boot();
  assert.equal(app.request('https://other.example/atelier/app.js'),undefined);
  for(const method of ['POST','PUT','DELETE','HEAD']) assert.equal(app.request('app.js',{method}),undefined);
  assert.deepEqual(app.calls,[]);
});
test('entry navigation refreshes offline shell and falls back only on network failure', async () => {
  const app=boot();
  assert.equal(await (await app.request('./',{mode:'navigate'})).text(),'network');
  app.setNetwork(async()=>{throw new Error('offline');});
  for(const path of ['./','index.html']) assert.equal(await (await app.request(path,{mode:'navigate'})).text(),'network');
  assert.equal(app.request('./?account=private',{mode:'navigate'}),undefined);
  assert.equal(app.request('private',{mode:'navigate'}),undefined);
  const empty=boot();empty.setNetwork(async()=>{throw new Error('offline');});
  assert.equal((await empty.request('./',{mode:'navigate'})).type,'error');
});
test('HTTP failure and non-HTML entry responses never poison the offline shell', async () => {
  const app=boot();await app.request('./',{mode:'navigate'});
  app.setNetwork(async()=>new Response('unavailable',{status:503}));
  assert.equal((await app.request('./',{mode:'navigate'})).status,503);
  app.setNetwork(async()=>new Response('private json',{headers:{'content-type':'application/json'}}));
  await app.request('./',{mode:'navigate'});
  app.setNetwork(async()=>{throw new Error('offline');});
  assert.equal(await (await app.request('./',{mode:'navigate'})).text(),'network');
});
test('install precaches only public assets; release metadata stays network-only', async () => {
  const app=boot();await app.lifecycle('install');
  const precache=app.calls.find(c=>c[0]==='addAll').slice(1);
  assert.equal(precache.length,6);
  assert.ok(precache.includes(scope+'index.html'));
  assert.ok(!precache.some(url=>url.includes('release-')));
  for(const path of ['release-channel.json','release-passport.v1.json','nested/release-channel.json']) assert.equal(app.request(path),undefined);
  assert.ok(app.calls.some(c=>c[0]==='skipWaiting'));
});
test('cache upgrade deletes old public caches but preserves unrelated caches', async () => {
  const app=boot();
  for(const name of ['daube-studio-public-v1.1.0-r2','unrelated-private-cache',cacheName]) await app.caches.open(name);
  await app.lifecycle('activate');
  assert.deepEqual([...app.stores.keys()].sort(),[cacheName,'unrelated-private-cache'].sort());
  assert.ok(app.calls.some(c=>c[0]==='claim'));
});

for (const fault of ['open', 'match', 'put']) {
  test(`cache ${fault} failure preserves successful online responses`, async () => {
    const app = boot({[fault]: true});
    for (const [path, options] of [['./', {mode:'navigate'}], ['app.js', {}]]) {
      assert.equal(await (await app.request(path, options)).text(), 'network');
    }
  });
}
test('failed navigation cache write never substitutes a stale fallback', async () => {
  const faults = {};
  const app = boot(faults);
  await app.request('./', {mode:'navigate'});
  faults.put = true;
  app.setNetwork(async () => new Response('fresh online', {headers:{'content-type':'text/html'}}));
  assert.equal(await (await app.request('./', {mode:'navigate'})).text(), 'fresh online');
});
test('offline cache open/read failures and misses fail closed', async () => {
  for (const faults of [{open:true}, {match:true}, {}]) {
    const app = boot(faults);
    app.setNetwork(async () => {throw new Error('offline');});
    for (const [path, options] of [['./', {mode:'navigate'}], ['app.js', {}]]) {
      assert.equal((await app.request(path, options)).type, 'error');
    }
  }
});
test('redirected responses are returned but never cached', async () => {
  const app = boot();
  app.setNetwork(async () => {
    const response = new Response('redirect target', {headers:{'content-type':'text/html'}});
    Object.defineProperty(response, 'redirected', {value:true});
    return response;
  });
  for (const [path, options] of [['./', {mode:'navigate'}], ['app.js', {}]]) {
    const response = await app.request(path, options);
    assert.equal(response.redirected, true);
    assert.equal(await response.text(), 'redirect target');
  }
  assert.ok(!app.calls.some(call => call[0] === 'put'));
});
test('failed install rejects without activating incomplete precache', async () => {
  for (const faults of [{open:true}, {addAll:true}]) {
    const app = boot(faults);
    await assert.rejects(app.lifecycle('install'), /failed/);
    assert.ok(!app.calls.some(call => call[0] === 'skipWaiting'));
    assert.ok(!app.calls.some(call => call[0] === 'delete'));
  }
});
