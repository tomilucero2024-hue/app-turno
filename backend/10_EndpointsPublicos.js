/**
 * Grupo 1 — endpoints del cliente final. Sin login.
 *
 * Estos endpoints son la superficie pública de la app, así que devuelven lo
 * mínimo necesario: nunca datos de otros clientes, ni teléfonos, ni quién
 * reservó cada horario ocupado.
 */

/**
 * Datos públicos de un negocio a partir de su slug.
 *
 * `requiere_turnstile` se agrega acá y NO dentro de `datosDeNegocio_` por dos
 * razones: sale de una propiedad del script y no de la planilla, y ese objeto
 * se cachea — guardarlo adentro haría que un cambio del secreto tarde hasta
 * que venza la caché en notarse.
 *
 * Lo usa la pantalla de reserva para detectar el único desajuste de
 * configuración que no se ve hasta que es tarde: con `TURNSTILE_SECRET`
 * cargado y sin site key en `config.js`, no hay token que mandar y toda
 * reserva muere en `VERIFICACION_FALLIDA` recién cuando el cliente ya completó
 * el formulario entero. No revela nada: que el sitio usa captcha ya se ve en
 * el widget.
 */
function epGetNegocio_(params) {
  var datos = datosDeNegocio_(cuentaPorSlug_(params.slug));

  var salida = {};
  for (var clave in datos) {
    if (Object.prototype.hasOwnProperty.call(datos, clave)) salida[clave] = datos[clave];
  }
  salida.requiere_turnstile = !!secretoTurnstile_();

  return ok_(salida);
}

/**
 * Servicios y profesionales activos de un negocio, listos para el cliente.
 *
 * Separado del endpoint porque el panel del dueño necesita lo mismo al abrir:
 * devolverlo junto con el perfil le ahorra una ida y vuelta entera al backend,
 * que a esta latencia se nota más que cualquier optimización de código.
 *
 * Es la primera pantalla que ve cada cliente y su contenido cambia unas pocas
 * veces por mes, así que se cachea: evita abrir la planilla del negocio y
 * leerle dos hojas en cada visita. Toda alta o baja de servicio o profesional
 * invalida la clave, así que el dueño ve sus cambios enseguida.
 */
function datosDeNegocio_(cuenta) {
  var claveCache = 'negocio_' + String(cuenta.slug).toLowerCase();
  var cacheado = cacheLeer_(claveCache);
  if (cacheado) return cacheado;

  var ss = planillaDeCuenta_(cuenta);

  var barberos = leerHoja_(ss, 'Barberos')
    .filter(function (b) { return esActivo_(b.activo); })
    .map(function (b) {
      return { id_barbero: String(b.id_barbero), nombre: String(b.nombre) };
    });

  var servicios = leerHoja_(ss, 'Servicios')
    .filter(function (s) { return esActivo_(s.activo); })
    .map(function (s) {
      return {
        id_servicio: String(s.id_servicio),
        nombre: String(s.nombre),
        duracion_minutos: Number(s.duracion_minutos) || 0,
        precio: Number(s.precio) || 0
      };
    });

  var datos = {
    nombre_negocio: cuenta.nombre_negocio,
    slug: cuenta.slug,
    tipo: cuenta.tipo,
    zona_horaria: cuenta.zona_horaria,
    antelacion_min_horas: cuenta.antelacion_min_horas,
    cancelacion_min_horas: cuenta.cancelacion_min_horas,
    margen_turno_min: cuenta.margen_turno_min || 0,
    direccion: cuenta.direccion || '',
    instagram: cuenta.instagram || '',
    telefono_contacto: cuenta.telefono_contacto || '',
    barberos: barberos,
    servicios: servicios
  };

  cacheGuardar_(claveCache, datos);
  return datos;
}

/**
 * Horarios libres de un barbero (o cualquiera) para una fecha y servicio(s).
 */
