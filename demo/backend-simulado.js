/**
 * Backend simulado para el modo demo del servidor local.
 *
 * Responde el MISMO contrato que el Web App de Apps Script —siempre `ok:true`
 * con `data`, o `ok:false` con `{codigo, mensaje}`— pero contra datos en
 * memoria, sin Google de por medio. Existe para poder recorrer la aplicación
 * entera en una máquina sin cuenta de Firebase, sin planilla y sin haber dado
 * de alta ningún negocio.
 *
 * Dos decisiones que lo mantienen honesto:
 *
 * 1. La disponibilidad NO está inventada: se calcula con `02_Disponibilidad.js`,
 *    el mismo archivo que corre en producción. Es lógica pura, no toca ningún
 *    servicio de Apps Script, y por eso se puede requerir desde acá igual que
 *    lo hacen los tests. Así el horario partido, el margen entre turnos, la
 *    antelación mínima y los bloqueos se comportan como de verdad, en vez de
 *    devolver una lista fija que se ve bien y no prueba nada.
 *
 * 2. Los errores se devuelven con los mismos códigos (`NO_ENCONTRADO`,
 *    `SLOT_OCUPADO`, `ACCION_DESCONOCIDA`…). Una pantalla que ramifica por
 *    código se ve acá tal como se va a ver en producción.
 *
 * Lo que NO simula, a propósito: la verificación de tokens de Firebase. En modo
 * demo la sesión del panel es falsa (ver `server.js`), así que el `token` llega
 * y se ignora. Nada de esto se sirve fuera de `--demo`.
 *
 * El estado vive en memoria: se reinicia con el servidor.
 */

'use strict';

const D = require('../backend/02_Disponibilidad.js');

const ESTADOS_QUE_OCUPAN = ['confirmado', 'completado', 'no_asistio'];
const ALFABETO_TICKET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO_TICKET = 10;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const ok = (data) => ({ ok: true, data });
const fallo = (codigo, mensaje) => ({ ok: false, error: { codigo, mensaje } });

/** Error con código, para cortar desde cualquier profundidad como hace el real. */
function errorApp(codigo, mensaje) {
  const err = new Error(mensaje);
  err.codigoApp = codigo;
  return err;
}

const hoyIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const ahoraEnMinutos = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

function sumarDias(fechaIso, dias) {
  const [a, m, d] = fechaIso.split('-').map(Number);
  const fecha = new Date(a, m - 1, d + dias);
  const p = (n) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}

/** 0 = domingo, igual que `diaSemanaDeFecha_` del backend real. */
function diaSemanaDeFecha(fechaIso) {
  const [a, m, d] = fechaIso.split('-').map(Number);
  return new Date(a, m - 1, d).getDay();
}

let contador = 0;
const nuevoId = (prefijo) => `${prefijo}_demo${++contador}`;

function nuevoCodigoTicket() {
  let salida = '';
  for (let i = 0; i < LARGO_TICKET; i++) {
    salida += ALFABETO_TICKET.charAt(Math.floor(Math.random() * ALFABETO_TICKET.length));
  }
  return salida;
}

const soloDigitos = (valor) => String(valor || '').replace(/\D/g, '');

function exigirTexto(params, clave) {
  const valor = String((params && params[clave]) || '').trim();
  if (!valor) throw errorApp('ENTRADA_INVALIDA', `Falta el parámetro "${clave}".`);
  return valor;
}

function exigirFecha(params, clave) {
  const valor = exigirTexto(params, clave);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw errorApp('ENTRADA_INVALIDA', `El parámetro "${clave}" no es una fecha válida.`);
  }
  return valor;
}

// ---------------------------------------------------------------------------
// Datos de ejemplo
// ---------------------------------------------------------------------------

/**
 * Un negocio con la forma que tiene uno real después de un par de semanas de
 * uso: horario partido, dos profesionales con agendas distintas, turnos en
 * varios estados y un bloqueo. Sin eso el panel abre vacío y no se ve nada de
 * lo que hay para ver.
 */
