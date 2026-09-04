/**
 * Servidor HTTP estático ultraligero en Node.js nativo (sin dependencias externas).
 * Diseñado para previsualizar localmente el frontend de la aplicación.
 *
 * Tiene dos modos:
 *
 *   node server.js            Sirve `frontend/` tal cual. Las llamadas salen al
 *                             backend real de Apps Script configurado en
 *                             `js/config.js`.
 *
 *   node server.js --demo     Además levanta un backend simulado en memoria y
 *                             sirve la aplicación apuntada contra él. No hace
 *                             falta Firebase, ni planilla, ni tener un negocio
 *                             dado de alta.
 *
 * El modo demo NO modifica ningún archivo: intercambia dos respuestas al vuelo
 * (`js/config.js` y `js/auth.js`) y deja el disco intacto. Es deliberado —
 * un modo de prueba que edita los archivos de producción tarde o temprano se
 * commitea sin querer.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const DEMO = process.argv.includes('--demo') || process.env.DEMO === '1';

const PUERTO = process.env.PORT || (DEMO ? 4000 : 3000);
const DIRECTORIO_FRONTEND = path.join(__dirname, 'frontend');
const DIRECTORIO_DEMO = path.join(__dirname, 'demo');

// Mapa de tipos MIME esenciales para servir los assets del frontend
const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * Responde con `Content-Length` explícito.
 *
 * Sin él Node manda `Transfer-Encoding: chunked`, y Chrome se niega a registrar
 * un Service Worker cuyo script llega así: falla con "An unknown error occurred
 * when fetching the script" y la PWA queda sin probar en local, que es
 * justamente donde hay que probarla.
 */
function responder(respuesta, codigo, cabeceras, cuerpo) {
  const buffer = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(String(cuerpo), 'utf-8');
  respuesta.writeHead(codigo, Object.assign({ 'Content-Length': buffer.length }, cabeceras));
  respuesta.end(buffer);
}

// ---------------------------------------------------------------------------
// Modo demo
// ---------------------------------------------------------------------------

const backendDemo = DEMO
  ? require('./demo/backend-simulado.js').crear({ turnstile: process.env.DEMO_TURNSTILE === '1' })
  : null;

/**
 * Latencia simulada del backend.
 *
 * Apps Script arranca en frío y la primera llamada tarda entre uno y tres
 * segundos. Responder al instante haría que los esqueletos de carga, la barra
 * de actividad y los estados intermedios nunca se vean — que son justamente
 * los que hay que mirar en una demo.
 */
const LATENCIA_MS = Number(process.env.DEMO_LATENCIA || 250);

function responderJson(respuesta, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  setTimeout(() => {
    responder(respuesta, 200, {
      // Apps Script responde SIEMPRE 200: el éxito o el error viajan en el
      // cuerpo. Replicarlo es lo que hace que el cliente de API se comporte acá
      // igual que en producción.
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, texto);
  }, LATENCIA_MS);
}

/** Endpoint `/exec`: la misma superficie que el Web App de Apps Script. */
function manejarExec(solicitud, respuesta, url) {
  if (solicitud.method === 'GET') {
    const params = {};
    url.searchParams.forEach((valor, clave) => { params[clave] = valor; });
    responderJson(respuesta, backendDemo.despachar('GET', params));
    return;
  }

  if (solicitud.method !== 'POST') {
    responderJson(respuesta, { ok: false, error: { codigo: 'ACCION_DESCONOCIDA', mensaje: 'Método no soportado.' } });
    return;
  }

  let cuerpo = '';
  solicitud.on('data', (trozo) => { cuerpo += trozo; });
  solicitud.on('end', () => {
    let params;
    try {
      params = JSON.parse(cuerpo);
    } catch (err) {
      // Mismo error que devuelve `parametrosPost_` en producción.
      responderJson(respuesta, {
        ok: false,
        error: { codigo: 'ENTRADA_INVALIDA', mensaje: 'El cuerpo del pedido no es JSON válido.' }
      });
      return;
    }
    responderJson(respuesta, backendDemo.despachar('POST', params && typeof params === 'object' ? params : {}));
  });
}

/**
 * Archivos que en modo demo se sirven distintos de lo que hay en disco.
 *
 * - `js/config.js` se reescribe para que `URL_BACKEND` apunte al `/exec` local.
 * - `js/auth.js` se reemplaza por la sesión simulada, porque entrar de verdad
 *   pide Firebase con `localhost` autorizado y una cuenta ya creada.
 * - `sw.js` cambia de nombre de caché para que el modo demo y el normal no
 *   compartan copias guardadas en el mismo origen: sin eso, alternar entre
 *   `npm start` y `npm run demo` deja código del otro modo en el caché.
 */
function servirReemplazoDemo(rutaRelativa) {
  if (rutaRelativa === '/js/config.js') {
    const original = fs.readFileSync(path.join(DIRECTORIO_FRONTEND, 'js', 'config.js'), 'utf-8');
    // Absoluta y no '/exec' a secas: `api.js` arma las lecturas con
    // `new URL(URL_BACKEND)`, que sin origen tira "Invalid URL" y deja toda la
    // pantalla en "No pudimos conectarnos con el servidor".
    return original.replace(
      /URL_BACKEND:\s*'[^']*'/,
      "URL_BACKEND: location.origin + '/exec'   /* MODO DEMO: backend simulado en memoria */");
  }

  if (rutaRelativa === '/js/auth.js') {
    return fs.readFileSync(path.join(DIRECTORIO_DEMO, 'auth-simulado.js'), 'utf-8');
  }

  if (rutaRelativa === '/sw.js') {
    const original = fs.readFileSync(path.join(DIRECTORIO_FRONTEND, 'sw.js'), 'utf-8');
    return original.replace(/(const CACHE_NAME = '[^']*)'/, "$1-demo'");
  }

  return null;
}

