/**
 * Configuración global y esquemas de datos.
 *
 * Los secretos NO viven en este archivo: se leen de las Propiedades del Script
 * (Configuración del proyecto -> Propiedades del script), para que el repo se
 * pueda publicar sin filtrar nada. Ver README para la lista de claves.
 *
 * Apps Script carga los archivos en orden alfabético y comparte un único ámbito
 * global, por eso los archivos están numerados: las constantes de este archivo
 * tienen que existir antes de que las use cualquier otro.
 */

/** Nombre de la hoja maestra dentro de la planilla maestra. */
const HOJA_CUENTAS = 'Cuentas';

/** Columnas de la hoja maestra `Cuentas`. */
const ESQUEMA_CUENTAS = [
  'id_cuenta',
  'tipo',
  'nombre_negocio',
  'slug',
  'email',
  'firebase_uid',
  'spreadsheet_id',
  'zona_horaria',
  'paso_grilla_min',
  'antelacion_min_horas',
  'cancelacion_min_horas',
  'margen_turno_min',
  'direccion',
  'instagram',
  'telefono_contacto',
  'activo',
  'fecha_alta'
];

/** Columnas de `Cuentas` que deben guardarse como texto plano. */
const CUENTAS_COLUMNAS_TEXTO = [
  'id_cuenta', 'slug', 'firebase_uid', 'spreadsheet_id',
  'direccion', 'instagram', 'telefono_contacto'
];

/**
 * Esquema de la planilla propia de cada negocio.
 * `texto` fuerza el formato de celda a texto plano ("@"): sin eso Sheets
 * convierte "09:00" en una hora y "2026-03-04" en una fecha, y al releerlas
 * vuelven como objetos Date en la zona horaria del archivo — que no siempre
 * coincide con la del script. Guardarlas como cadenas elimina esa clase de bug.
 */
const ESQUEMAS_NEGOCIO = {
  Barberos: {
    columnas: ['id_barbero', 'nombre', 'activo'],
    texto: ['id_barbero']
  },
  Servicios: {
    columnas: ['id_servicio', 'nombre', 'duracion_minutos', 'precio', 'activo'],
    texto: ['id_servicio']
  },
  Horarios_disponibles: {
    columnas: ['id_barbero', 'dia_semana', 'hora_inicio', 'hora_fin'],
    texto: ['id_barbero', 'hora_inicio', 'hora_fin']
  },
  Bloqueos: {
    columnas: ['id_bloqueo', 'id_barbero', 'fecha_inicio', 'fecha_fin', 'hora_inicio', 'hora_fin', 'motivo'],
    texto: ['id_bloqueo', 'id_barbero', 'fecha_inicio', 'fecha_fin', 'hora_inicio', 'hora_fin']
  },
  Turnos: {
    columnas: [
      'id_turno', 'codigo_ticket', 'id_barbero', 'id_servicio', 'servicio_nombre',
      'duracion_minutos', 'precio', 'cliente_nombre', 'cliente_telefono',
      'fecha', 'hora', 'hora_fin', 'estado', 'creado_en', 'cancelado_por'
    ],
    texto: [
      'id_turno', 'codigo_ticket', 'id_barbero', 'id_servicio',
      'cliente_telefono', 'fecha', 'hora', 'hora_fin', 'creado_en'
    ]
  },
  Turnos_Historico: {
    columnas: [
      'id_turno', 'codigo_ticket', 'id_barbero', 'id_servicio', 'servicio_nombre',
      'duracion_minutos', 'precio', 'cliente_nombre', 'cliente_telefono',
      'fecha', 'hora', 'hora_fin', 'estado', 'creado_en', 'cancelado_por'
    ],
    texto: [
      'id_turno', 'codigo_ticket', 'id_barbero', 'id_servicio',
      'cliente_telefono', 'fecha', 'hora', 'hora_fin', 'creado_en'
    ]
  },
  Lista_negra: {
    columnas: ['telefono', 'fecha_bloqueo', 'motivo'],
    texto: ['telefono', 'fecha_bloqueo']
  }
};

/** Estados posibles de un turno. `pendiente` no existe: ver sección 7 del doc. */
const ESTADOS_TURNO = ['confirmado', 'cancelado', 'completado', 'no_asistio'];

/** Estados que ocupan el horario. `cancelado` lo libera. */
const ESTADOS_QUE_OCUPAN = ['confirmado', 'completado', 'no_asistio'];

