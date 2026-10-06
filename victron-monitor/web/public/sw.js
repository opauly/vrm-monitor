/* VRM Monitor service worker — push notifications only.
 *
 * It caches nothing and intercepts no requests (no `fetch` handler), so it can
 * never serve stale pages or break navigation; its one job is to wake up when
 * the push service delivers an alert, show it, and open the right page when it
 * is tapped.
 *
 * Every push MUST end in a visible notification: iOS and Chrome revoke the
 * subscription of a site that receives a push and shows nothing.
 *
 * Payload (JSON, built by vrm_api/alerts_delivery.py): { title, body, url, tag,
 * severity }. `tag` makes a later notice about the same alert replace the
 * earlier one; `url` is a path on this site.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'VRM Monitor';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined;
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag,
    renotify: Boolean(tag), // a replacement alert should still buzz the phone
    requireInteraction: data.severity === 'critical', // stays up until dismissed (ignored on iOS)
    data: { url: typeof data.url === 'string' ? data.url : '/app/alerts' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Same-origin only: whatever the payload says, a tap can never send the user
  // to another site.
  const requested = new URL((event.notification.data && event.notification.data.url) || '/app/alerts', self.location.origin);
  const url = requested.origin === self.location.origin ? requested.href : self.location.origin + '/app/alerts';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(url);
            } catch {
              /* navigating an uncontrolled window can be refused; focusing it is enough */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
