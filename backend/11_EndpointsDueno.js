/**
 * Grupo 2 — endpoints del dueño del negocio. Todos exigen token.
 *
 * Ninguno recibe `id_cuenta`: se deriva siempre del token verificado. Recibirlo
 * del frontend sería una invitación a olvidarse de validarlo alguna vez, y
 * bastaría con mandar el id de otro negocio para leer o borrar sus turnos.
 */

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------

function epGetTurnosPorRango_(params) {
  var ctx = contextoAutenticado_(params);
  var desde = exigirFecha_(params, 'desde');
  var hasta = exigirFecha_(params, 'hasta');

  if (hasta < desde) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'La fecha de fin es anterior a la de inicio.');
  }
  if (diferenciaDias_(desde, hasta) > LIMITES.MAX_DIAS_RANGO_CONSULTA) {
    throw errorApp_(ERR.ENTRADA_INVALIDA,
      'El rango no puede superar los ' + LIMITES.MAX_DIAS_RANGO_CONSULTA + ' días.');
  }

  var ss = planillaDeCuenta_(ctx.cuenta);
  var nombresBarbero = mapaNombresBarbero_(ss);

  // La fecha se normaliza antes de comparar: si la celda perdió el formato "@"
  // y Sheets la devuelve como "1/9/2026", la comparación cruda contra el ISO da
  // false y el turno desaparece de la agenda del dueño — aunque siga ocupando
  // el horario. Un turno cuya fecha ni siquiera se puede interpretar se muestra
  // en TODOS los rangos: esconderlo es como no tenerlo, y el dueño necesita
  // verlo para poder arreglar la celda.
  var turnos = leerHoja_(ss, 'Turnos')
    .filter(function (t) {
      var f = aFechaIsoDeCelda(t.fecha);
      if (f === null) {
        console.error('Turno con fecha ilegible en la agenda: id_turno="' +
          String(t.id_turno) + '", fecha="' + String(t.fecha) + '".');
        return true;
      }
      return f >= desde && f <= hasta;
    })
    .map(function (t) {
      return {
        id_turno: String(t.id_turno),
        codigo_ticket: String(t.codigo_ticket),
        id_barbero: String(t.id_barbero),
        barbero_nombre: nombresBarbero[String(t.id_barbero)] || '',
        servicio_nombre: String(t.servicio_nombre || ''),
        duracion_minutos: Number(t.duracion_minutos) || 0,
        precio: Number(t.precio) || 0,
        cliente_nombre: String(t.cliente_nombre || ''),
        cliente_telefono: String(t.cliente_telefono || ''),
        // Normalizada, para que el panel siempre reciba "YYYY-MM-DD". Si no se
        // pudo interpretar viaja cruda: es preferible que se vea rara a que se
        // vea una fecha inventada.
        fecha: aFechaIsoDeCelda(t.fecha) || String(t.fecha),
        hora: String(t.hora),
        hora_fin: String(t.hora_fin || ''),
        estado: String(t.estado)
      };
    });

  turnos.sort(function (a, b) {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    return a.hora < b.hora ? -1 : (a.hora > b.hora ? 1 : 0);
  });

  return ok_({ desde: desde, hasta: hasta, turnos: turnos });
}

function epCancelarTurnoDueno_(params) {
  var ctx = contextoAutenticado_(params);
  var idTurno = exigirTexto_(params, 'id_turno', 60);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var turno = buscarTurnoPorId_(ss, idTurno);
  if (!turno) throw errorApp_(ERR.NO_ENCONTRADO, 'No existe ese turno.');

  actualizarFila_(ss, 'Turnos', turno._fila, { estado: 'cancelado', cancelado_por: 'dueno' });
  return ok_({ id_turno: idTurno, estado: 'cancelado' });
}

/**
 * Marca el desenlace de un turno.
 * `completado` y `no_asistio` son los que le dan sentido a las estadísticas y
 * son el disparador natural de la lista negra.
 */
