'use strict';

const CACHE_NAME = 'dansik-pwa-v1.0.113';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './compact.css',
  './core.js',
  './activity.js',
  './sync.js',
  './qr.js',
  './activity-ui.js',
  './weight.js',
  './vendor/jsQR.js',
  './meal-foods.js',
  './i18n.js',
  './csv.js',
  './portable-backup.js',
  './pwa.js',
  './renderer.js',
  './pwa-fit.js',
  './manifest.json',
  './app-icon.png',
  './app-icon.svg',
  './fonts/PretendardVariable.ttf',
  './fonts/NunitoTimerBold.ttf'
];

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'DANSIK_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ cache: CACHE_NAME });
  }
});

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(async url => {
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok) throw new Error(`Failed to cache ${url}`);
        await cache.put(url, response);
      }))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('dansik-pwa-v') && key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const open = windows.find(client => client.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(self.registration.scope);
  }));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || !requestUrl.href.startsWith(self.registration.scope)) return;
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    }).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(event.request) || Response.error();
    })
  );
});
