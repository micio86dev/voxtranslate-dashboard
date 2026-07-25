/* VoxTranslate for Business — service worker.
 * Web Push only (no caching): show notifications and focus/open the app on click.
 * Payload shape (from the server): { title, body, data:{ join_url, meeting_id, ... } }. */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'VoxTranslate', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'VoxTranslate';
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      // Full-colour image, rendered at ~64dp — the 32px favicon is far too small,
      // and the 512px app icon (238 KB) too heavy to fetch reliably on mobile.
      icon: '/icon-192.png',
      // `badge` is NOT drawn as a picture: Android uses its ALPHA channel as a
      // stencil, tints it, and places it in circular chrome. An opaque image (the
      // favicon, the app icon) therefore renders as a solid square. Must stay a
      // transparent, monochrome glyph — see public/badge.svg for the source art.
      badge: '/badge-96.png',
      data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Prefer the meeting join link; otherwise open the meetings page.
  const url = data.join_url || '/en/meetings/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && url.startsWith('/')) client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