function epMarcarEstadoTurno_(params) {
  var ctx = contextoAutenticado_(params);
  var idTurno = exigirTexto_(params, 'id_turno', 60);
  var estado = exigirTexto_(params, 'estado', 20);

  if (ESTADOS_TURNO.indexOf(estado) === -1) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'Estado inválido. Valores posibles: ' + ESTADOS_TURNO.join(', ') + '.');
  }

  var ss = planillaDeCuenta_(ctx.cuenta);
  var turno = buscarTurnoPorId_(ss, idTurno);
  if (!turno) throw errorApp_(ERR.NO_ENCONTRADO, 'No existe ese turno.');

  var parcial = { estado: estado };
  if (estado === 'cancelado') parcial.cancelado_por = 'dueno';

  actualizarFila_(ss, 'Turnos', turno._fila, parcial);
  return ok_({ id_turno: idTurno, estado: estado });
}

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------

function epCrearServicio_(params) {
  var ctx = contextoAutenticado_(params);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var servicio = {
    id_servicio: nuevoId_('s'),
    nombre: exigirTexto_(params, 'nombre', 60),
    duracion_minutos: exigirEntero_(params, 'duracion_minutos', 5, 600),
    precio: Number(params.precio) || 0,
    activo: true
  };

  agregarFila_(ss, 'Servicios', servicio);
  olvidarCacheDeCuenta_(ctx.cuenta);
  return ok_(servicio);
}

function epEditarServicio_(params) {
  var ctx = contextoAutenticado_(params);
  var idServicio = exigirTexto_(params, 'id_servicio', 60);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var fila = buscarPorId_(ss, 'Servicios', 'id_servicio', idServicio);
  if (!fila) throw errorApp_(ERR.NO_ENCONTRADO, 'No existe ese servicio.');

  var parcial = {};
  if (params.nombre !== undefined) parcial.nombre = exigirTexto_(params, 'nombre', 60);
  if (params.duracion_minutos !== undefined) parcial.duracion_minutos = exigirEntero_(params, 'duracion_minutos', 5, 600);
  if (params.precio !== undefined) parcial.precio = Number(params.precio) || 0;

  actualizarFila_(ss, 'Servicios', fila._fila, parcial);
  olvidarCacheDeCuenta_(ctx.cuenta);

  // Editar la duración NO afecta a los turnos ya reservados: cada turno guarda
  // su propia duración congelada. Sin eso, subir "Corte" de 30 a 45 minutos
  // haría que todos los turnos existentes pasaran a solaparse entre sí.
  return ok_({ id_servicio: idServicio });
}

/** Borrado lógico: hay turnos históricos que referencian este servicio. */
function epBorrarServicio_(params) {
  var ctx = contextoAutenticado_(params);
  var idServicio = exigirTexto_(params, 'id_servicio', 60);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var fila = buscarPorId_(ss, 'Servicios', 'id_servicio', idServicio);
  if (!fila) throw errorApp_(ERR.NO_ENCONTRADO, 'No existe ese servicio.');

  actualizarFila_(ss, 'Servicios', fila._fila, { activo: false });
  olvidarCacheDeCuenta_(ctx.cuenta);
  return ok_({ id_servicio: idServicio, activo: false });
}

// ---------------------------------------------------------------------------
// Barberos
// ---------------------------------------------------------------------------

function epCrearBarbero_(params) {
  var ctx = contextoAutenticado_(params);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var barbero = {
    id_barbero: nuevoId_('b'),
    nombre: exigirTexto_(params, 'nombre', 60),
    activo: true
  };

  agregarFila_(ss, 'Barberos', barbero);
  olvidarCacheDeCuenta_(ctx.cuenta);
  return ok_(barbero);
}

function epEditarBarbero_(params) {
  var ctx = contextoAutenticado_(params);
  var idBarbero = exigirTexto_(params, 'id_barbero', 60);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var fila = buscarPorId_(ss, 'Barberos', 'id_barbero', idBarbero);
  if (!fila) throw errorApp_(ERR.NO_ENCONTRADO, 'No existe ese profesional.');

  actualizarFila_(ss, 'Barberos', fila._fila, { nombre: exigirTexto_(params, 'nombre', 60) });
  olvidarCacheDeCuenta_(ctx.cuenta);
  return ok_({ id_barbero: idBarbero });
}