function epGetDisponibilidad_(params) {
  var cuenta = cuentaPorSlug_(params.slug);
  var idBarbero = exigirTexto_(params, 'id_barbero', 60);
  var fecha = exigirFecha_(params, 'fecha');
  var ss = planillaDeCuenta_(cuenta);

  var comboServicio = resolverServiciosActivos_(ss, params);
  var horarios;

  if (idBarbero === 'cualquiera') {
    var barberosActivos = leerHoja_(ss, 'Barberos')
      .filter(function (b) { return esActivo_(b.activo); });
    var listas = [];
    for (var i = 0; i < barberosActivos.length; i++) {
      listas.push(calcularDisponibilidad_(ss, cuenta, barberosActivos[i].id_barbero, fecha, comboServicio.duracion_total));
    }
    horarios = unirHorariosDisponibles(listas);
  } else {
    if (!barberoActivo_(ss, idBarbero)) {
      throw errorApp_(ERR.NO_ENCONTRADO, 'El profesional elegido no está disponible.');
    }
    horarios = calcularDisponibilidad_(ss, cuenta, idBarbero, fecha, comboServicio.duracion_total);
  }

  return ok_({
    fecha: fecha,
    id_barbero: idBarbero,
    id_servicio: comboServicio.id_servicio_str,
    duracion_minutos: comboServicio.duracion_total,
    horarios: horarios
  });
}

/**
 * Núcleo del cálculo de disponibilidad para un barbero individual.
 */
function calcularDisponibilidad_(ss, cuenta, idBarbero, fecha, duracionMin) {
  var diaSemana = diaSemanaDeFecha_(fecha);
  var margen = cuenta.margen_turno_min || 0;

  var ventanas = ventanasDelDia(leerHoja_(ss, 'Horarios_disponibles'), idBarbero, diaSemana);
  if (!ventanas.length) return [];

  var ocupados = turnosOcupados(leerHoja_(ss, 'Turnos'), idBarbero, fecha, ESTADOS_QUE_OCUPAN, margen)
    .concat(bloqueosDelDia(leerHoja_(ss, 'Bloqueos'), idBarbero, fecha));

  var hoy = hoyEnZona_(cuenta.zona_horaria);
  var desdeMinuto;
  if (fecha < hoy) {
    return [];
  } else if (fecha === hoy) {
    desdeMinuto = aMinutos(ahoraEnZona_(cuenta.zona_horaria)) + cuenta.antelacion_min_horas * 60;
  } else {
    desdeMinuto = -Infinity;
  }

  return calcularSlotsLibres({
    ventanas: ventanas,
    ocupados: ocupados,
    duracionMin: duracionMin,
    pasoMin: cuenta.paso_grilla_min,
    margenMin: margen,
    desdeMinuto: desdeMinuto
  });
}

/**
 * Crea un turno (con soporte de combos de servicios y asignación para "cualquiera").
 */
