/**
 * Tests de la lógica de disponibilidad.
 *
 * Se ejecutan con Node, sin dependencias:  node tests/disponibilidad.test.js
 *
 * Esto es posible porque 02_Disponibilidad.js no toca ningún servicio de Apps
 * Script. Es la única parte del backend con lógica no trivial, y también la
 * única que se puede probar sin desplegar nada.
 */

const assert = require('assert');
const D = require('../backend/02_Disponibilidad.js');

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
    console.log('       ' + err.message);
  }
}

function grupo(nombre) {
  console.log('\n' + nombre);
}

// ---------------------------------------------------------------------------
grupo('Conversión de horarios');

test('aMinutos convierte HH:mm a minutos', () => {
  assert.strictEqual(D.aMinutos('00:00'), 0);
  assert.strictEqual(D.aMinutos('09:30'), 570);
  assert.strictEqual(D.aMinutos('23:59'), 1439);
});

test('aMinutos rechaza formatos inválidos', () => {
  assert.ok(isNaN(D.aMinutos('9:30')));
  assert.ok(isNaN(D.aMinutos('24:00')));
  assert.ok(isNaN(D.aMinutos('09:60')));
  assert.ok(isNaN(D.aMinutos('')));
  assert.ok(isNaN(D.aMinutos(null)));
});

test('aHoraTexto es la inversa de aMinutos', () => {
  assert.strictEqual(D.aHoraTexto(0), '00:00');
  assert.strictEqual(D.aHoraTexto(570), '09:30');
  assert.strictEqual(D.aHoraTexto(1439), '23:59');
});

test('seSolapan usa intervalos semiabiertos', () => {
  // Un turno que termina justo cuando empieza el otro NO se solapa: si no,
  // sería imposible reservar dos turnos consecutivos.
  assert.strictEqual(D.seSolapan(600, 630, 630, 660), false);
  assert.strictEqual(D.seSolapan(600, 630, 629, 660), true);
  assert.strictEqual(D.seSolapan(600, 660, 610, 620), true);
});

// ---------------------------------------------------------------------------
grupo('calcularSlotsLibres — casos base');

test('genera la grilla completa cuando no hay nada ocupado', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('12:00') }],
    ocupados: [],
    duracionMin: 30,
    pasoMin: 30
  });
  assert.deepStrictEqual(slots, ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
});

test('el servicio tiene que entrar completo en la ventana', () => {
  // Ventana de una hora, servicio de 45 minutos, grilla de 15:
  // 09:30 + 45 = 10:15, se pasa del cierre.
  const slots = D.calcularSlotsLibres({
    ventanas: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('10:00') }],
    ocupados: [],
    duracionMin: 45,
    pasoMin: 15
  });
  assert.deepStrictEqual(slots, ['09:00', '09:15']);
});

test('una duración mayor que la ventana no deja ningún horario', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('09:30') }],
    ocupados: [],
    duracionMin: 60,
    pasoMin: 15
  });
  assert.deepStrictEqual(slots, []);
});

test('duración inválida devuelve lista vacía en vez de romper', () => {
  const base = { ventanas: [{ inicio: 540, fin: 720 }], ocupados: [], pasoMin: 15 };
  assert.deepStrictEqual(D.calcularSlotsLibres(Object.assign({}, base, { duracionMin: 0 })), []);
  assert.deepStrictEqual(D.calcularSlotsLibres(Object.assign({}, base, { duracionMin: -30 })), []);
});

test('sin ventanas de trabajo no hay horarios', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [], ocupados: [], duracionMin: 30, pasoMin: 15
  });
  assert.deepStrictEqual(slots, []);
});

// ---------------------------------------------------------------------------
grupo('calcularSlotsLibres — horario partido');

test('recorre las dos ventanas del día y no deja huecos entre medio', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [
      { inicio: D.aMinutos('09:00'), fin: D.aMinutos('11:00') },
      { inicio: D.aMinutos('16:00'), fin: D.aMinutos('17:00') }
    ],
    ocupados: [],
    duracionMin: 60,
    pasoMin: 60
  });
  // Las 11:00 y las 15:00 no existen: están fuera de toda ventana.
  assert.deepStrictEqual(slots, ['09:00', '10:00', '16:00']);
});

