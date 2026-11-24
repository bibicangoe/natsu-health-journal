const cacheName = 'wellness-journal-1.0.0';
const files = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('wellness-journal-') && key !== cacheName).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !files.some(path => new URL(path, self.registration.scope).href === url.href)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => response.ok ? response : caches.match('./')).catch(() => caches.match('./')));
    return;
  }
  event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});
