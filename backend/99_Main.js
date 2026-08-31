/**
 * Punto de entrada del Web App: enrutado de todas las acciones.
 *
 * Contrato de transporte (ver sección 5 del documento de arquitectura):
 *
 * - Apps Script SIEMPRE responde HTTP 200. El éxito o el error viajan en el
 *   cuerpo, nunca en el código de estado.
 * - Los POST tienen que llegar con `Content-Type: text/plain;charset=utf-8` y
 *   el JSON stringificado en el body. Con `application/json` el navegador manda
 *   antes un preflight OPTIONS, que Apps Script no puede responder porque solo
 *   expone doGet y doPost — y como el frontend vive en otro origen, TODAS las
 *   escrituras fallarían.
 * - Las lecturas públicas van por GET con parámetros de query.
 */

/** Acciones de lectura pública, accesibles por GET. */
var RUTAS_GET = {
  getNegocio: epGetNegocio_,
  getDisponibilidad: epGetDisponibilidad_,
  getTurno: epGetTurno_
};

/** Acciones que modifican estado o requieren token, accesibles por POST. */
var RUTAS_POST = {
  // Grupo 1 — cliente final
  crearTurno: epCrearTurno_,
  cancelarTurno: epCancelarTurnoCliente_,

  // Grupo 2 — dueño
  getTurnosPorRango: epGetTurnosPorRango_,
  cancelarTurnoDueno: epCancelarTurnoDueno_,
  marcarEstadoTurno: epMarcarEstadoTurno_,
  crearServicio: epCrearServicio_,
  editarServicio: epEditarServicio_,
  borrarServicio: epBorrarServicio_,
  crearBarbero: epCrearBarbero_,
  editarBarbero: epEditarBarbero_,
  borrarBarbero: epBorrarBarbero_,
  getHorarios: epGetHorarios_,
  configurarHorarios: epConfigurarHorarios_,
  crearBloqueo: epCrearBloqueo_,
  borrarBloqueo: epBorrarBloqueo_,
  getBloqueos: epGetBloqueos_,
  bloquearTelefono: epBloquearTelefono_,
  desbloquearTelefono: epDesbloquearTelefono_,
  getListaNegra: epGetListaNegra_,
  getEstadisticas: epGetEstadisticas_,
  archivarTurnos: epArchivarTurnos_,

  // Grupo 3 — cuenta
  registrarCuenta: epRegistrarCuenta_,
  getPerfilCuenta: epGetPerfilCuenta_,
  actualizarPerfilCuenta: epActualizarPerfilCuenta_
};

// El parseo de la entrada se pasa como función y NO se ejecuta acá: tiene que
// ocurrir dentro del try de despachar_. Si se hiciera afuera, un body que no
// es JSON lanzaría una excepción sin atrapar y Apps Script devolvería su página
// de error en HTML — el frontend recibiría algo que no puede parsear en lugar
// del {ok:false} que espera.
function doGet(e) {
  return despachar_(RUTAS_GET, function () { return parametrosGet_(e); });
}

function doPost(e) {
  return despachar_(RUTAS_POST, function () { return parametrosPost_(e); });
}

function parametrosGet_(e) {
  return (e && e.parameter) ? e.parameter : {};
}

function parametrosPost_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    var datos = JSON.parse(e.postData.contents);
    return (datos && typeof datos === 'object') ? datos : {};
  } catch (err) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'El cuerpo del pedido no es JSON válido.');
  }
}

function despachar_(rutas, obtenerParams) {
  var params = {};
  try {
    params = obtenerParams();
    var accion = String(params.accion || '');
    var manejador = Object.prototype.hasOwnProperty.call(rutas, accion) ? rutas[accion] : null;

    if (!manejador) {
      return responder_(fallo_(ERR.ACCION_DESCONOCIDA, 'Acción no reconocida: "' + accion + '".'));
    }

    return responder_(manejador(params));

  } catch (err) {
    if (err && err.codigoApp) {
      return responder_(fallo_(err.codigoApp, err.message));
    }

    // Un error inesperado se registra completo del lado del servidor, pero al
    // cliente se le devuelve un mensaje genérico: los stack traces pueden
    // filtrar ids de planillas y estructura interna.
    console.error('Error no controlado en "' + (params && params.accion) + '": ' +
      (err && err.stack ? err.stack : err));
    return responder_(fallo_(ERR.INTERNO, 'Ocurrió un error inesperado. Probá de nuevo en unos minutos.'));
  }
}