function estadoInicial() {
  const hoy = hoyIso();

  const cuenta = {
    id_cuenta: 'cta_demo',
    tipo: 'barberia',
    nombre_negocio: 'Barbería Demo',
    slug: 'demo',
    email: 'demo@barberia.test',
    zona_horaria: 'America/Argentina/Buenos_Aires',
    paso_grilla_min: 15,
    antelacion_min_horas: 2,
    cancelacion_min_horas: 4,
    margen_turno_min: 10,
    direccion: 'Av. Siempreviva 742',
    instagram: 'barberia.demo',
    telefono_contacto: '1122334455',
    spreadsheet_url: 'https://docs.google.com/spreadsheets/d/PLANILLA-DE-MENTIRA'
  };

  const barberos = [
    { id_barbero: 'bar_carlos', nombre: 'Carlos', activo: true },
    { id_barbero: 'bar_nico', nombre: 'Nico', activo: true }
  ];

  const servicios = [
    { id_servicio: 'srv_corte', nombre: 'Corte clásico', duracion_minutos: 30, precio: 8000, activo: true },
    { id_servicio: 'srv_barba', nombre: 'Barba', duracion_minutos: 20, precio: 5000, activo: true },
    { id_servicio: 'srv_combo', nombre: 'Corte + Barba', duracion_minutos: 45, precio: 12000, activo: true },
    { id_servicio: 'srv_color', nombre: 'Color', duracion_minutos: 60, precio: 18000, activo: true }
  ];

  // Horario partido de lunes a viernes y sábado a la mañana. Nico entra más
  // tarde: dos agendas distintas es lo que hace visible el "cualquiera
  // disponible", que con horarios idénticos no se distingue de un solo barbero.
  const horarios = [];
  for (let dia = 1; dia <= 5; dia++) {
    horarios.push({ id_barbero: 'bar_carlos', dia_semana: dia, hora_inicio: '09:00', hora_fin: '13:00' });
    horarios.push({ id_barbero: 'bar_carlos', dia_semana: dia, hora_inicio: '16:00', hora_fin: '20:00' });
    horarios.push({ id_barbero: 'bar_nico', dia_semana: dia, hora_inicio: '11:00', hora_fin: '19:00' });
  }
  horarios.push({ id_barbero: 'bar_carlos', dia_semana: 6, hora_inicio: '09:00', hora_fin: '14:00' });
  horarios.push({ id_barbero: 'bar_nico', dia_semana: 6, hora_inicio: '09:00', hora_fin: '14:00' });

  const turno = (extra) => Object.assign({
    id_turno: nuevoId('tur'),
    codigo_ticket: nuevoCodigoTicket(),
    id_servicio: 'srv_corte',
    servicio_nombre: 'Corte clásico',
    duracion_minutos: 30,
    precio: 8000,
    estado: 'confirmado',
    creado_en: new Date().toISOString()
  }, extra);

  const turnos = [
    turno({ id_barbero: 'bar_carlos', cliente_nombre: 'Juan Pérez', cliente_telefono: '1145678901', fecha: hoy, hora: '09:30', hora_fin: '10:00', estado: 'completado' }),
    turno({ id_barbero: 'bar_nico', cliente_nombre: 'Ana Gómez', cliente_telefono: '1155667788', fecha: hoy, hora: '11:30', hora_fin: '11:50', id_servicio: 'srv_barba', servicio_nombre: 'Barba', duracion_minutos: 20, precio: 5000, estado: 'completado' }),
    turno({ id_barbero: 'bar_carlos', cliente_nombre: 'Luis Díaz', cliente_telefono: '1133445566', fecha: hoy, hora: '17:00', hora_fin: '17:45', id_servicio: 'srv_combo', servicio_nombre: 'Corte + Barba', duracion_minutos: 45, precio: 12000 }),
    turno({ id_barbero: 'bar_nico', cliente_nombre: 'Sofía Ruiz', cliente_telefono: '1177889900', fecha: sumarDias(hoy, 1), hora: '12:00', hora_fin: '12:30' }),
    turno({ id_barbero: 'bar_carlos', cliente_nombre: 'Martín Vega', cliente_telefono: '1166554433', fecha: sumarDias(hoy, 1), hora: '16:30', hora_fin: '17:00', estado: 'cancelado', cancelado_por: 'cliente' }),
    turno({ id_barbero: 'bar_nico', cliente_nombre: 'Pedro Sosa', cliente_telefono: '1122110099', fecha: sumarDias(hoy, -3), hora: '15:00', hora_fin: '15:30', estado: 'no_asistio' })
  ];

  const bloqueos = [{
    id_bloqueo: nuevoId('blq'),
    id_barbero: 'bar_carlos',
    fecha_inicio: sumarDias(hoy, 3),
    fecha_fin: sumarDias(hoy, 3),
    hora_inicio: '',
    hora_fin: '',
    motivo: 'Franco'
  }];

  const listaNegra = [{
    telefono: '1199887766',
    fecha_bloqueo: sumarDias(hoy, -10),
    motivo: 'Faltó a tres turnos sin avisar'
  }];

  return { cuenta, barberos, servicios, horarios, bloqueos, turnos, listaNegra, historico: [] };
}