test('ventanas solapadas no producen horarios repetidos', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [
      { inicio: D.aMinutos('09:00'), fin: D.aMinutos('11:00') },
      { inicio: D.aMinutos('10:00'), fin: D.aMinutos('12:00') }
    ],
    ocupados: [],
    duracionMin: 60,
    pasoMin: 60
  });
  assert.deepStrictEqual(slots, ['09:00', '10:00', '11:00']);
});

test('el resultado sale ordenado aunque las ventanas vengan al revés', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [
      { inicio: D.aMinutos('16:00'), fin: D.aMinutos('17:00') },
      { inicio: D.aMinutos('09:00'), fin: D.aMinutos('10:00') }
    ],
    ocupados: [],
    duracionMin: 60,
    pasoMin: 60
  });
  assert.deepStrictEqual(slots, ['09:00', '16:00']);
});

test('descarta ventanas con fin anterior o igual al inicio', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [
      { inicio: D.aMinutos('12:00'), fin: D.aMinutos('09:00') },
      { inicio: D.aMinutos('10:00'), fin: D.aMinutos('10:00') },
      { inicio: D.aMinutos('09:00'), fin: D.aMinutos('10:00') }
    ],
    ocupados: [],
    duracionMin: 60,
    pasoMin: 60
  });
  assert.deepStrictEqual(slots, ['09:00']);
});

// ---------------------------------------------------------------------------
grupo('calcularSlotsLibres — horarios ocupados');

test('excluye el horario tomado y todos los que lo pisan', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('12:00') }],
    ocupados: [{ inicio: D.aMinutos('10:00'), fin: D.aMinutos('10:30') }],
    duracionMin: 30,
    pasoMin: 15
  });
  // 09:45 terminaría 10:15 y 10:15 empezaría dentro del turno: ambos pisan.
  assert.ok(!slots.includes('09:45'));
  assert.ok(!slots.includes('10:00'));
  assert.ok(!slots.includes('10:15'));
  // 09:30 termina justo a las 10:00 y 10:30 empieza justo al terminar: válidos.
  assert.ok(slots.includes('09:30'));
  assert.ok(slots.includes('10:30'));
});

test('permite turnos consecutivos pegados', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('11:00') }],
    ocupados: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('10:00') }],
    duracionMin: 60,
    pasoMin: 60
  });
  assert.deepStrictEqual(slots, ['10:00']);
});

test('un bloqueo de día completo deja la agenda vacía', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('20:00') }],
    ocupados: [{ inicio: 0, fin: 1440 }],
    duracionMin: 30,
    pasoMin: 15
  });
  assert.deepStrictEqual(slots, []);
});

// ---------------------------------------------------------------------------
grupo('calcularSlotsLibres — antelación mínima');

test('descarta los horarios anteriores al piso indicado', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('12:00') }],
    ocupados: [],
    duracionMin: 60,
    pasoMin: 60,
    desdeMinuto: D.aMinutos('10:00')
  });
  assert.deepStrictEqual(slots, ['10:00', '11:00']);
});

test('un piso posterior al cierre deja la agenda vacía', () => {
  const slots = D.calcularSlotsLibres({
    ventanas: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('12:00') }],
    ocupados: [],
    duracionMin: 60,
    pasoMin: 60,
    desdeMinuto: D.aMinutos('23:00')
  });
  assert.deepStrictEqual(slots, []);
});

// ---------------------------------------------------------------------------
grupo('ventanasDelDia');

const HORARIOS = [
  { id_barbero: 'b1', dia_semana: 1, hora_inicio: '09:00', hora_fin: '13:00' },
  { id_barbero: 'b1', dia_semana: 1, hora_inicio: '16:00', hora_fin: '20:00' },
  { id_barbero: 'b1', dia_semana: 2, hora_inicio: '09:00', hora_fin: '18:00' },
  { id_barbero: 'b2', dia_semana: 1, hora_inicio: '10:00', hora_fin: '14:00' }
];

test('devuelve las dos franjas del horario partido', () => {
  const v = D.ventanasDelDia(HORARIOS, 'b1', 1);
  assert.deepStrictEqual(v, [
    { inicio: 540, fin: 780 },
    { inicio: 960, fin: 1200 }
  ]);
});

test('no mezcla los horarios de otro barbero', () => {
  assert.strictEqual(D.ventanasDelDia(HORARIOS, 'b2', 1).length, 1);
  assert.strictEqual(D.ventanasDelDia(HORARIOS, 'b1', 3).length, 0);
});

