// Mindstone offline support for the installed web app (phones and browsers). Caches the app itself so it opens
// without a network; your data lives in the browser's own database, not in this cache. Sync requests (/v1/) and
// other sites are never cached.
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `mindstone-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch("./", { cache: "reload" });
    const html = await res.clone().text();
    await cache.put("./", res);
    const assets = [...html.matchAll(/(?:src|href)="(\.\/(?:assets|icons)\/[^"]+|\.\/(?:favicon\.png|manifest\.webmanifest))"/g)].map((m) => m[1]);
    await cache.addAll([...new Set(assets)]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("mindstone-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/v1/")) return;
  if (req.mode === "navigate") { // the app page: fresh when online, cached when offline
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); void caches.open(CACHE).then((c) => c.put("./", copy)); return res; }).catch(async () => (await caches.match("./")) || Response.error()));
    return;
  }
  event.respondWith((async () => { // files: hashed and immutable, so the cache is always right
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === "basic") { const copy = res.clone(); void caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })());
});
