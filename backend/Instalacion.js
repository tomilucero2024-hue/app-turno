/**
 * Funciones de instalación y mantenimiento.
 * Se ejecutan a mano desde el editor de Apps Script, nunca desde el Web App.
 */

/**
 * Crea la planilla maestra y deja su id en las propiedades del script.
 * Ejecutar UNA sola vez, al instalar el proyecto.
 */
function instalar() {
  var props = PropertiesService.getScriptProperties();

  if (props.getProperty('MASTER_SPREADSHEET_ID')) {
    Logger.log('Ya existe una planilla maestra: ' + props.getProperty('MASTER_SPREADSHEET_ID'));
    return;
  }

  var ss = SpreadsheetApp.create('App Turnos - Cuentas (maestra)');
  var h = ss.insertSheet(HOJA_CUENTAS);
  prepararHoja_(h, ESQUEMA_CUENTAS, CUENTAS_COLUMNAS_TEXTO);

  var porDefecto = ss.getSheets()[0];
  if (porDefecto.getName() !== HOJA_CUENTAS) {
    ss.deleteSheet(porDefecto);
  }

  props.setProperty('MASTER_SPREADSHEET_ID', ss.getId());

  Logger.log('Planilla maestra creada: ' + ss.getUrl());
  Logger.log('Falta cargar a mano las propiedades FIREBASE_API_KEY, FIREBASE_PROJECT_ID ' +
    'y CLAVE_ALTA_ADMIN (la clave que autoriza abrir agendas nuevas).');
}

/**
 * Verifica que la instalación esté completa.
 * Conviene correrla después de cargar las propiedades y antes de publicar.
 */
function verificarInstalacion() {
  var problemas = [];
  var props = PropertiesService.getScriptProperties().getProperties();

  if (!props.MASTER_SPREADSHEET_ID) {
    problemas.push('Falta MASTER_SPREADSHEET_ID (ejecutá instalar()).');
  }
  if (!props.FIREBASE_API_KEY) {
    problemas.push('Falta FIREBASE_API_KEY.');
  }
  if (!props.FIREBASE_PROJECT_ID) {
    problemas.push('Falta FIREBASE_PROJECT_ID (sin esto no se valida el "aud" del token).');
  }
  if (!props.TURNSTILE_SECRET) {
    problemas.push('AVISO: sin TURNSTILE_SECRET la verificación anti-spam queda desactivada. ' +
      'Aceptable en desarrollo, no en producción.');
  } else {
    // La otra mitad vive en el frontend y desde acá no se puede leer, así que
    // lo único posible es recordarlo. Con el secreto cargado y sin site key,
    // toda reserva falla con VERIFICACION_FALLIDA; desde esta versión la
    // pantalla de reserva lo detecta y lo avisa en vez de dejarlo pasar.
    problemas.push('AVISO: TURNSTILE_SECRET está cargado. Verificá que ' +
      'TURNSTILE_SITE_KEY también esté en frontend/js/config.js: las dos mitades van ' +
      'juntas o ninguna.');
  }
  if (!props.CLAVE_ALTA_ADMIN) {
    problemas.push('AVISO: sin CLAVE_ALTA_ADMIN cualquiera que se registre en Firebase puede ' +
      'abrir una agenda nueva. Cargá una clave para cerrar el alta.');
  }

  if (props.MASTER_SPREADSHEET_ID) {
    try {
      var ss = SpreadsheetApp.openById(props.MASTER_SPREADSHEET_ID);
      if (!ss.getSheetByName(HOJA_CUENTAS)) {
        problemas.push('La planilla maestra no tiene la hoja "' + HOJA_CUENTAS + '".');
      } else {
        var cols = cabecera_(ss, HOJA_CUENTAS);
        for (var i = 0; i < ESQUEMA_CUENTAS.length; i++) {
          if (cols.indexOf(ESQUEMA_CUENTAS[i]) === -1) {
            problemas.push('Falta la columna "' + ESQUEMA_CUENTAS[i] + '" en la hoja Cuentas.');
          }
        }
      }
    } catch (err) {
      problemas.push('No se puede abrir la planilla maestra: ' + err);
    }
  }

  if (!problemas.length) {
    Logger.log('Instalación completa. Todo en orden.');
  } else {
    Logger.log(problemas.join('\n'));
  }
  return problemas;
}

