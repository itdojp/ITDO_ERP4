const CACHE_NAME = 'erp4-pwa-v1';
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
const OFFLINE_URL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request);
          if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(OFFLINE_URL, response.clone()).catch(() => undefined);
          }
          return response;
        } catch {
          const cached = await caches.match(OFFLINE_URL);
          return (
            cached ||
            new Response('offline', { status: 503, statusText: 'Offline' })
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone()).catch(() => undefined);
        }
        return response;
      } catch {
        return (
          cached ||
          new Response('offline', { status: 503, statusText: 'Offline' })
        );
      }
    })(),
  );
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'ERP4',
    body: '',
    url: '/',
    icon: '/icon.svg',
  };
  if (event.data) {
    try {
      const data = event.data.json();
      payload = { ...payload, ...data };
    } catch {
      payload.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'ERP4', {
      body: payload.body,
      icon: payload.icon || '/icon.svg',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'PUSH_TEST') return;
  const payload = data.payload || {};
  event.waitUntil(
    self.registration.showNotification(payload.title || 'ERP4', {
      body: payload.body || '',
      icon: payload.icon || '/icon.svg',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(
      (clientList) => {
        for (const client of clientList) {
          if (client.url.includes(targetUrl) && 'focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      },
    ),
  );
});