// ---------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------

function manejarSolicitud(solicitud, respuesta) {
  const url = new URL(solicitud.url || '/', 'http://localhost');
  let rutaRelativa = decodeURIComponent(url.pathname);

  if (DEMO && rutaRelativa === '/exec') {
    manejarExec(solicitud, respuesta, url);
    return;
  }

  if (rutaRelativa === '/' || rutaRelativa === '') {
    rutaRelativa = '/index.html';
  }

  if (DEMO) {
    const reemplazo = servirReemplazoDemo(rutaRelativa);
    if (reemplazo !== null) {
      responder(respuesta, 200, {
        'Content-Type': TIPOS_MIME['.js'],
        'Cache-Control': 'no-store'
      }, reemplazo);
      return;
    }
  }

  const rutaArchivo = path.normalize(path.join(DIRECTORIO_FRONTEND, rutaRelativa));

  // Validación de seguridad: evitar path traversal fuera del directorio frontend
  if (!rutaArchivo.startsWith(DIRECTORIO_FRONTEND)) {
    responder(respuesta, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, '403 Acceso denegado');
    return;
  }

  fs.stat(rutaArchivo, (errorStat, stats) => {
    if (errorStat) {
      responder(respuesta, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, '404 Archivo no encontrado');
      return;
    }

    let rutaDestino = rutaArchivo;
    if (stats.isDirectory()) {
      rutaDestino = path.join(rutaArchivo, 'index.html');
    }

    fs.readFile(rutaDestino, (errorLectura, contenido) => {
      if (errorLectura) {
        responder(respuesta, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, '404 Archivo no encontrado');
        return;
      }

      const extension = path.extname(rutaDestino).toLowerCase();
      const tipoMime = TIPOS_MIME[extension] || 'application/octet-stream';

      responder(respuesta, 200, { 'Content-Type': tipoMime }, contenido);
    });
  });
}

function iniciarServidor(puerto) {
  const srv = http.createServer(manejarSolicitud);
  srv.listen(puerto, () => {
    console.log('==================================================');
    console.log(` Servidor local activo en: http://localhost:${puerto}`);
    if (DEMO) console.log(' MODO DEMO: backend simulado en memoria, sin Google.');
    console.log('==================================================');
    console.log(' Enlaces disponibles:');
    console.log(` - Hub de pruebas / Demo:        http://localhost:${puerto}/_demo.html`);
    console.log(` - Pantalla de Reserva Cliente:  http://localhost:${puerto}/index.html?n=demo`);
    console.log(` - Panel de Administración:      http://localhost:${puerto}/panel.html`);
    console.log('==================================================');
    if (DEMO) {
      console.log(' El negocio de ejemplo es "demo": dos profesionales con');
      console.log(' horarios distintos, cuatro servicios, turnos en varios');
      console.log(' estados, un bloqueo y un teléfono en la lista negra.');
      console.log(' El panel entra con cualquier correo y 6 caracteres de clave.');
      console.log(' Todo vive en memoria: se reinicia con el servidor.');
      console.log('==================================================');
    }
  });

  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(` El puerto ${puerto} está ocupado. Intentando en http://localhost:${puerto + 1}...`);
      iniciarServidor(puerto + 1);
    } else {
      console.error('Error al iniciar el servidor:', err);
    }
  });
}

iniciarServidor(Number(PUERTO));