test('compara ids y días como texto y como número indistintamente', () => {
  const filas = [{ id_barbero: 7, dia_semana: '3', hora_inicio: '09:00', hora_fin: '10:00' }];
  assert.strictEqual(D.ventanasDelDia(filas, '7', 3).length, 1);
});

test('descarta filas corruptas sin dejar al negocio sin agenda', () => {
  const filas = [
    { id_barbero: 'b1', dia_semana: 1, hora_inicio: 'mediodía', hora_fin: '13:00' },
    { id_barbero: 'b1', dia_semana: 1, hora_inicio: '20:00', hora_fin: '09:00' },
    { id_barbero: 'b1', dia_semana: 1, hora_inicio: '09:00', hora_fin: '13:00' }
  ];
  assert.deepStrictEqual(D.ventanasDelDia(filas, 'b1', 1), [{ inicio: 540, fin: 780 }]);
});

// ---------------------------------------------------------------------------
grupo('bloqueosDelDia');

test('un bloqueo sin horas cubre el día entero', () => {
  const b = [{ id_barbero: 'b1', fecha_inicio: '2026-09-10', fecha_fin: '2026-09-10' }];
  assert.deepStrictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10'), [{ inicio: 0, fin: 1440 }]);
});

test('un bloqueo con horas cubre solo esa franja', () => {
  const b = [{
    id_barbero: 'b1', fecha_inicio: '2026-09-10', fecha_fin: '2026-09-10',
    hora_inicio: '14:00', hora_fin: '16:00'
  }];
  assert.deepStrictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10'), [{ inicio: 840, fin: 960 }]);
});

test('el rango de fechas es inclusivo en los dos extremos', () => {
  const b = [{ id_barbero: 'b1', fecha_inicio: '2026-09-10', fecha_fin: '2026-09-12' }];
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-09').length, 0);
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10').length, 1);
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-11').length, 1);
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-12').length, 1);
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-13').length, 0);
});

test('un bloqueo de "todos" alcanza a cualquier barbero', () => {
  const b = [{ id_barbero: 'todos', fecha_inicio: '2026-09-10', fecha_fin: '2026-09-10' }];
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10').length, 1);
  assert.strictEqual(D.bloqueosDelDia(b, 'b9', '2026-09-10').length, 1);
});

test('un bloqueo de otro barbero no aplica', () => {
  const b = [{ id_barbero: 'b2', fecha_inicio: '2026-09-10', fecha_fin: '2026-09-10' }];
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10').length, 0);
});

test('sin fecha_fin el bloqueo dura un solo día', () => {
  const b = [{ id_barbero: 'b1', fecha_inicio: '2026-09-10', fecha_fin: '' }];
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10').length, 1);
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-11').length, 0);
});

test('horas corruptas degradan a bloqueo de día completo, no a bloqueo nulo', () => {
  const b = [{
    id_barbero: 'b1', fecha_inicio: '2026-09-10', fecha_fin: '2026-09-10',
    hora_inicio: '16:00', hora_fin: '14:00'
  }];
  assert.deepStrictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10'), [{ inicio: 0, fin: 1440 }]);
});

// Regresión: la celda que perdió el formato "@" hacía que el bloqueo no
// aplicara a NINGÚN día, así que unas vacaciones cargadas volvían a ofrecerse.
test('un bloqueo aplica aunque Sheets devuelva la fecha como "1/9/2026"', () => {
  const b = [{ id_barbero: 'b1', fecha_inicio: '1/9/2026', fecha_fin: '1/9/2026' }];
  assert.deepStrictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-01'), [{ inicio: 0, fin: 1440 }]);
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-02').length, 0);
});

test('un rango de bloqueo en formato de Sheets sigue siendo inclusivo', () => {
  const b = [{ id_barbero: 'b1', fecha_inicio: '10/09/2026', fecha_fin: '12/9/2026' }];
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-09').length, 0);
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10').length, 1);
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-12').length, 1);
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-13').length, 0);
});

test('una fecha de bloqueo ilegible bloquea el día, no lo libera', () => {
  const b = [{ id_bloqueo: 'bl_1', id_barbero: 'b1', fecha_inicio: 'vacaciones', fecha_fin: '' }];
  assert.deepStrictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10'), [{ inicio: 0, fin: 1440 }]);
});

test('un bloqueo sin fecha_inicio se ignora, no bloquea todo', () => {
  const b = [{ id_bloqueo: 'bl_1', id_barbero: 'b1', fecha_inicio: '', fecha_fin: '' }];
  assert.strictEqual(D.bloqueosDelDia(b, 'b1', '2026-09-10').length, 0);
});

