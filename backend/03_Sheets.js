/**
 * Capa de acceso a datos sobre Google Sheets.
 *
 * Las filas se mapean por NOMBRE de columna, leyendo la fila 1 como cabecera,
 * en vez de por índice fijo. Es más lento por un getRange extra, pero significa
 * que si alguien reordena o inserta una columna a mano en la planilla, el
 * backend sigue funcionando en lugar de escribir datos en la columna equivocada.
 */

// ---------------------------------------------------------------------------
// Caché
// ---------------------------------------------------------------------------

/**
 * Caché corta sobre CacheService.
 *
 * Cada llamada a la API abre la planilla maestra y lee la hoja `Cuentas` entera
 * solo para traducir un slug o un uid en una cuenta. Medido contra el
 * deployment real, esa resolución cuesta entre medio segundo y un segundo, y se
 * paga en TODOS los endpoints, incluidos los públicos. Guardarla unos minutos
 * es la mejora de latencia más grande que se puede hacer sin cambiar la
 * arquitectura.
 *
 * La caché es del script, no del usuario: la comparten todas las ejecuciones,
 * que es justo lo que se quiere acá. Nunca se guardan ausencias: si un slug no
 * existe todavía, la próxima llamada tiene que poder encontrarlo.
 */
var TTL_CACHE_SEG = 300;

function cacheLeer_(clave) {
  try {
    var crudo = CacheService.getScriptCache().get(clave);
    return crudo ? JSON.parse(crudo) : null;
  } catch (err) {
    // Un fallo de caché nunca puede tumbar un pedido: se sigue contra la
    // planilla, que es la fuente de verdad.
    return null;
  }
}

function cacheGuardar_(clave, valor, segundos) {
  try {
    CacheService.getScriptCache().put(clave, JSON.stringify(valor), segundos || TTL_CACHE_SEG);
  } catch (err) {
    console.warn('No se pudo guardar en caché ' + clave + ': ' + err);
  }
}

function cacheOlvidar_(claves) {
  try {
    CacheService.getScriptCache().removeAll(claves);
  } catch (err) {
    console.warn('No se pudo limpiar la caché: ' + err);
  }
}

/**
 * Invalida todo lo cacheado de una cuenta.
 *
 * Se llama después de cada escritura que cambie lo que se sirve: configuración
 * del negocio, servicios y profesionales. Los turnos NO se cachean, así que una
 * reserva no necesita pasar por acá.
 */
function olvidarCacheDeCuenta_(cuenta) {
  if (!cuenta) return;
  cacheOlvidar_([
    'cuenta_slug_' + String(cuenta.slug || '').toLowerCase(),
    'cuenta_uid_' + String(cuenta.firebase_uid || ''),
    'negocio_' + String(cuenta.slug || '').toLowerCase()
  ]);
}

/** Abre una planilla por id. */
function abrirPlanilla_(spreadsheetId) {
  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (err) {
    throw errorApp_(ERR.INTERNO, 'No se pudo abrir la planilla ' + spreadsheetId + '.');
  }
}

/** Devuelve la hoja o lanza un error claro si falta. */
function hoja_(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  if (!h) {
    throw errorApp_(ERR.INTERNO, 'Falta la hoja "' + nombre + '" en la planilla.');
  }
  return h;
}

/**
 * Lee una hoja completa y devuelve las filas como objetos.
 *
 * Cada objeto incluye `_fila`: el número de fila real en la planilla (1-based),
 * necesario para poder actualizarla después sin volver a buscarla.
 *
 * Nota de rendimiento: esto lee la hoja entera. Para `Turnos` es O(n) sobre
 * todo el histórico del negocio. A escala de una barbería (miles de filas por
 * año) es holgadamente suficiente; si algún negocio crece mucho, el próximo
 * paso es archivar los turnos viejos en otra hoja, no complicar esta función.
 */
function leerHoja_(ss, nombre) {
  var h = hoja_(ss, nombre);
  var ultimaFila = h.getLastRow();
  var ultimaCol = h.getLastColumn();
  if (ultimaFila < 1 || ultimaCol < 1) return [];

  var valores = h.getRange(1, 1, ultimaFila, ultimaCol).getDisplayValues();
  var cabecera = valores[0];
  var filas = [];

  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i];
    var vacia = true;
    var obj = { _fila: i + 1 };
    for (var c = 0; c < cabecera.length; c++) {
      var clave = String(cabecera[c] || '').trim();
      if (!clave) continue;
      var valor = fila[c];
      obj[clave] = valor;
      if (String(valor).trim() !== '') vacia = false;
    }
    if (!vacia) filas.push(obj);
  }
  return filas;
}

/** Cabecera de una hoja, como array de nombres de columna. */
function cabecera_(ss, nombre) {
  var h = hoja_(ss, nombre);
  var ultimaCol = h.getLastColumn();
  if (ultimaCol < 1) return [];
  return h.getRange(1, 1, 1, ultimaCol).getValues()[0].map(function (v) {
    return String(v || '').trim();
  });
}

