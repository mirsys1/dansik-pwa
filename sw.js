'use strict';

const CACHE_NAME = 'dansik-pwa-v1.0.29';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './compact.css',
  './core.js',
  './i18n.js',
  './csv.js',
  './pwa.js',
  './renderer.js',
  './pwa-fit.js',
  './manifest.json',
  './app-icon.png',
  './app-icon.svg',
  './fonts/PretendardVariable.ttf'
];

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'DANSIK_VERSION' && event.ports[0]) {
    event.ports[0].postMessage({ cache: CACHE_NAME });
  }
});

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url => fetch(url, { cache: 'reload' }).then(res => cache.put(url, res))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