function epCrearTurno_(params) {
  var cuenta = cuentaPorSlug_(params.slug);
  var idBarbero = exigirTexto_(params, 'id_barbero', 60);
  var fecha = exigirFecha_(params, 'fecha');
  var hora = exigirHora_(params, 'hora');
  var nombre = exigirTexto_(params, 'cliente_nombre', 80);
  var telefono = normalizarTelefono_(params.cliente_telefono);

  // --- Fase 1: sin lock -----------------------------------------------------

  verificarTurnstile_(params.turnstile_token);

  var ss = planillaDeCuenta_(cuenta);

  if (estaEnListaNegra_(ss, telefono)) {
    throw errorApp_(ERR.TELEFONO_BLOQUEADO, 'No pudimos completar la reserva. Comunicate con el negocio.');
  }

  limitarReservasPorTelefono_(cuenta.id_cuenta, telefono);

  var comboServicio = resolverServiciosActivos_(ss, params);
  var esCualquiera = (idBarbero === 'cualquiera');
  var barbero = null;

  if (!esCualquiera) {
    barbero = buscarBarberoActivo_(ss, idBarbero);
    var horariosLibres = calcularDisponibilidad_(ss, cuenta, idBarbero, fecha, comboServicio.duracion_total);
    if (horariosLibres.indexOf(hora) === -1) {
      throw errorApp_(ERR.SLOT_OCUPADO, 'Ese horario ya no está disponible. Elegí otro.');
    }
  } else {
    var barberosActivos = leerHoja_(ss, 'Barberos').filter(function (b) { return esActivo_(b.activo); });
    var hayLibre = false;
    for (var b = 0; b < barberosActivos.length; b++) {
      var hDisponibles = calcularDisponibilidad_(ss, cuenta, barberosActivos[b].id_barbero, fecha, comboServicio.duracion_total);
      if (hDisponibles.indexOf(hora) !== -1) {
        hayLibre = true;
        break;
      }
    }
    if (!hayLibre) {
      throw errorApp_(ERR.SLOT_OCUPADO, 'Ese horario ya no está disponible. Elegí otro.');
    }
  }

  var inicioMin = aMinutos(hora);
  var finMin = inicioMin + comboServicio.duracion_total;
  var horaFin = aHoraTexto(finMin);
  var finMinConMargen = finMin + (cuenta.margen_turno_min || 0);

  // --- Fase 2: sección crítica ---------------------------------------------

  var turnoGuardado;
  var barberoAsignadoNombre = '';

  conLock_(function () {
    var margen = cuenta.margen_turno_min || 0;
    var turnosFilas = leerHoja_(ss, 'Turnos');
    var bloqueosFilas = leerHoja_(ss, 'Bloqueos');
    var barberoFinal = barbero;

    if (esCualquiera) {
      var barberosActivos = leerHoja_(ss, 'Barberos').filter(function (b) { return esActivo_(b.activo); });
      var diaSemana = diaSemanaDeFecha_(fecha);
      var horariosFilas = leerHoja_(ss, 'Horarios_disponibles');
      var asignado = null;

      for (var i = 0; i < barberosActivos.length; i++) {
        var cand = barberosActivos[i];
        var ventanas = ventanasDelDia(horariosFilas, cand.id_barbero, diaSemana);
        if (!ventanas.length) continue;

        var entraEnVentana = false;
        for (var v = 0; v < ventanas.length; v++) {
          if (inicioMin >= ventanas[v].inicio && (inicioMin + comboServicio.duracion_total) <= ventanas[v].fin) {
            entraEnVentana = true;
            break;
          }
        }
        if (!entraEnVentana) continue;

        var ocupados = turnosOcupados(turnosFilas, cand.id_barbero, fecha, ESTADOS_QUE_OCUPAN, margen)
          .concat(bloqueosDelDia(bloqueosFilas, cand.id_barbero, fecha));

        var solapa = false;
        for (var o = 0; o < ocupados.length; o++) {
          if (seSolapan(inicioMin, finMinConMargen, ocupados[o].inicio, ocupados[o].fin)) {
            solapa = true;
            break;
          }
        }
        if (!solapa) {
          asignado = cand;
          break;
        }
      }

      if (!asignado) {
        throw errorApp_(ERR.SLOT_OCUPADO, 'Ese horario se acaba de ocupar. Elegí otro.');
      }
      barberoFinal = { id_barbero: String(asignado.id_barbero), nombre: String(asignado.nombre) };
    } else {
      var ocupados = turnosOcupados(turnosFilas, barberoFinal.id_barbero, fecha, ESTADOS_QUE_OCUPAN, margen)
        .concat(bloqueosDelDia(bloqueosFilas, barberoFinal.id_barbero, fecha));
      for (var j = 0; j < ocupados.length; j++) {
        if (seSolapan(inicioMin, finMinConMargen, ocupados[j].inicio, ocupados[j].fin)) {
          throw errorApp_(ERR.SLOT_OCUPADO, 'Ese horario se acaba de ocupar. Elegí otro.');
        }
      }
    }

    barberoAsignadoNombre = barberoFinal.nombre;

    turnoGuardado = {
      id_turno: nuevoId_('t'),
      codigo_ticket: nuevoCodigoTicket_(),
      id_barbero: barberoFinal.id_barbero,
      id_servicio: comboServicio.id_servicio_str,
      servicio_nombre: comboServicio.servicio_nombre,
      duracion_minutos: comboServicio.duracion_total,
      precio: comboServicio.precio_total,
      cliente_nombre: nombre,
      cliente_telefono: telefono,
      fecha: fecha,
      hora: hora,
      hora_fin: horaFin,
      estado: 'confirmado',
      creado_en: ahoraIso_(),
      cancelado_por: ''
    };

    agregarFila_(ss, 'Turnos', turnoGuardado);
  });

  return ok_({
    id_turno: turnoGuardado.id_turno,
    codigo_ticket: turnoGuardado.codigo_ticket,
    nombre_negocio: cuenta.nombre_negocio,
    barbero_nombre: barberoAsignadoNombre,
    servicio_nombre: comboServicio.servicio_nombre,
    fecha: fecha,
    hora: hora,
    hora_fin: horaFin,
    precio: comboServicio.precio_total
  });
}

