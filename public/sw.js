// Phase 1: service worker. Responsibilities (keep it small):
//  1. Cache the app shell for offline launch.
//  2. Background sync of the IndexedDB upload queue (retry with backoff; never drop a queued image).
//  3. Receive Web Push → show notification → click opens /confirm/<id>.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : { title: "Paper2Cloud", body: "Ready to confirm", url: "/capture" };
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, data: { url: data.url } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || "/capture"));
});
