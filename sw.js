/* Service worker de Core IA: shell offline ligero con actualización inmediata. */
const CACHE = "coreia-shell-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./script.js",
  "./discord-rpc.js",
  "./manifest.webmanifest",
  "./favicon.svg",
];

// El HTML y el JS principales se piden primero a la red para que las nuevas
// versiones se apliquen al instante (con la caché como respaldo sin conexión).
const NETWORK_FIRST = [/\/$/, /\/index\.html$/, /\/script\.js$/, /\/discord-rpc\.js$/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isNetworkFirst(url) {
  return NETWORK_FIRST.some((pattern) => pattern.test(url.pathname));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isNetworkFirst(url)) {
    event.respondWith(
      // `no-store`: se pide siempre a la red sin caché HTTP intermedia, para
      // que las actualizaciones de HTML/JS se apliquen al instante.
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || caches.match("./index.html"));
      return cached || network;
    })
  );
});
