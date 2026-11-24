// Omnisoft Gym — service worker: εγκατάσταση ως εφαρμογή και λειτουργία χωρίς σύνδεση για το «κέλυφος».
// Πρώτα δίκτυο (για να φαίνονται αμέσως οι ενημερώσεις), αποθήκη μόνο όταν δεν υπάρχει σύνδεση.
// Τα δεδομένα (Supabase) δεν αποθηκεύονται ποτέ εδώ.
const CACHE = 'gym-v16';
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'stickman.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const own = url.origin === self.location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net';
  if (!own && !cdn) return;                      // Supabase κ.λπ.: κατευθείαν στο δίκτυο
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: own }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
