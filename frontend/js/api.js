/**
 * Cliente de la API del backend en Apps Script.
 *
 * Dos reglas de transporte que NO se pueden cambiar sin romper la app:
 *
 * 1. Los POST van con Content-Type "text/plain;charset=utf-8". Con
 *    "application/json" el navegador manda antes un preflight OPTIONS, que un
 *    Web App de Apps Script no puede responder porque solo expone doGet y
 *    doPost. Como el frontend vive en otro origen (GitHub Pages), TODAS las
 *    escrituras fallarían con un error de CORS.
 *
 * 2. Apps Script responde siempre HTTP 200. El éxito o el error viajan en el
 *    cuerpo, así que acá nunca se mira `response.status`.
 */

const API = (() => {
  // La URL del deployment vive en config.js, que es el único archivo que hay
  // que tocar al desplegar. El valor de reserva mantiene este cliente usable
  // suelto, sin config.js cargado (por ejemplo desde un test o una consola).
  // Al publicar una versión nueva hay que EDITAR el deployment existente
  // ("Administrar implementaciones" -> lápiz -> Versión: Nueva); si se crea uno
  // nuevo, la URL cambia y hay que actualizarla.
  const URL_BACKEND = (typeof CONFIG !== 'undefined' && CONFIG.URL_BACKEND)
    || 'https://script.google.com/macros/s/PEGAR_ID_DEL_DEPLOYMENT/exec';

  /** Error con el código que devolvió el backend, para poder ramificar por caso. */
  class ErrorAPI extends Error {
    constructor(codigo, mensaje) {
      super(mensaje);
      this.name = 'ErrorAPI';
      this.codigo = codigo;
    }
  }

  function desempaquetar(cuerpo) {
    if (!cuerpo || typeof cuerpo !== 'object') {
      throw new ErrorAPI('INTERNO', 'El servidor devolvió una respuesta inesperada.');
    }
    if (cuerpo.ok !== true) {
      const error = cuerpo.error || {};
      throw new ErrorAPI(error.codigo || 'INTERNO', error.mensaje || 'Ocurrió un error.');
    }
    return cuerpo.data;
  }

  async function leerCuerpo(respuesta) {
    const texto = await respuesta.text();
    try {
      return JSON.parse(texto);
    } catch (err) {
      // Apps Script devuelve HTML cuando el script no compila o el deployment
      // está mal configurado. Sin este mensaje el síntoma es un críptico
      // "Unexpected token <".
      throw new ErrorAPI('INTERNO',
        'El servidor no respondió en el formato esperado. Revisá que el deployment esté publicado con acceso "Cualquier persona".');
    }
  }

  // --- Señal de actividad ---------------------------------------------------
  //
  // Apps Script arranca en frío: la primera llamada después de un rato tarda
  // entre uno y tres segundos, y con la red de un celular a veces más. Contar
  // los pedidos en vuelo deja que la interfaz muestre una barra de progreso
  // mientras haya alguno, así ninguna espera queda sin señal — ni siquiera las
  // que ocurren dentro de un diálogo o al refrescar una sección ya dibujada.
  //
  // Se avisa por suscripción y no con un evento del DOM para que este archivo
  // siga sin tocar el documento y pueda usarse suelto (tests, consola).

  let enVuelo = 0;
  const oyentesActividad = [];

  function avisarActividad() {
    oyentesActividad.forEach((fn) => {
      try { fn(enVuelo); } catch (err) { console.error(err); }
    });
  }

  /** Envuelve un pedido llevando la cuenta de los que están en curso. */
  async function pedir(hacerFetch) {
    enVuelo += 1;
    avisarActividad();
    try {
      return desempaquetar(await leerCuerpo(await hacerFetch()));
    } finally {
      enVuelo -= 1;
      avisarActividad();
    }
  }

  /** Lecturas públicas: GET con parámetros de query. */
  function get(accion, params = {}) {
    const url = new URL(URL_BACKEND);
    url.searchParams.set('accion', accion);
    Object.entries(params).forEach(([clave, valor]) => {
      if (valor !== undefined && valor !== null) url.searchParams.set(clave, String(valor));
    });

    return pedir(() => fetch(url.toString(), { method: 'GET', redirect: 'follow' }));
  }

  /** Escrituras y acciones autenticadas: POST como request simple. */
  function post(accion, params = {}) {
    return pedir(() => fetch(URL_BACKEND, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion, ...params })
    }));
  }

  return {
    ErrorAPI,
    URL_BACKEND,

    /**
     * Se suscribe a la cantidad de pedidos en curso. Devuelve la función para
     * darse de baja. La UI lo usa para la barra de progreso.
     */
    alCambiarActividad(fn) {
      oyentesActividad.push(fn);
      fn(enVuelo);
      return () => {
        const i = oyentesActividad.indexOf(fn);
        if (i >= 0) oyentesActividad.splice(i, 1);
      };
    },

    // --- Cliente final (sin login) -----------------------------------------
    getNegocio: (slug) => get('getNegocio', { slug }),

    getDisponibilidad: (slug, idBarbero, idServicio, fecha) => {
      const serviciosArray = Array.isArray(idServicio) ? idServicio : [idServicio];
      const idServiciosStr = serviciosArray.join(',');
      const idServicioUnico = serviciosArray[0] || '';
      return get('getDisponibilidad', {
        slug,
        id_barbero: idBarbero,
        id_servicio: idServicioUnico,
        id_servicios: idServiciosStr,
        fecha
      });
    },

    getTurno: (slug, codigoTicket) => get('getTurno', { slug, codigo_ticket: codigoTicket }),

    crearTurno: (datos) => {
      const copia = { ...datos };
      if (copia.id_servicios) {
        copia.id_servicio = Array.isArray(copia.id_servicios) ? copia.id_servicios[0] : String(copia.id_servicios).split(',')[0];
        if (Array.isArray(copia.id_servicios)) copia.id_servicios = copia.id_servicios.join(',');
      } else if (copia.id_servicio) {
        copia.id_servicios = String(copia.id_servicio);
      }
      return post('crearTurno', copia);
    },

    cancelarTurno: (slug, codigoTicket) =>
      post('cancelarTurno', { slug, codigo_ticket: codigoTicket }),

    // --- Dueño (con token) --------------------------------------------------
    // El token se pasa en cada llamada y nunca se persiste en localStorage:
    // vive en memoria y se renueva con getIdToken() de Firebase.
    conToken: (token) => ({
      getPerfilCuenta: () => post('getPerfilCuenta', { token }),
      actualizarPerfilCuenta: (config) => post('actualizarPerfilCuenta', { token, ...config }),
      // `claveAdmin` es la clave maestra que autoriza abrir una agenda. Se manda
      // al backend porque es ahí donde se valida: la comprobación del panel es
      // solo para dar el error sin esperar una ida y vuelta.
      registrarCuenta: (tipo, nombreNegocio, claveAdmin = '') =>
        post('registrarCuenta', {
          token, tipo, nombre_negocio: nombreNegocio, clave_admin: claveAdmin
        }),

      getTurnosPorRango: (desde, hasta) => post('getTurnosPorRango', { token, desde, hasta }),
      cancelarTurno: (idTurno) => post('cancelarTurnoDueno', { token, id_turno: idTurno }),
      marcarEstadoTurno: (idTurno, estado) =>
        post('marcarEstadoTurno', { token, id_turno: idTurno, estado }),
      archivarTurnos: (dias = 30) => post('archivarTurnos', { token, dias }),

      crearServicio: (datos) => post('crearServicio', { token, ...datos }),
      editarServicio: (datos) => post('editarServicio', { token, ...datos }),
      borrarServicio: (idServicio) => post('borrarServicio', { token, id_servicio: idServicio }),

      crearBarbero: (nombre) => post('crearBarbero', { token, nombre }),
      editarBarbero: (idBarbero, nombre) =>
        post('editarBarbero', { token, id_barbero: idBarbero, nombre }),
      borrarBarbero: (idBarbero) => post('borrarBarbero', { token, id_barbero: idBarbero }),

      getHorarios: (idBarbero) => post('getHorarios', { token, id_barbero: idBarbero }),
      configurarHorarios: (idBarbero, horarios) =>
        post('configurarHorarios', { token, id_barbero: idBarbero, horarios }),

      getBloqueos: () => post('getBloqueos', { token }),
      crearBloqueo: (datos) => post('crearBloqueo', { token, ...datos }),
      borrarBloqueo: (idBloqueo) => post('borrarBloqueo', { token, id_bloqueo: idBloqueo }),

      getListaNegra: () => post('getListaNegra', { token }),
      bloquearTelefono: (telefono, motivo) => post('bloquearTelefono', { token, telefono, motivo }),
      desbloquearTelefono: (telefono) => post('desbloquearTelefono', { token, telefono }),

      getEstadisticas: (desde, hasta) => post('getEstadisticas', { token, desde, hasta })
    })
  };
})();

/**
 * Arma el link de WhatsApp con el comprobante del turno.
 *
 * No envía nada: abre WhatsApp con el mensaje precargado para que el cliente
 * elija a quién mandárselo. Es 100% frontend, sin API paga de por medio.
 *
 * encodeURIComponent es obligatorio: sin él los saltos de línea y los acentos
 * rompen la URL.
 */
function linkComprobanteWhatsApp(turno, urlDelSitio) {
  const mensaje = [
    'Turno confirmado ✅',
    'Negocio: ' + turno.nombre_negocio,
    'Barbero: ' + turno.barbero_nombre,
    'Servicio: ' + turno.servicio_nombre,
    'Fecha: ' + turno.fecha + ' - Hora: ' + turno.hora,
    'Código de ticket: ' + turno.codigo_ticket,
    'Para cancelar, ingresá a ' + urlDelSitio + ' con este código.'
  ].join('\n');

  return 'https://wa.me/?text=' + encodeURIComponent(mensaje);
}
