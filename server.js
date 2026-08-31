/**
 * Servidor HTTP estático ultraligero en Node.js nativo (sin dependencias externas).
 * Diseñado para previsualizar localmente el frontend de la aplicación.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUERTO = process.env.PORT || 3000;
const DIRECTORIO_FRONTEND = path.join(__dirname, 'frontend');

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

const servidor = http.createServer((solicitud, respuesta) => {
  // Extrae la ruta sin parámetros de consulta (query string)
  const urlSinParametros = (solicitud.url || '/').split('?')[0];
  let rutaRelativa = decodeURIComponent(urlSinParametros);

  if (rutaRelativa === '/' || rutaRelativa === '') {
    rutaRelativa = '/index.html';
  }

  const rutaArchivo = path.normalize(path.join(DIRECTORIO_FRONTEND, rutaRelativa));

  // Validación de seguridad: evitar path traversal fuera del directorio frontend
  if (!rutaArchivo.startsWith(DIRECTORIO_FRONTEND)) {
    respuesta.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    respuesta.end('403 Acceso denegado');
    return;
  }

  fs.stat(rutaArchivo, (errorStat, stats) => {
    if (errorStat) {
      respuesta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      respuesta.end('404 Archivo no encontrado');
      return;
    }

    let rutaDestino = rutaArchivo;
    if (stats.isDirectory()) {
      rutaDestino = path.join(rutaArchivo, 'index.html');
    }

    fs.readFile(rutaDestino, (errorLectura, contenido) => {
      if (errorLectura) {
        respuesta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        respuesta.end('404 Archivo no encontrado');
        return;
      }

      const extension = path.extname(rutaDestino).toLowerCase();
      const tipoMime = TIPOS_MIME[extension] || 'application/octet-stream';

      respuesta.writeHead(200, { 'Content-Type': tipoMime });
      respuesta.end(contenido);
    });
  });
});

servidor.listen(PUERTO, () => {
  console.log('==================================================');
  console.log(` Servidor local activo en: http://localhost:${PUERTO}`);
  console.log('==================================================');
  console.log(' Enlaces disponibles:');
  console.log(` - Demo interactiva (datos mock): http://localhost:${PUERTO}/_demo.html`);
  console.log(` - Reserva cliente:              http://localhost:${PUERTO}/index.html`);
  console.log(` - Panel de administración:      http://localhost:${PUERTO}/panel.html`);
  console.log('==================================================');
});
