/** Worker only for install/push. Page/API requests use the normal browser network stack. */
export async function prepareRemoteOnly(window: Window): Promise<void> {
  const clear = async () => {
    try {
      await Promise.all(
        ((await window.caches?.keys()) || []).map((key) =>
          window.caches.delete(key),
        ),
      );
    } catch {
      /* Private browsing may deny Cache Storage. */
    }
  };
  await clear();
  try {
    const base = new URL(window.document.baseURI);
    const registration = await window.navigator.serviceWorker?.register(
      new URL("service-worker.js", base).href,
      { scope: base.pathname, updateViaCache: "none" },
    );
    if (registration) {
      await registration.update();
      const replacement = registration.installing || registration.waiting;
      if (
        replacement &&
        !["activated", "redundant"].includes(replacement.state)
      )
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            replacement.removeEventListener("statechange", changed);
            resolve();
          };
          const changed = () => {
            if (["activated", "redundant"].includes(replacement.state))
              finish();
          };
          const timer = setTimeout(finish, 8000);
          replacement.addEventListener("statechange", changed);
          changed();
        });
      // Registration and existing push subscriptions are retained; only historical caches go away.
      registration.active?.postMessage({ type: "CLEAR_CACHES" });
    }
  } catch {
    /* No offline app fallback: network errors remain normal network errors. */
  }
  await clear();
  window.addEventListener("pageshow", (event) => {
    if ((event as PageTransitionEvent).persisted) window.location.reload();
  });
}
