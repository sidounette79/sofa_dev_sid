// Push notification service worker (20.08) — episode-release and
// series-status-change pushes only. Deliberately minimal: no offline
// caching/asset precaching here, just the two events Web Push needs.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/web-app-manifest-192x192.png",
      // 07.09, Sid: Android status-bar icon showed a blank white square.
      // Android derives that icon from the badge image's alpha channel —
      // web-app-manifest-192x192.png is fully opaque (no transparency), so
      // there was no shape for it to extract. This is a dedicated white
      // silhouette on a transparent background instead.
      badge: "/badge-96x96.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.endsWith(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
