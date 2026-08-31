/**
 * Utilidades de interfaz compartidas por la pantalla de reserva y el panel.
 *
 * Dos decisiones que valen para todo el frontend:
 *
 * 1. NADA se inserta con innerHTML a partir de datos del servidor. El nombre de
 *    un negocio o de un cliente lo escribe una persona, así que todo texto se
 *    pone con textContent. Los helpers de este archivo construyen nodos, no
 *    cadenas de HTML, justamente para que no exista la tentación.
 *
 * 2. Las fechas "YYYY-MM-DD" NUNCA se pasan a `new Date(iso)`. Ese constructor
 *    las interpreta como UTC y en Argentina (UTC-3) muestran el día anterior.
 *    Se parsean a mano en `aFechaLocal`.
 */

const UI = (() => {

  // --- DOM ------------------------------------------------------------------

  const $  = (selector, raiz = document) => raiz.querySelector(selector);
  const $$ = (selector, raiz = document) => Array.from(raiz.querySelectorAll(selector));

  /**
   * Crea un elemento.
   * `props.texto` usa textContent; no hay opción de HTML crudo a propósito.
   */
  function el(etiqueta, props = {}, hijos = []) {
    const nodo = document.createElement(etiqueta);

    Object.entries(props).forEach(([clave, valor]) => {
      if (valor === null || valor === undefined || valor === false) return;
      if (clave === 'clase') nodo.className = valor;
      else if (clave === 'texto') nodo.textContent = valor;
      else if (clave === 'onClick') nodo.addEventListener('click', valor);
      else if (clave === 'onSubmit') nodo.addEventListener('submit', valor);
      else if (clave === 'onInput') nodo.addEventListener('input', valor);
      else if (clave === 'onChange') nodo.addEventListener('change', valor);
      else if (clave === 'datos') Object.entries(valor).forEach(([k, v]) => { nodo.dataset[k] = v; });
      else if (clave in nodo && clave !== 'list') nodo[clave] = valor;
      else nodo.setAttribute(clave, valor);
    });

    (Array.isArray(hijos) ? hijos : [hijos])
      .filter(Boolean)
      .forEach((h) => nodo.append(h));

    return nodo;
  }

  /** Icono del sprite SVG que cada página inserta al principio del body. */
  function ico(nombre, clase = 'ico') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', clase);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#ico-' + nombre);
    svg.append(use);
    return svg;
  }

  /**
   * Vacía un contenedor y le pone los hijos nuevos.
   *
   * El contenido entra con una aparición corta. No es decoración: entre el
   * esqueleto y los datos hay un salto brusco que se lee como un parpadeo, y
   * medio segundo después nadie sabe si la pantalla terminó de cargar o si lo
   * que ve es lo de antes. La animación marca el cambio.
   */
  function pintar(contenedor, hijos, animar = true) {
    contenedor.replaceChildren(...(Array.isArray(hijos) ? hijos.filter(Boolean) : [hijos]));
    if (!animar || !contenedor.childNodes.length) return;
    contenedor.classList.remove('aparece');
    void contenedor.offsetWidth;          // reinicia la animación si se repinta seguido
    contenedor.classList.add('aparece');
  }

  /** Bloque de esqueletos mientras se espera al backend. */
  function esqueletos(cantidad, modificador = 'bloque') {
    return Array.from({ length: cantidad }, () =>
      el('div', { clase: `esqueleto esqueleto--${modificador}` }));
  }

  /**
   * Esqueleto con la forma de la sección que se está por dibujar.
   *
   * Que el hueco se parezca a lo que va a venir hace dos cosas: la espera se
   * siente más corta y el contenido no salta cuando llega, porque el alto ya
   * era parecido.
   */
  function esqueletoDe(forma = 'lista', cantidad = 3) {
    const cabecera = el('div', { clase: 'pila pila--sm' }, [
      el('div', { clase: 'esqueleto esqueleto--titulo' }),
      el('div', { clase: 'esqueleto esqueleto--linea', style: 'width:42%' })
    ]);

    if (forma === 'metricas') {
      return el('div', { clase: 'pila pila--lg' }, [
        cabecera,
        el('div', { clase: 'grilla grilla--3' }, esqueletos(3, 'metrica')),
        el('div', { clase: 'grilla grilla--2' }, esqueletos(2, 'panel'))
      ]);
    }

    if (forma === 'agenda') {
      return el('div', { clase: 'pila pila--lg' }, [
        cabecera,
        el('div', { clase: 'fila fila--envolver' }, esqueletos(4, 'chip')),
        el('div', { clase: 'pila' }, esqueletos(cantidad, 'bloque'))
      ]);
    }

    return el('div', { clase: 'pila pila--lg' }, [
      cabecera,
      el('div', { clase: 'pila' }, esqueletos(cantidad, 'bloque'))
    ]);
  }

  // --- Barra de progreso global ---------------------------------------------
  //
  // Los esqueletos cubren las pantallas que se dibujan enteras, pero no las
  // esperas que ocurren con la pantalla ya puesta: guardar un servicio, abrir
  // un diálogo, refrescar la agenda. Esta barra se alimenta de los pedidos en
  // vuelo del cliente de API, así que cubre todas por igual sin que cada
  // pantalla tenga que acordarse de encenderla.

  const RETRASO_BARRA = 180;   // ms: por debajo de esto la respuesta ya llegó y la barra solo parpadearía

  function iniciarProgreso() {
    if (typeof API === 'undefined' || !API.alCambiarActividad) return;

    const relleno = el('div', { clase: 'progreso__relleno' });
    const barra = el('div', {
      clase: 'progreso', role: 'status', 'aria-live': 'polite', 'aria-label': 'Cargando'
    }, [relleno]);

    let temporizadorMostrar = null;
    let visible = false;

    API.alCambiarActividad((activas) => {
      if (activas > 0) {
        if (visible || temporizadorMostrar) return;
        temporizadorMostrar = setTimeout(() => {
          temporizadorMostrar = null;
          visible = true;
          barra.classList.add('progreso--visible');
        }, RETRASO_BARRA);
        return;
      }

      clearTimeout(temporizadorMostrar);
      temporizadorMostrar = null;
      if (!visible) return;
      visible = false;
      // Se apaga con un cierre corto en lugar de desaparecer de golpe: sin eso
      // las respuestas rápidas se ven como un destello.
      barra.classList.add('progreso--fin');
      setTimeout(() => {
        barra.classList.remove('progreso--visible', 'progreso--fin');
      }, 260);
    });

    const montar = () => document.body.append(barra);
    if (document.body) montar();
    else document.addEventListener('DOMContentLoaded', montar, { once: true });
  }

  function vacio(mensaje, nombreIcono = 'calendario') {
    return el('div', { clase: 'vacio' }, [
      ico(nombreIcono, 'ico ico--xl'),
      el('p', { texto: mensaje })
    ]);
  }

  function aviso(mensaje, tipo = 'error') {
    return el('div', { clase: `aviso aviso--${tipo}` }, [
      ico(tipo === 'error' ? 'alerta' : 'info', 'ico'),
      el('span', { texto: mensaje })
    ]);
  }

  // --- Avisos flotantes -----------------------------------------------------

  function contenedorTostadas() {
    let cont = $('.tostadas');
    if (!cont) {
      cont = el('div', { clase: 'tostadas', role: 'status', 'aria-live': 'polite' });
      document.body.append(cont);
    }
    return cont;
  }

  function tostada(mensaje, tipo = 'info') {
    const nodo = el('div', { clase: `tostada tostada--${tipo}` }, [
      ico(tipo === 'exito' ? 'check' : tipo === 'error' ? 'alerta' : 'info', `ico tostada__ico--${tipo}`),
      el('span', { clase: 'crece', texto: mensaje })
    ]);
    contenedorTostadas().append(nodo);
    setTimeout(() => {
      nodo.style.transition = 'opacity 200ms, transform 200ms';
      nodo.style.opacity = '0';
      nodo.style.transform = 'translateY(10px)';
      setTimeout(() => nodo.remove(), 220);
    }, tipo === 'error' ? 6000 : 3800);
    return nodo;
  }

  // --- Diálogos -------------------------------------------------------------

  /** Cuántos diálogos hay abiertos: el scroll del fondo se libera con el último. */
  let dialogosAbiertos = 0;

  /**
   * Congela el scroll del documento mientras haya un diálogo abierto.
   *
   * Sin esto, en iOS el dedo arrastra la página de atrás en vez del diálogo y al
   * cerrarlo la pantalla quedó en otro lado. Se guarda la posición y se repone
   * al cerrar, porque `position: fixed` sobre el body la pierde.
   */
  function bloquearScrollDeFondo() {
    dialogosAbiertos += 1;
    if (dialogosAbiertos > 1) return;
    const y = window.scrollY;
    document.body.dataset.scrollCongelado = String(y);
    document.body.style.position = 'fixed';
    document.body.style.top = `-${y}px`;
    document.body.style.width = '100%';
  }

  function liberarScrollDeFondo() {
    dialogosAbiertos = Math.max(0, dialogosAbiertos - 1);
    if (dialogosAbiertos > 0) return;
    const y = Number(document.body.dataset.scrollCongelado || 0);
    delete document.body.dataset.scrollCongelado;
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, y);
  }

  /**
   * Abre un diálogo modal. Devuelve una función para cerrarlo.
   * Se cierra con Escape o tocando fuera; el foco entra en el primer control
   * para que sea usable con teclado.
   */
  function dialogo({ titulo, cuerpo, acciones = [], alCerrar = null }) {
    const panel = el('div', {
      clase: 'panel-tinta dialogo', role: 'dialog', 'aria-modal': 'true', tabindex: '-1'
    }, [
      el('div', { clase: 'pila' }, [
        el('div', { clase: 'fila fila--sep' }, [
          el('h2', { clase: 'titular', style: 'font-size:1.2rem', texto: titulo }),
          el('button', { clase: 'boton-ico', type: 'button', 'aria-label': 'Cerrar', onClick: () => cerrar() },
            [ico('cerrar')])
        ]),
        cuerpo,
        acciones.length ? el('div', { clase: 'fila fila--fin fila--envolver' }, acciones) : null
      ])
    ]);

    const velo = el('div', {
      clase: 'velo',
      onClick: (e) => { if (e.target === velo) cerrar(); }
    }, [panel]);

    function alTeclado(e) { if (e.key === 'Escape') cerrar(); }

    let cerrado = false;
    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      document.removeEventListener('keydown', alTeclado);
      velo.remove();
      liberarScrollDeFondo();
      if (alCerrar) alCerrar();
    }

    document.addEventListener('keydown', alTeclado);
    bloquearScrollDeFondo();
    document.body.append(velo);

    // El foco se busca DENTRO del cuerpo, no en el panel entero: la X de cerrar
    // está antes en el DOM y se la llevaba siempre. Si el cuerpo no tiene ningún
    // control, el foco queda en el panel para que Escape siga funcionando.
    const primerControl = cuerpo && cuerpo.querySelector
      ? cuerpo.querySelector('input:not([type=hidden]), select, textarea, button')
      : null;
    (primerControl || panel).focus();

    return cerrar;
  }

  /** Confirmación destructiva. Resuelve a true/false. */
  function confirmar({ titulo, mensaje, textoOk = 'Confirmar', peligro = true }) {
    return new Promise((resolver) => {
      let decidido = false;
      const responder = (valor) => { decidido = true; resolver(valor); cerrar(); };

      const cerrar = dialogo({
        titulo,
        cuerpo: el('p', { clase: 'apagado', texto: mensaje }),
        // Cerrar con Escape o tocando fuera cuenta como "no".
        alCerrar: () => { if (!decidido) resolver(false); },
        acciones: [
          el('button', { clase: 'boton boton--secundario', type: 'button', texto: 'Volver',
            onClick: () => responder(false) }),
          el('button', {
            clase: `boton ${peligro ? 'boton--peligro' : 'boton--primario'}`,
            type: 'button', texto: textoOk, onClick: () => responder(true)
          })
        ]
      });
    });
  }

  // --- Estado de carga en botones -------------------------------------------

  /**
   * Ejecuta una acción asíncrona dejando el botón deshabilitado con un
   * hilandero. Es obligatorio en toda llamada al backend: el arranque en frío
   * de Apps Script tarda entre 1 y 3 segundos y sin esto la app se siente rota.
   */
  async function conCarga(boton, accion) {
    if (boton.disabled) return;
    const contenidoOriginal = Array.from(boton.childNodes);
    boton.disabled = true;
    boton.replaceChildren(el('span', { clase: 'hilandero' }), el('span', { texto: 'Un momento…' }));
    try {
      return await accion();
    } finally {
      boton.disabled = false;
      boton.replaceChildren(...contenidoOriginal);
    }
  }

  /** Traduce un error del backend a un mensaje mostrable. */
  function mensajeDeError(err) {
    if (err && err.name === 'ErrorAPI') return err.message;
    if (err instanceof TypeError) {
      // fetch rechaza con TypeError cuando no hay red o el deployment no
      // responde con CORS abierto.
      return 'No pudimos conectarnos con el servidor. Revisá tu conexión y probá de nuevo.';
    }
    console.error(err);
    return 'Ocurrió un error inesperado. Probá de nuevo en unos minutos.';
  }

  // --- Fechas y formatos ----------------------------------------------------

  /** "2026-03-04" -> Date local del 4 de marzo, sin corrimiento por UTC. */
  function aFechaLocal(iso) {
    const [a, m, d] = String(iso).split('-').map(Number);
    return new Date(a, m - 1, d);
  }

  /** Date -> "YYYY-MM-DD" usando los componentes locales. */
  function aIso(fecha) {
    const p = (n) => String(n).padStart(2, '0');
    return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
  }

  const hoyIso = () => aIso(new Date());

  /**
   * Hora local actual como "HH:mm".
   *
   * La agenda la compara como cadena contra `turno.hora`, que el backend guarda
   * en ese mismo formato. Comparar cadenas "HH:mm" ordena igual que comparar
   * minutos, asi que no hace falta convertir nada.
   */
  function ahoraHora() {
    const f = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(f.getHours())}:${p(f.getMinutes())}`;
  }

  function sumarDias(iso, dias) {
    const f = aFechaLocal(iso);
    f.setDate(f.getDate() + dias);
    return aIso(f);
  }

  const DIAS_CORTOS  = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const DIAS_LARGOS  = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  /** Partes de una fecha ISO listas para pintar la tira de días. */
  function partesDeFecha(iso) {
    const f = aFechaLocal(iso);
    return {
      semanaCorto: DIAS_CORTOS[f.getDay()],
      semanaLargo: DIAS_LARGOS[f.getDay()],
      numero: f.getDate(),
      mesCorto: MESES_CORTOS[f.getMonth()],
      diaSemana: f.getDay()
    };
  }

  /** "2026-03-04" -> "Miércoles 4 de marzo". */
  function fechaLarga(iso) {
    const p = partesDeFecha(iso);
    const mes = aFechaLocal(iso).toLocaleDateString('es-AR', { month: 'long' });
    return `${p.semanaLargo} ${p.numero} de ${mes}`;
  }

  /** Etiqueta relativa para la agenda: hoy, mañana o la fecha corta. */
  function fechaRelativa(iso) {
    if (iso === hoyIso()) return 'Hoy';
    if (iso === sumarDias(hoyIso(), 1)) return 'Mañana';
    if (iso === sumarDias(hoyIso(), -1)) return 'Ayer';
    const p = partesDeFecha(iso);
    return `${p.semanaCorto} ${p.numero} ${p.mesCorto}`;
  }

  const formateadorPrecio = new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0
  });

  const precio = (n) => formateadorPrecio.format(Number(n) || 0);

  /** 90 -> "1 h 30 min". */
  function duracion(minutos) {
    const m = Number(minutos) || 0;
    if (m < 60) return `${m} min`;
    const horas = Math.floor(m / 60);
    const resto = m % 60;
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
  }

  /** Suma minutos a "HH:mm" y devuelve "HH:mm". */
  function sumarMinutos(hora, minutos) {
    const [h, m] = hora.split(':').map(Number);
    const total = h * 60 + m + Number(minutos || 0);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(total / 60) % 24)}:${p(total % 60)}`;
  }

  const ESTADOS = {
    confirmado: 'Confirmado',
    completado: 'Completado',
    cancelado: 'Cancelado',
    no_asistio: 'No asistió'
  };

  function insignia(estado) {
    return el('span', { clase: `insignia insignia--${estado}`, texto: ESTADOS[estado] || estado });
  }

  /**
   * Da formato a un teléfono argentino a partir de sus dígitos.
   *
   * Diez dígitos son código de área de dos más ocho ("11 5555-1234"); once son
   * un área de tres más ocho ("351 555-1234" con el 9 de móvil adelante). Es la
   * única función que decide el formato: la máscara del input y el texto que se
   * muestra en la agenda salen de acá, así que no pueden discrepar.
   */
  function formatearTelefono(valor) {
    const d = String(valor || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `${d.slice(0, 2)} ${d.slice(2)}`;
    if (d.length <= 10) return `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)} ${d.slice(3, 7)}-${d.slice(7)}`;
  }

  /** Teléfono en formato legible; el backend guarda solo dígitos. */
  const telefono = (valor) => formatearTelefono(valor);

  /**
   * Aplica la máscara en tiempo real sobre un input de teléfono.
   *
   * Reescribir `input.value` manda el cursor al final, y en un celular eso hace
   * imposible corregir un dígito del medio: el dedo toca la mitad del número y
   * la siguiente tecla aparece al final. Por eso se cuenta cuántos dígitos había
   * a la izquierda del cursor y se lo repone después del mismo dígito, ya con
   * los separadores nuevos.
   */
  function aplicarMascaraTelefono(input) {
    if (!input) return;

    input.addEventListener('input', () => {
      const anterior = input.value;
      const cursor = input.selectionStart === null ? anterior.length : input.selectionStart;
      const digitosALaIzquierda = anterior.slice(0, cursor).replace(/\D/g, '').length;

      const formateado = formatearTelefono(anterior);
      if (formateado === anterior) return;
      input.value = formateado;

      let contados = 0;
      let posicion = digitosALaIzquierda === 0 ? 0 : formateado.length;
      for (let i = 0; i < formateado.length; i++) {
        if (/\d/.test(formateado[i])) contados++;
        if (contados === digitosALaIzquierda) { posicion = i + 1; break; }
      }

      try {
        input.setSelectionRange(posicion, posicion);
      } catch (err) {
        // Algunos navegadores no lo permiten en inputs type="tel"; el valor ya
        // quedó bien y perder el cursor es preferible a romper el tipeo.
      }
    });
  }

  /** Genera link directo a Google Calendar */
  function linkGoogleCalendar(turno, negocio) {
    const fechaLimpia = (turno.fecha || '').replace(/-/g, '');
    const horaInicioLimpia = (turno.hora || '').replace(/:/g, '') + '00';
    const dur = Number(turno.duracion_minutos) || 30;
    const horaFinLimpia = (turno.hora_fin || sumarMinutos(turno.hora, dur)).replace(/:/g, '') + '00';
    const start = `${fechaLimpia}T${horaInicioLimpia}`;
    const end = `${fechaLimpia}T${horaFinLimpia}`;

    const title = encodeURIComponent(`Turno: ${turno.servicio_nombre} · ${turno.nombre_negocio || negocio?.nombre_negocio || 'Barbería'}`);
    const details = encodeURIComponent(`Profesional: ${turno.barbero_nombre}\nCódigo de ticket: ${turno.codigo_ticket}\nPrecio: ${precio(turno.precio)}`);
    const location = encodeURIComponent(negocio?.direccion || turno.nombre_negocio || '');

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
  }

  /** Genera y descarga archivo .ics para Apple Calendar y Outlook */
  function descargarIcs(turno, negocio) {
    const fechaLimpia = (turno.fecha || '').replace(/-/g, '');
    const horaInicioLimpia = (turno.hora || '').replace(/:/g, '') + '00';
    const dur = Number(turno.duracion_minutos) || 30;
    const horaFinLimpia = (turno.hora_fin || sumarMinutos(turno.hora, dur)).replace(/:/g, '') + '00';
    const start = `${fechaLimpia}T${horaInicioLimpia}`;
    const end = `${fechaLimpia}T${horaFinLimpia}`;
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const nombreNegocio = turno.nombre_negocio || negocio?.nombre_negocio || 'Barbería';
    const resumen = `Turno: ${turno.servicio_nombre} - ${nombreNegocio}`;
    const descripcion = `Profesional: ${turno.barbero_nombre}\\nCódigo de ticket: ${turno.codigo_ticket}\\nPrecio: ${precio(turno.precio)}`;
    const ubicacion = negocio?.direccion || nombreNegocio;

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//App Turnos//ES',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${turno.id_turno || turno.codigo_ticket || Date.now()}@appturno`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${resumen}`,
      `DESCRIPTION:${descripcion}`,
      `LOCATION:${ubicacion}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `turno-${turno.codigo_ticket || 'reserva'}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  /** Exporta una lista de objetos a archivo CSV con cabeceras */
  function descargarCsv(nombreArchivo, filas, columnas) {
    if (!filas || !filas.length) return;
    const cols = columnas || Object.keys(filas[0]);
    const escapeCsv = (str) => `"${String(str === null || str === undefined ? '' : str).replace(/"/g, '""')}"`;

    const lineaCabecera = cols.map(escapeCsv).join(',');
    const lineasDatos = filas.map((fila) => cols.map((c) => escapeCsv(fila[c])).join(','));
    const contenidoCsv = '\uFEFF' + [lineaCabecera, ...lineasDatos].join('\r\n');

    const blob = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nombreArchivo.endsWith('.csv') ? nombreArchivo : `${nombreArchivo}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  // --- Instalación como app -------------------------------------------------

  /**
   * Ofrece instalar la app en la pantalla de inicio.
   *
   * Los dos caminos son distintos y no hay uno solo que sirva para ambos:
   *
   * - Android y escritorio disparan `beforeinstallprompt` cuando la página
   *   cumple los requisitos (manifest con iconos, service worker, HTTPS). Se
   *   guarda el evento y se llama a `prompt()` desde un botón nuestro, porque
   *   el navegador solo acepta el pedido si sale de un gesto del usuario.
   *
   * - iOS no dispara nada y no tiene API de instalación: la única forma es
   *   Compartir -> Agregar a inicio, a mano. Ahí lo único que se puede hacer es
   *   explicarlo, y se explica solo en Safari, que es el único navegador de
   *   iPhone que puede hacerlo.
   *
   * El botón se dibuja en el elemento `#instalar-app` de cada página, y no
   * aparece si la app ya está instalada.
   */
  function prepararInstalacion() {
    // Este archivo se carga también fuera del navegador (los tests lo evalúan
    // en un sandbox de Node con un `window` mínimo). Sin esta guarda, engancharse
    // a un evento acá rompe la carga del módulo entero.
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    let pedidoDiferido = null;

    const yaEstaInstalada = () =>
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;

    const esDeApple = () => {
      const ua = navigator.userAgent;
      // iPadOS 13+ se anuncia como Mac; los puntos táctiles lo delatan.
      return /iPad|iPhone|iPod/.test(ua) ||
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    };

    const ranura = () => $('#instalar-app');

    function ofrecer(texto, alTocar) {
      const caja = ranura();
      if (!caja || yaEstaInstalada()) return;
      pintar(caja, el('button', {
        clase: 'boton boton--secundario boton--chico', type: 'button', onClick: alTocar
      }, [ico('compartir', 'ico ico--sm'), document.createTextNode(texto)]));
    }

    function explicarEnIOS() {
      dialogo({
        titulo: 'Agregar a la pantalla de inicio',
        cuerpo: el('div', { clase: 'pila' }, [
          el('p', { clase: 'apagado', texto:
            'En el iPhone la instalación la hace Safari, no la página. Son tres toques:' }),
          el('ol', { clase: 'pila pila--sm apagado', style: 'margin:0; padding-left: 1.2em' }, [
            el('li', { texto: 'Tocá el botón Compartir, el cuadradito con la flecha hacia arriba.' }),
            el('li', { texto: 'Deslizá y elegí "Agregar a pantalla de inicio".' }),
            el('li', { texto: 'Confirmá con "Agregar", arriba a la derecha.' })
          ]),
          el('p', { clase: 'chico tenue', texto:
            'Queda como una app más, con su icono y a pantalla completa. Si no ves el botón Compartir, ' +
            'abrí esta página en Safari: desde otros navegadores el iPhone no deja instalarla.' })
        ])
      });
    }

    // Android y escritorio: el navegador avisa cuando se puede instalar.
    window.addEventListener('beforeinstallprompt', (evento) => {
      // Sin esto el navegador muestra su propio cartel, que aparece cuando él
      // quiere y no se puede volver a pedir si el usuario lo descarta.
      evento.preventDefault();
      pedidoDiferido = evento;
      ofrecer('Instalar app', async () => {
        if (!pedidoDiferido) return;
        pedidoDiferido.prompt();
        const { outcome } = await pedidoDiferido.userChoice;
        // El evento sirve una sola vez: si lo rechazó, el navegador lo vuelve a
        // disparar más adelante por su cuenta.
        pedidoDiferido = null;
        if (outcome === 'accepted') pintar(ranura(), []);
        else ofrecer('Instalar app', () => {});
      });
    });

    window.addEventListener('appinstalled', () => {
      pedidoDiferido = null;
      const caja = ranura();
      if (caja) pintar(caja, []);
      tostada('¡Listo! Ya la tenés en tu pantalla de inicio.', 'exito');
    });

    // iOS: no hay evento, así que se ofrece igual y se explica el camino manual.
    if (esDeApple() && !yaEstaInstalada()) {
      const montar = () => ofrecer('Agregar a inicio', explicarEnIOS);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', montar, { once: true });
      } else {
        montar();
      }
    }
  }

  /** Lee un parámetro de la query string. */
  const parametro = (nombre) => new URLSearchParams(location.search).get(nombre);

  iniciarProgreso();
  prepararInstalacion();

  return {
    $, $$, el, ico, pintar, esqueletos, esqueletoDe, vacio, aviso,
    tostada, dialogo, confirmar, conCarga, mensajeDeError,
    aFechaLocal, aIso, hoyIso, sumarDias, partesDeFecha, fechaLarga, fechaRelativa,
    precio, duracion, sumarMinutos, insignia, telefono, formatearTelefono, parametro,
    ahoraHora,
    aplicarMascaraTelefono, linkGoogleCalendar, descargarIcs, descargarCsv,
    prepararInstalacion,
    ESTADOS, DIAS_CORTOS, DIAS_LARGOS
  };
})();