// ---------------------------------------------------------------------------
grupo('aFechaIsoDeCelda');

test('normaliza las formas en que Sheets devuelve una fecha', () => {
  assert.strictEqual(D.aFechaIsoDeCelda('2026-09-10'), '2026-09-10');
  assert.strictEqual(D.aFechaIsoDeCelda('10/9/2026'), '2026-09-10');
  assert.strictEqual(D.aFechaIsoDeCelda('10/09/2026'), '2026-09-10');
  assert.strictEqual(D.aFechaIsoDeCelda('  1/9/2026  '), '2026-09-01');
  assert.strictEqual(D.aFechaIsoDeCelda(new Date(2026, 8, 10)), '2026-09-10');
});

test('devuelve null en vez de adivinar cuando la celda no se entiende', () => {
  assert.strictEqual(D.aFechaIsoDeCelda(''), null);
  assert.strictEqual(D.aFechaIsoDeCelda(null), null);
  assert.strictEqual(D.aFechaIsoDeCelda(undefined), null);
  assert.strictEqual(D.aFechaIsoDeCelda('setiembre'), null);
  assert.strictEqual(D.aFechaIsoDeCelda('10-9-26'), null);
});

// El filtro de rango del panel comparaba la celda cruda contra el ISO. Es la
// misma familia de bug que el bloqueo perdido: el turno existe y ocupa el
// horario, pero no aparece ni en la agenda ni en los números.
test('normalizada, una fecha de Sheets cae en el rango que le corresponde', () => {
  const f = D.aFechaIsoDeCelda('1/9/2026');
  assert.strictEqual('1/9/2026' >= '2026-09-01' && '1/9/2026' <= '2026-09-30', false);
  assert.strictEqual(f >= '2026-09-01' && f <= '2026-09-30', true);
});

// ---------------------------------------------------------------------------
grupo('turnosOcupados');

const TURNOS = [
  { id_barbero: 'b1', fecha: '2026-09-10', hora: '09:00', hora_fin: '09:30', estado: 'confirmado', duracion_minutos: 30 },
  { id_barbero: 'b1', fecha: '2026-09-10', hora: '10:00', hora_fin: '10:30', estado: 'cancelado', duracion_minutos: 30 },
  { id_barbero: 'b1', fecha: '2026-09-10', hora: '11:00', hora_fin: '11:30', estado: 'completado', duracion_minutos: 30 },
  { id_barbero: 'b1', fecha: '2026-09-10', hora: '12:00', hora_fin: '12:30', estado: 'no_asistio', duracion_minutos: 30 },
  { id_barbero: 'b2', fecha: '2026-09-10', hora: '09:00', hora_fin: '09:30', estado: 'confirmado', duracion_minutos: 30 },
  { id_barbero: 'b1', fecha: '2026-09-11', hora: '09:00', hora_fin: '09:30', estado: 'confirmado', duracion_minutos: 30 }
];

test('un turno cancelado libera el horario y los demás lo ocupan', () => {
  const o = D.turnosOcupados(TURNOS, 'b1', '2026-09-10');
  assert.strictEqual(o.length, 3);
  assert.ok(!o.some(x => x.inicio === D.aMinutos('10:00')));
});

test('no cuenta turnos de otro barbero ni de otra fecha', () => {
  assert.strictEqual(D.turnosOcupados(TURNOS, 'b2', '2026-09-10').length, 1);
  assert.strictEqual(D.turnosOcupados(TURNOS, 'b1', '2026-09-11').length, 1);
  assert.strictEqual(D.turnosOcupados(TURNOS, 'b1', '2026-09-12').length, 0);
});

test('sin hora_fin reconstruye el fin con la duración congelada del turno', () => {
  // Es la duración guardada EN EL TURNO, no la del servicio actual: si el dueño
  // edita el servicio, los turnos ya reservados no se pueden mover.
  const filas = [{ id_barbero: 'b1', fecha: '2026-09-10', hora: '09:00', estado: 'confirmado', duracion_minutos: 45 }];
  assert.deepStrictEqual(D.turnosOcupados(filas, 'b1', '2026-09-10'), [{ inicio: 540, fin: 585 }]);
});

