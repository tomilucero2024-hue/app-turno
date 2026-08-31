/**
 * Módulo de Bloqueos del panel del dueño.
 */

window.PanelModulos = window.PanelModulos || {};

window.PanelModulos.Bloqueos = (() => {
  const { el, pintar, vacio, tostada, conCarga, mensajeDeError, dialogo } = UI;

  async function pintarBloqueos(ctx) {
    ctx.cargando('lista', 2);

    let bloqueos = [];
    try {
      const api = await ctx.dueno();
      bloqueos = (await api.getBloqueos()).bloqueos || [];
      if (!ctx.estado.negocio) await ctx.recargarNegocio();
    } catch (err) {
      pintar(ctx.contenido(), UI.aviso(mensajeDeError(err)));
      return;
    }
    if (ctx.estado.seccion !== 'bloqueos') return;

    const nombreBarbero = (id) => id === 'todos'
      ? 'Todo el negocio'
      : (ctx.estado.negocio?.barberos?.find((b) => b.id_barbero === id)?.nombre || 'Profesional dado de baja');

    pintar(ctx.contenido(), el('div', { clase: 'pila pila--lg' }, [
      ctx.encabezado('Bloqueos', 'Vacaciones, feriados o un rato puntual sin atender.',
        ctx.botonNuevo('Nuevo bloqueo', () => formularioBloqueo(ctx))),

      bloqueos.length
        ? el('div', { clase: 'pila' }, bloqueos.map((b) =>
            el('div', { clase: 'tarjeta tarjeta--compacta fila fila--sep fila--envolver' }, [
              el('div', { clase: 'crece' }, [
                el('div', { clase: 'negrita', texto:
                  b.fecha_inicio === b.fecha_fin
                    ? UI.fechaLarga(b.fecha_inicio)
                    : `${UI.fechaLarga(b.fecha_inicio)} al ${UI.fechaLarga(b.fecha_fin)}` }),
                el('div', { clase: 'chico tenue', texto: [
                  nombreBarbero(b.id_barbero),
                  b.hora_inicio ? `${b.hora_inicio} a ${b.hora_fin}` : 'Día completo',
                  b.motivo
                ].filter(Boolean).join(' · ') })
              ]),
              ctx.botonDeTurno('tacho', 'Quitar el bloqueo', async () => {
                const api = await ctx.dueno();
                await api.borrarBloqueo(b.id_bloqueo);
                tostada('Bloqueo eliminado.', 'exito');
                pintarBloqueos(ctx);
              }, 'peligro')
            ])))
        : el('div', { clase: 'tarjeta' }, [vacio('No hay bloqueos cargados.', 'calendario-x')])
    ]));
  }

  function formularioBloqueo(ctx) {
    const barberos = ctx.estado.negocio?.barberos || [];

    const barbero = el('select', { clase: 'entrada' }, [
      el('option', { value: 'todos', texto: 'Todo el negocio' }),
      ...barberos.map((b) => el('option', { value: b.id_barbero, texto: b.nombre }))
    ]);

    const desde = el('input', { clase: 'entrada', type: 'date', required: true, value: UI.hoyIso() });
    const hasta = el('input', { clase: 'entrada', type: 'date', required: true, value: UI.hoyIso() });
    const diaEntero = el('input', { type: 'checkbox', checked: true, style: 'width:18px;height:18px;accent-color:var(--oro-500)' });
    const horaInicio = el('input', { clase: 'entrada', type: 'time', value: '13:00', step: 300, disabled: true });
    const horaFin = el('input', { clase: 'entrada', type: 'time', value: '16:00', step: 300, disabled: true });
    const motivo = el('input', { clase: 'entrada', maxlength: 120, placeholder: 'Vacaciones, feriado, turno médico…' });

    diaEntero.addEventListener('change', () => {
      horaInicio.disabled = diaEntero.checked;
      horaFin.disabled = diaEntero.checked;
    });

    const guardar = el('button', { clase: 'boton boton--primario', type: 'submit', texto: 'Crear bloqueo' });

    const formulario = el('form', { clase: 'pila', onSubmit: async (e) => {
      e.preventDefault();
      await conCarga(guardar, async () => {
        try {
          const api = await ctx.dueno();
          await api.crearBloqueo({
            id_barbero: barbero.value,
            fecha_inicio: desde.value,
            fecha_fin: hasta.value,
            hora_inicio: diaEntero.checked ? '' : horaInicio.value,
            hora_fin: diaEntero.checked ? '' : horaFin.value,
            motivo: motivo.value.trim()
          });
          cerrar();
          tostada('Bloqueo creado.', 'exito');
          pintarBloqueos(ctx);
        } catch (err) {
          tostada(mensajeDeError(err), 'error');
        }
      });
    } }, [
      ctx.campo('¿A quién afecta?', barbero),
      el('div', { clase: 'grilla grilla--2' }, [ctx.campo('Desde', desde), ctx.campo('Hasta', hasta)]),
      el('label', { clase: 'fila', style: 'cursor:pointer' }, [
        diaEntero, el('span', { clase: 'chico', texto: 'Día completo' })
      ]),
      el('div', { clase: 'grilla grilla--2' }, [
        ctx.campo('Hora de inicio', horaInicio),
        ctx.campo('Hora de fin', horaFin)
      ]),
      ctx.campo('Motivo (opcional)', motivo),
      el('div', { clase: 'fila fila--fin' }, [guardar])
    ]);

    const cerrar = dialogo({ titulo: 'Nuevo bloqueo', cuerpo: formulario });
  }

  return { render: pintarBloqueos };
})();