/** Columnas que deben guardarse como texto plano en una hoja dada. */
function columnasTextoDe_(nombreHoja) {
  if (nombreHoja === HOJA_CUENTAS) return CUENTAS_COLUMNAS_TEXTO;
  if (!Object.prototype.hasOwnProperty.call(ESQUEMAS_NEGOCIO, nombreHoja)) return [];
  return ESQUEMAS_NEGOCIO[nombreHoja].texto || [];
}

/**
 * Fuerza el formato "@" en las celdas de texto de una fila ANTES de escribirla.
 *
 * Tiene que ser antes: si primero se escribe "09:00" en una celda sin formato,
 * Sheets ya la convirtió en una hora, y aplicarle "@" después muestra el número
 * de serie en vez de arreglar nada.
 *
 * Lee los formatos actuales y solo escribe si falta alguno, así el caso normal
 * —una fila dentro del rango que ya formateó `prepararHoja_`— cuesta una sola
 * lectura. Importa porque esto corre dentro del lock al crear un turno.
 */
function fijarFormatoTexto_(h, columnas, columnasTexto, numeroFila) {
  if (!columnas.length || !columnasTexto.length) return;

  var rango = h.getRange(numeroFila, 1, 1, columnas.length);
  var formatos = rango.getNumberFormats()[0];
  var cambio = false;

  for (var i = 0; i < columnas.length; i++) {
    if (columnasTexto.indexOf(columnas[i]) !== -1 && formatos[i] !== '@') {
      formatos[i] = '@';
      cambio = true;
    }
  }

  if (cambio) rango.setNumberFormats([formatos]);
}

/**
 * Agrega una fila a partir de un objeto {columna: valor}.
 *
 * No usa `appendRow` porque el formato de las celdas tiene que quedar fijado
 * antes de escribir. `prepararHoja_` formatea las filas que existen al crear la
 * planilla —999 en una hoja nueva—, así que a partir del turno número mil las
 * filas nuevas caían fuera de ese rango: Sheets reinterpretaba la fecha y la
 * hora, y esa es la fila ilegible que después bloquea un día entero.
 */
function agregarFila_(ss, nombre, objeto) {
  var h = hoja_(ss, nombre);
  var cols = cabecera_(ss, nombre);
  if (!cols.length) {
    throw errorApp_(ERR.INTERNO, 'La hoja "' + nombre + '" no tiene cabecera.');
  }

  var valores = cols.map(function (col) {
    var v = objeto[col];
    return (v === undefined || v === null) ? '' : v;
  });

  var numeroFila = h.getLastRow() + 1;
  // Escribir más allá de la grilla existente falla, así que se agranda primero.
  if (numeroFila > h.getMaxRows()) {
    h.insertRowsAfter(h.getMaxRows(), 1);
  }

  fijarFormatoTexto_(h, cols, columnasTextoDe_(nombre), numeroFila);
  h.getRange(numeroFila, 1, 1, valores.length).setValues([valores]);

  return numeroFila;
}

/** Actualiza celdas puntuales de una fila ya localizada. */
function actualizarFila_(ss, nombre, numeroFila, parcial) {
  var h = hoja_(ss, nombre);
  var cols = cabecera_(ss, nombre);
  for (var clave in parcial) {
    if (!Object.prototype.hasOwnProperty.call(parcial, clave)) continue;
    var indice = cols.indexOf(clave);
    if (indice === -1) continue;
    h.getRange(numeroFila, indice + 1).setValue(parcial[clave]);
  }
}

/** Borra una fila por número. Se usa solo donde no hay histórico que preservar. */
function borrarFila_(ss, nombre, numeroFila) {
  hoja_(ss, nombre).deleteRow(numeroFila);
}

/** Verdadero si el valor de una celda "activo" cuenta como activo. */
function esActivo_(valor) {
  var v = String(valor === undefined || valor === null ? '' : valor).trim().toLowerCase();
  return v === '' || v === 'true' || v === 'si' || v === 'sí' || v === '1' || v === 'verdadero';
}

// ---------------------------------------------------------------------------
// Planilla maestra: hoja `Cuentas`
// ---------------------------------------------------------------------------

function planillaMaestra_() {
  return abrirPlanilla_(idPlanillaMaestra_());
}

function leerCuentas_() {
  return leerHoja_(planillaMaestra_(), HOJA_CUENTAS);
}

/** Normaliza una fila de `Cuentas` a los tipos que espera el resto del código. */
function normalizarCuenta_(fila) {
  if (!fila) return null;
  return {
    _fila: fila._fila,
    id_cuenta: String(fila.id_cuenta || ''),
    tipo: String(fila.tipo || 'independiente'),
    nombre_negocio: String(fila.nombre_negocio || ''),
    slug: String(fila.slug || ''),
    email: String(fila.email || ''),
    firebase_uid: String(fila.firebase_uid || ''),
    spreadsheet_id: String(fila.spreadsheet_id || ''),
    zona_horaria: String(fila.zona_horaria || DEFAULTS_CUENTA.zona_horaria),
    paso_grilla_min: Number(fila.paso_grilla_min) || DEFAULTS_CUENTA.paso_grilla_min,
    antelacion_min_horas: Number(fila.antelacion_min_horas) || DEFAULTS_CUENTA.antelacion_min_horas,
    cancelacion_min_horas: Number(fila.cancelacion_min_horas) || DEFAULTS_CUENTA.cancelacion_min_horas,
    margen_turno_min: Number(fila.margen_turno_min) || DEFAULTS_CUENTA.margen_turno_min,
    direccion: String(fila.direccion || ''),
    instagram: String(fila.instagram || ''),
    telefono_contacto: String(fila.telefono_contacto || ''),
    activo: esActivo_(fila.activo)
  };
}

