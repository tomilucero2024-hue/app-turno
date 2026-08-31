/**
 * Módulo de Agenda del panel del dueño.
 * Incluye buscador en tiempo real, filtro por profesional y gestión de estados.
 */

window.PanelModulos = window.PanelModulos || {};

window.PanelModulos.Agenda = (() => {
  const { $, el, ico, pintar, vacio, tostada, mensajeDeError, confirmar } = UI;

  let busquedaTexto = '';
  let filtroBarberoId = 'todos';

  async function pintarAgenda(ctx) {
    ctx.cargando('agenda', 3);

    let turnos = [];
    try {
      const api = await ctx.dueno();
      const datos = await api.getTurnosPorRango(ctx.estado.rango.desde, ctx.estado.rango.hasta);
      turnos = datos.turnos || [];
      if (!ctx.estado.negocio) await ctx.recargarNegocio();
    } catch (err) {
      pintar(ctx.contenido(), UI.aviso(mensajeDeError(err)));
      return;
    }

    if (ctx.estado.seccion !== 'agenda') return;

    const barberos = ctx.estado.negocio?.barberos || [];

    // Filtros locales en memoria (búsqueda y profesional)
    const turnosFiltrados = turnos.filter((t) => {
      if (filtroBarberoId !== 'todos' && String(t.id_barbero) !== String(filtroBarberoId)) {
        return false;
      }
      if (busquedaTexto.trim()) {
        const q = busquedaTexto.trim().toLowerCase();
        const nombre = String(t.cliente_nombre || '').toLowerCase();
        const tel = String(t.cliente_telefono || '').replace(/\D/g, '');
        const serv = String(t.servicio_nombre || '').toLowerCase();
        const cod = String(t.codigo_ticket || '').toLowerCase();
        if (!nombre.includes(q) && !tel.includes(q) && !serv.includes(q) && !cod.includes(q)) {
          return false;
        }
      }
      return true;
    });

    const activos = turnosFiltrados.filter((t) => t.estado !== 'cancelado');
    const facturacionPrevista = activos.reduce((suma, t) => suma + (Number(t.precio) || 0), 0);

    const hoy = UI.hoyIso();
    const ahora = UI.ahoraHora();
    const proximoTurno = activos.find((t) => (t.fecha > hoy) || (t.fecha === hoy && t.hora >= ahora)) || activos[0];
    const proximoTexto = proximoTurno ? `${proximoTurno.hora} • ${proximoTurno.cliente_nombre}` : 'Sin turnos próximos';

    // Hero Card de métricas ejecutivas
    const heroCard = el('section', { clase: 'hero-card' }, [
      el('div', { clase: 'hero-card__header' }, [
        el('div', {}, [
          el('div', { clase: 'hero-card__label', texto: 'Facturación estimada del período' }),
          el('div', { clase: 'hero-card__amount', texto: UI.precio(facturacionPrevista) })
        ])
      ]),
      el('div', { clase: 'metrics-grid' }, [
        el('div', { clase: 'metric-box' }, [
          el('span', { clase: 'metric-box__title', texto: 'Ocupación Turnos' }),
          el('span', { clase: 'metric-box__value', texto: `${activos.length} activos (${turnosFiltrados.length} tot.)` })
        ]),
        el('div', { clase: 'metric-box' }, [
          el('span', { clase: 'metric-box__title', texto: 'Próximo Cliente' }),
          el('span', { clase: 'metric-box__value', texto: proximoTexto })
        ])
      ])
    ]);

    // Controles de búsqueda y filtro
    const inputBuscador = el('input', {
      clase: 'entrada',
      type: 'search',
      placeholder: 'Buscar por cliente, teléfono, ticket o servicio…',
      value: busquedaTexto
    });
    inputBuscador.addEventListener('input', () => {
      busquedaTexto = inputBuscador.value;
      repintarListaTurnos(turnos, ctx);
    });

    const selectBarbero = el('select', { clase: 'entrada' }, [
      el('option', { value: 'todos', texto: 'Todos los profesionales' }),
      ...barberos.map((b) => el('option', {
        value: b.id_barbero,
        texto: b.nombre,
        selected: String(b.id_barbero) === String(filtroBarberoId)
      }))
    ]);
    selectBarbero.addEventListener('change', () => {
      filtroBarberoId = selectBarbero.value;
      repintarListaTurnos(turnos, ctx);
    });

    const barraFiltros = el('div', { clase: 'barra-filtro-agenda' }, [
      el('div', { clase: 'buscador' }, [ico('buscar', 'ico'), inputBuscador]),
      selectBarbero
    ]);

    const contenedorTurnos = el('div', { id: 'contenedor-turnos-agenda' });

    pintar(ctx.contenido(), el('div', { clase: 'pila pila--lg' }, [
      ctx.encabezado('Agenda', 'Gestión de turnos en tiempo real.',
        el('button', {
          clase: 'boton boton--secundario boton--chico',
          type: 'button',
          onClick: () => pintarAgenda(ctx)
        }, [ico('refrescar', 'ico ico--sm'), document.createTextNode('Actualizar')])),

      heroCard,

      ctx.selectorDeRango(ctx.estado.rango, (nuevo) => {
        ctx.estado.rango = nuevo;
        pintarAgenda(ctx);
      }),

      barraFiltros,
      contenedorTurnos
    ]));

    repintarListaTurnos(turnos, ctx);
  }

  function repintarListaTurnos(todosLosTurnos, ctx) {
    const contenedor = $('#contenedor-turnos-agenda');
    if (!contenedor) return;

    const turnosFiltrados = todosLosTurnos.filter((t) => {
      if (filtroBarberoId !== 'todos' && String(t.id_barbero) !== String(filtroBarberoId)) {
        return false;
      }
      if (busquedaTexto.trim()) {
        const q = busquedaTexto.trim().toLowerCase();
        const nombre = String(t.cliente_nombre || '').toLowerCase();
        const tel = String(t.cliente_telefono || '').replace(/\D/g, '');
        const serv = String(t.servicio_nombre || '').toLowerCase();
        const cod = String(t.codigo_ticket || '').toLowerCase();
        if (!nombre.includes(q) && !tel.includes(q) && !serv.includes(q) && !cod.includes(q)) {
          return false;
        }
      }
      return true;
    });

    if (!turnosFiltrados.length) {
      pintar(contenedor, el('div', { clase: 'tarjeta' }, [
        vacio('No hay turnos registrados en este período o búsqueda.', 'calendario')
      ]));
      return;
    }

    pintar(contenedor, el('div', { clase: 'pila pila--lg' }, agruparPorFecha(turnosFiltrados, ctx)));
  }

  function agruparPorFecha(turnos, ctx) {
    const porFecha = new Map();
    turnos.forEach((t) => {
      if (!porFecha.has(t.fecha)) porFecha.set(t.fecha, []);
      porFecha.get(t.fecha).push(t);
    });

    return Array.from(porFecha.entries()).map(([fecha, delDia]) =>
      el('div', { clase: 'pila pila--sm' }, [
        el('div', { clase: 'fila fila--sep' }, [
          el('div', { clase: 'titular', texto: UI.fechaRelativa(fecha) }),
          el('span', { clase: 'chico tenue', texto: UI.fechaLarga(fecha) })
        ]),
        el('div', { clase: 'timeline-list' }, delDia.map((t) => filaTurno(t, ctx)))
      ]));
  }

  function filaTurno(turno, ctx) {
    const acciones = [];

    if (turno.estado === 'confirmado') {
      acciones.push(ctx.botonDeTurno('check', 'Marcar como atendido', async () =>
        cambiarEstadoTurno(turno, 'completado', ctx)));
      acciones.push(ctx.botonDeTurno('alerta', 'Marcar que no vino', async () =>
        cambiarEstadoTurno(turno, 'no_asistio', ctx)));
      acciones.push(ctx.botonDeTurno('tacho', 'Cancelar el turno', async () => {
        const seguro = await confirmar({
          titulo: 'Cancelar el turno',
          mensaje: `Se cancela el turno de ${turno.cliente_nombre} del ${UI.fechaLarga(turno.fecha)} a las ${turno.hora}.`,
          textoOk: 'Sí, cancelar'
        });
        if (!seguro) return;
        const api = await ctx.dueno();
        await api.cancelarTurno(turno.id_turno);
        tostada('Turno cancelado.', 'exito');
        pintarAgenda(ctx);
      }, 'peligro'));
    }

    if (turno.cliente_telefono) {
      acciones.push(el('a', {
        clase: 'boton-ico boton-ico--chico',
        href: 'https://wa.me/' + turno.cliente_telefono.replace(/\D/g, ''),
        target: '_blank', rel: 'noopener',
        title: 'Escribirle por WhatsApp', 'aria-label': 'Escribirle por WhatsApp'
      }, [ico('whatsapp', 'ico ico--sm')]));

      acciones.push(ctx.botonDeTurno('candado', 'Bloquear este teléfono', async () => {
        const seguro = await confirmar({
          titulo: 'Bloquear el teléfono',
          mensaje: `${UI.telefono(turno.cliente_telefono)} no va a poder reservar más turnos hasta que lo desbloquees.`,
          textoOk: 'Bloquear'
        });
        if (!seguro) return;
        const api = await ctx.dueno();
        await api.bloquearTelefono(turno.cliente_telefono, `Bloqueado desde la agenda (${turno.cliente_nombre})`);
        tostada('Teléfono bloqueado.', 'exito');
      }));
    }

    return el('article', { clase: `turn-card${turno.estado === 'cancelado' ? ' turn-card--cancelado' : ''}` }, [
      el('div', { clase: 'turn-time' }, [
        el('span', { clase: 'turn-time__hour', texto: turno.hora }),
        el('span', { clase: 'turn-time__duration', texto: `${turno.duracion_minutos || 30}m` })
      ]),
      el('div', { clase: 'turn-details' }, [
        el('div', { clase: 'turn-client', texto: turno.cliente_nombre }),
        el('div', { clase: 'turn-service' }, [
          el('span', { texto: turno.servicio_nombre || 'Servicio' }),
          el('span', { texto: ' · ' }),
          el('span', { clase: 'oro negrita', texto: UI.precio(turno.precio) }),
          turno.barbero_nombre ? el('span', { clase: 'tenue', texto: ` · ${turno.barbero_nombre}` }) : null
        ].filter(Boolean))
      ]),
      el('div', { clase: 'turn-meta' }, [
        el('span', { clase: `status-badge status-badge--${turno.estado}` }, [
          document.createTextNode(UI.ESTADOS[turno.estado] || turno.estado)
        ]),
        el('div', { clase: 'fila', style: 'gap: 4px;' }, acciones)
      ])
    ]);
  }

  async function cambiarEstadoTurno(turno, nuevoEstado, ctx) {
    const api = await ctx.dueno();
    await api.marcarEstadoTurno(turno.id_turno, nuevoEstado);
    tostada(`Turno marcado como ${UI.ESTADOS[nuevoEstado].toLowerCase()}.`, 'exito');
    pintarAgenda(ctx);
  }

  return { render: pintarAgenda };
})();