/** Borrado lógico, por la misma razón que los servicios. */
function epBorrarBarbero_(params) {
  var ctx = contextoAutenticado_(params);
  var idBarbero = exigirTexto_(params, 'id_barbero', 60);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var fila = buscarPorId_(ss, 'Barberos', 'id_barbero', idBarbero);
  if (!fila) throw errorApp_(ERR.NO_ENCONTRADO, 'No existe ese profesional.');

  actualizarFila_(ss, 'Barberos', fila._fila, { activo: false });
  olvidarCacheDeCuenta_(ctx.cuenta);
  return ok_({ id_barbero: idBarbero, activo: false });
}

// ---------------------------------------------------------------------------
// Horarios y bloqueos
// ---------------------------------------------------------------------------

/**
 * Franjas horarias guardadas, para poder editarlas.
 *
 * Sin esta lectura el editor del panel no tenía de dónde sacar la configuración
 * vigente y partía de lo último que se hubiera guardado en ESE navegador. Abrir
 * el panel desde otro dispositivo mostraba la semana entera vacía y, como
 * `configurarHorarios` reemplaza todo, guardar ahí borraba los horarios reales.
 *
 * `legible` no significa "la fila está bien": significa "el editor puede
 * mostrar esta franja y volver a guardarla tal cual". Una franja que
 * `ventanasDelDia` descarta ya le sacó esa ventana al barbero sin que nadie se
 * entere, así que el panel tiene que poder mostrarla para que alguien la
 * arregle. También caen acá las franjas que terminan a las 24:00: son válidas
 * para el cálculo, pero `<input type="time">` no las representa y `exigirHora_`
 * no las aceptaría de vuelta.
 */
function epGetHorarios_(params) {
  var ctx = contextoAutenticado_(params);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var filtro = (params.id_barbero === undefined || params.id_barbero === null)
    ? null
    : exigirTexto_(params, 'id_barbero', 60);

  var filas = leerHoja_(ss, 'Horarios_disponibles');
  var horarios = [];

  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];
    if (filtro !== null && String(f.id_barbero) !== filtro) continue;

    // El día se valida contra el texto crudo y no con Number(): `Number('')` es
    // 0, y eso convertiría una celda vacía en un domingo que nadie cargó.
    var crudoDia = String(f.dia_semana === null || f.dia_semana === undefined ? '' : f.dia_semana).trim();
    var dia = /^[0-6]$/.test(crudoDia) ? Number(crudoDia) : null;

    var inicio = aMinutosDeCelda(f.hora_inicio);
    var fin = aMinutosDeCelda(f.hora_fin);
    var legible = dia !== null && !isNaN(inicio) && !isNaN(fin) &&
      fin > inicio && inicio <= 1439 && fin <= 1439;

    horarios.push({
      id_barbero: String(f.id_barbero),
      dia_semana: dia,
      // Normalizadas a "HH:mm" cuando se entienden; crudas cuando no, para que
      // el dueño vea qué dice la celda en vez de un hueco.
      hora_inicio: legible ? aHoraTexto(inicio) : String(f.hora_inicio || ''),
      hora_fin: legible ? aHoraTexto(fin) : String(f.hora_fin || ''),
      legible: legible
    });
  }

  return ok_({ horarios: horarios });
}

/**
 * Reemplaza por completo los horarios de un barbero.
 *
 * Recibe un array de ventanas, porque un día puede tener más de una: el
 * horario partido (9-13 y 16-20) es el caso típico de una barbería de barrio y
 * una sola franja por día no puede representarlo.
 */
