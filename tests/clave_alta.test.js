/**
 * Tests de la clave que autoriza abrir una agenda.
 *
 * Es el único secreto del sistema que se compara en un endpoint sin
 * autenticar, así que conviene tenerlo cubierto: un error acá no rompe nada
 * visible, simplemente deja el alta abierta para cualquiera.
 *
 * Se carga el backend completo en un sandbox, igual que `router.test.js`, pero
 * con `PropertiesService` y `CacheService` simulados de verdad — con estado —
 * para poder ejercitar el vale de un solo uso y el límite de intentos.
 *
 *   node tests/clave_alta.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'backend');
const CLAVE = 'la-clave-del-administrador';

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

/**
 * Arma un backend cargado con una clave dada.
 * Devuelve el sandbox y el caché simulado, para poder espiarlo.
 */
function backendCon(clave) {
  const propiedades = {};
  if (clave) propiedades.CLAVE_ALTA_ADMIN = clave;

  const cache = new Map();
  let uuid = 0;

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    JSON, Date, Math, Intl, Object, Array, Number, String,
    isNaN, isFinite, parseInt, encodeURIComponent, Infinity,

    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => propiedades,
        getProperty: (k) => propiedades[k] || null,
        setProperty: () => {}
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, v); },
        remove: (k) => { cache.delete(k); }
      })
    },
    SpreadsheetApp: {}, LockService: {}, UrlFetchApp: {}, DriveApp: {},
    Logger: { log: () => {} },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (t) => ({ setMimeType() { return this; }, getContent: () => t })
    },
    Utilities: {
      // Un uuid distinto por llamada: dos altas seguidas no pueden compartir vale.
      getUuid: () => String(++uuid).padStart(8, '0') + '-0000-0000-0000-000000000000',
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
  fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort().forEach((archivo) => {
    vm.runInContext(fs.readFileSync(path.join(DIR, archivo), 'utf8'), contexto, { filename: archivo });
  });

  // `evaluar` hace falta para lo declarado con `const`: a diferencia de `var` y
  // de las funciones, no queda como propiedad del objeto global del contexto.
  const evaluar = (expresion) => vm.runInContext(expresion, contexto);

  return { sandbox, cache, evaluar };
}

/** Ejecuta algo que debería fallar y devuelve el código de error. */
function codigoDeError(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.codigoApp || 'SIN_CODIGO';
  }
}

console.log('\n--- Clave de alta ---');

console.log('\nVerificación de la clave');

test('la clave correcta devuelve un vale', () => {
  const { sandbox } = backendCon(CLAVE);
  const r = sandbox.epVerificarClaveAlta_({ clave_admin: CLAVE });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.requiere_clave, true);
  assert.ok(r.data.vale, 'Tendría que venir un vale');
  assert.strictEqual(r.data.vence_en_min, 30);
});

test('la clave incorrecta no devuelve vale y da NO_AUTENTICADO', () => {
  const { sandbox, cache } = backendCon(CLAVE);
  const codigo = codigoDeError(() => sandbox.epVerificarClaveAlta_({ clave_admin: 'otra-cosa' }));
  assert.strictEqual(codigo, 'NO_AUTENTICADO');
  const vales = [...cache.keys()].filter((k) => k.indexOf('vale_') === 0);
  assert.deepStrictEqual(vales, [], 'No se puede emitir un vale con la clave mal');
});

test('la clave vacía o ausente se rechaza', () => {
  const { sandbox } = backendCon(CLAVE);
  assert.strictEqual(codigoDeError(() => sandbox.epVerificarClaveAlta_({ clave_admin: '' })), 'NO_AUTENTICADO');
  assert.strictEqual(codigoDeError(() => sandbox.epVerificarClaveAlta_({})), 'NO_AUTENTICADO');
});

test('un prefijo correcto de la clave no alcanza', () => {
  // La comparación no corta en la primera diferencia, pero igual tiene que
  // seguir siendo estricta con longitudes distintas.
  const { sandbox } = backendCon(CLAVE);
  assert.strictEqual(codigoDeError(() => sandbox.epVerificarClaveAlta_({ clave_admin: CLAVE.slice(0, -1) })), 'NO_AUTENTICADO');
  assert.strictEqual(codigoDeError(() => sandbox.epVerificarClaveAlta_({ clave_admin: CLAVE + 'x' })), 'NO_AUTENTICADO');
});

test('sin clave configurada avisa que el alta está abierta', () => {
  const { sandbox } = backendCon('');
  const r = sandbox.epVerificarClaveAlta_({ clave_admin: 'cualquiera' });
  assert.strictEqual(r.data.requiere_clave, false);
  assert.strictEqual(r.data.vale, '');
});

console.log('\nLímite de intentos');