/** Busca una cuenta activa por slug. */
function cuentaPorSlug_(slug) {
  var buscado = String(slug || '').trim().toLowerCase();
  if (!buscado) throw errorApp_(ERR.ENTRADA_INVALIDA, 'Falta el parámetro "slug".');

  var cacheada = cacheLeer_('cuenta_slug_' + buscado);
  if (cacheada) return cacheada;

  var filas = leerCuentas_();
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].slug || '').trim().toLowerCase() === buscado) {
      var cuenta = normalizarCuenta_(filas[i]);
      if (!cuenta.activo) break;
      cacheGuardar_('cuenta_slug_' + buscado, cuenta);
      return cuenta;
    }
  }
  throw errorApp_(ERR.NO_ENCONTRADO, 'No existe un negocio con ese identificador.');
}

/** Busca la cuenta asociada a un uid de Firebase. Devuelve null si no tiene. */
function cuentaPorUid_(uid) {
  var clave = 'cuenta_uid_' + String(uid);
  var cacheada = cacheLeer_(clave);
  if (cacheada) return cacheada;

  var filas = leerCuentas_();
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].firebase_uid || '').trim() === String(uid)) {
      var cuenta = normalizarCuenta_(filas[i]);
      if (!cuenta.activo) return null;
      cacheGuardar_(clave, cuenta);
      return cuenta;
    }
  }
  // La ausencia no se cachea a propósito: quien acaba de registrarse tiene que
  // encontrar su cuenta en la llamada siguiente, no dentro de cinco minutos.
  return null;
}

/** Abre la planilla propia de un negocio. */
function planillaDeCuenta_(cuenta) {
  if (!cuenta.spreadsheet_id) {
    throw errorApp_(ERR.INTERNO, 'La cuenta no tiene planilla asociada.');
  }
  return abrirPlanilla_(cuenta.spreadsheet_id);
}

// ---------------------------------------------------------------------------
// Creación de la planilla de un negocio
// ---------------------------------------------------------------------------

/**
 * Crea la planilla propia de un negocio con todas sus hojas y cabeceras.
 *
 * Una planilla por negocio (y no una pestaña dentro de una planilla común) da
 * aislamiento real: un bug de filtrado no puede mezclar los datos de dos
 * negocios, y ninguno se acerca al techo de 10 millones de celdas.
 */
function crearPlanillaNegocio_(nombreNegocio, zonaHoraria) {
  var ss = SpreadsheetApp.create('Turnos - ' + nombreNegocio);
  if (zonaHoraria) {
    try {
      ss.setSpreadsheetTimeZone(zonaHoraria);
    } catch (errZ) {
      console.warn('No se pudo fijar la zona horaria en la planilla: ' + errZ);
    }
  }

  for (var nombreHoja in ESQUEMAS_NEGOCIO) {
    if (!Object.prototype.hasOwnProperty.call(ESQUEMAS_NEGOCIO, nombreHoja)) continue;
    var esquema = ESQUEMAS_NEGOCIO[nombreHoja];
    var h = ss.insertSheet(nombreHoja);
    prepararHoja_(h, esquema.columnas, esquema.texto);
  }

  // La hoja por defecto que crea Sheets sobra.
  var porDefecto = ss.getSheets()[0];
  if (!ESQUEMAS_NEGOCIO[porDefecto.getName()]) {
    ss.deleteSheet(porDefecto);
  }

  var carpeta = carpetaNegocios_();
  if (carpeta) {
    try {
      DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(carpeta));
    } catch (err) {
      // Si la carpeta no existe la planilla queda en la raíz de Drive: es un
      // problema de prolijidad, no de funcionamiento. No vale abortar el alta.
      console.warn('No se pudo mover la planilla a la carpeta configurada: ' + err);
    }
  }

  return ss.getId();
}

/** Escribe la cabecera de una hoja y fija el formato de las columnas de texto. */
function prepararHoja_(h, columnas, columnasTexto) {
  h.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold');
  h.setFrozenRows(1);

  var texto = columnasTexto || [];
  for (var i = 0; i < columnas.length; i++) {
    if (texto.indexOf(columnas[i]) !== -1) {
      // "@" fuerza texto plano: sin esto Sheets convierte "09:00" en una hora
      // y "2026-03-04" en una fecha, y al releerlas cambian de tipo y de zona.
      h.getRange(2, i + 1, h.getMaxRows() - 1, 1).setNumberFormat('@');
    }
  }
  if (h.getMaxColumns() > columnas.length) {
    h.deleteColumns(columnas.length + 1, h.getMaxColumns() - columnas.length);
  }
}
