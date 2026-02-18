const CACHE_NAME = 'erp4-pwa-v2';
const CORE_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
const OFFLINE_URL = '/index.html';
const STATIC_CACHE_PATHS = new Set(CORE_ASSETS);
const STATIC_CACHE_PREFIXES = ['/assets/'];

function isApiLikePath(pathname) {
  const lowerPath = pathname.toLowerCase();
  return (
    lowerPath.startsWith('/api') ||
    lowerPath.startsWith('/health') ||
    lowerPath.startsWith('/healthz') ||
    lowerPath.startsWith('/ready') ||
    lowerPath.startsWith('/readyz')
  );
}

function isStaticAssetRequest(request, url) {
  if (request.mode === 'navigate') return false;
  if (isApiLikePath(url.pathname)) return false;
  if (STATIC_CACHE_PATHS.has(url.pathname)) return true;
  return STATIC_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function canStoreResponse(response) {
  if (!response || !response.ok) return false;
  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
    return false;
  }
  return true;
}

function normalizeNotificationPath(value) {
  if (typeof value !== 'string') return '/';
  const trimmed = value.trim();
  if (!trimmed || !trimmed.startsWith('/')) return '/';
  try {
    const resolved = new URL(trimmed, self.location.origin);
    if (resolved.origin !== self.location.origin) return '/';
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return '/';
  }
}

function getNotificationPayload(value) {
  const base = {
    title: 'ERP4',
    body: '',
    url: '/',
    icon: '/icon.svg',
  };
  if (!value || typeof value !== 'object') return base;
  const data = value;
  return {
    title: typeof data.title === 'string' ? data.title : base.title,
    body: typeof data.body === 'string' ? data.body : base.body,
    icon: typeof data.icon === 'string' ? data.icon : base.icon,
    url: normalizeNotificationPath(data.url),
  };
}

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
          if (canStoreResponse(response)) {
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

  if (!isStaticAssetRequest(event.request, url)) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (canStoreResponse(response)) {
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
  let payload = getNotificationPayload();
  if (event.data) {
    try {
      payload = getNotificationPayload(event.data.json());
    } catch {
      payload = {
        ...payload,
        body: event.data.text(),
      };
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'ERP4', {
      body: payload.body,
      icon: payload.icon || '/icon.svg',
      data: { url: normalizeNotificationPath(payload.url) },
    }),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'PUSH_TEST') return;
  const payload = getNotificationPayload(data.payload || {});
  event.waitUntil(
    self.registration.showNotification(payload.title || 'ERP4', {
      body: payload.body,
      icon: payload.icon || '/icon.svg',
      data: { url: normalizeNotificationPath(payload.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = normalizeNotificationPath(event.notification?.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(
      (clientList) => {
        const target = new URL(targetPath, self.location.origin);
        for (const client of clientList) {
          let clientUrl;
          try {
            clientUrl = new URL(client.url);
          } catch {
            continue;
          }
          if (
            clientUrl.origin === target.origin &&
            clientUrl.pathname === target.pathname &&
            'focus' in client
          ) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target.toString());
        }
        return undefined;
      },
    ),
  );
});
