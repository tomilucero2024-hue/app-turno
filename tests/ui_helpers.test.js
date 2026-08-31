const fs = require('fs');
const assert = require('assert');
const path = require('path');
const vm = require('vm');

console.log('\n--- Verificación Integral de Helpers y Módulos Frontend ---');

// 1. Validar manifest.json
const manifestPath = path.join(__dirname, '..', 'frontend', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
assert.strictEqual(manifest.name, 'Turnos - Sistema de Reservas');
assert.strictEqual(manifest.display, 'standalone');
console.log('  ok  manifest.json es JSON válido y tiene estructura PWA');

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

console.log('\nTodos los tests de UI y Frontend pasaron satisfactoriamente.\n');
