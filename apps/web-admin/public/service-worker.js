/* ALORA — install/push only, revision 2026-10-26.
 * Deliberately NO fetch handler, precache, response storage or offline fallback. */
async function clearCaches() {
  await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
}
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await clearCaches();
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CLEAR_CACHES")
    event.waitUntil(
      clearCaches().then(() =>
        event.ports?.[0]?.postMessage({ ok: true, remoteOnly: true }),
      ),
    );
});
function notificationUrl(value) {
  try {
    const url = new URL(
      typeof value === "string" ? value : "/admin/#/dashboard",
      self.location.origin,
    );
    if (
      url.origin === self.location.origin &&
      url.pathname.startsWith("/admin/")
    )
      return url.href;
  } catch {
    /* Ignore malformed/external destinations. */
  }
  return new URL("/admin/#/dashboard", self.location.origin).href;
}
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    /* Generic notification for malformed data. */
  }
  const title =
    typeof payload.title === "string" ? payload.title.slice(0, 120) : "ALORA";
  const body =
    typeof payload.body === "string"
      ? payload.body.slice(0, 500)
      : "Hai una nuova notifica. Apri ALORA per consultarla.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/admin/icons/icon-192.png",
      ...(typeof payload.id === "string"
        ? { tag: payload.id.slice(0, 120) }
        : {}),
      data: { url: notificationUrl(payload.url) },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = notificationUrl(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = windows.find(
        (client) =>
          new URL(client.url).origin === self.location.origin &&
          new URL(client.url).pathname.startsWith("/admin/"),
      );
      if (existing) {
        await existing.navigate(url);
        await existing.focus();
      } else await self.clients.openWindow(url);
    })(),
  );
});
