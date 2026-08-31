/**
 * Service Worker para soporte PWA y carga instantánea de recursos estáticos.
 *
 * La estrategia NO es la misma para todo, y esa es la decisión central del
 * archivo:
 *
 * - El HTML y el JavaScript van por RED PRIMERO. Con cache primero, una app
 *   instalada en el celular se queda servida desde el disco y no ve una versión
 *   nueva nunca: el usuario abre el ícono, el Service Worker le devuelve el
 *   HTML viejo, y la corrección que se publicó ayer no llega. Ese fue el
 *   comportamiento hasta esta versión.
 *
 * - Las imágenes, las fuentes y el manifest van por CACHE PRIMERO con
 *   revalidación en segundo plano. Casi nunca cambian y son los que hacen que
 *   la primera pantalla se dibuje al instante.
 *
 * Nada de esto toca las llamadas a Apps Script ni a Firebase: se descartan por
 * origen antes de decidir cualquier estrategia.
 */

const CACHE_NAME = 'app-turno-cache-v6';

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
  './img/poste-barbero.svg',
  './img/icono-180.png',
  './img/icono-192.png',
  './img/icono-512.png',
  './img/icono-maskable-512.png',
  './manifest.json',
  './manifest-panel.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // `addAll` falla entera si un solo recurso da 404, y con eso el Service
      // Worker no se instala. Se piden de a uno para que un archivo que todavía
      // no se subió no tire abajo la instalación completa.
      .then((cache) => Promise.all(
        RECURSOS_ESTATICOS.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(claves.map((clave) => (clave === CACHE_NAME ? null : caches.delete(clave))))
    ).then(() => self.clients.claim())
  );
});

/**
 * HTML, JS y CSS son el código de la app: siempre se prefiere el de la red.
 *
 * El CSS entra en esta bolsa aunque sea tentador cachearlo: con revalidación en
 * segundo plano, un cambio de estilo aparece recién en la SEGUNDA carga, y el
 * síntoma es el peor posible — se publica un arreglo, se abre la página, y sigue
 * viéndose el problema. Lo que se gana cacheándolo es una request de un archivo
 * chico; lo que se pierde es poder confiar en lo que uno ve.
 */
function esCodigoDeLaApp(peticion, url) {
  return peticion.mode === 'navigate' ||
    peticion.destination === 'document' ||
    peticion.destination === 'script' ||
    peticion.destination === 'style' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.css');
}

function guardarEnCache(peticion, respuesta) {
  if (!respuesta || respuesta.status !== 200 || respuesta.type !== 'basic') return respuesta;
  const clon = respuesta.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(peticion, clon));
  return respuesta;
}

/**
 * Busca en el caché ignorando la query string como último recurso.
 *
 * La pantalla del cliente se abre siempre como `index.html?n=barberia`, y esa
 * URL exacta no está guardada: sin `ignoreSearch` una app instalada no abre
 * nada estando sin señal, que es justamente cuando el caché tendría que servir.
 */
function buscarEnCache(peticion) {
  return caches.match(peticion).then((exacta) =>
    exacta || caches.match(peticion, { ignoreSearch: true }));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // No interceptar peticiones a Apps Script, Firebase o APIs externas.
  if (url.origin !== self.location.origin || e.request.method !== 'GET') {
    return;
  }

  if (esCodigoDeLaApp(e.request, url)) {
    e.respondWith(
      fetch(e.request)
        .then((respuesta) => guardarEnCache(e.request, respuesta))
        // Sin red se cae al caché; si tampoco está, se deja pasar el error para
        // que el navegador muestre su propia pantalla de "sin conexión".
        .catch(() => buscarEnCache(e.request).then((cacheada) => {
          if (cacheada) return cacheada;
          throw new Error('Sin red y sin copia en caché de ' + url.pathname);
        }))
    );
    return;
  }

  // Recursos estáticos: se sirve la copia guardada y se revalida por detrás.
  e.respondWith(
    buscarEnCache(e.request).then((cacheada) => {
      const desdeLaRed = fetch(e.request)
        .then((respuesta) => guardarEnCache(e.request, respuesta))
        .catch(() => cacheada);
      return cacheada || desdeLaRed;
    })
  );
});