function epConfigurarHorarios_(params) {
  var ctx = contextoAutenticado_(params);
  var idBarbero = exigirTexto_(params, 'id_barbero', 60);
  var ss = planillaDeCuenta_(ctx.cuenta);

  if (!buscarPorId_(ss, 'Barberos', 'id_barbero', idBarbero)) {
    throw errorApp_(ERR.NO_ENCONTRADO, 'No existe ese profesional.');
  }

  var entrada = params.horarios;
  if (!Array.isArray(entrada)) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'El campo "horarios" debe ser una lista de ventanas.');
  }

  var nuevos = entrada.map(function (v, i) {
    var dia = exigirEntero_(v, 'dia_semana', 0, 6);
    var inicio = exigirHora_(v, 'hora_inicio');
    var fin = exigirHora_(v, 'hora_fin');
    if (aMinutos(fin) <= aMinutos(inicio)) {
      throw errorApp_(ERR.ENTRADA_INVALIDA,
        'En la franja ' + (i + 1) + ' la hora de fin no es posterior a la de inicio.');
    }
    return { id_barbero: idBarbero, dia_semana: dia, hora_inicio: inicio, hora_fin: fin };
  });

  var h = hoja_(ss, 'Horarios_disponibles');
  var existentes = leerHoja_(ss, 'Horarios_disponibles');

  // Se borra de abajo hacia arriba para que los números de fila de las que
  // quedan por borrar no se corran.
  for (var i = existentes.length - 1; i >= 0; i--) {
    if (String(existentes[i].id_barbero) === idBarbero) {
      h.deleteRow(existentes[i]._fila);
    }
  }
  for (var j = 0; j < nuevos.length; j++) {
    agregarFila_(ss, 'Horarios_disponibles', nuevos[j]);
  }

  return ok_({ id_barbero: idBarbero, cantidad: nuevos.length });
}

function epCrearBloqueo_(params) {
  var ctx = contextoAutenticado_(params);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var idBarbero = exigirTexto_(params, 'id_barbero', 60);
  if (idBarbero !== 'todos' && !buscarPorId_(ss, 'Barberos', 'id_barbero', idBarbero)) {
    throw errorApp_(ERR.NO_ENCONTRADO, 'No existe ese profesional.');
  }

  var fechaInicio = exigirFecha_(params, 'fecha_inicio');
  var fechaFin = params.fecha_fin ? exigirFecha_(params, 'fecha_fin') : fechaInicio;
  if (fechaFin < fechaInicio) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'La fecha de fin es anterior a la de inicio.');
  }

  // Las horas son opcionales: sin ellas el bloqueo cubre el día completo, y con
  // ellas se puede bloquear "el martes de 14 a 16", que es el caso más común
  // después de las vacaciones.
  var horaInicio = '';
  var horaFin = '';
  if (params.hora_inicio || params.hora_fin) {
    horaInicio = exigirHora_(params, 'hora_inicio');
    horaFin = exigirHora_(params, 'hora_fin');
    if (aMinutos(horaFin) <= aMinutos(horaInicio)) {
      throw errorApp_(ERR.ENTRADA_INVALIDA, 'La hora de fin no es posterior a la de inicio.');
    }
  }

  var bloqueo = {
    id_bloqueo: nuevoId_('bl'),
    id_barbero: idBarbero,
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
    hora_inicio: horaInicio,
    hora_fin: horaFin,
    motivo: String(params.motivo || '').slice(0, 120)
  };

  agregarFila_(ss, 'Bloqueos', bloqueo);
  return ok_(bloqueo);
}

/** Los bloqueos sí se borran de verdad: nada histórico los referencia. */
function epBorrarBloqueo_(params) {
  var ctx = contextoAutenticado_(params);
  var idBloqueo = exigirTexto_(params, 'id_bloqueo', 60);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var fila = buscarPorId_(ss, 'Bloqueos', 'id_bloqueo', idBloqueo);
  if (!fila) throw errorApp_(ERR.NO_ENCONTRADO, 'No existe ese bloqueo.');

  borrarFila_(ss, 'Bloqueos', fila._fila);
  return ok_({ id_bloqueo: idBloqueo });
}

