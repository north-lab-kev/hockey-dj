/**
 * sw.js
 * Service worker that makes every page load use the latest deployed files (SPEC §4.8, U-1).
 * Each same-origin request is revalidated with the server instead of being taken from the
 * browser cache. Unchanged files come back as a quick 304. There is no offline mode.
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(new Request(request, { cache: 'no-cache' })).catch(() => fetch(request)));
});
