// Service worker: handles Web Push notifications for the Wealth Dashboard.
// Runs in the browser's background, separate from the app's JS bundle.
//
// G411: this worker is push-only and must never serve an app shell. It has no
// fetch handler on purpose, so every navigation and asset request goes to the
// network (and the browser's normal HTTP caching), never to a Cache Storage
// copy of an older build. It precaches nothing. The version below only names
// the one cache this worker is allowed to own (none today); on activate every
// other cache is deleted, so a shell cached by any earlier worker generation
// is cleared the first time this worker takes over.
const SW_VERSION = "g411-push-only-v1";
const OWNED_CACHES = [];

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return OWNED_CACHES.indexOf(key) === -1;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("push", function (event) {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "New transaction", body: event.data.text() };
  }

  const title = data.title || "Wealth Dashboard";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/" },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // Focus an existing window if one is open
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});
