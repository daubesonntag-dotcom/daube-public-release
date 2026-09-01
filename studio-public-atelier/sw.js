const CACHE='daube-studio-public-v1.1.0-r2';
const CORE=['./','./index.html','./styles.css','./app.js','./bootstrap.js','./manifest.webmanifest','./icon.svg','./release-channel.json'];
const scopePath=new URL(self.registration.scope).pathname;
const entryPaths=new Set([scopePath,`${scopePath}index.html`]);

self.addEventListener('install',(event)=>{
  event.waitUntil(caches.open(CACHE).then((cache)=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',(event)=>{
  event.waitUntil(caches.keys().then((keys)=>Promise.all(keys.filter((key)=>key.startsWith('daube-studio-public-')&&key!==CACHE).map((key)=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',(event)=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  if(url.pathname.endsWith('/release-channel.json')){
    event.respondWith(fetch(request,{cache:'no-store'}).catch(()=>caches.match(request)));
    return;
  }

  if(request.mode==='navigate'){
    const isAppEntry=entryPaths.has(url.pathname);
    event.respondWith(fetch(request).then((response)=>{
      if(response.ok&&isAppEntry){const copy=response.clone();caches.open(CACHE).then((cache)=>cache.put('./index.html',copy));}
      return response;
    }).catch(()=>isAppEntry?caches.match('./index.html'):Response.error()));
    return;
  }

  event.respondWith(caches.match(request).then((cached)=>cached||fetch(request).then((response)=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then((cache)=>cache.put(request,copy));}
    return response;
  })));
});
