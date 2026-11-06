/* Installation-only worker: requests go directly to the browser/network.
 * Keep this URL to migrate devices controlled by the previous caching worker.
 */
const CACHE_PREFIX = "barber-admin";

async function clearLegacyCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith(CACHE_PREFIX))
      .map((key) => caches.delete(key)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await clearLegacyCaches();
    await self.clients.claim();
  })());
});

// Compatibility with tabs still running the previous application version.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data?.type === "CLEAR_CACHES") {
    event.waitUntil(clearLegacyCaches().then(() => {
      event.ports?.[0]?.postMessage({ ok: true });
    }));
  }
});

// No fetch listener, precache, runtime cache, or offline fallback.
