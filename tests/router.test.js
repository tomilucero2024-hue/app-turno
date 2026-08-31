/**
 * Test de humo del backend completo.
 *
 * Carga todos los archivos en el mismo orden alfabético en que los evalúa Apps
 * Script, con los servicios de Google simulados con lo mínimo indispensable.
 * No prueba la lógica de negocio: prueba que el proyecto CARGA y que el router
 * resuelve todos sus handlers. Un typo en una tabla de rutas se descubre acá en
 * un segundo, en vez de en producción con un "Acción no reconocida".
 *
 *   node tests/router.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'backend');

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

// --- Simulación mínima de los servicios de Apps Script ----------------------

function noImplementado(nombre) {
  return function () {
    throw new Error('El test de humo no debe llegar a ' + nombre + '.');
  };
}

const sandbox = {
  console: console,
  JSON: JSON,
  Date: Date,
  Math: Math,
  Intl: Intl,
  Object: Object,
  Array: Array,
  Number: Number,
  String: String,
  isNaN: isNaN,
  isFinite: isFinite,
  parseInt: parseInt,
  encodeURIComponent: encodeURIComponent,
  Infinity: Infinity,

  PropertiesService: {
    getScriptProperties: () => ({
      getProperties: () => ({}),
      getProperty: () => null,
      setProperty: noImplementado('setProperty')
    })
  },
  SpreadsheetApp: { openById: noImplementado('openById'), create: noImplementado('create') },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  UrlFetchApp: { fetch: noImplementado('fetch') },
  DriveApp: {},
  Logger: { log: () => {} },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (texto) => ({
      _texto: texto,
      setMimeType: function () { return this; },
      getContent: function () { return this._texto; }
    })
  },
  Utilities: {
    getUuid: () => '00112233-4455-6677-8899-aabbccddeeff',
    formatDate: () => '2026-01-01',
    computeDigest: () => [1, 2, 3],
    base64EncodeWebSafe: () => 'xxx',
    base64DecodeWebSafe: () => [],
    newBlob: () => ({ getDataAsString: () => '{}' }),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' }
  }
};

const contexto = vm.createContext(sandbox);

// Apps Script evalúa los archivos en orden alfabético dentro de un único ámbito
// global. Por eso los archivos están numerados, y por eso acá se cargan igual.
const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();

console.log('\nCarga del proyecto');

test('todos los archivos cargan sin error', () => {
  archivos.forEach((archivo) => {
    const codigo = fs.readFileSync(path.join(DIR, archivo), 'utf8');
    vm.runInContext(codigo, contexto, { filename: archivo });
  });
});

test('los archivos se cargan en el orden que usa Apps Script', () => {
  const esperado = [
    '00_Config.js', '01_Utils.js', '02_Disponibilidad.js', '03_Sheets.js',
    '04_Auth.js', '05_AntiAbuso.js', '10_EndpointsPublicos.js',
    '11_EndpointsDueno.js', '12_EndpointsCuenta.js', '99_Main.js', 'Instalacion.js'
  ];
  assert.deepStrictEqual(archivos, esperado);
});

console.log('\nTabla de rutas');

test('todos los handlers del router existen y son funciones', () => {
  const faltantes = [];
  [['GET', sandbox.RUTAS_GET], ['POST', sandbox.RUTAS_POST]].forEach(([metodo, rutas]) => {
    assert.ok(rutas, 'No existe la tabla de rutas ' + metodo);
    Object.keys(rutas).forEach((accion) => {
      if (typeof rutas[accion] !== 'function') faltantes.push(metodo + ' ' + accion);
    });
  });
  assert.deepStrictEqual(faltantes, [], 'Handlers no resueltos: ' + faltantes.join(', '));
});

test('ninguna acción está declarada a la vez en GET y en POST', () => {
  const enAmbas = Object.keys(sandbox.RUTAS_GET).filter((a) => a in sandbox.RUTAS_POST);
  assert.deepStrictEqual(enAmbas, []);
});

test('las acciones que escriben no son accesibles por GET', () => {
  // Un GET que modifica estado se puede disparar desde una etiqueta <img> en
  // cualquier página, sin que el navegador aplique CORS al pedido.
  const prohibidas = ['crearTurno', 'cancelarTurno', 'registrarCuenta', 'borrarServicio'];
  prohibidas.forEach((accion) => {
    assert.ok(!(accion in sandbox.RUTAS_GET), accion + ' no debería estar en RUTAS_GET');
  });
});

console.log('\nContrato de respuesta');

test('una acción desconocida responde ok:false, nunca una excepción', () => {
  const salida = sandbox.doPost({ postData: { contents: JSON.stringify({ accion: 'noExiste' }) } });
  const cuerpo = JSON.parse(salida.getContent());
  assert.strictEqual(cuerpo.ok, false);
  assert.strictEqual(cuerpo.error.codigo, 'ACCION_DESCONOCIDA');
});

test('un body que no es JSON responde ok:false, nunca una excepción', () => {
  const salida = sandbox.doPost({ postData: { contents: 'esto no es json' } });
  const cuerpo = JSON.parse(salida.getContent());
  assert.strictEqual(cuerpo.ok, false);
  assert.strictEqual(cuerpo.error.codigo, 'ENTRADA_INVALIDA');
});

test('un GET sin parámetros responde ok:false, nunca una excepción', () => {
  const cuerpo = JSON.parse(sandbox.doGet({}).getContent());
  assert.strictEqual(cuerpo.ok, false);
});

test('las acciones heredadas de Object no se resuelven como rutas', () => {
  // Sin hasOwnProperty, accion="constructor" resolvería a una función real.
  const salida = sandbox.doPost({ postData: { contents: JSON.stringify({ accion: 'constructor' }) } });
  const cuerpo = JSON.parse(salida.getContent());
  assert.strictEqual(cuerpo.error.codigo, 'ACCION_DESCONOCIDA');
});

test('un error interno no filtra el stack trace al cliente', () => {
  const salida = sandbox.doPost({
    postData: { contents: JSON.stringify({ accion: 'getPerfilCuenta', token: 'x'.repeat(40) }) }
  });
  const cuerpo = JSON.parse(salida.getContent());
  assert.strictEqual(cuerpo.ok, false);
  assert.ok(!/at |\.js:\d+/.test(JSON.stringify(cuerpo)), 'La respuesta contiene un stack trace');
});

console.log('\nValidación de entrada');

test('normalizarTelefono_ deja solo dígitos', () => {
  assert.strictEqual(sandbox.normalizarTelefono_('11 2345-6789'), '1123456789');
  assert.strictEqual(sandbox.normalizarTelefono_('+54 9 11 2345 6789'), '5491123456789');
});

test('normalizarTelefono_ rechaza números imposibles', () => {
  assert.throws(() => sandbox.normalizarTelefono_('123'));
  assert.throws(() => sandbox.normalizarTelefono_(''));
});

test('generarSlug_ produce identificadores aptos para la URL', () => {
  assert.strictEqual(sandbox.generarSlug_('Barbería Juan'), 'barberia-juan');
  assert.strictEqual(sandbox.generarSlug_('  El Peluquín  '), 'el-peluquin');
  assert.strictEqual(sandbox.generarSlug_('Ñandú & Cía.'), 'nandu-cia');
  assert.strictEqual(sandbox.generarSlug_('!!!'), 'negocio');
});

test('esFechaValida_ rechaza fechas que no existen', () => {
  assert.strictEqual(sandbox.esFechaValida_('2026-02-30'), false);
  assert.strictEqual(sandbox.esFechaValida_('2026-13-01'), false);
  assert.strictEqual(sandbox.esFechaValida_('2026-2-1'), false);
  assert.strictEqual(sandbox.esFechaValida_('2026-02-28'), true);
  assert.strictEqual(sandbox.esFechaValida_('2028-02-29'), true);
});

test('diaSemanaDeFecha_ no se corre por la zona horaria', () => {
  assert.strictEqual(sandbox.diaSemanaDeFecha_('2026-09-10'), 4);
  assert.strictEqual(sandbox.diaSemanaDeFecha_('2026-01-01'), 4);
});

test('sumarDias_ y diferenciaDias_ cruzan meses y años', () => {
  assert.strictEqual(sandbox.diferenciaDias_('2026-01-01', '2026-03-01'), 59);
  assert.strictEqual(sandbox.diferenciaDias_('2026-12-31', '2027-01-01'), 1);
});

test('esActivo_ trata la celda vacía como activo', () => {
  // Las filas que un usuario agrega a mano en la planilla suelen quedar sin el
  // campo "activo": tratarlas como inactivas escondería servicios sin motivo.
  assert.strictEqual(sandbox.esActivo_(''), true);
  assert.strictEqual(sandbox.esActivo_('TRUE'), true);
  assert.strictEqual(sandbox.esActivo_(true), true);
  assert.strictEqual(sandbox.esActivo_('FALSE'), false);
  assert.strictEqual(sandbox.esActivo_(false), false);
});

test('el código de ticket usa solo caracteres no ambiguos', () => {
  const codigo = sandbox.nuevoCodigoTicket_();
  assert.strictEqual(codigo.length, 10);
  assert.ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(codigo), 'Código inesperado: ' + codigo);
});

test('esZonaHorariaValida_ valida zonas IANA conocidas y rechaza valores inválidos', () => {
  assert.strictEqual(sandbox.esZonaHorariaValida_('America/Argentina/Buenos_Aires'), true);
  assert.strictEqual(sandbox.esZonaHorariaValida_('UTC'), true);
  assert.strictEqual(sandbox.esZonaHorariaValida_('Europe/Madrid'), true);
  assert.strictEqual(sandbox.esZonaHorariaValida_('Invalida/NoExiste'), false);
  assert.strictEqual(sandbox.esZonaHorariaValida_(''), false);
  assert.strictEqual(sandbox.esZonaHorariaValida_(null), false);
});

console.log('\n' + pasados + ' pasados, ' + fallidos + ' fallidos.');
process.exit(fallidos > 0 ? 1 : 0);
