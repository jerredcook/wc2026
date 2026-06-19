/* Network-first service worker for the WC 2026 app.
   Always tries the network first, so when you're online you get fresh content
   (no stale-cache surprises). When the network fails (offline), it serves the
   last-cached app shell. Live score APIs (ESPN / Anthropic) are cross-origin
   and are never intercepted or cached — they always go straight to the network
   and degrade gracefully on their own when offline. */
const CACHE = "wc2026-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  self.skipWaiting(); // activate this version immediately
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).catch(function () {})
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle our own origin (the app shell). Cross-origin score feeds pass through.
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(function (res) {
      const copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match("./index.html"); // navigation fallback when offline
      });
    })
  );
});
