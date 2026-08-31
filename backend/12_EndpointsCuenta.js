/**
 * Grupo 3 — registro y configuración de la cuenta.
 *
 * Corrección de seguridad respecto del diseño original: `registrarCuenta` NO
 * recibe el `firebase_uid` desde el frontend. Si lo hiciera, cualquiera podría
 * enviar el uid de otra persona y crear o reclamar su negocio. El uid sale
 * siempre del token verificado.
 */

function epRegistrarCuenta_(params) {
  var ctx = contextoUsuario_(params);

  if (ctx.cuenta) {
    throw errorApp_(ERR.YA_REGISTRADO, 'Este usuario ya tiene un negocio registrado.');
  }

  // La clave de alta se valida ACA, antes de crear la planilla. El panel también
  // la pide, pero esa comprobación es solo comodidad: corre en el navegador del
  // usuario y no autoriza nada por sí sola.
  exigirClaveDeAlta_(params);

  var nombreNegocio = exigirTexto_(params, 'nombre_negocio', 80);
  var tipo = String(params.tipo || 'independiente');
  if (tipo !== 'independiente' && tipo !== 'barberia') {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'El tipo debe ser "independiente" o "barberia".');
  }

  // La creación de la planilla queda fuera del lock: es la parte lenta y no
  // compite con nadie. Adentro solo se resuelve el slug y se escribe la fila,
  // que es donde dos altas simultáneas podrían pisarse.
  var spreadsheetId = crearPlanillaNegocio_(nombreNegocio, DEFAULTS_CUENTA.zona_horaria);

  var cuenta;
  try {
    cuenta = conLock_(function () {
      var slug = slugDisponible_(generarSlug_(nombreNegocio));

      // Se revalida acá adentro: entre la verificación del token y este punto,
      // otra ejecución en paralelo del mismo usuario podría haber creado ya la
      // cuenta.
      if (cuentaPorUid_(ctx.usuario.uid)) {
        throw errorApp_(ERR.YA_REGISTRADO, 'Este usuario ya tiene un negocio registrado.');
      }

      var nueva = {
        id_cuenta: nuevoId_('c'),
        tipo: tipo,
        nombre_negocio: nombreNegocio,
        slug: slug,
        email: ctx.usuario.email,
        firebase_uid: ctx.usuario.uid,
        spreadsheet_id: spreadsheetId,
        zona_horaria: DEFAULTS_CUENTA.zona_horaria,
        paso_grilla_min: DEFAULTS_CUENTA.paso_grilla_min,
        antelacion_min_horas: DEFAULTS_CUENTA.antelacion_min_horas,
        cancelacion_min_horas: DEFAULTS_CUENTA.cancelacion_min_horas,
        margen_turno_min: DEFAULTS_CUENTA.margen_turno_min,
        direccion: DEFAULTS_CUENTA.direccion,
        instagram: DEFAULTS_CUENTA.instagram,
        telefono_contacto: DEFAULTS_CUENTA.telefono_contacto,
        activo: true,
        fecha_alta: ahoraIso_()
      };

      agregarFila_(planillaMaestra_(), HOJA_CUENTAS, nueva);
      return nueva;
    });
  } catch (err) {
    // Si el alta falla después de crear la planilla, queda una planilla
    // huérfana en Drive. Se la marca en el nombre para poder limpiarla, en vez
    // de borrarla a ciegas: si el error fue transitorio, los datos importan.
    try {
      SpreadsheetApp.openById(spreadsheetId).rename('HUERFANA - ' + nombreNegocio + ' - ' + ahoraIso_());
    } catch (err2) {
      console.error('No se pudo marcar la planilla huérfana ' + spreadsheetId + ': ' + err2);
    }
    throw err;
  }

  // Un negocio recién creado sin barbero no puede recibir turnos, así que se
  // crea uno por defecto. Para el independiente ese barbero es él mismo.
  var ss = abrirPlanilla_(spreadsheetId);
  agregarFila_(ss, 'Barberos', {
    id_barbero: nuevoId_('b'),
    nombre: tipo === 'independiente' ? nombreNegocio : 'Profesional 1',
    activo: true
  });

  return ok_({
    id_cuenta: cuenta.id_cuenta,
    slug: cuenta.slug,
    nombre_negocio: cuenta.nombre_negocio,
    tipo: cuenta.tipo
  });
}

/**
 * Corta el alta si la clave maestra no coincide.
 *
 * La comparación recorre siempre las dos cadenas completas en lugar de cortar
 * en la primera diferencia: comparar con `!==` filtra por el tiempo de
 * respuesta cuántos caracteres iniciales acertó quien prueba, y adivinar una
 * clave carácter por carácter es mucho más barato que adivinarla entera.
 */