test('los intentos fallidos se cortan al llegar al límite', () => {
  const { sandbox, evaluar } = backendCon(CLAVE);
  const maximo = evaluar('LIMITES.CLAVE_ALTA_FALLIDAS_POR_HORA');

  for (let i = 0; i < maximo; i++) {
    assert.strictEqual(
      codigoDeError(() => sandbox.epVerificarClaveAlta_({ clave_admin: 'mal' })),
      'NO_AUTENTICADO', 'El intento ' + (i + 1) + ' debería ser un rechazo normal');
  }
  assert.strictEqual(
    codigoDeError(() => sandbox.epVerificarClaveAlta_({ clave_admin: 'mal' })),
    'LIMITE_EXCEDIDO', 'Pasado el límite tiene que cambiar el código de error');
});

test('el límite también frena a quien acierta después de agotarlo', () => {
  // Si no, el límite sería inútil: bastaría con seguir probando.
  const { sandbox, evaluar } = backendCon(CLAVE);
  for (let i = 0; i < evaluar('LIMITES.CLAVE_ALTA_FALLIDAS_POR_HORA'); i++) {
    codigoDeError(() => sandbox.epVerificarClaveAlta_({ clave_admin: 'mal' }));
  }
  assert.strictEqual(
    codigoDeError(() => sandbox.epVerificarClaveAlta_({ clave_admin: CLAVE })),
    'LIMITE_EXCEDIDO');
});

console.log('\nAutorización del alta');

test('el vale emitido autoriza el alta', () => {
  const { sandbox } = backendCon(CLAVE);
  const vale = sandbox.epVerificarClaveAlta_({ clave_admin: CLAVE }).data.vale;
  assert.doesNotThrow(() => sandbox.exigirClaveDeAlta_({ vale_alta: vale }));
});

test('el vale sirve UNA sola vez', () => {
  const { sandbox } = backendCon(CLAVE);
  const vale = sandbox.epVerificarClaveAlta_({ clave_admin: CLAVE }).data.vale;
  sandbox.exigirClaveDeAlta_({ vale_alta: vale });
  assert.strictEqual(
    codigoDeError(() => sandbox.exigirClaveDeAlta_({ vale_alta: vale })),
    'NO_AUTENTICADO', 'Reusar el vale tendría que fallar');
});

test('un vale inventado no autoriza', () => {
  const { sandbox } = backendCon(CLAVE);
  assert.strictEqual(
    codigoDeError(() => sandbox.exigirClaveDeAlta_({ vale_alta: 'vale_inventado' })),
    'NO_AUTENTICADO');
});

test('dos verificaciones seguidas dan vales distintos', () => {
  const { sandbox } = backendCon(CLAVE);
  const a = sandbox.epVerificarClaveAlta_({ clave_admin: CLAVE }).data.vale;
  const b = sandbox.epVerificarClaveAlta_({ clave_admin: CLAVE }).data.vale;
  assert.notStrictEqual(a, b);
});

test('la clave directa también autoriza el alta, sin vale', () => {
  // Es la salida cuando el vale caducó a mitad del trámite.
  const { sandbox } = backendCon(CLAVE);
  assert.doesNotThrow(() => sandbox.exigirClaveDeAlta_({ clave_admin: CLAVE }));
});

test('el alta sin clave ni vale se rechaza', () => {
  const { sandbox } = backendCon(CLAVE);
  assert.strictEqual(codigoDeError(() => sandbox.exigirClaveDeAlta_({})), 'NO_AUTENTICADO');
  assert.strictEqual(codigoDeError(() => sandbox.exigirClaveDeAlta_({ clave_admin: 'mal', vale_alta: 'mal' })), 'NO_AUTENTICADO');
});

test('sin clave configurada el alta no exige nada', () => {
  const { sandbox } = backendCon('');
  assert.doesNotThrow(() => sandbox.exigirClaveDeAlta_({}));
});

console.log('\nExposición');

test('la clave no aparece en ninguna respuesta', () => {
  const { sandbox } = backendCon(CLAVE);
  const serializada = JSON.stringify(sandbox.epVerificarClaveAlta_({ clave_admin: CLAVE }));
  assert.ok(serializada.indexOf(CLAVE) === -1, 'La respuesta no puede devolver la clave');
});

test('la clave no está en ningún archivo del frontend', () => {
  // El motivo de todo el diseño: config.js se descarga en el navegador de
  // cualquier visitante.
  const dirFront = path.join(__dirname, '..', 'frontend', 'js');
  fs.readdirSync(dirFront).filter((f) => f.endsWith('.js')).forEach((archivo) => {
    const codigo = fs.readFileSync(path.join(dirFront, archivo), 'utf8');
    assert.ok(codigo.indexOf('CLAVE_ADMIN') === -1,
      archivo + ' menciona CLAVE_ADMIN: la clave no puede vivir en el frontend');
  });
});

test('verificarClaveAlta está en el router y va por POST', () => {
  const { sandbox } = backendCon(CLAVE);
  assert.strictEqual(typeof sandbox.RUTAS_POST.verificarClaveAlta, 'function');
  assert.ok(!('verificarClaveAlta' in sandbox.RUTAS_GET),
    'Por GET viajaría la clave en la URL, que queda en los logs del servidor');
});

console.log('\n' + pasados + ' pasados, ' + fallidos + ' fallidos.');
if (fallidos) process.exit(1);
