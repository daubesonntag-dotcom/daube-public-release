const CACHE='daube-studio-public-v1.1.0';
const CORE=['./','./index.html','./styles.css','./app.js','./bootstrap.js','./manifest.webmanifest','./icon.svg','./release-channel.json'];

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

  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then((response)=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then((cache)=>cache.put('./index.html',copy));}
      return response;
    }).catch(()=>caches.match('./index.html')));
    return;
  }

  if(url.pathname.endsWith('/release-channel.json')){
    event.respondWith(fetch(request,{cache:'no-store'}).catch(()=>caches.match(request)));
    return;
  }

  event.respondWith(caches.match(request).then((cached)=>cached||fetch(request).then((response)=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then((cache)=>cache.put(request,copy));}
    return response;
  })));
});
