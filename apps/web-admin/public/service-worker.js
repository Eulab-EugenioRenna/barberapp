/*
 * Barber Admin service worker.
 *
 * Strategia volutamente NON aggressiva:
 * - la rete resta la fonte di verita (network-first);
 * - la cache serve solo come fallback quando si e offline;
 * - ad ogni aggiornamento le cache precedenti vengono invalidate, cosi il
 *   browser non continua a servire file vecchi dopo un deploy.
 *
 * L'API (/api/**) non viene mai intercettata ne cachata: i dati devono
 * restare sempre remoti e autenticati.
 */
const CACHE_PREFIX = "barber-admin";
const CACHE_NAME = `${CACHE_PREFIX}-runtime`;
const OFFLINE_FALLBACK_KEY = "./index.html";

self.addEventListener("install", () => {
  // La nuova versione prende subito il controllo: nessun precache pesante.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data.type === "CLEAR_CACHES") {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
        event.ports?.[0]?.postMessage({ ok: true });
      })(),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Solo GET same-origin: tutto il resto va dritto alla rete.
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // L'API non entra mai nella cache del service worker.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, true));
    return;
  }

  if (["script", "style", "image", "font", "manifest"].includes(request.destination)) {
    event.respondWith(networkFirst(request, false));
  }
});

async function networkFirst(request, isNavigation) {
  const cache = await caches.open(CACHE_NAME);

  try {
    // Per le navigazioni forziamo la rivalidazione: index.html non deve mai
    // arrivare dalla cache HTTP del browser dopo un deploy.
    const response = await fetch(
      request,
      isNavigation ? { cache: "no-cache" } : undefined,
    );

    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
      if (isNavigation) {
        cache.put(OFFLINE_FALLBACK_KEY, response.clone());
      }
    }

    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    if (isNavigation) {
      const fallback = await cache.match(OFFLINE_FALLBACK_KEY);
      if (fallback) {
        return fallback;
      }
    }

    throw error;
  }
}