// ---------------------------------------------------------------------------
// Consultas sobre el estado
// ---------------------------------------------------------------------------

function crear(opciones) {
  const estado = estadoInicial();

  // Las dos mitades de Turnstile se comparan de verdad: el modo demo puede
  // encender el secreto para ver cómo se comporta la pantalla de reserva
  // cuando el backend lo exige y el frontend no tiene la site key.
  const exigeTurnstile = !!(opciones && opciones.turnstile);

  const activos = (lista) => lista.filter((f) => f.activo !== false);
  const barberosActivos = () => activos(estado.barberos);
  const serviciosActivos = () => activos(estado.servicios);

  const buscarBarbero = (id) => barberosActivos().find((b) => b.id_barbero === id) || null;
  const nombreBarbero = (id) => {
    const b = estado.barberos.find((x) => x.id_barbero === id);
    return b ? b.nombre : '';
  };

  function cuentaPorSlug(slug) {
    // Mismo orden que `cuentaPorSlug_`: la falta del parámetro es un error de
    // entrada y no un negocio que no existe. La pantalla de reserva ramifica
    // por código, así que confundirlos cambia lo que ve el cliente.
    const buscado = String(slug || '').trim().toLowerCase();
    if (!buscado) throw errorApp('ENTRADA_INVALIDA', 'Falta el parámetro "slug".');
    if (buscado !== estado.cuenta.slug) {
      throw errorApp('NO_ENCONTRADO', 'No existe un negocio con ese identificador.');
    }
    return estado.cuenta;
  }

  /** Resuelve el combo de servicios igual que `resolverServiciosActivos_`. */
  function resolverServicios(params) {
    const crudo = String(params.id_servicios || params.id_servicio || '');
    const ids = crudo.split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw errorApp('ENTRADA_INVALIDA', 'Falta el parámetro "id_servicio".');

    const elegidos = ids.map((id) => {
      const s = serviciosActivos().find((x) => x.id_servicio === id);
      if (!s) throw errorApp('NO_ENCONTRADO', 'Alguno de los servicios elegidos ya no está disponible.');
      return s;
    });

    return {
      id_servicio_str: elegidos.map((s) => s.id_servicio).join(','),
      servicio_nombre: elegidos.map((s) => s.nombre).join(' + '),
      duracion_total: elegidos.reduce((a, s) => a + s.duracion_minutos, 0),
      precio_total: elegidos.reduce((a, s) => a + s.precio, 0)
    };
  }

  /**
   * El cálculo real, con el módulo de producción. La antelación mínima se
   * aplica solo cuando la fecha consultada es hoy, igual que el original.
   */
  function disponibilidad(idBarbero, fecha, duracionMin) {
    const c = estado.cuenta;
    const ventanas = D.ventanasDelDia(estado.horarios, idBarbero, diaSemanaDeFecha(fecha));
    if (!ventanas.length) return [];

    const ocupados = D.turnosOcupados(estado.turnos, idBarbero, fecha, ESTADOS_QUE_OCUPAN, c.margen_turno_min)
      .concat(D.bloqueosDelDia(estado.bloqueos, idBarbero, fecha));

    const hoy = hoyIso();
    let desdeMinuto;
    if (fecha < hoy) return [];
    else if (fecha === hoy) desdeMinuto = ahoraEnMinutos() + c.antelacion_min_horas * 60;
    else desdeMinuto = -Infinity;

    return D.calcularSlotsLibres({
      ventanas,
      ocupados,
      duracionMin,
      pasoMin: c.paso_grilla_min,
      margenMin: c.margen_turno_min,
      desdeMinuto
    });
  }

  function datosDeNegocio() {
    const c = estado.cuenta;
    return {
      nombre_negocio: c.nombre_negocio,
      slug: c.slug,
      tipo: c.tipo,
      zona_horaria: c.zona_horaria,
      antelacion_min_horas: c.antelacion_min_horas,
      cancelacion_min_horas: c.cancelacion_min_horas,
      margen_turno_min: c.margen_turno_min,
      direccion: c.direccion,
      instagram: c.instagram,
      telefono_contacto: c.telefono_contacto,
      barberos: barberosActivos().map((b) => ({ id_barbero: b.id_barbero, nombre: b.nombre })),
      servicios: serviciosActivos().map((s) => ({
        id_servicio: s.id_servicio, nombre: s.nombre,
        duracion_minutos: s.duracion_minutos, precio: s.precio
      }))
    };
  }

  const vistaPublica = (t) => ({
    id_turno: t.id_turno,
    codigo_ticket: t.codigo_ticket,
    nombre_negocio: estado.cuenta.nombre_negocio,
    barbero_nombre: nombreBarbero(t.id_barbero),
    servicio_nombre: t.servicio_nombre,
    cliente_nombre: t.cliente_nombre,
    fecha: t.fecha,
    hora: t.hora,
    hora_fin: t.hora_fin,
    precio: t.precio,
    estado: t.estado
  });

  const buscarTurnoPorId = (id) => {
    const t = estado.turnos.find((x) => x.id_turno === id);
    if (!t) throw errorApp('NO_ENCONTRADO', 'No encontramos ese turno.');
    return t;
  };

  // -------------------------------------------------------------------------
  // Grupo 1 — cliente final
  // -------------------------------------------------------------------------

  const RUTAS_GET = {
    getNegocio(params) {
      cuentaPorSlug(params.slug);
      const datos = datosDeNegocio();
      datos.requiere_turnstile = exigeTurnstile;
      return ok(datos);
    },

    getDisponibilidad(params) {
      cuentaPorSlug(params.slug);
      const idBarbero = exigirTexto(params, 'id_barbero');
      const fecha = exigirFecha(params, 'fecha');
      const combo = resolverServicios(params);

      let horarios;
      if (idBarbero === 'cualquiera') {
        horarios = D.unirHorariosDisponibles(
          barberosActivos().map((b) => disponibilidad(b.id_barbero, fecha, combo.duracion_total)));
      } else {
        if (!buscarBarbero(idBarbero)) {
          throw errorApp('NO_ENCONTRADO', 'El profesional elegido no está disponible.');
        }
        horarios = disponibilidad(idBarbero, fecha, combo.duracion_total);
      }

      return ok({
        fecha,
        id_barbero: idBarbero,
        id_servicio: combo.id_servicio_str,
        duracion_minutos: combo.duracion_total,
        horarios
      });
    },

    getTurno(params) {
      cuentaPorSlug(params.slug);
      const codigo = exigirTexto(params, 'codigo_ticket').toUpperCase();
      const t = estado.turnos.find((x) => x.codigo_ticket === codigo);
      if (!t) throw errorApp('NO_ENCONTRADO', 'No encontramos ningún turno con ese código.');
      return ok(vistaPublica(t));
    }
  };

  const RUTAS_POST = {
    crearTurno(params) {
      cuentaPorSlug(params.slug);
      const idBarbero = exigirTexto(params, 'id_barbero');
      const fecha = exigirFecha(params, 'fecha');
      const hora = exigirTexto(params, 'hora');
      const nombre = exigirTexto(params, 'cliente_nombre');
      const telefono = soloDigitos(params.cliente_telefono);

      if (exigeTurnstile && !params.turnstile_token) {
        throw errorApp('VERIFICACION_FALLIDA', 'Falta la verificación anti-spam.');
      }
      if (telefono.length < 6) {
        throw errorApp('ENTRADA_INVALIDA', 'El teléfono no parece válido.');
      }
      if (estado.listaNegra.some((l) => l.telefono === telefono)) {
        throw errorApp('TELEFONO_BLOQUEADO', 'No pudimos completar la reserva. Comunicate con el negocio.');
      }

      const combo = resolverServicios(params);

      // Se vuelve a calcular la disponibilidad antes de guardar: es lo que hace
      // el backend real dentro del lock, y es lo que produce el SLOT_OCUPADO
      // que la pantalla de reserva sabe manejar.
      const candidatos = idBarbero === 'cualquiera'
        ? barberosActivos().map((b) => b.id_barbero)
        : [idBarbero];

      const elegido = candidatos.find((id) =>
        disponibilidad(id, fecha, combo.duracion_total).indexOf(hora) !== -1);

      if (!elegido) throw errorApp('SLOT_OCUPADO', 'Ese horario ya no está disponible. Elegí otro.');

      const fin = D.aMinutos(hora) + combo.duracion_total;
      const nuevo = {
        id_turno: nuevoId('tur'),
        codigo_ticket: nuevoCodigoTicket(),
        id_barbero: elegido,
        id_servicio: combo.id_servicio_str,
        servicio_nombre: combo.servicio_nombre,
        duracion_minutos: combo.duracion_total,
        precio: combo.precio_total,
        cliente_nombre: nombre,
        cliente_telefono: telefono,
        fecha,
        hora,
        hora_fin: D.aHoraTexto(fin),
        estado: 'confirmado',
        creado_en: new Date().toISOString(),
        cancelado_por: ''
      };
      estado.turnos.push(nuevo);

      return ok({
        id_turno: nuevo.id_turno,
        codigo_ticket: nuevo.codigo_ticket,
        nombre_negocio: estado.cuenta.nombre_negocio,
        barbero_nombre: nombreBarbero(elegido),
        servicio_nombre: combo.servicio_nombre,
        fecha,
        hora,
        hora_fin: nuevo.hora_fin,
        precio: combo.precio_total
      });
    },

    cancelarTurno(params) {
      cuentaPorSlug(params.slug);
      const codigo = exigirTexto(params, 'codigo_ticket').toUpperCase();
      const t = estado.turnos.find((x) => x.codigo_ticket === codigo);
      if (!t) throw errorApp('NO_ENCONTRADO', 'No encontramos ningún turno con ese código.');

      const yaEstaba = t.estado === 'cancelado';
      t.estado = 'cancelado';
      t.cancelado_por = 'cliente';
      return ok({ id_turno: t.id_turno, estado: 'cancelado', ya_estaba: yaEstaba });
    },

    // -----------------------------------------------------------------------
    // Grupo 2 — dueño
    // -----------------------------------------------------------------------

    getTurnosPorRango(params) {
      const desde = exigirFecha(params, 'desde');
      const hasta = exigirFecha(params, 'hasta');
      const turnos = estado.turnos
        .filter((t) => t.fecha >= desde && t.fecha <= hasta)
        .map((t) => ({
          id_turno: t.id_turno,
          codigo_ticket: t.codigo_ticket,
          id_barbero: t.id_barbero,
          barbero_nombre: nombreBarbero(t.id_barbero),
          servicio_nombre: t.servicio_nombre,
          duracion_minutos: t.duracion_minutos,
          precio: t.precio,
          cliente_nombre: t.cliente_nombre,
          cliente_telefono: t.cliente_telefono,
          fecha: t.fecha,
          hora: t.hora,
          hora_fin: t.hora_fin,
          estado: t.estado
        }))
        .sort((a, b) => (a.fecha !== b.fecha ? (a.fecha < b.fecha ? -1 : 1) : (a.hora < b.hora ? -1 : 1)));

      return ok({ desde, hasta, turnos });
    },

    cancelarTurnoDueno(params) {
      const t = buscarTurnoPorId(exigirTexto(params, 'id_turno'));
      t.estado = 'cancelado';
      t.cancelado_por = 'dueno';
      return ok({ id_turno: t.id_turno, estado: 'cancelado' });
    },

    marcarEstadoTurno(params) {
      const t = buscarTurnoPorId(exigirTexto(params, 'id_turno'));
      const nuevo = exigirTexto(params, 'estado');
      if (['confirmado', 'completado', 'cancelado', 'no_asistio'].indexOf(nuevo) === -1) {
        throw errorApp('ENTRADA_INVALIDA', 'Ese estado no existe.');
      }
      t.estado = nuevo;
      return ok({ id_turno: t.id_turno, estado: nuevo });
    },

    crearServicio(params) {
      const s = {
        id_servicio: nuevoId('srv'),
        nombre: exigirTexto(params, 'nombre'),
        duracion_minutos: Number(params.duracion_minutos) || 30,
        precio: Number(params.precio) || 0,
        activo: true
      };
      estado.servicios.push(s);
      return ok(s);
    },

    editarServicio(params) {
      const id = exigirTexto(params, 'id_servicio');
      const s = estado.servicios.find((x) => x.id_servicio === id);
      if (!s) throw errorApp('NO_ENCONTRADO', 'Ese servicio no existe.');
      if (params.nombre !== undefined) s.nombre = String(params.nombre);
      if (params.duracion_minutos !== undefined) s.duracion_minutos = Number(params.duracion_minutos);
      if (params.precio !== undefined) s.precio = Number(params.precio);
      return ok({ id_servicio: id });
    },

    borrarServicio(params) {
      const id = exigirTexto(params, 'id_servicio');
      const s = estado.servicios.find((x) => x.id_servicio === id);
      if (!s) throw errorApp('NO_ENCONTRADO', 'Ese servicio no existe.');
      // Baja lógica, igual que el real: los turnos ya reservados lo referencian.
      s.activo = false;
      return ok({ id_servicio: id, activo: false });
    },

    crearBarbero(params) {
      const b = { id_barbero: nuevoId('bar'), nombre: exigirTexto(params, 'nombre'), activo: true };
      estado.barberos.push(b);
      return ok(b);
    },

    editarBarbero(params) {
      const id = exigirTexto(params, 'id_barbero');
      const b = estado.barberos.find((x) => x.id_barbero === id);
      if (!b) throw errorApp('NO_ENCONTRADO', 'Ese profesional no existe.');
      b.nombre = exigirTexto(params, 'nombre');
      return ok({ id_barbero: id });
    },

    borrarBarbero(params) {
      const id = exigirTexto(params, 'id_barbero');
      const b = estado.barberos.find((x) => x.id_barbero === id);
      if (!b) throw errorApp('NO_ENCONTRADO', 'Ese profesional no existe.');
      b.activo = false;
      return ok({ id_barbero: id, activo: false });
    },

    getHorarios(params) {
      const filtro = (params.id_barbero === undefined || params.id_barbero === null)
        ? null : String(params.id_barbero);

      const horarios = estado.horarios
        .filter((h) => filtro === null || h.id_barbero === filtro)
        .map((h) => ({
          id_barbero: h.id_barbero,
          dia_semana: h.dia_semana,
          hora_inicio: h.hora_inicio,
          hora_fin: h.hora_fin,
          legible: true
        }));

      return ok({ horarios });
    },

    configurarHorarios(params) {
      const id = exigirTexto(params, 'id_barbero');
      const nuevos = Array.isArray(params.horarios) ? params.horarios : [];
      // Reemplazo completo de la semana, igual que el real.
      estado.horarios = estado.horarios.filter((h) => h.id_barbero !== id);
      nuevos.forEach((h) => estado.horarios.push({
        id_barbero: id,
        dia_semana: Number(h.dia_semana),
        hora_inicio: String(h.hora_inicio),
        hora_fin: String(h.hora_fin)
      }));
      return ok({ id_barbero: id, cantidad: nuevos.length });
    },

    getBloqueos() {
      return ok({ bloqueos: estado.bloqueos.slice() });
    },

    crearBloqueo(params) {
      const b = {
        id_bloqueo: nuevoId('blq'),
        id_barbero: exigirTexto(params, 'id_barbero'),
        fecha_inicio: exigirFecha(params, 'fecha_inicio'),
        fecha_fin: String(params.fecha_fin || params.fecha_inicio),
        hora_inicio: String(params.hora_inicio || ''),
        hora_fin: String(params.hora_fin || ''),
        motivo: String(params.motivo || '')
      };
      estado.bloqueos.push(b);
      return ok(b);
    },

    borrarBloqueo(params) {
      const id = exigirTexto(params, 'id_bloqueo');
      const i = estado.bloqueos.findIndex((b) => b.id_bloqueo === id);
      if (i === -1) throw errorApp('NO_ENCONTRADO', 'Ese bloqueo no existe.');
      estado.bloqueos.splice(i, 1);
      return ok({ id_bloqueo: id });
    },

    getListaNegra() {
      return ok({ lista: estado.listaNegra.slice() });
    },

    bloquearTelefono(params) {
      const telefono = soloDigitos(params.telefono);
      if (telefono.length < 6) throw errorApp('ENTRADA_INVALIDA', 'El teléfono no parece válido.');
      if (estado.listaNegra.some((l) => l.telefono === telefono)) {
        return ok({ telefono, ya_estaba: true });
      }
      estado.listaNegra.push({
        telefono,
        fecha_bloqueo: hoyIso(),
        motivo: String(params.motivo || '')
      });
      return ok({ telefono, ya_estaba: false });
    },

    desbloquearTelefono(params) {
      const telefono = soloDigitos(params.telefono);
      const i = estado.listaNegra.findIndex((l) => l.telefono === telefono);
      if (i === -1) throw errorApp('NO_ENCONTRADO', 'Ese teléfono no está en la lista.');
      estado.listaNegra.splice(i, 1);
      return ok({ telefono });
    },

    getEstadisticas(params) {
      const desde = exigirFecha(params, 'desde');
      const hasta = exigirFecha(params, 'hasta');
      if (hasta < desde) throw errorApp('ENTRADA_INVALIDA', 'La fecha de fin es anterior a la de inicio.');

      const resumen = {
        desde, hasta, total: 0, confirmados: 0, completados: 0,
        cancelados: 0, no_asistio: 0, facturado: 0, por_barbero: {}, por_servicio: {}
      };

      estado.turnos.filter((t) => t.fecha >= desde && t.fecha <= hasta).forEach((t) => {
        resumen.total++;
        if (t.estado === 'confirmado') resumen.confirmados++;
        else if (t.estado === 'completado') resumen.completados++;
        else if (t.estado === 'cancelado') resumen.cancelados++;
        else if (t.estado === 'no_asistio') resumen.no_asistio++;

        // Solo lo atendido factura, igual que en producción.
        if (t.estado === 'completado') resumen.facturado += t.precio;

        if (t.estado !== 'cancelado') {
          const b = nombreBarbero(t.id_barbero) || t.id_barbero;
          resumen.por_barbero[b] = (resumen.por_barbero[b] || 0) + 1;
          const s = t.servicio_nombre || 'Sin nombre';
          resumen.por_servicio[s] = (resumen.por_servicio[s] || 0) + 1;
        }
      });

      return ok(resumen);
    },

    archivarTurnos(params) {
      const dias = Number(params.dias) || 30;
      const corte = sumarDias(hoyIso(), -dias);
      const aArchivar = estado.turnos.filter((t) =>
        t.fecha < corte && t.estado !== 'confirmado');

      estado.historico = estado.historico.concat(aArchivar);
      estado.turnos = estado.turnos.filter((t) => aArchivar.indexOf(t) === -1);
      return ok({ archivados: aArchivar.length, fecha_corte: corte });
    },

    // -----------------------------------------------------------------------
    // Grupo 3 — cuenta
    // -----------------------------------------------------------------------

    verificarClaveAlta() {
      // En demo el alta está abierta: no hay clave de administrador que
      // comparar, y devolver un vale sería mentir sobre el estado del sistema.
      return ok({ requiere_clave: false, vale: '' });
    },

    registrarCuenta(params) {
      estado.cuenta.nombre_negocio = String(params.nombre_negocio || estado.cuenta.nombre_negocio);
      estado.cuenta.tipo = String(params.tipo || estado.cuenta.tipo);
      return ok({ slug: estado.cuenta.slug, nombre_negocio: estado.cuenta.nombre_negocio });
    },

    getPerfilCuenta() {
      return ok(Object.assign({}, estado.cuenta, { negocio: datosDeNegocio() }));
    },

    actualizarPerfilCuenta(params) {
      ['nombre_negocio', 'direccion', 'instagram', 'telefono_contacto', 'zona_horaria']
        .forEach((k) => { if (params[k] !== undefined) estado.cuenta[k] = String(params[k]); });
      ['paso_grilla_min', 'margen_turno_min', 'antelacion_min_horas', 'cancelacion_min_horas']
        .forEach((k) => { if (params[k] !== undefined) estado.cuenta[k] = Number(params[k]); });
      return ok(Object.assign({}, estado.cuenta, { negocio: datosDeNegocio() }));
    }
  };

  /**
   * Despacha una acción. Nunca lanza: como el `despachar_` real, todo error se
   * convierte en un `{ok:false}` para que el frontend siempre reciba JSON.
   */
  function despachar(metodo, params) {
    const rutas = metodo === 'GET' ? RUTAS_GET : RUTAS_POST;
    const accion = String((params && params.accion) || '');

    if (!Object.prototype.hasOwnProperty.call(rutas, accion)) {
      // Una acción que existe pero por el otro método da el mismo error que en
      // producción, donde las tablas también están separadas.
      return fallo('ACCION_DESCONOCIDA', `Acción no reconocida: "${accion}".`);
    }

    try {
      return rutas[accion](params || {});
    } catch (err) {
      if (err && err.codigoApp) return fallo(err.codigoApp, err.message);
      console.error('[demo] error no controlado en "' + accion + '":', err);
      return fallo('INTERNO', 'Ocurrió un error inesperado. Probá de nuevo en unos minutos.');
    }
  }

  return { despachar, estado, acciones: { GET: RUTAS_GET, POST: RUTAS_POST } };
}

module.exports = { crear };
