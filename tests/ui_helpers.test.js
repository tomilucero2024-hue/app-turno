const fs = require('fs');
const assert = require('assert');
const path = require('path');
const vm = require('vm');

console.log('\n--- Verificación Integral de Helpers y Módulos Frontend ---');

// 1. Validar los dos manifests
//
// Son dos y no uno porque `start_url` decide qué abre el icono instalado, y
// solo puede apuntar a un lado: con un manifest compartido, el dueño instalaba
// el panel y le abría la pantalla de buscar barbería.
const dirFrontend = path.join(__dirname, '..', 'frontend');
const leerManifest = (nombre) =>
  JSON.parse(fs.readFileSync(path.join(dirFrontend, nombre), 'utf-8'));

const manifest = leerManifest('manifest.json');
const manifestPanel = leerManifest('manifest-panel.json');

[['manifest.json', manifest, './index.html'],
 ['manifest-panel.json', manifestPanel, './panel.html']].forEach(([nombre, m, inicio]) => {
  assert.strictEqual(m.display, 'standalone', nombre + ': display');
  assert.strictEqual(m.start_url, inicio, nombre + ': start_url');
  assert.ok(m.name && m.short_name, nombre + ': falta name o short_name');

  // Chrome exige un icono de 192 y uno de 512 para ofrecer la instalación, y
  // Android necesita uno maskable para no recortar el logo dentro del círculo.
  const porTamano = (t) => m.icons.some((i) => i.sizes === t && i.type === 'image/png');
  assert.ok(porTamano('192x192'), nombre + ': falta el icono PNG de 192');
  assert.ok(porTamano('512x512'), nombre + ': falta el icono PNG de 512');
  assert.ok(m.icons.some((i) => (i.purpose || '').includes('maskable')),
    nombre + ': falta un icono maskable');

  m.icons.forEach((i) => {
    const ruta = path.join(dirFrontend, i.src);
    assert.ok(fs.existsSync(ruta), nombre + ': el icono ' + i.src + ' no existe');
  });
});

assert.notStrictEqual(manifest.start_url, manifestPanel.start_url,
  'Dos manifests con el mismo start_url se instalan como la misma app');
console.log('  ok  los dos manifests son válidos y sus iconos existen');

// Los accesos directos del panel salen al mantener apretado el icono en Android.
assert.ok(manifestPanel.shortcuts.length >= 1, 'El panel tendría que tener accesos directos');
manifestPanel.shortcuts.forEach((a) => {
  assert.ok(a.name && a.url, 'Acceso directo sin nombre o sin url');
  const seccion = a.url.split('#')[1];
  assert.ok(seccion, 'El acceso directo ' + a.name + ' tiene que apuntar a una sección con #');
  const panelJs = fs.readFileSync(path.join(dirFrontend, 'js', 'panel.js'), 'utf-8');
  assert.ok(panelJs.includes("id: '" + seccion + "'"),
    'El acceso directo ' + a.name + ' apunta a "' + seccion + '", que no es una sección del panel');
});
console.log('  ok  los accesos directos del panel apuntan a secciones que existen');

// 2. Cargar UI en sandbox
const uiPath = path.join(__dirname, '..', 'frontend', 'js', 'ui.js');
const uiCode = fs.readFileSync(uiPath, 'utf-8');

let blobCapturado = null;
let elementoCreado = null;

const sandbox = {
  window: { location: { search: '' } },
  document: {
    createElement: (tag) => {
      elementoCreado = {
        tag,
        _attrs: {},
        setAttribute: function(k, v) { this._attrs[k] = v; },
        click: function() { this.clicked = true; },
        addEventListener: function() {}
      };
      return elementoCreado;
    },
    body: { appendChild: () => {}, removeChild: () => {} }
  },
  navigator: {},
  location: { search: '' },
  URL: { createObjectURL: () => 'blob:mock-url', revokeObjectURL: () => {} },
  Blob: function(arr, opts) {
    this.content = arr.join('');
    this.opts = opts;
    blobCapturado = this;
  },
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  Date: Date,
  Math: Math,
  Number: Number,
  String: String,
  URLSearchParams: URLSearchParams
};

vm.createContext(sandbox);
const UI = vm.runInContext(uiCode + '\n;UI;', sandbox);

// 3. Probar linkGoogleCalendar
const turnoPrueba = {
  fecha: '2026-09-15',
  hora: '10:00',
  hora_fin: '10:45',
  servicio_nombre: 'Corte + Barba',
  barbero_nombre: 'Lucas',
  codigo_ticket: 'TICKET123',
  precio: 5000
};
const negocioPrueba = {
  direccion: 'Av. Libertador 100',
  nombre_negocio: 'Barbería San Martín'
};