// Este es el caso que produjo una doble reserva real: la versión anterior
// descartaba la fila ilegible y devolvía [], o sea "el día está libre", y el
// backend aceptaba turnos encima de uno ya reservado. Un turno que no se puede
// leer tiene que ocupar, no desaparecer.
test('un turno ilegible bloquea el día en vez de dejarlo libre', () => {
  const filas = [
    { id_barbero: 'b1', fecha: '2026-09-10', hora: '', estado: 'confirmado', duracion_minutos: 30 },
    { id_barbero: 'b1', fecha: '2026-09-10', hora: '09:00', estado: 'confirmado', duracion_minutos: 0 }
  ];
  assert.deepStrictEqual(D.turnosOcupados(filas, 'b1', '2026-09-10'), [{ inicio: 0, fin: 1440 }]);
});

test('un turno cancelado ilegible no bloquea nada', () => {
  const filas = [{ id_barbero: 'b1', fecha: 'ayer', hora: 'tarde', estado: 'cancelado' }];
  assert.deepStrictEqual(D.turnosOcupados(filas, 'b1', '2026-09-10'), []);
});

test('una fecha que no se puede interpretar también bloquea el día', () => {
  const filas = [{ id_barbero: 'b1', fecha: 'jueves', hora: '09:00', hora_fin: '09:30', estado: 'confirmado' }];
  assert.deepStrictEqual(D.turnosOcupados(filas, 'b1', '2026-09-10'), [{ inicio: 0, fin: 1440 }]);
});

// ---------------------------------------------------------------------------
grupo('Lectura tolerante de celdas');

test('acepta las formas en que Sheets devuelve una hora', () => {
  assert.strictEqual(D.aMinutosDeCelda('11:00'), 660);
  assert.strictEqual(D.aMinutosDeCelda('11:00:00'), 660);
  assert.strictEqual(D.aMinutosDeCelda('9:30'), 570);
  assert.strictEqual(D.aMinutosDeCelda('  11:15  '), 675);
  assert.strictEqual(D.aMinutosDeCelda('11:00 a. m.'), 660);
  assert.strictEqual(D.aMinutosDeCelda('1:30 p.m.'), 810);
  assert.strictEqual(D.aMinutosDeCelda('12:00 a. m.'), 0);
  assert.strictEqual(D.aMinutosDeCelda(new Date(2026, 8, 10, 16, 45)), 1005);
});

test('rechaza lo que no es una hora', () => {
  ['', 'mediodía', '25:00', '11:60', null, undefined].forEach((v) => {
    assert.ok(isNaN(D.aMinutosDeCelda(v)), 'debería ser NaN: ' + v);
  });
});

test('la validación de la entrada de la API sigue siendo estricta', () => {
  // aMinutos es la que valida lo que manda el cliente: ahí "11:00:00" no vale.
  assert.ok(isNaN(D.aMinutos('11:00:00')));
  assert.ok(isNaN(D.aMinutos('9:30')));
  assert.strictEqual(D.aMinutos('09:30'), 570);
});

test('compara fechas guardadas en los formatos que muestra Sheets', () => {
  assert.strictEqual(D.mismaFecha('2026-09-10', '2026-09-10'), true);
  assert.strictEqual(D.mismaFecha('2026-09-11', '2026-09-10'), false);
  assert.strictEqual(D.mismaFecha('10/9/2026', '2026-09-10'), true);
  assert.strictEqual(D.mismaFecha('10/09/2026', '2026-09-10'), true);
  assert.strictEqual(D.mismaFecha(new Date(2026, 8, 10), '2026-09-10'), true);
  assert.strictEqual(D.mismaFecha('cualquier cosa', '2026-09-10'), null);
});

// ---------------------------------------------------------------------------
grupo('Regresión: la doble reserva del 11:15');

test('un turno de una hora a las 11 impide reservar 30 minutos a las 11:15', () => {
  const fecha = '2026-09-10';

  // Las horas llegan como las devuelve una planilla cuya columna perdió el
  // formato de texto: con segundos. Antes esto vaciaba la lista de ocupados.
  const turnos = [
    { id_barbero: 'b1', fecha: fecha, hora: '12:00:00', hora_fin: '12:30:00', estado: 'confirmado' },
    { id_barbero: 'b1', fecha: fecha, hora: '11:00:00', hora_fin: '12:00:00', estado: 'confirmado' }
  ];

  const libres = D.calcularSlotsLibres({
    ventanas: [{ inicio: 600, fin: 780 }],   // 10:00 a 13:00
    ocupados: D.turnosOcupados(turnos, 'b1', fecha),
    duracionMin: 30,
    pasoMin: 15
  });

  assert.ok(libres.indexOf('11:15') === -1, '11:15 se solapa con el turno de 11:00 a 12:00');
  assert.ok(libres.indexOf('11:00') === -1, '11:00 está tomado');
  assert.ok(libres.indexOf('12:00') === -1, '12:00 está tomado');
  assert.deepStrictEqual(libres, ['10:00', '10:15', '10:30', '12:30']);
});