/** Consulta de un turno por código de ticket. */
function epGetTurno_(params) {
  var cuenta = cuentaPorSlug_(params.slug);
  var codigo = exigirTexto_(params, 'codigo_ticket', 20).toUpperCase();
  var ss = planillaDeCuenta_(cuenta);

  var turno = buscarTurnoPorTicket_(ss, codigo);
  if (!turno) {
    limitarConsultasTicket_(cuenta.id_cuenta);
    throw errorApp_(ERR.NO_ENCONTRADO, 'No encontramos ningún turno con ese código.');
  }

  return ok_(vistaPublicaDeTurno_(ss, cuenta, turno));
}

/** Cancelación por parte del cliente, usando el código de ticket. */
function epCancelarTurnoCliente_(params) {
  var cuenta = cuentaPorSlug_(params.slug);
  var codigo = exigirTexto_(params, 'codigo_ticket', 20).toUpperCase();
  var ss = planillaDeCuenta_(cuenta);

  var turno = buscarTurnoPorTicket_(ss, codigo);
  if (!turno) {
    limitarConsultasTicket_(cuenta.id_cuenta);
    throw errorApp_(ERR.NO_ENCONTRADO, 'No encontramos ningún turno con ese código.');
  }

  if (String(turno.estado) === 'cancelado') {
    return ok_({ id_turno: String(turno.id_turno), estado: 'cancelado', ya_estaba: true });
  }
  if (String(turno.estado) !== 'confirmado') {
    throw errorApp_(ERR.FUERA_DE_PLAZO, 'Este turno ya no se puede cancelar.');
  }

  exigirPlazoDeCancelacion_(cuenta, turno);

  actualizarFila_(ss, 'Turnos', turno._fila, { estado: 'cancelado', cancelado_por: 'cliente' });

  return ok_({ id_turno: String(turno.id_turno), estado: 'cancelado', ya_estaba: false });
}

/**
 * Impide cancelar con menos antelación que la configurada, para que el negocio
 * tenga margen de reasignar el horario.
 */
function exigirPlazoDeCancelacion_(cuenta, turno) {
  var hoy = hoyEnZona_(cuenta.zona_horaria);
  var fecha = String(turno.fecha);

  if (fecha < hoy) {
    throw errorApp_(ERR.FUERA_DE_PLAZO, 'Este turno ya pasó.');
  }
  if (fecha > hoy) return;

  var minutosAhora = aMinutos(ahoraEnZona_(cuenta.zona_horaria));
  var minutosTurno = aMinutos(String(turno.hora));
  if (isNaN(minutosTurno)) return;

  if (minutosTurno - minutosAhora < cuenta.cancelacion_min_horas * 60) {
    throw errorApp_(ERR.FUERA_DE_PLAZO,
      'Los turnos se cancelan con al menos ' + cuenta.cancelacion_min_horas +
      ' h de anticipación. Comunicate con el negocio.');
  }
}

// ---------------------------------------------------------------------------
// Auxiliares compartidos
// ---------------------------------------------------------------------------

