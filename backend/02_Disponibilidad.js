/**
 * Cálculo de horarios disponibles — lógica pura.
 *
 * Este archivo NO puede depender de SpreadsheetApp, CacheService ni de ningún
 * servicio de Apps Script. Es la única parte del backend con lógica no trivial,
 * y mantenerla pura permite ejecutarla con Node desde `tests/`, cosa que dentro
 * del editor de Apps Script es impracticable.
 *
 * Convención interna: todos los horarios se manejan como minutos desde la
 * medianoche (enteros), y los intervalos son semiabiertos [inicio, fin).
 */

/** "09:30" -> 570. Devuelve NaN si el formato no es válido. */
function aMinutos(hhmm) {
  if (typeof hhmm !== 'string') return NaN;
  var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Igual que `aMinutos` pero para valores LEÍDOS DE LA PLANILLA, que no siempre
 * llegan como "HH:mm".
 *
 * Las columnas de hora se crean con formato "@" (texto plano) justamente para
 * evitarlo, pero alcanza con que alguien edite una celda a mano, pegue una
 * fila, o que una planilla vieja se haya creado sin ese formato, para que
 * Sheets interprete "11:00" como una hora y la devuelva como "11:00:00" o como
 * "11:00 a. m." según la configuración regional.
 *
 * `aMinutos` sigue siendo estricta y es la que valida lo que manda el cliente:
 * la entrada de la API tiene que ser "HH:mm" y nada más. Esta tolerancia es
 * solo para los datos que ya están guardados.
 */
function aMinutosDeCelda(valor) {
  if (valor === null || valor === undefined) return NaN;

  // Si la lectura vino con getValues() en vez de getDisplayValues(), una hora
  // llega como Date sobre el 30/12/1899.
  if (valor instanceof Date) {
    return valor.getHours() * 60 + valor.getMinutes();
  }

  var texto = String(valor).trim();
  if (!texto) return NaN;

  var m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?$/i.exec(texto);
  if (!m) return NaN;

  var horas = Number(m[1]);
  var minutos = Number(m[2]);
  if (minutos > 59) return NaN;

  var sufijo = (m[3] || '').replace(/[.\s]/g, '').toLowerCase();
  if (sufijo === 'pm' && horas < 12) horas += 12;
  if (sufijo === 'am' && horas === 12) horas = 0;

  if (horas > 24 || (horas === 24 && minutos > 0)) return NaN;
  return horas * 60 + minutos;
}

/** 570 -> "09:30". Admite 1440 ("24:00") como fin de jornada. */
function aHoraTexto(minutos) {
  var h = Math.floor(minutos / 60);
  var m = minutos % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

/** Dos intervalos semiabiertos se solapan si cada uno empieza antes de que termine el otro. */
function seSolapan(aInicio, aFin, bInicio, bFin) {
  return aInicio < bFin && bInicio < aFin;
}

/**
 * Calcula los horarios de inicio en los que se puede reservar un servicio.
 *
 * @param {Object} p
 * @param {Array<{inicio:number, fin:number}>} p.ventanas
 *        Ventanas de trabajo del barbero ese día, en minutos. Puede haber más
 *        de una: el horario partido (9-13 y 16-20) es el caso típico y una sola
 *        ventana no puede representarlo.
 * @param {Array<{inicio:number, fin:number}>} p.ocupados
 *        Intervalos ya tomados: turnos que ocupan y bloqueos que aplican.
 * @param {number} p.duracionMin  Duración del servicio elegido.
 * @param {number} p.pasoMin      Granularidad de la grilla (por defecto 15).
 * @param {number} [p.desdeMinuto]
 *        Primer minuto admisible del día. Se usa para la antelación mínima
 *        cuando la fecha consultada es hoy. Omitido = sin restricción.
 * @returns {Array<string>} Horarios "HH:mm" ordenados y sin repetir.
 */
function calcularSlotsLibres(p) {
  var ventanas = p.ventanas || [];
  var ocupados = p.ocupados || [];
  var duracion = p.duracionMin;
  var paso = p.pasoMin > 0 ? p.pasoMin : 15;
  var margen = (typeof p.margenMin === 'number' && p.margenMin > 0) ? p.margenMin : 0;
  var desde = (typeof p.desdeMinuto === 'number') ? p.desdeMinuto : -Infinity;

  if (!(duracion > 0)) return [];

  var encontrados = {};
  var salida = [];

  for (var v = 0; v < ventanas.length; v++) {
    var ventana = ventanas[v];
    if (!(ventana.fin > ventana.inicio)) continue;

    for (var inicio = ventana.inicio; inicio + duracion <= ventana.fin; inicio += paso) {
      var fin = inicio + duracion;
      var finConMargen = fin + margen;

      // El turno tiene que entrar completo en la ventana. La condición del for
      // ya lo garantiza, y es lo que permite ofrecer las 10:15 para un servicio
      // de 45 minutos sin dejar huecos muertos al final de la ventana.

      if (inicio < desde) continue;

      var libre = true;
      for (var o = 0; o < ocupados.length; o++) {
        if (seSolapan(inicio, finConMargen, ocupados[o].inicio, ocupados[o].fin)) {
          libre = false;
          break;
        }
      }
      if (!libre) continue;

      var texto = aHoraTexto(inicio);
      if (!encontrados[texto]) {
        encontrados[texto] = true;
        salida.push(texto);
      }
    }
  }

  salida.sort();
  return salida;
}

/**
 * Convierte las filas de `Horarios_disponibles` en ventanas de minutos para un
 * día de la semana concreto. Descarta filas mal cargadas en lugar de romper:
 * una fila corrupta no debe dejar al negocio sin agenda.
 */
function ventanasDelDia(filasHorarios, idBarbero, diaSemana) {
  var ventanas = [];
  for (var i = 0; i < filasHorarios.length; i++) {
    var f = filasHorarios[i];
    if (String(f.id_barbero) !== String(idBarbero)) continue;
    if (Number(f.dia_semana) !== Number(diaSemana)) continue;

    var inicio = aMinutosDeCelda(f.hora_inicio);
    var fin = aMinutosDeCelda(f.hora_fin);
    // Una franja ilegible se descarta: el barbero queda sin esa ventana, que es
    // el lado seguro del error (no se ofrece nada que no se pueda verificar).
    if (isNaN(inicio) || isNaN(fin) || fin <= inicio) continue;

    ventanas.push({ inicio: inicio, fin: fin });
  }
  return ventanas;
}

/**
 * Intervalos ocupados por bloqueos en una fecha dada.
 *
 * Un bloqueo aplica si la fecha cae dentro de [fecha_inicio, fecha_fin]
 * (ambos inclusive) y si es del barbero o de "todos". Si no tiene horas,
 * bloquea el día entero.
 *
 * Las fechas se normalizan con `aFechaIsoDeCelda` en vez de compararse como
 * cadenas crudas. Comparar crudo es lo que hacía desaparecer unas vacaciones
 * enteras: si la celda perdía el formato "@", Sheets devolvía "1/9/2026" y
 * `"1/9/2026" >= "2026-09-01"` es false, así que el bloqueo no aplicaba a
 * ningún día y el negocio volvía a ofrecer turnos en silencio.
 */
function bloqueosDelDia(filasBloqueos, idBarbero, fechaIso) {
  var salida = [];
  for (var i = 0; i < filasBloqueos.length; i++) {
    var b = filasBloqueos[i];

    var destino = String(b.id_barbero || '').trim();
    if (destino !== 'todos' && destino !== String(idBarbero)) continue;

    var crudoDesde = textoDeCelda_(b.fecha_inicio);
    // Una fila sin fecha de inicio no es un bloqueo: no hay nada que aplicar.
    if (!crudoDesde) continue;

    var desde = aFechaIsoDeCelda(b.fecha_inicio);
    var crudoHasta = textoDeCelda_(b.fecha_fin);
    var hasta = crudoHasta ? aFechaIsoDeCelda(b.fecha_fin) : desde;

    // Una fecha ilegible NO puede leerse como "este bloqueo no aplica hoy":
    // ese es justamente el camino por el que un bloqueo cargado se evapora.
    // Se bloquea el día, igual que con un turno ilegible.
    if (desde === null || hasta === null) {
      return diaBloqueadoPorFechaIlegible_(b, fechaIso);
    }

    if (fechaIso < desde || fechaIso > hasta) continue;

    var inicio = aMinutosDeCelda(b.hora_inicio);
    var fin = aMinutosDeCelda(b.hora_fin);
    if (isNaN(inicio) || isNaN(fin) || fin <= inicio) {
      // Sin horas válidas, el bloqueo cubre el día completo.
      inicio = 0;
      fin = 1440;
    }
    salida.push({ inicio: inicio, fin: fin });
  }
  return salida;
}

/**
 * Intervalos ocupados por turnos de un barbero en una fecha.
 * `cancelado` libera el horario; el resto de los estados lo ocupan.
 */
function turnosOcupados(filasTurnos, idBarbero, fechaIso, estadosQueOcupan, margenMinutos) {
  var ocupan = estadosQueOcupan || ['confirmado', 'completado', 'no_asistio'];
  var margen = (typeof margenMinutos === 'number' && margenMinutos > 0) ? margenMinutos : 0;
  var salida = [];

  for (var i = 0; i < filasTurnos.length; i++) {
    var t = filasTurnos[i];
    if (String(t.id_barbero) !== String(idBarbero)) continue;
    // El estado se mira ANTES que la fecha: un turno cancelado no ocupa nada,
    // así que tampoco tiene por qué activar el bloqueo por fila ilegible.
    if (ocupan.indexOf(String(t.estado)) === -1) continue;

    var esDeEsteDia = mismaFecha(t.fecha, fechaIso);
    if (esDeEsteDia === false) continue;
    if (esDeEsteDia === null) return diaBloqueadoPorFilaIlegible_(t, fechaIso, 'fecha');

    var inicio = aMinutosDeCelda(t.hora);

    var fin = aMinutosDeCelda(t.hora_fin);
    if (isNaN(fin)) {
      // Respaldo para filas viejas sin hora_fin: se reconstruye con la
      // duración congelada en el propio turno, nunca con la del servicio
      // actual, que puede haber cambiado desde que se reservó.
      var duracion = Number(t.duracion_minutos);
      if (duracion > 0 && !isNaN(inicio)) fin = inicio + duracion;
    }

    if (isNaN(inicio) || isNaN(fin) || fin <= inicio) {
      return diaBloqueadoPorFilaIlegible_(t, fechaIso, 'hora');
    }

    salida.push({ inicio: inicio, fin: fin + margen });
  }
  return salida;
}

/**
 * Respuesta ante una fila de turno que no se puede interpretar.
 *
 * Devuelve el día entero ocupado. Una fila ilegible NO puede contarse como
 * "no hay nada reservado": eso es exactamente lo que termina con dos clientes
 * citados en el mismo horario. Bloquear el día es visible, el dueño lo reclama
 * y se corrige; una doble reserva se descubre con las dos personas paradas en
 * el local. El log deja el motivo real del lado del servidor.
 */
function diaBloqueadoPorFilaIlegible_(turno, fechaIso, campo) {
  if (typeof console !== 'undefined' && console.error) {
    console.error('Turno ilegible (campo ' + campo + ') al calcular ' + fechaIso +
      ': id_turno="' + String(turno.id_turno) + '", fecha="' + String(turno.fecha) +
      '", hora="' + String(turno.hora) + '", hora_fin="' + String(turno.hora_fin) +
      '". Se bloquea el día por seguridad.');
  }
  return [{ inicio: 0, fin: 1440 }];
}

/** Texto recortado de una celda, tolerando null y undefined. */
function textoDeCelda_(valor) {
  return String(valor === null || valor === undefined ? '' : valor).trim();
}

/**
 * Normaliza la fecha guardada en una celda a "YYYY-MM-DD".
 *
 * Devuelve null cuando no se puede interpretar. Ese caso importa: una fecha
 * que no se entiende no es lo mismo que una fecha que no coincide, y todo el
 * que compare fechas leídas de la planilla tiene que distinguirlos — comparar
 * la cadena cruda contra un ISO da `false` en silencio y hace desaparecer
 * turnos y bloqueos que sí existen.
 */
function aFechaIsoDeCelda(valor) {
  // Si la lectura vino con getValues() en vez de getDisplayValues(), la fecha
  // llega como Date en la zona del archivo.
  if (valor instanceof Date) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return valor.getFullYear() + '-' + p(valor.getMonth() + 1) + '-' + p(valor.getDate());
  }

  var texto = textoDeCelda_(valor);
  if (!texto) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;

  // "1/9/2026" y "01/09/2026": día primero, que es como muestra Sheets con la
  // configuración regional de Argentina. Un formato con el mes primero daría el
  // mismo texto para el 1/9 y el 9/1, así que no se adivina: se devuelve null y
  // quien llama decide del lado seguro.
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  if (m) {
    var p2 = function (n) { return (Number(n) < 10 ? '0' : '') + Number(n); };
    return m[3] + '-' + p2(m[2]) + '-' + p2(m[1]);
  }

  return null;
}

/**
 * Compara la fecha guardada en una fila con una fecha ISO.
 *
 * Devuelve true, false, o null cuando la celda no se puede interpretar. Ese
 * tercer caso importa: si no sabemos de qué día es un turno, no podemos
 * afirmar que no es de hoy, y quien llama tiene que tratarlo como ocupado.
 */
function mismaFecha(valorCelda, fechaIso) {
  var iso = aFechaIsoDeCelda(valorCelda);
  return iso === null ? null : iso === fechaIso;
}

/**
 * Respuesta ante un bloqueo cuya fecha no se puede interpretar.
 *
 * Mismo criterio que con un turno ilegible: bloquear el día es visible y el
 * dueño lo reclama; un bloqueo que se evapora se descubre cuando aparece
 * alguien a cortarse el pelo el día que el local está cerrado.
 */
function diaBloqueadoPorFechaIlegible_(bloqueo, fechaIso) {
  if (typeof console !== 'undefined' && console.error) {
    console.error('Bloqueo ilegible al calcular ' + fechaIso +
      ': id_bloqueo="' + String(bloqueo.id_bloqueo) +
      '", fecha_inicio="' + String(bloqueo.fecha_inicio) +
      '", fecha_fin="' + String(bloqueo.fecha_fin) +
      '". Se bloquea el día por seguridad.');
  }
  return [{ inicio: 0, fin: 1440 }];
}

/**
 * Une y ordena sin duplicados las listas de horarios disponibles de múltiples barberos.
 */
function unirHorariosDisponibles(listas) {
  var encontrados = {};
  var salida = [];
  for (var i = 0; i < listas.length; i++) {
    var lista = listas[i] || [];
    for (var j = 0; j < lista.length; j++) {
      var hora = lista[j];
      if (!encontrados[hora]) {
        encontrados[hora] = true;
        salida.push(hora);
      }
    }
  }
  salida.sort();
  return salida;
}

// Permite `require()` desde los tests en Node sin afectar a Apps Script,
// donde `module` no existe.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    aMinutos: aMinutos,
    aMinutosDeCelda: aMinutosDeCelda,
    aFechaIsoDeCelda: aFechaIsoDeCelda,
    mismaFecha: mismaFecha,
    aHoraTexto: aHoraTexto,
    seSolapan: seSolapan,
    calcularSlotsLibres: calcularSlotsLibres,
    unirHorariosDisponibles: unirHorariosDisponibles,
    ventanasDelDia: ventanasDelDia,
    bloqueosDelDia: bloqueosDelDia,
    turnosOcupados: turnosOcupados
  };
}