function exigirClaveDeAlta_(params) {
  var esperada = claveAltaAdmin_();
  if (!esperada) return;   // sin clave configurada, el alta queda abierta

  var recibida = String((params && params.clave_admin) || '');
  var iguales = recibida.length === esperada.length;
  var largo = Math.max(recibida.length, esperada.length);
  for (var i = 0; i < largo; i++) {
    if (recibida.charAt(i) !== esperada.charAt(i)) iguales = false;
  }

  if (!iguales) {
    throw errorApp_(ERR.NO_AUTENTICADO,
      'La clave de administrador no es correcta. Solo el administrador puede abrir una agenda nueva.');
  }
}

/**
 * Busca un slug libre, agregando un sufijo numérico si hace falta.
 * Debe llamarse SIEMPRE dentro del lock: dos altas simultáneas con el mismo
 * nombre de negocio verían ambas el slug como libre y escribirían el mismo.
 */
function slugDisponible_(base) {
  var usados = {};
  var filas = leerCuentas_();
  for (var i = 0; i < filas.length; i++) {
    usados[String(filas[i].slug || '').trim().toLowerCase()] = true;
  }

  if (!usados[base]) return base;
  for (var n = 2; n < 500; n++) {
    var candidato = base + '-' + n;
    if (!usados[candidato]) return candidato;
  }
  throw errorApp_(ERR.SLUG_OCUPADO, 'No pudimos generar una dirección para ese nombre. Probá con otro.');
}

function epGetPerfilCuenta_(params) {
  var ctx = contextoAutenticado_(params);
  var c = ctx.cuenta;

  return ok_({
    id_cuenta: c.id_cuenta,
    tipo: c.tipo,
    nombre_negocio: c.nombre_negocio,
    slug: c.slug,
    email: c.email,
    zona_horaria: c.zona_horaria,
    paso_grilla_min: c.paso_grilla_min,
    antelacion_min_horas: c.antelacion_min_horas,
    cancelacion_min_horas: c.cancelacion_min_horas,
    margen_turno_min: c.margen_turno_min || 0,
    direccion: c.direccion || '',
    instagram: c.instagram || '',
    telefono_contacto: c.telefono_contacto || '',
    spreadsheet_url: 'https://docs.google.com/spreadsheets/d/' + c.spreadsheet_id,

    // Los servicios y el equipo viajan acá para que el panel abra con una sola
    // llamada en vez de dos encadenadas. Sale casi gratis: es el mismo dato
    // cacheado que sirve la pantalla del cliente.
    negocio: datosDeNegocio_(c)
  });
}

/**
 * Actualiza la configuración de la cuenta.
 * El slug NO es editable en el MVP: cambiarlo rompería todos los links que el
 * negocio ya repartió a sus clientes.
 */
function epActualizarPerfilCuenta_(params) {
  var ctx = contextoAutenticado_(params);
  var parcial = {};

  if (params.nombre_negocio !== undefined) {
    parcial.nombre_negocio = exigirTexto_(params, 'nombre_negocio', 80);
  }
  if (params.paso_grilla_min !== undefined) {
    parcial.paso_grilla_min = exigirEntero_(params, 'paso_grilla_min', 5, 120);
  }
  if (params.antelacion_min_horas !== undefined) {
    parcial.antelacion_min_horas = exigirEntero_(params, 'antelacion_min_horas', 0, 720);
  }
  if (params.cancelacion_min_horas !== undefined) {
    parcial.cancelacion_min_horas = exigirEntero_(params, 'cancelacion_min_horas', 0, 720);
  }
  if (params.margen_turno_min !== undefined) {
    parcial.margen_turno_min = exigirEntero_(params, 'margen_turno_min', 0, 120);
  }
  if (params.direccion !== undefined) {
    parcial.direccion = String(params.direccion || '').trim().slice(0, 120);
  }
  if (params.instagram !== undefined) {
    parcial.instagram = String(params.instagram || '').trim().replace(/^@/, '').slice(0, 80);
  }
  if (params.telefono_contacto !== undefined) {
    parcial.telefono_contacto = String(params.telefono_contacto || '').trim().slice(0, 30);
  }
  if (params.zona_horaria !== undefined) {
    parcial.zona_horaria = exigirZonaHoraria_(params, 'zona_horaria');
    try {
      var ss = planillaDeCuenta_(ctx.cuenta);
      ss.setSpreadsheetTimeZone(parcial.zona_horaria);
    } catch (errZ) {
      console.warn('No se pudo actualizar la zona horaria en la planilla: ' + errZ);
    }
  }

  if (!Object.keys(parcial).length) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'No hay nada para actualizar.');
  }

  actualizarFila_(planillaMaestra_(), HOJA_CUENTAS, ctx.cuenta._fila, parcial);

  // Sin esto, el dueño cambia el nombre del negocio o el paso de la grilla y no
  // lo ve reflejado hasta que vence la caché.
  olvidarCacheDeCuenta_(ctx.cuenta);
  return ok_(parcial);
}
