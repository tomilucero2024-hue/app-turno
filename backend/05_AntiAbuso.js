/**
 * Capas anti-abuso del MVP.
 *
 * Lo que NO se puede hacer acá: limitar por IP. Apps Script no expone la IP del
 * cliente en el objeto `e` de doPost ni en ningún otro lado. Como el límite por
 * teléfono se esquiva escribiendo otro número, Turnstile es la capa que
 * realmente sostiene el sistema; el resto son complementos.
 */

var URL_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifica el token de Cloudflare Turnstile.
 * Si no hay secreto configurado, la verificación queda desactivada — útil en
 * desarrollo, pero hay que cargarlo antes de publicar.
 */
function verificarTurnstile_(token) {
  var secreto = secretoTurnstile_();
  if (!secreto) return;

  if (typeof token !== 'string' || !token) {
    throw errorApp_(ERR.VERIFICACION_FALLIDA, 'Falta la verificación anti-spam.');
  }

  var respuesta = UrlFetchApp.fetch(URL_TURNSTILE, {
    method: 'post',
    payload: { secret: secreto, response: token },
    muteHttpExceptions: true
  });

  var aprobado = false;
  try {
    aprobado = JSON.parse(respuesta.getContentText()).success === true;
  } catch (err) {
    aprobado = false;
  }

  if (!aprobado) {
    throw errorApp_(ERR.VERIFICACION_FALLIDA, 'No pudimos verificar que seas una persona. Recargá la página y probá de nuevo.');
  }
}

/**
 * Contador de intentos en una ventana de tiempo, sobre CacheService.
 *
 * Es deliberadamente best-effort: CacheService retiene como máximo 6 horas y
 * puede desalojar entradas antes de tiempo, y el par leer-escribir no es
 * atómico, así que bajo concurrencia alta puede dejar pasar algún intento de
 * más. Para rate limiting eso es aceptable — el peor caso es que el límite se
 * afloje un rato. Nunca debe usarse para datos que tengan que ser confiables.
 *
 * @returns {boolean} true si el intento está dentro del límite.
 */
function dentroDelLimite_(clave, maximo, ventanaSegundos) {
  var cache = CacheService.getScriptCache();
  var actual = Number(cache.get(clave) || 0);
  if (actual >= maximo) return false;
  cache.put(clave, String(actual + 1), ventanaSegundos);
  return true;
}

/** Límite de reservas por teléfono por hora. */
function limitarReservasPorTelefono_(idCuenta, telefono) {
  var clave = 'res_' + idCuenta + '_' + telefono;
  if (!dentroDelLimite_(clave, LIMITES.RESERVAS_POR_TELEFONO_POR_HORA, 3600)) {
    throw errorApp_(ERR.LIMITE_EXCEDIDO,
      'Ya reservaste varios turnos en la última hora. Si necesitás otro, comunicate con el negocio.');
  }
}

/**
 * Límite de consultas fallidas de código de ticket.
 * Es lo que hace inviable la fuerza bruta sobre el código de 10 caracteres.
 */
function limitarConsultasTicket_(idCuenta) {
  var clave = 'tick_' + idCuenta;
  if (!dentroDelLimite_(clave, LIMITES.CONSULTAS_TICKET_FALLIDAS_POR_HORA, 3600)) {
    throw errorApp_(ERR.LIMITE_EXCEDIDO, 'Demasiados intentos. Esperá un rato antes de volver a probar.');
  }
}

/** Verdadero si el teléfono está en la lista negra del negocio. */
function estaEnListaNegra_(ss, telefono) {
  var filas = leerHoja_(ss, 'Lista_negra');
  for (var i = 0; i < filas.length; i++) {
    if (normalizarTelefonoSuave_(filas[i].telefono) === telefono) return true;
  }
  return false;
}

/** Como normalizarTelefono_ pero sin lanzar: los datos ya guardados pueden ser cualquier cosa. */
function normalizarTelefonoSuave_(valor) {
  return String(valor || '').replace(/\D/g, '');
}
