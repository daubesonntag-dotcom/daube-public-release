const CACHE = 'daube-studio-public-v1.1.1-qc-storage-r2';
const scopeUrl = self.registration.scope;
const entryUrls = new Set([
  new URL('./', scopeUrl).href,
  new URL('./index.html', scopeUrl).href,
]);
const staticUrls = new Set([
  './styles.css', './app.js', './bootstrap.js', './manifest.webmanifest', './icon.svg',
].map((path) => new URL(path, scopeUrl).href));
const offlineEntry = new URL('./index.html', scopeUrl).href;
// Release metadata is deliberately excluded: an offline copy cannot establish
// the current release state. Query-bearing URLs also remain network-only.
const CORE = [offlineEntry, ...staticUrls];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(CORE))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys
      .filter((key) => key.startsWith('daube-studio-public-') && key !== CACHE)
      .map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// Cache storage is optional during requests. Storage errors must never replace
// a successful network response with stale content or break an online request.
async function readCached(request) {
  try {
    const cache = await caches.open(CACHE);
    return await cache.match(request);
  } catch {
    return undefined;
  }
}

async function writeCached(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  } catch {
    // Quota, storage policy, or eviction failures do not invalidate the response.
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search) return;

  if (request.mode === 'navigate' && entryUrls.has(url.href)) {
    event.respondWith((async () => {
      let response;
      try {
        response = await fetch(request);
      } catch {
        return (await readCached(offlineEntry)) || Response.error();
      }
      if (response.ok && !response.redirected &&
          response.headers.get('content-type')?.includes('text/html')) {
        await writeCached(offlineEntry, response);
      }
      return response;
    })());
    return;
  }

  // Never intercept other navigations, private/API routes, release manifests,
  // or arbitrary same-origin resources, including query variants of assets.
  if (request.mode === 'navigate' || !staticUrls.has(url.href)) return;
  event.respondWith((async () => {
    const cached = await readCached(request);
    if (cached) return cached;
    let response;
    try {
      response = await fetch(request);
    } catch {
      return Response.error();
    }
    if (response.ok && !response.redirected) {
      await writeCached(request, response);
    }
    return response;
  })());
});
