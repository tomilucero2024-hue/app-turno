/**
 * Test de humo del backend simulado del modo demo.
 *
 *   node tests/demo.test.js
 *
 * El modo demo solo sirve si se comporta como el de verdad. Un backend de
 * mentira que responde distinto es peor que no tenerlo: se prueba una pantalla
 * contra él, se ve bien, y el error aparece en producción.
 *
 * Por eso lo que se verifica acá no es que "ande", sino que respete el contrato:
 * la forma de la respuesta, los códigos de error, y que cada acción que el
 * frontend llama exista. Lo último es lo que más se rompe: se agrega un
 * endpoint al backend real, se olvida acá, y el modo demo se cae con
 * ACCION_DESCONOCIDA en una pantalla cualquiera.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { crear } = require('../demo/backend-simulado.js');

let pasados = 0;
let fallidos = 0;

function test(nombre, fn) {
  try {
    fn();
    pasados++;
    console.log('  ok  ' + nombre);
  } catch (err) {
    fallidos++;
    console.log('FALLA  ' + nombre);
    console.log('       ' + (err && err.message));
  }
}

function grupo(nombre) {
  console.log('\n' + nombre);
}

const hoy = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Primer día futuro que caiga en el día de semana pedido. */
function proximoDia(diaSemana) {
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== diaSemana);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

console.log('\n--- Backend simulado del modo demo ---');

// ---------------------------------------------------------------------------
grupo('Paridad con el router real');

test('implementa todas las acciones que llama el frontend', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'api.js'), 'utf-8');
  const usadas = new Set();
  const re = /\b(?:get|post)\('([a-zA-Z]+)'/g;
  let m;
  while ((m = re.exec(api)) !== null) usadas.add(m[1]);

  const demo = crear();
  const implementadas = new Set(
    Object.keys(demo.acciones.GET).concat(Object.keys(demo.acciones.POST)));

  const faltan = [...usadas].filter((a) => !implementadas.has(a));
  assert.deepStrictEqual(faltan, [],
    'El modo demo no implementa: ' + faltan.join(', '));
});

test('cada acción está en el mismo método HTTP que en producción', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'backend', '99_Main.js'), 'utf-8');
  const bloque = (nombre) => {
    const desde = main.indexOf('var ' + nombre + ' = {');
    return main.slice(desde, main.indexOf('};', desde));
  };
  const nombres = (texto) => (texto.match(/^\s{2}([a-zA-Z]+):/gm) || [])
    .map((s) => s.trim().replace(':', ''));

  const demo = crear();
  nombres(bloque('RUTAS_GET')).forEach((accion) => {
    assert.ok(Object.prototype.hasOwnProperty.call(demo.acciones.GET, accion),
      accion + ' es GET en producción y falta como GET en el demo');
  });
  nombres(bloque('RUTAS_POST')).forEach((accion) => {
    assert.ok(Object.prototype.hasOwnProperty.call(demo.acciones.POST, accion),
      accion + ' es POST en producción y falta como POST en el demo');
  });
});

// ---------------------------------------------------------------------------
grupo('Contrato de respuesta');

