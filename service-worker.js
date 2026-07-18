'use strict';

const CACHE_NAME = 'tavern-tactician-shell-v3';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './engines.js',
  './app.js',
  './solver-worker.js',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const shellUrls = new Set(APP_SHELL.map((path) => new URL(path, self.registration.scope).href));
const navigationFallback = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name.startsWith('tavern-tactician-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => cache.match(navigationFallback))
        .then((cached) => cached || fetch(request)),
    );
    return;
  }

  if (!shellUrls.has(requestUrl.href)) return;
  event.respondWith(
    caches.open(CACHE_NAME)
      .then((cache) => cache.match(request, { ignoreSearch: true }))
      .then((cached) => cached || fetch(request)),
  );
});