/**
 * Resuelve uno o varios servicios solicitados, validando que existan y estén activos.
 * Devuelve { duracion_total, precio_total, servicio_nombre, id_servicio_str, servicios }.
 */
function resolverServiciosActivos_(ss, params) {
  var ids = [];
  if (Array.isArray(params.id_servicios)) {
    ids = params.id_servicios.map(String).filter(Boolean);
  } else if (typeof params.id_servicios === 'string' && params.id_servicios.trim()) {
    ids = params.id_servicios.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  } else if (params.id_servicio) {
    ids = [String(params.id_servicio).trim()];
  }

  if (!ids.length) {
    throw errorApp_(ERR.ENTRADA_INVALIDA, 'Falta indicar al menos un servicio.');
  }

  var serviciosResueltos = [];
  var duracionTotal = 0;
  var precioTotal = 0;
  var nombres = [];

  for (var i = 0; i < ids.length; i++) {
    var serv = buscarServicioActivo_(ss, ids[i]);
    serviciosResueltos.push(serv);
    duracionTotal += serv.duracion_minutos;
    precioTotal += serv.precio;
    nombres.push(serv.nombre);
  }

  return {
    servicios: serviciosResueltos,
    duracion_total: duracionTotal,
    precio_total: precioTotal,
    servicio_nombre: nombres.join(' + '),
    id_servicio_str: ids.join(',')
  };
}

function buscarServicioActivo_(ss, idServicio) {
  var filas = leerHoja_(ss, 'Servicios');
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id_servicio) === String(idServicio) && esActivo_(filas[i].activo)) {
      var duracion = Number(filas[i].duracion_minutos);
      if (!(duracion > 0)) {
        throw errorApp_(ERR.INTERNO, 'El servicio "' + filas[i].nombre + '" no tiene una duración válida.');
      }
      return {
        id_servicio: String(filas[i].id_servicio),
        nombre: String(filas[i].nombre),
        duracion_minutos: duracion,
        precio: Number(filas[i].precio) || 0
      };
    }
  }
  throw errorApp_(ERR.NO_ENCONTRADO, 'El servicio elegido no está disponible.');
}

function buscarBarberoActivo_(ss, idBarbero) {
  var filas = leerHoja_(ss, 'Barberos');
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].id_barbero) === String(idBarbero) && esActivo_(filas[i].activo)) {
      return { id_barbero: String(filas[i].id_barbero), nombre: String(filas[i].nombre) };
    }
  }
  throw errorApp_(ERR.NO_ENCONTRADO, 'El profesional elegido no está disponible.');
}

function barberoActivo_(ss, idBarbero) {
  try {
    buscarBarberoActivo_(ss, idBarbero);
    return true;
  } catch (err) {
    return false;
  }
}

function buscarTurnoPorTicket_(ss, codigo) {
  var filas = leerHoja_(ss, 'Turnos');
  for (var i = 0; i < filas.length; i++) {
    if (String(filas[i].codigo_ticket).trim().toUpperCase() === codigo) return filas[i];
  }
  return null;
}

/** Proyección de un turno para el cliente: sin datos de nadie más. */
function vistaPublicaDeTurno_(ss, cuenta, turno) {
  var nombreBarbero = '';
  var barberos = leerHoja_(ss, 'Barberos');
  for (var i = 0; i < barberos.length; i++) {
    if (String(barberos[i].id_barbero) === String(turno.id_barbero)) {
      nombreBarbero = String(barberos[i].nombre);
      break;
    }
  }

  return {
    id_turno: String(turno.id_turno),
    codigo_ticket: String(turno.codigo_ticket),
    nombre_negocio: cuenta.nombre_negocio,
    barbero_nombre: nombreBarbero,
    servicio_nombre: String(turno.servicio_nombre || ''),
    cliente_nombre: String(turno.cliente_nombre || ''),
    fecha: String(turno.fecha),
    hora: String(turno.hora),
    hora_fin: String(turno.hora_fin || ''),
    precio: Number(turno.precio) || 0,
    estado: String(turno.estado)
  };
}
