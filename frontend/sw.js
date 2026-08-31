/**
 * Service Worker para soporte PWA y carga instantánea de recursos estáticos.
 */

const CACHE_NAME = 'app-turno-cache-v1';
const RECURSOS_ESTATICOS = [
  './',
  './index.html',
  './panel.html',
  './css/estilo.css',
  './css/componentes.css',
  './js/config.js',
  './js/ui.js',
  './js/api.js',
  './js/auth.js',
  './js/reserva.js',
  './js/panel-agenda.js',
  './js/panel-servicios.js',
  './js/panel-equipo.js',
  './js/panel-bloqueos.js',
  './js/panel-clientes.js',
  './js/panel-estadisticas.js',
  './js/panel-ajustes.js',
  './js/panel.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(RECURSOS_ESTATICOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(
        claves.map((clave) => {
          if (clave !== CACHE_NAME) return caches.delete(clave);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // No interceptar peticiones a Apps Script, Firebase o APIs externas
  if (url.origin !== self.location.origin || e.request.method !== 'GET') {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clon = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clon));
        }
        return networkResponse;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