/**
 * Carga un negocio de ejemplo sobre la cuenta indicada, para poder probar el
 * flujo completo sin cargar todo a mano.
 *
 * @param {string} slug Slug del negocio a poblar.
 */
function cargarDatosDeEjemplo(slug) {
  var cuenta = cuentaPorSlug_(slug);
  var ss = planillaDeCuenta_(cuenta);

  var barberos = leerHoja_(ss, 'Barberos');
  var idBarbero;
  if (barberos.length) {
    idBarbero = String(barberos[0].id_barbero);
  } else {
    idBarbero = nuevoId_('b');
    agregarFila_(ss, 'Barberos', { id_barbero: idBarbero, nombre: 'Juan', activo: true });
  }

  agregarFila_(ss, 'Servicios', {
    id_servicio: nuevoId_('s'), nombre: 'Corte', duracion_minutos: 30, precio: 8000, activo: true
  });
  agregarFila_(ss, 'Servicios', {
    id_servicio: nuevoId_('s'), nombre: 'Corte + Barba', duracion_minutos: 45, precio: 12000, activo: true
  });

  // Horario partido de lunes a viernes, más el sábado a la mañana. Dos filas
  // por día es exactamente lo que la versión anterior del modelo no permitía.
  for (var dia = 1; dia <= 5; dia++) {
    agregarFila_(ss, 'Horarios_disponibles', {
      id_barbero: idBarbero, dia_semana: dia, hora_inicio: '09:00', hora_fin: '13:00'
    });
    agregarFila_(ss, 'Horarios_disponibles', {
      id_barbero: idBarbero, dia_semana: dia, hora_inicio: '16:00', hora_fin: '20:00'
    });
  }
  agregarFila_(ss, 'Horarios_disponibles', {
    id_barbero: idBarbero, dia_semana: 6, hora_inicio: '09:00', hora_fin: '14:00'
  });

  Logger.log('Datos de ejemplo cargados en "' + cuenta.nombre_negocio + '".');
}

/**
 * Diagnóstico de la conexión con Firebase.
 *
 * Manda a Identity Toolkit un token deliberadamente inválido usando la API key
 * que está guardada en las propiedades del script. La respuesta discrimina las
 * dos causas que desde el frontend se ven idénticas ("la sesión no es válida"):
 *
 * - `INVALID_ID_TOKEN` -> la key es correcta y el servicio responde. El problema
 *   está en el token, no en la configuración.
 * - `API_KEY_INVALID` / `API key not valid` -> la key guardada no sirve: quedó
 *   mal copiada, con espacios, o es de otro proyecto.
 */
function verificarFirebase() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var key = props.FIREBASE_API_KEY || '';

  Logger.log('FIREBASE_PROJECT_ID = "' + (props.FIREBASE_PROJECT_ID || '(vacío)') + '"');

  if (!key) {
    Logger.log('Falta FIREBASE_API_KEY. Cargala en Configuración del proyecto -> Propiedades del script.');
    return;
  }

  // El error más común al copiar y pegar: espacios o comillas alrededor. Una
  // API key web de Firebase arranca con "AIza" y tiene 39 caracteres.
  Logger.log('FIREBASE_API_KEY: ' + key.length + ' caracteres, empieza con "' + key.slice(0, 4) + '".');
  if (key !== key.trim()) {
    Logger.log('PROBLEMA: la key tiene espacios al principio o al final. Volvé a guardarla sin espacios.');
  }
  if (/["']/.test(key)) {
    Logger.log('PROBLEMA: la key tiene comillas adentro. Va sin comillas.');
  }

  var respuesta = UrlFetchApp.fetch(URL_LOOKUP + '?key=' + encodeURIComponent(key.trim()), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: 'token-de-prueba-invalido' }),
    muteHttpExceptions: true
  });

  var codigo = respuesta.getResponseCode();
  var cuerpo = respuesta.getContentText();
  Logger.log('Identity Toolkit -> HTTP ' + codigo + ': ' + cuerpo);

  if (cuerpo.indexOf('INVALID_ID_TOKEN') !== -1) {
    Logger.log('OK: la API key sirve y el servicio responde. El token de prueba es inválido a propósito.');
  } else if (cuerpo.indexOf('API_KEY_INVALID') !== -1 || cuerpo.indexOf('API key not valid') !== -1) {
    Logger.log('LA CAUSA: la API key guardada no es válida. Copiala de nuevo desde Firebase -> Configuración del proyecto -> Tus apps.');
  } else if (codigo === 403) {
    Logger.log('LA CAUSA: el proyecto de Google Cloud está bloqueando la llamada. Revisá que la API "Identity Toolkit" esté habilitada y que la key no tenga restricciones de sitio web.');
  } else {
    Logger.log('Respuesta inesperada: pasá el HTTP y el cuerpo de arriba.');
  }
}