/** Valores por defecto de configuración de una cuenta nueva. */
const DEFAULTS_CUENTA = {
  zona_horaria: 'America/Argentina/Buenos_Aires',
  paso_grilla_min: 15,
  antelacion_min_horas: 1,
  cancelacion_min_horas: 2,
  margen_turno_min: 0,
  direccion: '',
  instagram: '',
  telefono_contacto: ''
};

/** Límites anti-abuso. */
const LIMITES = {
  RESERVAS_POR_TELEFONO_POR_HORA: 3,
  CONSULTAS_TICKET_FALLIDAS_POR_HORA: 10,
  ESPERA_LOCK_MS: 20000,
  CACHE_TOKEN_SEG: 300,
  CACHE_CUENTA_SEG: 300,
  MAX_DIAS_RANGO_CONSULTA: 92
};

/** Alfabeto del código de ticket: sin 0/O/1/I/L, para poder dictarlo por teléfono. */
const ALFABETO_TICKET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO_TICKET = 10;

/** Códigos de error del contrato de la API. */
const ERR = {
  ENTRADA_INVALIDA: 'ENTRADA_INVALIDA',
  NO_AUTENTICADO: 'NO_AUTENTICADO',
  SIN_CUENTA: 'SIN_CUENTA',
  NO_ENCONTRADO: 'NO_ENCONTRADO',
  SLOT_OCUPADO: 'SLOT_OCUPADO',
  LIMITE_EXCEDIDO: 'LIMITE_EXCEDIDO',
  TELEFONO_BLOQUEADO: 'TELEFONO_BLOQUEADO',
  VERIFICACION_FALLIDA: 'VERIFICACION_FALLIDA',
  FUERA_DE_PLAZO: 'FUERA_DE_PLAZO',
  SLUG_OCUPADO: 'SLUG_OCUPADO',
  YA_REGISTRADO: 'YA_REGISTRADO',
  SISTEMA_OCUPADO: 'SISTEMA_OCUPADO',
  ACCION_DESCONOCIDA: 'ACCION_DESCONOCIDA',
  INTERNO: 'INTERNO'
};

/** Lectura memoizada de las Propiedades del Script. */
var _propiedadesCache = null;

function propiedad_(clave, porDefecto) {
  if (_propiedadesCache === null) {
    _propiedadesCache = PropertiesService.getScriptProperties().getProperties();
  }
  var valor = _propiedadesCache[clave];
  return (valor === undefined || valor === null || valor === '') ? porDefecto : valor;
}

/** ID de la planilla maestra que contiene la hoja `Cuentas`. */
function idPlanillaMaestra_() {
  var id = propiedad_('MASTER_SPREADSHEET_ID', '');
  if (!id) {
    throw errorApp_(ERR.INTERNO, 'Falta la propiedad de script MASTER_SPREADSHEET_ID. Ejecutá instalar() una vez.');
  }
  return id;
}

/** API key web de Firebase. Es pública por diseño (viaja en el frontend igual). */
function apiKeyFirebase_() {
  var key = propiedad_('FIREBASE_API_KEY', '');
  if (!key) {
    throw errorApp_(ERR.INTERNO, 'Falta la propiedad de script FIREBASE_API_KEY.');
  }
  return key;
}

/** ID del proyecto de Firebase, usado para validar el `aud` del token. */
function proyectoFirebase_() {
  return propiedad_('FIREBASE_PROJECT_ID', '');
}

/** Secreto de Cloudflare Turnstile. Vacío = verificación desactivada (desarrollo). */
function secretoTurnstile_() {
  return propiedad_('TURNSTILE_SECRET', '');
}

/**
 * Clave maestra que autoriza el alta de una agenda nueva.
 *
 * Vive acá y no en el frontend por la razón obvia: `config.js` se descarga en
 * el navegador de cualquiera, así que una clave comparada en JavaScript no
 * autoriza nada — se lee en el código fuente de la página y se saltea borrando
 * el `if` desde la consola. La comparación real es la de `epRegistrarCuenta_`.
 *
 * Vacía = el alta queda abierta. Es aceptable en desarrollo y no en producción,
 * y `verificarInstalacion()` lo avisa.
 */
function claveAltaAdmin_() {
  return propiedad_('CLAVE_ALTA_ADMIN', '');
}

/** Carpeta de Drive donde se crean las planillas de los negocios (opcional). */
function carpetaNegocios_() {
  return propiedad_('DRIVE_FOLDER_ID', '');
}