// ---------------------------------------------------------------------------
grupo('Integración: un día completo de barbería');

test('agenda realista con horario partido, un turno y un bloqueo', () => {
  const fecha = '2026-09-10';
  const idBarbero = 'b1';

  const horarios = [
    { id_barbero: 'b1', dia_semana: 4, hora_inicio: '09:00', hora_fin: '13:00' },
    { id_barbero: 'b1', dia_semana: 4, hora_inicio: '16:00', hora_fin: '20:00' }
  ];
  const turnos = [
    { id_barbero: 'b1', fecha: fecha, hora: '09:00', hora_fin: '09:30', estado: 'confirmado' }
  ];
  const bloqueos = [
    { id_barbero: 'b1', fecha_inicio: fecha, fecha_fin: fecha, hora_inicio: '17:00', hora_fin: '18:00' }
  ];

  // 2026-09-10 es jueves (día 4).
  const ventanas = D.ventanasDelDia(horarios, idBarbero, 4);
  const ocupados = D.turnosOcupados(turnos, idBarbero, fecha)
    .concat(D.bloqueosDelDia(bloqueos, idBarbero, fecha));

  const slots = D.calcularSlotsLibres({
    ventanas: ventanas,
    ocupados: ocupados,
    duracionMin: 60,
    pasoMin: 60
  });

  // Mañana: 09:00 tomado; 10:00, 11:00 y 12:00 libres (12:00 cierra a las 13:00).
  // Tarde: 16:00 libre; 17:00 bloqueado; 18:00 y 19:00 libres.
  assert.deepStrictEqual(slots, ['10:00', '11:00', '12:00', '16:00', '18:00', '19:00']);
});

// ---------------------------------------------------------------------------
grupo('Margen entre turnos (Buffer time)');

test('el margen extiende el intervalo ocupado evitando solapamiento inmediato', () => {
  const fecha = '2026-09-10';
  const idBarbero = 'b1';
  const turnos = [
    { id_barbero: 'b1', fecha: fecha, hora: '09:00', hora_fin: '09:30', estado: 'confirmado' }
  ];

  // Con 10 minutos de margen, el turno de 09:00-09:30 bloquea hasta las 09:40
  const ocupadosConMargen = D.turnosOcupados(turnos, idBarbero, fecha, null, 10);
  assert.deepStrictEqual(ocupadosConMargen, [{ inicio: 540, fin: 580 }]); // 540=09:00, 580=09:40

  const slots = D.calcularSlotsLibres({
    ventanas: [{ inicio: D.aMinutos('09:00'), fin: D.aMinutos('11:00') }],
    ocupados: ocupadosConMargen,
    duracionMin: 30,
    pasoMin: 15,
    margenMin: 10
  });

  // 09:00, 09:15, 09:30 ocupados por el turno + buffer.
  // 09:45 entra (09:45 a 10:15 + 10m buffer = 10:25 <= 11:00).
  assert.ok(slots.indexOf('09:00') === -1);
  assert.ok(slots.indexOf('09:15') === -1);
  assert.ok(slots.indexOf('09:30') === -1);
  assert.ok(slots.indexOf('09:45') !== -1);
  assert.ok(slots.indexOf('10:00') !== -1);
});

// ---------------------------------------------------------------------------
grupo('Unión de disponibilidad (Cualquier profesional)');

test('unirHorariosDisponibles une y ordena horarios sin duplicar', () => {
  const barber1 = ['09:00', '10:00', '11:00'];
  const barber2 = ['09:30', '10:00', '11:30'];
  const unificados = D.unirHorariosDisponibles([barber1, barber2]);

  assert.deepStrictEqual(unificados, ['09:00', '09:30', '10:00', '11:00', '11:30']);
});

// ---------------------------------------------------------------------------
console.log('\n' + pasados + ' pasados, ' + fallidos + ' fallidos.');
process.exit(fallidos > 0 ? 1 : 0);