const linkGC = UI.linkGoogleCalendar(turnoPrueba, negocioPrueba);
assert.ok(linkGC.includes('https://calendar.google.com/calendar/render'), 'URL de Google Calendar válida');
assert.ok(linkGC.includes('20260915T100000'), 'Fecha/Hora de inicio presente en formato ISO compacto');
assert.ok(linkGC.includes('20260915T104500'), 'Fecha/Hora de fin presente');
console.log('  ok  linkGoogleCalendar genera URL con parámetros correctos');

// 4. Probar descargarIcs
UI.descargarIcs(turnoPrueba, negocioPrueba);
assert.ok(blobCapturado, 'Blob .ics generado');
assert.ok(blobCapturado.content.includes('BEGIN:VCALENDAR'), 'Contiene cabecera iCalendar');
assert.ok(blobCapturado.content.includes('DTSTART:20260915T100000'), 'Contiene fecha inicio iCalendar');
assert.ok(blobCapturado.content.includes('DTEND:20260915T104500'), 'Contiene fecha fin iCalendar');
assert.ok(blobCapturado.content.includes('SUMMARY:Turno: Corte + Barba - Barbería San Martín'), 'Contiene resumen');
assert.strictEqual(elementoCreado.download, 'turno-TICKET123.ics');
console.log('  ok  descargarIcs genera archivo iCalendar estándar .ics válido');

// 5. Probar descargarCsv
UI.descargarCsv('reporte_turnos.csv', [
  { ticket: 'T1', cliente: 'Juan Pérez', servicio: 'Corte', precio: 3000 },
  { ticket: 'T2', cliente: 'Carlos "El Pro"', servicio: 'Corte + Barba', precio: 5000 }
]);
assert.ok(blobCapturado.content.startsWith('\uFEFF'), 'CSV incluye BOM UTF-8 para compatibilidad con Excel');
assert.ok(blobCapturado.content.includes('"Carlos ""El Pro"""'), 'CSV escapa comillas dobles según RFC 4180');
assert.strictEqual(elementoCreado.download, 'reporte_turnos.csv');
console.log('  ok  descargarCsv exporta tabla con BOM UTF-8 y escapado correcto');

// 6. Probar máscara de teléfono
const mockInput = {
  value: '',
  listeners: {},
  addEventListener: function(event, fn) { this.listeners[event] = fn; },
  trigger: function(event) { if (this.listeners[event]) this.listeners[event](); }
};
UI.aplicarMascaraTelefono(mockInput);
mockInput.value = '1123456789';
mockInput.trigger('input');
assert.strictEqual(mockInput.value, '11 2345-6789', 'Máscara formatea número de 10 dígitos correctamente');

mockInput.value = '11234';
mockInput.trigger('input');
assert.strictEqual(mockInput.value, '11 234', 'Máscara formatea número parcial correctamente');
console.log('  ok  aplicarMascaraTelefono formatea en vivo 11 XXXX-XXXX');

// 7. Las hojas de estilo tienen las llaves balanceadas
//
// Una llave de cierre suelta no rompe nada a la vista: el navegador la trata
// como un error, se recupera consumiendo la regla que viene después y la
// descarta en silencio. Así desapareció la regla principal de
// `.nav-pildora__item`, y las pestañas del panel quedaron con el estilo crudo
// del botón del sistema. Contar llaves lo detecta antes de que llegue a la
// pantalla.
const dirCss = path.join(dirFrontend, 'css');
fs.readdirSync(dirCss).filter((f) => f.endsWith('.css')).forEach((archivo) => {
  const css = fs.readFileSync(path.join(dirCss, archivo), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
  let profundidad = 0;
  let linea = 1;
  for (const caracter of css) {
    if (caracter === '\n') linea++;
    else if (caracter === '{') profundidad++;
    else if (caracter === '}') {
      profundidad--;
      assert.ok(profundidad >= 0, archivo + ':' + linea +
        ' cierra una llave que nunca se abrió; la regla siguiente se pierde sin aviso');
    }
  }
  assert.strictEqual(profundidad, 0, archivo + ' deja bloques sin cerrar');
});
console.log('  ok  las hojas de estilo tienen las llaves balanceadas');

console.log('\nTodos los tests de UI y Frontend pasaron satisfactoriamente.\n');
