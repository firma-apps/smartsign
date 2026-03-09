const CACHE = "smartsign-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(ASSETS); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function(e) {
  // Kun cache GET requests — ikke Firebase/API kald
  if(e.request.method !== "GET") return;
  var url = e.request.url;
  if(url.includes("firestore") || url.includes("firebase") || url.includes("cloudfunctions") || url.includes("fonts.googleapis")) return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var network = fetch(e.request).then(function(resp) {
        if(resp && resp.status === 200 && e.request.url.startsWith(self.location.origin)) {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clone); });
        }
        return resp;
      });
      return cached || network;
    })
  );
});
