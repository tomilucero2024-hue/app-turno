/**
 * Pantalla de reserva del cliente final.
 *
 * El flujo es servicio -> profesional -> día -> hora -> datos, y cada paso
 * depende del anterior por una razón concreta: la disponibilidad se calcula con
 * la duración del servicio y la agenda del profesional, así que no se puede
 * pedir un horario antes de saber esas dos cosas.
 *
 * Todo el estado vive en un único objeto `estado`. Cada vez que cambia, se
 * vuelve a pintar lo que dependa de él. No hay estado escondido en el DOM.
 */

(() => {
  const { $, el, ico, pintar, esqueletos, vacio, tostada, conCarga, mensajeDeError } = UI;

  const DIAS_POR_SEMANA = 7;

  const estado = {
    slug: null,
    negocio: null,
    servicios: [],      // Array de servicios seleccionados (combos dinámicos)
    barbero: null,        // Objeto barbero o { id_barbero: 'cualquiera', nombre: 'Cualquiera disponible' }
    fecha: null,
    hora: null,
    horarios: [],
    cargandoHorarios: false,
    semanaOffset: 0       // Desplazamiento en semanas para el selector de fechas
  };

  // Nodos que se tocan seguido.
  const vistas = {
    cargando: $('#vista-cargando'),
    sinNegocio: $('#vista-sin-negocio'),
    reserva: $('#vista-reserva'),
    comprobante: $('#vista-comprobante')
  };

  function mostrarVista(nombre) {
    Object.entries(vistas).forEach(([clave, nodo]) => {
      nodo.classList.toggle('oculto', clave !== nombre);
    });
  }

  // ==========================================================================
  // Arranque
  // ==========================================================================

  async function iniciar() {
    const slug = (UI.parametro('n') || UI.parametro('negocio') || '').trim().toLowerCase();

    $('#form-slug').addEventListener('submit', (e) => {
      e.preventDefault();
      const valor = $('#entrada-slug').value.trim().toLowerCase();
      if (valor) location.search = '?n=' + encodeURIComponent(valor);
    });

    $('#btn-mi-turno').addEventListener('click', () => abrirConsultaTicket());
    UI.aplicarMascaraTelefono($('#entrada-telefono'));

    if (!slug) {
      $('#entrada-slug').value = localStorage.getItem('ultimo-negocio') || '';
      mostrarVista('sinNegocio');
      return;
    }

    estado.slug = slug;
    await cargarNegocio();

    // Link de comprobante con el código ya cargado: se abre la consulta sola.
    const ticket = UI.parametro('ticket');
    if (ticket && estado.negocio) abrirConsultaTicket(ticket);
  }

  async function cargarNegocio() {
    mostrarVista('cargando');
    try {
      estado.negocio = await API.getNegocio(estado.slug);
      localStorage.setItem('ultimo-negocio', estado.slug);
      pintarNegocio();
      mostrarVista('reserva');
    } catch (err) {
      $('#entrada-slug').value = estado.slug;
      pintar($('#error-slug'), UI.aviso(
        err.codigo === 'NO_ENCONTRADO'
          ? 'No encontramos ningún negocio con esa dirección. Revisá el link que te pasaron.'
          : mensajeDeError(err)
      ));
      mostrarVista('sinNegocio');
    }
  }

  // ==========================================================================
  // Encabezado y pasos
  // ==========================================================================

  function pintarNegocio() {
    const n = estado.negocio;

    document.title = `Reservá tu turno · ${n.nombre_negocio}`;
    $('#marca-nombre').textContent = n.nombre_negocio;
    $('#titulo-negocio').textContent = n.nombre_negocio;

    const chips = [
      el('span', { clase: 'chip chip--oro' }, [
        ico('tienda', 'ico ico--sm'),
        el('span', { texto: n.tipo === 'barberia' ? 'Barbería' : 'Profesional independiente' })
      ]),
      n.antelacion_min_horas > 0
        ? el('span', { clase: 'chip' }, [
            ico('reloj', 'ico ico--sm'),
            el('span', { texto: `Se reserva con ${n.antelacion_min_horas} h de anticipación` })
          ])
        : null
    ];

    if (n.direccion) {
      chips.push(el('a', {
        clase: 'chip chip-link',
        href: `https://maps.google.com/?q=${encodeURIComponent(n.direccion)}`,
        target: '_blank', rel: 'noopener'
      }, [ico('buscar', 'ico ico--sm'), el('span', { texto: n.direccion })]));
    }

    if (n.instagram) {
      chips.push(el('a', {
        clase: 'chip chip-link',
        href: `https://instagram.com/${n.instagram.replace(/^@/, '')}`,
        target: '_blank', rel: 'noopener'
      }, [ico('etiqueta', 'ico ico--sm'), el('span', { texto: `@${n.instagram.replace(/^@/, '')}` })]));
    }

    if (n.telefono_contacto) {
      chips.push(el('a', {
        clase: 'chip chip-link',
        href: `https://wa.me/${n.telefono_contacto.replace(/\D/g, '')}`,
        target: '_blank', rel: 'noopener'
      }, [ico('whatsapp', 'ico ico--sm'), el('span', { texto: UI.telefono(n.telefono_contacto) })]));
    }

    pintar($('#chips-negocio'), chips.filter(Boolean));

    $('#nota-cancelacion').textContent = n.cancelacion_min_horas > 0
      ? `Podés cancelar hasta ${n.cancelacion_min_horas} h antes del turno.`
      : 'Podés cancelar tu turno cuando quieras.';

    pintarServicios();
    pintarBarberos();
    pintarDias();
    actualizarResumen();
  }

  function duracionTotalServicios() {
    return estado.servicios.reduce((acc, s) => acc + (Number(s.duracion_minutos) || 0), 0);
  }

  function precioTotalServicios() {
    return estado.servicios.reduce((acc, s) => acc + (Number(s.precio) || 0), 0);
  }

  function pintarServicios() {
    const servicios = estado.negocio.servicios || [];

    if (!servicios.length) {
      pintar($('#lista-servicios'), UI.aviso(
        'Este negocio todavía no cargó sus servicios. Comunicate con ellos para reservar.', 'atencion'));
      return;
    }

    pintar($('#lista-servicios'), servicios.map((s) => {
      const seleccionado = estado.servicios.some((item) => item.id_servicio === s.id_servicio);

      return el('button', {
        clase: 'tarjeta tarjeta--compacta tarjeta--interactiva',
        type: 'button',
        'aria-pressed': String(seleccionado),
        onClick: () => alternarServicio(s)
      }, [
        el('div', { clase: 'fila fila--sep fila--arriba' }, [
          el('div', { clase: 'fila crece' }, [
            el('span', { clase: 'check-indicador' }, [ico('check', 'ico ico--sm')]),
            el('div', { clase: 'crece' }, [
              el('div', { clase: 'negrita', texto: s.nombre }),
              el('div', { clase: 'chico tenue', texto: UI.duracion(s.duracion_minutos) })
            ])
          ]),
          el('span', { clase: 'precio oro', texto: UI.precio(s.precio) })
        ])
      ]);
    }));
  }

  function pintarBarberos() {
    const barberos = estado.negocio.barberos || [];

    if (!barberos.length) {
      pintar($('#lista-barberos'), UI.aviso('Este negocio todavía no cargó su equipo.', 'atencion'));
      return;
    }

    let listaAMostrar = [...barberos];

    // Si hay 2 o más barberos, agregar la opción "Cualquiera disponible" al inicio
    if (barberos.length >= 2) {
      listaAMostrar = [
        { id_barbero: 'cualquiera', nombre: 'Cualquiera disponible', esCualquiera: true },
        ...barberos
      ];
    } else if (barberos.length === 1 && !estado.barbero) {
      estado.barbero = barberos[0];
    }

    pintar($('#lista-barberos'), listaAMostrar.map((b) => {
      const seleccionado = estado.barbero?.id_barbero === b.id_barbero;

      return el('button', {
        clase: 'tarjeta tarjeta--compacta tarjeta--interactiva',
        type: 'button',
        'aria-pressed': String(seleccionado),
        onClick: () => elegirBarbero(b)
      }, [
        el('div', { clase: 'fila' }, [
          el('span', { clase: 'marca__sello' }, [
            ico(b.esCualquiera ? 'usuarios' : 'usuario', 'ico ico--sm')
          ]),
          el('div', { clase: 'crece' }, [
            el('div', { clase: 'negrita', texto: b.nombre }),
            b.esCualquiera ? el('div', { clase: 'chico tenue', texto: 'Primer horario libre' }) : null
          ].filter(Boolean))
        ])
      ]);
    }));
  }

  function pintarDias() {
    const hoy = UI.hoyIso();
    const totalDias = CONFIG.DIAS_A_MOSTRAR || 21;
    const todosLosDias = Array.from({ length: totalDias }, (_, i) => UI.sumarDias(hoy, i));

    const contenedor = $('#lista-dias');

    const btnVerMes = $('#btn-ver-mes');
    if (btnVerMes) {
      btnVerMes.onclick = () => abrirModalCalendario(todosLosDias);
    }

    const botonesDias = todosLosDias.map((iso) => {
      const p = UI.partesDeFecha(iso);
      return el('button', {
        clase: 'dia',
        type: 'button',
        'aria-pressed': String(estado.fecha === iso),
        'aria-label': UI.fechaLarga(iso),
        onClick: (e) => {
          elegirFecha(iso);
          try {
            e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          } catch (errScroll) {}
        }
      }, [
        el('span', { clase: 'dia__semana', texto: iso === hoy ? 'Hoy' : p.semanaCorto }),
        el('span', { clase: 'dia__numero', texto: String(p.numero) }),
        el('span', { clase: 'dia__mes', texto: p.mesCorto })
      ]);
    });

    pintar(contenedor, botonesDias);
  }

  function abrirModalCalendario(diasDisponibles) {
    const cuerpo = el('div', { clase: 'pila' }, [
      el('p', { clase: 'chico tenue', texto: 'Elegí cualquier día disponible dentro de las próximas 3 semanas:' }),
      el('div', {
        clase: 'grilla',
        style: 'grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap: var(--e2); max-height: 55vh; overflow-y: auto;'
      }, diasDisponibles.map((iso) => {
        const p = UI.partesDeFecha(iso);
        const hoy = UI.hoyIso();
        return el('button', {
          clase: 'dia',
          style: 'width: 100%;',
          type: 'button',
          'aria-pressed': String(estado.fecha === iso),
          onClick: () => {
            cerrar();
            elegirFecha(iso);
            setTimeout(() => {
              const diaSeleccionado = UI.$(`.dia[aria-pressed="true"]`);
              if (diaSeleccionado) {
                diaSeleccionado.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
              }
            }, 100);
          }
        }, [
          el('span', { clase: 'dia__semana', texto: iso === hoy ? 'Hoy' : p.semanaCorto }),
          el('span', { clase: 'dia__numero', texto: String(p.numero) }),
          el('span', { clase: 'dia__mes', texto: p.mesCorto })
        ]);
      }))
    ]);

    const cerrar = UI.dialogo({ titulo: 'Seleccionar fecha', cuerpo });
  }

  // ==========================================================================
  // Selección
  // ==========================================================================

  function alternarServicio(servicio) {
    const idx = estado.servicios.findIndex((s) => s.id_servicio === servicio.id_servicio);
    if (idx >= 0) {
      estado.servicios.splice(idx, 1);
    } else {
      estado.servicios.push(servicio);
    }

    estado.hora = null;
    estado.horarios = [];
    pintarServicios();
    sincronizarPasos();
    if (estado.barbero && estado.fecha && estado.servicios.length > 0) {
      cargarHorarios();
    }
  }

  function elegirBarbero(barbero) {
    estado.barbero = barbero;
    estado.hora = null;
    estado.horarios = [];
    pintarBarberos();
    sincronizarPasos();
    if (estado.servicios.length > 0 && estado.fecha) {
      cargarHorarios();
    }
  }

  function elegirFecha(iso) {
    estado.fecha = iso;
    estado.hora = null;
    pintarDias();
    sincronizarPasos();
    cargarHorarios();
  }

  function elegirHora(hora) {
    estado.hora = hora;
    pintarHorarios();
    sincronizarPasos();
    acercarResumen();
  }

  /**
   * Trae el formulario de confirmación a la vista al completar el último paso.
   *
   * En pantalla ancha el resumen está al costado y siempre visible. En móvil
   * queda debajo de la grilla de horarios, que puede tener treinta botones: sin
   * esto, elegir la hora no produce ningún cambio visible y el botón de
   * confirmar queda a varias pantallas de scroll. El `scroll-padding-top` del
   * CSS es lo que evita que la barra superior tape el título al llegar.
   */
  function acercarResumen() {
    if (!window.matchMedia || !window.matchMedia('(max-width: 900px)').matches) return;
    const formulario = $('#form-reserva');
    if (!formulario) return;
    try {
      formulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      formulario.scrollIntoView();
    }
  }

  function sincronizarPasos() {
    const s = $('#paso-servicio');
    const b = $('#paso-barbero');
    const f = $('#paso-fecha');

    const tieneServicio = estado.servicios.length > 0;
    const tieneBarbero = !!estado.barbero;

    s.classList.toggle('paso--listo', tieneServicio);
    $('#elegido-servicio').textContent = tieneServicio
      ? `${estado.servicios.map((item) => item.nombre).join(' + ')} · ${UI.duracion(duracionTotalServicios())}`
      : '';

    b.dataset.bloqueada = String(!tieneServicio);
    b.classList.toggle('paso--listo', tieneBarbero);
    $('#elegido-barbero').textContent = estado.barbero ? estado.barbero.nombre : '';

    f.dataset.bloqueada = String(!tieneServicio || !tieneBarbero);
    f.classList.toggle('paso--listo', !!estado.hora);
    $('#elegido-fecha').textContent = estado.fecha
      ? UI.fechaLarga(estado.fecha) + (estado.hora ? ` · ${estado.hora} h` : '')
      : '';

    [[s, 1, tieneServicio], [b, 2, tieneBarbero], [f, 3, !!estado.hora]]
      .forEach(([seccion, numero, listo]) => {
        const marca = $('.paso__numero', seccion);
        if (listo) pintar(marca, ico('check', 'ico ico--sm'));
        else marca.textContent = String(numero);
      });

    actualizarResumen();
  }

  // ==========================================================================
  // Horarios y Caché
  // ==========================================================================

  const VIDA_CACHE_MS = 45000;
  const cacheHorarios = new Map();

  const claveDisponibilidad = (idBarbero, idsServicios, fecha) =>
    `${idBarbero}|${idsServicios.slice().sort().join(',')}|${fecha}`;

  function horariosCacheados(clave) {
    const entrada = cacheHorarios.get(clave);
    if (!entrada) return null;
    if (Date.now() - entrada.momento > VIDA_CACHE_MS) {
      cacheHorarios.delete(clave);
      return null;
    }
    return entrada.horarios;
  }

  async function pedirDisponibilidad(idBarbero, idsServicios, fecha) {
    const clave = claveDisponibilidad(idBarbero, idsServicios, fecha);
    const enMemoria = horariosCacheados(clave);
    if (enMemoria) return enMemoria;

    const datos = await API.getDisponibilidad(estado.slug, idBarbero, idsServicios, fecha);
    const horarios = datos.horarios || [];
    cacheHorarios.set(clave, { horarios: horarios, momento: Date.now() });
    return horarios;
  }

  async function adelantarDiasSiguientes(idBarbero, idsServicios, fechaBase, cuantos = 3) {
    for (let i = 1; i <= cuantos; i++) {
      const fecha = UI.sumarDias(fechaBase, i);
      if (horariosCacheados(claveDisponibilidad(idBarbero, idsServicios, fecha))) continue;
      try {
        await pedirDisponibilidad(idBarbero, idsServicios, fecha);
      } catch (err) {
        return;
      }
      if (!estado.barbero || estado.barbero.id_barbero !== idBarbero ||
          estado.servicios.length !== idsServicios.length) return;
    }
  }

  async function cargarHorarios({ refrescar = false } = {}) {
    if (!estado.servicios.length || !estado.barbero || !estado.fecha) return;

    const idBarbero = estado.barbero.id_barbero;
    const idsServicios = estado.servicios.map((s) => s.id_servicio);
    if (refrescar) cacheHorarios.delete(claveDisponibilidad(idBarbero, idsServicios, estado.fecha));

    estado.cargandoHorarios = true;
    pintarHorarios();

    const pedido = { ...estado, idsServicios };

    const sigueVigente = () =>
      pedido.fecha === estado.fecha &&
      !!estado.barbero && pedido.barbero.id_barbero === estado.barbero.id_barbero &&
      estado.servicios.length === pedido.idsServicios.length;

    try {
      const horarios = await pedirDisponibilidad(idBarbero, idsServicios, estado.fecha);
      if (sigueVigente()) estado.horarios = horarios;
    } catch (err) {
      if (sigueVigente()) {
        estado.horarios = [];
        tostada(mensajeDeError(err), 'error');
      }
    } finally {
      if (sigueVigente()) {
        estado.cargandoHorarios = false;
        pintarHorarios();
      }
    }

    adelantarDiasSiguientes(idBarbero, idsServicios, pedido.fecha);
  }

  function pintarHorarios() {
    const contenedor = $('#lista-horarios');

    if (!estado.servicios.length || !estado.barbero || !estado.fecha) {
      contenedor.className = '';
      pintar(contenedor, el('p', {
        clase: 'chico tenue centrado', style: 'padding: var(--e3) 0',
        texto: 'Elegí servicio(s), profesional y día para ver los horarios libres.'
      }));
      return;
    }

    if (estado.cargandoHorarios) {
      contenedor.className = 'horarios';
      pintar(contenedor, esqueletos(8, 'slot'));
      return;
    }

    if (!estado.horarios.length) {
      contenedor.className = '';
      pintar(contenedor, vacio('No quedan horarios libres ese día. Probá con otra fecha.', 'calendario-x'));
      return;
    }

    contenedor.className = 'horarios';
    pintar(contenedor, estado.horarios.map((hora) =>
      el('button', {
        clase: 'horario',
        type: 'button',
        'aria-pressed': String(estado.hora === hora),
        onClick: () => elegirHora(hora)
      }, [document.createTextNode(hora)])
    ));
  }

  // ==========================================================================
  // Resumen y confirmación
  // ==========================================================================

  function filaResumen(etiqueta, valor) {
    return el('div', { clase: 'fila fila--sep' }, [
      el('dt', { clase: 'chico tenue', texto: etiqueta }),
      el('dd', { clase: 'chico negrita', style: 'margin:0; text-align:right', texto: valor })
    ]);
  }

  function actualizarResumen() {
    const filas = [];

    if (estado.servicios.length > 0) {
      filas.push(filaResumen('Servicio(s)', estado.servicios.map((s) => s.nombre).join(' + ')));
      filas.push(filaResumen('Duración est.', UI.duracion(duracionTotalServicios())));
    }
    if (estado.barbero)  filas.push(filaResumen('Profesional', estado.barbero.nombre));
    if (estado.fecha)    filas.push(filaResumen('Día', UI.fechaRelativa(estado.fecha)));
    if (estado.hora && estado.servicios.length > 0) {
      filas.push(filaResumen('Hora',
        `${estado.hora} – ${UI.sumarMinutos(estado.hora, duracionTotalServicios())}`));
    }

    pintar($('#resumen-datos'), filas.length ? filas
      : [el('p', { clase: 'chico tenue', texto: 'Todavía no elegiste nada.' })]);

    $('#resumen-total').textContent = estado.servicios.length > 0
      ? UI.precio(precioTotalServicios())
      : '—';

    actualizarBotonConfirmar();
  }

  const datosCompletos = () =>
    !!(estado.servicios.length > 0 && estado.barbero && estado.fecha && estado.hora &&
       $('#entrada-nombre').value.trim() && $('#entrada-telefono').value.replace(/\D/g, '').length >= 6);

  function actualizarBotonConfirmar() {
    const boton = $('#btn-confirmar');
    if (boton.dataset.enviando === 'true') return;
    boton.disabled = !datosCompletos();
  }

  async function confirmar(evento) {
    evento.preventDefault();
    if (!datosCompletos()) return;

    const boton = $('#btn-confirmar');
    boton.dataset.enviando = 'true';

    try {
      await conCarga(boton, async () => {
        const turno = await API.crearTurno({
          slug: estado.slug,
          id_barbero: estado.barbero.id_barbero,
          id_servicios: estado.servicios.map((s) => s.id_servicio),
          fecha: estado.fecha,
          hora: estado.hora,
          cliente_nombre: $('#entrada-nombre').value.trim(),
          cliente_telefono: $('#entrada-telefono').value.trim(),
          turnstile_token: tokenTurnstile()
        });
        pintarComprobante(turno);
      });
    } catch (err) {
      reiniciarTurnstile();

      if (err.codigo === 'SLOT_OCUPADO') {
        estado.hora = null;
        tostada(err.message, 'error');
        sincronizarPasos();
        cargarHorarios({ refrescar: true });
        return;
      }
      tostada(mensajeDeError(err), 'error');
    } finally {
      boton.dataset.enviando = 'false';
      actualizarBotonConfirmar();
    }
  }

  // ==========================================================================
  // Comprobante y Exportación de Calendario
  // ==========================================================================

  function pintarComprobante(turno) {
    const detalle = [
      ['Negocio', turno.nombre_negocio],
      ['Profesional', turno.barbero_nombre],
      ['Servicio', turno.servicio_nombre],
      ['Día', UI.fechaLarga(turno.fecha)],
      ['Hora', `${turno.hora} – ${turno.hora_fin}`],
      ['Total', UI.precio(turno.precio)]
    ].map(([k, v]) => filaResumen(k, v));

    const paraWhatsApp = { ...turno, nombre_negocio: turno.nombre_negocio };

    pintar(vistas.comprobante, el('div', {
      clase: 'contenedor--angosto pila pila--lg',
      style: 'margin-inline:auto'
    }, [
      el('div', { clase: 'panel-tinta pila centrado' }, [
        el('div', { clase: 'marca__sello', style: 'width:56px;height:56px;margin-inline:auto' },
          [ico('check', 'ico ico--lg')]),
        el('h1', { texto: 'Turno confirmado' }),
        el('p', { clase: 'apagado', texto: 'Guardá este código: es lo único que necesitás para consultar o cancelar tu turno.' }),
        el('div', { clase: 'codigo-ticket', texto: turno.codigo_ticket }),
        el('div', { clase: 'fila fila--envolver', style: 'justify-content:center' }, [
          el('button', {
            clase: 'boton boton--secundario boton--chico', type: 'button',
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(turno.codigo_ticket);
                tostada('Código copiado.', 'exito');
              } catch (err) {
                tostada('No pudimos copiarlo. Anotalo a mano.', 'error');
              }
            }
          }, [ico('copiar', 'ico ico--sm'), document.createTextNode('Copiar código')]),
          el('a', {
            clase: 'boton whatsapp boton--chico',
            href: linkComprobanteWhatsApp(paraWhatsApp, CONFIG.URL_SITIO + '?n=' + estado.slug),
            target: '_blank', rel: 'noopener'
          }, [ico('whatsapp', 'ico ico--sm'), document.createTextNode('Enviar por WhatsApp')])
        ])
      ]),

      el('div', { clase: 'tarjeta pila' }, [
        el('div', { clase: 'tarjeta__titulo', texto: 'Detalle' }),
        el('dl', { clase: 'pila pila--sm', style: 'margin:0' }, detalle),
        el('div', { clase: 'grid-acciones-calendario' }, [
          el('a', {
            clase: 'boton boton--contorno boton--chico',
            href: UI.linkGoogleCalendar(turno, estado.negocio),
            target: '_blank', rel: 'noopener'
          }, [ico('calendario', 'ico ico--sm'), document.createTextNode('Google Calendar')]),
          el('button', {
            clase: 'boton boton--secundario boton--chico',
            type: 'button',
            onClick: () => UI.descargarIcs(turno, estado.negocio)
          }, [ico('calendario', 'ico ico--sm'), document.createTextNode('Apple / Outlook (.ics)')])
        ])
      ]),

      el('p', { clase: 'chico tenue centrado', texto: $('#nota-cancelacion').textContent }),

      el('button', {
        clase: 'boton boton--secundario', type: 'button', texto: 'Reservar otro turno',
        onClick: () => location.reload()
      })
    ]));

    mostrarVista('comprobante');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==========================================================================
  // Consulta y cancelación por código de ticket
  // ==========================================================================

  function abrirConsultaTicket(codigoInicial = '') {
    if (!estado.slug) {
      tostada('Primero ingresá la dirección del negocio.', 'error');
      return;
    }

    const entrada = el('input', {
      clase: 'entrada entrada--ticket',
      maxlength: 12,
      placeholder: 'ABCD234XYZ',
      value: codigoInicial,
      'aria-label': 'Código de ticket'
    });

    const resultado = el('div');
    const buscar = el('button', { clase: 'boton boton--primario', type: 'submit', texto: 'Buscar turno' });

    const formulario = el('form', { clase: 'pila', onSubmit: async (e) => {
      e.preventDefault();
      const codigo = entrada.value.trim().toUpperCase();
      if (!codigo) return;

      await conCarga(buscar, async () => {
        try {
          const turno = await API.getTurno(estado.slug, codigo);
          pintar(resultado, tarjetaTurnoConsultado(turno, resultado));
        } catch (err) {
          pintar(resultado, UI.aviso(mensajeDeError(err)));
        }
      });
    } }, [
      entrada,
      el('p', { clase: 'campo__ayuda centrado', texto: 'Son 10 caracteres, sin distinguir mayúsculas.' }),
      buscar,
      resultado
    ]);

    UI.dialogo({ titulo: 'Consultar mi turno', cuerpo: formulario });

    if (codigoInicial) formulario.requestSubmit();
  }

  function tarjetaTurnoConsultado(turno, contenedorResultado) {
    const cancelable = turno.estado === 'confirmado';

    const botonCancelar = el('button', {
      clase: 'boton boton--peligro boton--bloque', type: 'button', texto: 'Cancelar este turno',
      onClick: async () => {
        const seguro = await UI.confirmar({
          titulo: 'Cancelar el turno',
          mensaje: `Vas a cancelar el turno del ${UI.fechaLarga(turno.fecha)} a las ${turno.hora}. No se puede deshacer.`,
          textoOk: 'Sí, cancelar'
        });
        if (!seguro) return;

        await conCarga(botonCancelar, async () => {
          try {
            await API.cancelarTurno(estado.slug, turno.codigo_ticket);
            tostada('Turno cancelado.', 'exito');
            pintar(contenedorResultado,
              tarjetaTurnoConsultado({ ...turno, estado: 'cancelado' }, contenedorResultado));
          } catch (err) {
            tostada(mensajeDeError(err), 'error');
          }
        });
      }
    });

    return el('div', { clase: 'pila' }, [
      el('div', { clase: 'fila fila--sep' }, [
        el('span', { clase: 'titular', texto: turno.nombre_negocio }),
        UI.insignia(turno.estado)
      ]),
      el('dl', { clase: 'pila pila--sm', style: 'margin:0' }, [
        filaResumen('Cliente', turno.cliente_nombre),
        filaResumen('Profesional', turno.barbero_nombre),
        filaResumen('Servicio', turno.servicio_nombre),
        filaResumen('Día', UI.fechaLarga(turno.fecha)),
        filaResumen('Hora', `${turno.hora}${turno.hora_fin ? ' – ' + turno.hora_fin : ''}`),
        filaResumen('Total', UI.precio(turno.precio))
      ]),
      cancelable ? botonCancelar : null
    ]);
  }

  // ==========================================================================
  // Turnstile
  // ==========================================================================

  function montarTurnstile() {
    if (!CONFIG.TURNSTILE_SITE_KEY) return;

    const caja = $('#turnstile-contenedor');
    caja.append(el('div', {
      clase: 'cf-turnstile',
      'data-sitekey': CONFIG.TURNSTILE_SITE_KEY,
      'data-theme': 'dark'
    }));

    const script = el('script', {
      src: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
      async: true,
      defer: true
    });
    document.head.append(script);
  }

  const tokenTurnstile = () =>
    (window.turnstile && CONFIG.TURNSTILE_SITE_KEY) ? window.turnstile.getResponse() : '';

  function reiniciarTurnstile() {
    if (window.turnstile && CONFIG.TURNSTILE_SITE_KEY) window.turnstile.reset();
  }

  // ==========================================================================

  $('#form-reserva').addEventListener('submit', confirmar);
  $('#entrada-nombre').addEventListener('input', actualizarBotonConfirmar);
  $('#entrada-telefono').addEventListener('input', actualizarBotonConfirmar);

  montarTurnstile();
  iniciar();
})();
