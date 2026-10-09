// Offline support: the app shell is cached on install; fonts are cached the first time they load.
// Bump VERSION whenever any file changes so phones pick up the new version.
const VERSION = "krok-v2.0.0";
const FONT_CACHE = "krok-fonts";
const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./db.js",
  "./plan.js",
  "./guide.js",
  "./importers.js",
  "./fit.js",
  "./streams.js",
  "./analysis.js",
  "./charts.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION && k !== FONT_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      } catch (e) {
        return new Response("", { status: 504 });
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (req.mode === "navigate") {
      const hit = await cache.match("./index.html");
      if (hit) return hit;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      if (req.mode === "navigate") return (await cache.match("./")) || Response.error();
      return Response.error();
    }
  })());
});
