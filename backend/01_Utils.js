/**
 * Utilidades transversales: errores, respuestas, identificadores, tiempo y
 * normalización de entrada.
 */

/** Error de aplicación con código de la API. */
function errorApp_(codigo, mensaje) {
  var e = new Error(mensaje || codigo);
  e.codigoApp = codigo;
  return e;
}

/** Respuesta exitosa del contrato de la API. */
function ok_(data) {
  return { ok: true, data: data === undefined ? null : data };
}

/** Respuesta de error del contrato de la API. */
function fallo_(codigo, mensaje) {
  return { ok: false, error: { codigo: codigo, mensaje: mensaje || codigo } };
}

/**
 * Serializa la respuesta.
 *
 * Apps Script siempre responde HTTP 200: `ContentService` no permite fijar el
 * código de estado. Por eso el éxito o el fracaso viajan SIEMPRE en el cuerpo,
 * y el frontend nunca debe mirar `response.status`.
 */
function responder_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Identificador aleatorio con prefijo, sin secuencias adivinables. */
function nuevoId_(prefijo) {
  return prefijo + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

/**
 * Código de ticket de 10 caracteres sobre un alfabeto sin caracteres ambiguos.
 * Es el único secreto que protege al turno, por eso no se deriva del id.
 */
function nuevoCodigoTicket_() {
  var bytes = Utilities.getUuid().replace(/-/g, '');
  var salida = '';
  for (var i = 0; i < LARGO_TICKET; i++) {
    var n = parseInt(bytes.substr(i * 2, 2), 16);
    salida += ALFABETO_TICKET.charAt(n % ALFABETO_TICKET.length);
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Tiempo
// ---------------------------------------------------------------------------

/** Fecha de hoy en la zona horaria dada, como "YYYY-MM-DD". */
function hoyEnZona_(zona) {
  return Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
}

/** Hora actual en la zona horaria dada, como "HH:mm". */
function ahoraEnZona_(zona) {
  return Utilities.formatDate(new Date(), zona, 'HH:mm');
}

/** Día de la semana (0=domingo … 6=sábado) de una fecha "YYYY-MM-DD". */
function diaSemanaDeFecha_(fechaIso) {
  var p = fechaIso.split('-');
  // Date.UTC evita que la zona horaria del script corra el día.
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
}

/** Suma días a una fecha "YYYY-MM-DD" y devuelve otra "YYYY-MM-DD". */
function sumarDias_(fechaIso, dias) {
  var p = fechaIso.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  d.setUTCDate(d.getUTCDate() + dias);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

/** Diferencia en días entre dos fechas ISO (b - a). */
function diferenciaDias_(fechaIsoA, fechaIsoB) {
  var a = fechaIsoA.split('-');
  var b = fechaIsoB.split('-');
  var da = Date.UTC(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
  var db = Date.UTC(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
  return Math.round((db - da) / 86400000);
}

/** Timestamp ISO en UTC, para auditoría. */
function ahoraIso_() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Validación y normalización de entrada
// ---------------------------------------------------------------------------

var RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
var RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

function esFechaValida_(valor) {
  if (typeof valor !== 'string' || !RE_FECHA.test(valor)) return false;
  var p = valor.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function esHoraValida_(valor) {
  return typeof valor === 'string' && RE_HORA.test(valor);
}

/** Exige un texto no vacío y lo recorta al largo máximo. */
function exigirTexto_(params, campo, largoMax) {
  var valor = params[campo];
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'Falta el campo "' + campo + '".');
  }
  return valor.trim().slice(0, largoMax || 200);
}

function exigirFecha_(params, campo) {
  var valor = params[campo];
  if (!esFechaValida_(valor)) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'El campo "' + campo + '" debe tener el formato YYYY-MM-DD.');
  }
  return valor;
}

function exigirHora_(params, campo) {
  var valor = params[campo];
  if (!esHoraValida_(valor)) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'El campo "' + campo + '" debe tener el formato HH:mm.');
  }
  return valor;
}

function exigirEntero_(params, campo, minimo, maximo) {
  var n = Number(params[campo]);
  if (!isFinite(n) || Math.floor(n) !== n || n < minimo || n > maximo) {
    throw errorApp_(ERR.ENTRADA_INVALIDA,
      'El campo "' + campo + '" debe ser un entero entre ' + minimo + ' y ' + maximo + '.');
  }
  return n;
}

function esZonaHorariaValida_(zona) {
  if (typeof zona !== 'string' || zona.trim() === '') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zona.trim() });
    return true;
  } catch (err) {
    return false;
  }
}

function exigirZonaHoraria_(params, campo) {
  var valor = params[campo];
  if (!esZonaHorariaValida_(valor)) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'La zona horaria no parece válida. Usá un formato IANA como America/Argentina/Buenos_Aires.');
  }
  return valor.trim();
}

/**
 * Normaliza un teléfono a solo dígitos.
 * La comparación con la lista negra y el rate limiting usan esta forma, para
 * que "11 2345-6789" y "1123456789" sean el mismo número.
 */
function normalizarTelefono_(valor) {
  var soloDigitos = String(valor || '').replace(/\D/g, '');
  if (soloDigitos.length < 6 || soloDigitos.length > 20) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'El teléfono no parece válido.');
  }
  return soloDigitos;
}

/** Convierte un nombre de negocio en un slug apto para la URL. */
function generarSlug_(texto) {
  var base = String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'negocio';
}

/** Ejecuta `fn` dentro del lock global del script. Ver sección 8 del doc. */
function conLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LIMITES.ESPERA_LOCK_MS)) {
    throw errorApp_(ERR.SISTEMA_OCUPADO, 'El sistema está ocupado. Probá de nuevo en unos segundos.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
