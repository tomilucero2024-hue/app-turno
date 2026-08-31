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
      ctx.encabezado('Agenda', 'Los turnos reservados en el período elegido.',
        el('button', {
          clase: 'boton boton--secundario boton--chico',
          type: 'button',
          onClick: () => pintarAgenda(ctx)
        }, [ico('refrescar', 'ico ico--sm'), document.createTextNode('Actualizar')])),

      ctx.selectorDeRango(ctx.estado.rango, (nuevo) => {
        ctx.estado.rango = nuevo;
        pintarAgenda(ctx);
      }),

      el('div', { clase: 'grilla grilla--3' }, [
        ctx.tarjetaMetrica('Turnos', String(activos.length)),
        ctx.tarjetaMetrica('Cancelados', String(turnosFiltrados.length - activos.length)),
        ctx.tarjetaMetrica('A facturar', UI.precio(facturacionPrevista))
      ]),

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
        vacio('No hay turnos que coincidan con la búsqueda o filtro.', 'calendario')
      ]));
      return;
    }

    pintar(contenedor, el('div', { clase: 'pila' }, agruparPorFecha(turnosFiltrados, ctx)));
  }

  function agruparPorFecha(turnos, ctx) {
    const porFecha = new Map();
    turnos.forEach((t) => {
      if (!porFecha.has(t.fecha)) porFecha.set(t.fecha, []);
      porFecha.get(t.fecha).push(t);
    });

    return Array.from(porFecha.entries()).map(([fecha, delDia]) =>
      el('div', { clase: 'tarjeta pila' }, [
        el('div', { clase: 'fila fila--sep' }, [
          el('div', { clase: 'titular', texto: UI.fechaRelativa(fecha) }),
          el('span', { clase: 'chico tenue', texto: UI.fechaLarga(fecha) })
        ]),
        el('div', { clase: 'lista' }, delDia.map((t) => filaTurno(t, ctx)))
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

    return el('div', { clase: `item${turno.estado === 'cancelado' ? ' item--cancelado' : ''}` }, [
      el('span', { clase: 'item__hora', texto: turno.hora }),
      el('div', { clase: 'item__cuerpo' }, [
        el('div', { clase: 'item__titulo', texto: turno.cliente_nombre }),
        el('div', { clase: 'item__meta',
          texto: [turno.servicio_nombre, turno.barbero_nombre, UI.telefono(turno.cliente_telefono)]
            .filter(Boolean).join(' · ') })
      ]),
      el('span', { clase: 'precio chico ocultar-movil', texto: UI.precio(turno.precio) }),
      UI.insignia(turno.estado),
      el('div', { clase: 'item__acciones' }, acciones)
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