function epGetBloqueos_(params) {
  var ctx = contextoAutenticado_(params);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var bloqueos = leerHoja_(ss, 'Bloqueos').map(function (b) {
    return {
      id_bloqueo: String(b.id_bloqueo),
      id_barbero: String(b.id_barbero),
      fecha_inicio: String(b.fecha_inicio),
      fecha_fin: String(b.fecha_fin || b.fecha_inicio),
      hora_inicio: String(b.hora_inicio || ''),
      hora_fin: String(b.hora_fin || ''),
      motivo: String(b.motivo || '')
    };
  });

  return ok_({ bloqueos: bloqueos });
}

// ---------------------------------------------------------------------------
// Lista negra
// ---------------------------------------------------------------------------

function epBloquearTelefono_(params) {
  var ctx = contextoAutenticado_(params);
  var telefono = normalizarTelefono_(params.telefono);
  var ss = planillaDeCuenta_(ctx.cuenta);

  if (estaEnListaNegra_(ss, telefono)) {
    return ok_({ telefono: telefono, ya_estaba: true });
  }

  agregarFila_(ss, 'Lista_negra', {
    telefono: telefono,
    fecha_bloqueo: hoyEnZona_(ctx.cuenta.zona_horaria),
    motivo: String(params.motivo || '').slice(0, 120)
  });

  return ok_({ telefono: telefono, ya_estaba: false });
}

function epDesbloquearTelefono_(params) {
  var ctx = contextoAutenticado_(params);
  var telefono = normalizarTelefono_(params.telefono);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var filas = leerHoja_(ss, 'Lista_negra');
  for (var i = filas.length - 1; i >= 0; i--) {
    if (normalizarTelefonoSuave_(filas[i].telefono) === telefono) {
      borrarFila_(ss, 'Lista_negra', filas[i]._fila);
    }
  }

  return ok_({ telefono: telefono });
}

function epGetListaNegra_(params) {
  var ctx = contextoAutenticado_(params);
  var ss = planillaDeCuenta_(ctx.cuenta);

  var lista = leerHoja_(ss, 'Lista_negra').map(function (f) {
    return {
      telefono: String(f.telefono),
      fecha_bloqueo: String(f.fecha_bloqueo || ''),
      motivo: String(f.motivo || '')
    };
  });

  return ok_({ lista: lista });
}

// ---------------------------------------------------------------------------
// Estadísticas
// ---------------------------------------------------------------------------

/**
 * Resumen del período.
 *
 * La facturación sale del precio congelado en cada turno, no del precio actual
 * del servicio: si el dueño sube los precios en marzo, febrero tiene que seguir
 * mostrando lo que realmente cobró.
 */
function epGetEstadisticas_(params) {
  var ctx = contextoAutenticado_(params);
  var desde = exigirFecha_(params, 'desde');
  var hasta = exigirFecha_(params, 'hasta');

  if (hasta < desde) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'La fecha de fin es anterior a la de inicio.');
  }

  var ss = planillaDeCuenta_(ctx.cuenta);
  var nombresBarbero = mapaNombresBarbero_(ss);

  var resumen = {
    desde: desde,
    hasta: hasta,
    total: 0,
    confirmados: 0,
    completados: 0,
    cancelados: 0,
    no_asistio: 0,
    facturado: 0,
    por_barbero: {},
    por_servicio: {}
  };

  var turnos = leerHoja_(ss, 'Turnos');
  for (var i = 0; i < turnos.length; i++) {
    var t = turnos[i];

    // Mismo motivo que en la agenda: comparar la celda cruda contra el ISO
    // esconde los turnos cuya fecha Sheets devuelve en otro formato. Acá, en
    // cambio, un turno que no se puede ubicar en el tiempo NO se cuenta: la
    // agenda gana en mostrar de más, la facturación tiene que ser exacta.
    var fecha = aFechaIsoDeCelda(t.fecha);
    if (fecha === null) {
      console.error('Turno con fecha ilegible, excluido de las estadísticas: id_turno="' +
        String(t.id_turno) + '", fecha="' + String(t.fecha) + '".');
      continue;
    }
    if (fecha < desde || fecha > hasta) continue;

    var estado = String(t.estado);
    resumen.total++;

    if (estado === 'confirmado') resumen.confirmados++;
    else if (estado === 'completado') resumen.completados++;
    else if (estado === 'cancelado') resumen.cancelados++;
    else if (estado === 'no_asistio') resumen.no_asistio++;

    if (estado === 'completado') {
      resumen.facturado += Number(t.precio) || 0;
    }

    if (estado !== 'cancelado') {
      var nombreBarbero = nombresBarbero[String(t.id_barbero)] || String(t.id_barbero);
      resumen.por_barbero[nombreBarbero] = (resumen.por_barbero[nombreBarbero] || 0) + 1;

      var nombreServicio = String(t.servicio_nombre || 'Sin nombre');
      resumen.por_servicio[nombreServicio] = (resumen.por_servicio[nombreServicio] || 0) + 1;
    }
  }

  return ok_(resumen);
}

