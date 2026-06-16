const CACHE_NAME = 'alashool-v3';
const urlsToCache = [
  '/',
  'index.html',
  'style.css',
  'app.js',
  'https://unpkg.com/dexie/dist/dexie.js',
  'https://unpkg.com/jspdf/dist/jspdf.umd.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});