/**
 * Muestra cómo se están leyendo los turnos de una fecha y qué horarios ocupan.
 *
 * Es la herramienta para investigar una doble reserva: imprime cada fila tal
 * como vuelve de la planilla, con el formato de las celdas de fecha y hora, y
 * después el resultado del cálculo de ocupación. Si una hora aparece como
 * "11:00:00" en vez de "11:00", o la columna figura sin formato "@", ahí está
 * el problema.
 *
 * Editar el slug y la fecha antes de ejecutar: el editor de Apps Script no
 * permite pasar argumentos.
 */
function diagnosticarTurnos() {
  var slug = 'PEGAR-SLUG';
  var fecha = '2026-09-10';

  var cuenta = cuentaPorSlug_(slug);
  var ss = planillaDeCuenta_(cuenta);
  var h = hoja_(ss, 'Turnos');
  var cols = cabecera_(ss, 'Turnos');

  Logger.log('Negocio: ' + cuenta.nombre_negocio + ' | fecha analizada: ' + fecha);
  Logger.log('Paso de la grilla: ' + cuenta.paso_grilla_min + ' min');

  // El formato de las columnas de fecha y hora es la causa habitual: si no es
  // "@", Sheets reinterpreta el contenido y al releerlo cambia de forma.
  ['fecha', 'hora', 'hora_fin'].forEach(function (col) {
    var i = cols.indexOf(col);
    if (i === -1) {
      Logger.log('FALTA la columna "' + col + '" en la hoja Turnos.');
      return;
    }
    Logger.log('Formato de la columna "' + col + '" (fila 2): ' +
      h.getRange(2, i + 1).getNumberFormat());
  });

  var filas = leerHoja_(ss, 'Turnos');
  Logger.log('Turnos en la planilla: ' + filas.length);

  for (var i = 0; i < filas.length; i++) {
    var t = filas[i];
    Logger.log('  fila ' + t._fila +
      ' | barbero=' + t.id_barbero +
      ' | fecha="' + t.fecha + '"' +
      ' | hora="' + t.hora + '" -> ' + aMinutosDeCelda(t.hora) +
      ' | hora_fin="' + t.hora_fin + '" -> ' + aMinutosDeCelda(t.hora_fin) +
      ' | estado=' + t.estado +
      ' | ¿es de la fecha? ' + mismaFecha(t.fecha, fecha));
  }

  var barberos = leerHoja_(ss, 'Barberos');
  for (var b = 0; b < barberos.length; b++) {
    var id = String(barberos[b].id_barbero);
    var ocupados = turnosOcupados(filas, id, fecha, ESTADOS_QUE_OCUPAN);
    var texto = ocupados.map(function (o) {
      return aHoraTexto(o.inicio) + '-' + aHoraTexto(o.fin);
    }).join(', ');
    Logger.log('Ocupado para ' + barberos[b].nombre + ' (' + id + '): ' + (texto || 'nada'));
  }
}