// ---------------------------------------------------------------------------
// Archivado de turnos históricos
// ---------------------------------------------------------------------------

/**
 * Mueve a la hoja `Turnos_Historico` los turnos cerrados con más de 30 días de antigüedad.
 * Mantiene la hoja principal `Turnos` liviana para asegurar tiempos de respuesta óptimos.
 */
function epArchivarTurnos_(params) {
  var ctx = contextoAutenticado_(params);
  var diasAntiguedad = params.dias ? Math.max(30, Number(params.dias) || 30) : 30;
  var ss = planillaDeCuenta_(ctx.cuenta);

  var hoy = hoyEnZona_(ctx.cuenta.zona_horaria);
  var fechaLimite = sumarDias_(hoy, -diasAntiguedad);

  var archivados = 0;

  conLock_(function () {
    // Asegurar que la hoja Turnos_Historico exista
    var hojaHist = ss.getSheetByName('Turnos_Historico');
    if (!hojaHist) {
      hojaHist = ss.insertSheet('Turnos_Historico');
      prepararHoja_(hojaHist, ESQUEMAS_NEGOCIO.Turnos_Historico.columnas, ESQUEMAS_NEGOCIO.Turnos_Historico.texto);
    }

    var turnos = leerHoja_(ss, 'Turnos');
    var aMover = [];

    for (var i = 0; i < turnos.length; i++) {
      var t = turnos[i];
      var fechaIso = aFechaIsoDeCelda(t.fecha);
      var estado = String(t.estado);

      // Solo archivar turnos finalizados que sean anteriores o iguales a la fecha límite
      if (fechaIso && fechaIso <= fechaLimite && (estado === 'completado' || estado === 'cancelado' || estado === 'no_asistio')) {
        aMover.push(t);
      }
    }

    if (!aMover.length) return;

    for (var j = 0; j < aMover.length; j++) {
      agregarFila_(ss, 'Turnos_Historico', aMover[j]);
    }

    // Borrar de abajo hacia arriba para que no se corran los números de fila
    var hTurnos = hoja_(ss, 'Turnos');
    for (var k = aMover.length - 1; k >= 0; k--) {
      hTurnos.deleteRow(aMover[k]._fila);
    }

    archivados = aMover.length;
  });

  return ok_({ archivados: archivados, fecha_corte: fechaLimite });
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function buscarPorId_(ss, nombreHoja, columnaId, valor) {
  var filas = leerHoja_(ss, nombreHoja);
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i][columnaId]) === String(valor)) return filas[i];
  }
  return null;
}

function buscarTurnoPorId_(ss, idTurno) {
  return buscarPorId_(ss, 'Turnos', 'id_turno', idTurno);
}

function mapaNombresBarbero_(ss) {
  var mapa = {};
  var filas = leerHoja_(ss, 'Barberos');
  for (var i = 0; i < filas.length; i++) {
    mapa[String(filas[i].id_barbero)] = String(filas[i].nombre);
  }
  return mapa;
}