test('una acción desconocida responde ok:false, nunca una excepción', () => {
  const r = crear().despachar('GET', { accion: 'ping' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.codigo, 'ACCION_DESCONOCIDA');
});

test('las acciones heredadas de Object no se resuelven como rutas', () => {
  const r = crear().despachar('POST', { accion: 'constructor' });
  assert.strictEqual(r.error.codigo, 'ACCION_DESCONOCIDA');
});

test('un slug ausente es ENTRADA_INVALIDA y uno que no existe, NO_ENCONTRADO', () => {
  const demo = crear();
  assert.strictEqual(demo.despachar('GET', { accion: 'getNegocio' }).error.codigo, 'ENTRADA_INVALIDA');
  assert.strictEqual(demo.despachar('GET', { accion: 'getNegocio', slug: 'otro' }).error.codigo, 'NO_ENCONTRADO');
});

test('getNegocio publica requiere_turnstile según cómo se levantó el demo', () => {
  const sin = crear().despachar('GET', { accion: 'getNegocio', slug: 'demo' });
  assert.strictEqual(sin.data.requiere_turnstile, false);

  const con = crear({ turnstile: true }).despachar('GET', { accion: 'getNegocio', slug: 'demo' });
  assert.strictEqual(con.data.requiere_turnstile, true);
});

// ---------------------------------------------------------------------------
grupo('Reserva');

test('la disponibilidad respeta el horario partido de la agenda de ejemplo', () => {
  const demo = crear();
  const martes = proximoDia(2);
  const r = demo.despachar('GET', {
    accion: 'getDisponibilidad', slug: 'demo',
    id_barbero: 'bar_carlos', id_servicios: 'srv_corte', fecha: martes
  });
  assert.strictEqual(r.ok, true);
  // Carlos trabaja 09-13 y 16-20: tiene que haber un hueco en el medio.
  assert.ok(r.data.horarios.includes('09:00'), 'falta la mañana');
  assert.ok(r.data.horarios.includes('16:00'), 'falta la tarde');
  assert.ok(!r.data.horarios.includes('14:00'), 'el hueco del mediodía no debería ofrecerse');
});

test('un día sin horarios cargados devuelve la lista vacía, no un error', () => {
  const r = crear().despachar('GET', {
    accion: 'getDisponibilidad', slug: 'demo',
    id_barbero: 'cualquiera', id_servicios: 'srv_corte', fecha: proximoDia(0)
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data.horarios, []);
});

test('un combo de servicios suma duración y precio', () => {
  const r = crear().despachar('GET', {
    accion: 'getDisponibilidad', slug: 'demo',
    id_barbero: 'bar_nico', id_servicios: 'srv_corte,srv_barba', fecha: proximoDia(2)
  });
  assert.strictEqual(r.data.duracion_minutos, 50);
});

test('reservar dos veces el mismo horario da SLOT_OCUPADO', () => {
  const demo = crear();
  const martes = proximoDia(2);
  const base = {
    accion: 'crearTurno', slug: 'demo', id_barbero: 'bar_carlos',
    id_servicios: 'srv_corte', fecha: martes, hora: '09:00',
    cliente_nombre: 'Cliente', cliente_telefono: '11 4567-8901'
  };

  const primero = demo.despachar('POST', base);
  assert.strictEqual(primero.ok, true);
  assert.strictEqual(primero.data.codigo_ticket.length, 10);

  const segundo = demo.despachar('POST', Object.assign({}, base, { cliente_telefono: '1155667788' }));
  assert.strictEqual(segundo.error.codigo, 'SLOT_OCUPADO');
});

test('el margen entre turnos bloquea los horarios pegados al que se reservó', () => {
  const demo = crear();
  const martes = proximoDia(2);
  demo.despachar('POST', {
    accion: 'crearTurno', slug: 'demo', id_barbero: 'bar_carlos',
    id_servicios: 'srv_corte', fecha: martes, hora: '09:00',
    cliente_nombre: 'Cliente', cliente_telefono: '1145678901'
  });

  const libres = demo.despachar('GET', {
    accion: 'getDisponibilidad', slug: 'demo',
    id_barbero: 'bar_carlos', id_servicios: 'srv_corte', fecha: martes
  }).data.horarios;

  // El turno ocupa 09:00-09:30 y el margen es de 10 minutos.
  ['09:00', '09:15', '09:30'].forEach((h) =>
    assert.ok(!libres.includes(h), h + ' tendría que estar ocupado'));
  assert.ok(libres.includes('09:45'), '09:45 tendría que quedar libre');
});

test('un teléfono de la lista negra no puede reservar, y no se le dice por qué', () => {
  const demo = crear();
  const r = demo.despachar('POST', {
    accion: 'crearTurno', slug: 'demo', id_barbero: 'bar_carlos',
    id_servicios: 'srv_corte', fecha: proximoDia(2), hora: '10:00',
    cliente_nombre: 'Cliente', cliente_telefono: '1199887766'
  });
  assert.strictEqual(r.error.codigo, 'TELEFONO_BLOQUEADO');
  assert.ok(!/negra|bloquead/i.test(r.error.mensaje),
    'el mensaje al cliente no debe delatar que está en la lista');
});

test('el turno creado se consulta y se cancela con su código', () => {
  const demo = crear();
  const creado = demo.despachar('POST', {
    accion: 'crearTurno', slug: 'demo', id_barbero: 'cualquiera',
    id_servicios: 'srv_corte', fecha: proximoDia(2), hora: '10:00',
    cliente_nombre: 'Cliente', cliente_telefono: '1145678901'
  }).data;

  const consultado = demo.despachar('GET', {
    accion: 'getTurno', slug: 'demo', codigo_ticket: creado.codigo_ticket.toLowerCase()
  });
  assert.strictEqual(consultado.data.estado, 'confirmado', 'el código no debe distinguir mayúsculas');

  const cancelado = demo.despachar('POST', {
    accion: 'cancelarTurno', slug: 'demo', codigo_ticket: creado.codigo_ticket
  });
  assert.strictEqual(cancelado.data.ya_estaba, false);

  const otraVez = demo.despachar('POST', {
    accion: 'cancelarTurno', slug: 'demo', codigo_ticket: creado.codigo_ticket
  });
  assert.strictEqual(otraVez.data.ya_estaba, true);
});

// ---------------------------------------------------------------------------
grupo('Panel');

test('el perfil trae los servicios y el equipo en la misma llamada', () => {
  const r = crear().despachar('POST', { accion: 'getPerfilCuenta', token: 'x' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.data.negocio, 'falta el negocio embebido');
  assert.ok(r.data.negocio.servicios.length > 0);
  assert.ok(r.data.negocio.barberos.length > 0);
});

test('la facturación cuenta solo los turnos atendidos', () => {
  const demo = crear();
  const r = demo.despachar('POST', {
    accion: 'getEstadisticas', token: 'x', desde: hoy(), hasta: hoy()
  }).data;

  const esperado = demo.estado.turnos
    .filter((t) => t.fecha === hoy() && t.estado === 'completado')
    .reduce((a, t) => a + t.precio, 0);

  assert.strictEqual(r.facturado, esperado);
  assert.ok(r.facturado > 0, 'los datos de ejemplo tendrían que tener algo facturado hoy');
});

test('borrar un servicio es baja lógica: los turnos viejos lo siguen nombrando', () => {
  const demo = crear();
  demo.despachar('POST', { accion: 'borrarServicio', token: 'x', id_servicio: 'srv_corte' });
  const negocio = demo.despachar('GET', { accion: 'getNegocio', slug: 'demo' }).data;
  assert.ok(!negocio.servicios.some((s) => s.id_servicio === 'srv_corte'),
    'no debería ofrecerse más');
  assert.ok(demo.estado.turnos.some((t) => t.servicio_nombre === 'Corte clásico'),
    'los turnos ya reservados no se tocan');
});

test('configurarHorarios reemplaza la semana entera del profesional', () => {
  const demo = crear();
  demo.despachar('POST', {
    accion: 'configurarHorarios', token: 'x', id_barbero: 'bar_carlos',
    horarios: [{ dia_semana: 2, hora_inicio: '10:00', hora_fin: '12:00' }]
  });
  const suyos = demo.despachar('POST', {
    accion: 'getHorarios', token: 'x', id_barbero: 'bar_carlos'
  }).data.horarios;
  assert.strictEqual(suyos.length, 1);
  assert.strictEqual(suyos[0].hora_inicio, '10:00');
});

// ---------------------------------------------------------------------------
console.log(`\n${pasados} pasados, ${fallidos} fallidos.\n`);
if (fallidos > 0) process.exit(1);
