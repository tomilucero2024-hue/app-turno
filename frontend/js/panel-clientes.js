/**
 * Módulo de Lista Negra / Clientes del panel del dueño.
 */

window.PanelModulos = window.PanelModulos || {};

window.PanelModulos.Clientes = (() => {
  const { el, pintar, vacio, tostada, conCarga, mensajeDeError } = UI;

  async function pintarListaNegra(ctx) {
    ctx.cargando('lista', 2);

    let lista = [];
    try {
      const api = await ctx.dueno();
      lista = (await api.getListaNegra()).lista || [];
    } catch (err) {
      pintar(ctx.contenido(), UI.aviso(mensajeDeError(err)));
      return;
    }
    if (ctx.estado.seccion !== 'clientes') return;

    const telefono = el('input', {
      clase: 'entrada', type: 'tel', inputmode: 'tel', required: true,
      placeholder: '11 5555-5555'
    });
    UI.aplicarMascaraTelefono(telefono);

    const motivo = el('input', { clase: 'entrada', maxlength: 120, placeholder: 'Motivo (opcional)' });
    const bloquear = el('button', { clase: 'boton boton--primario', type: 'submit', texto: 'Bloquear' });

    const alta = el('form', { clase: 'tarjeta pila', onSubmit: async (e) => {
      e.preventDefault();
      await conCarga(bloquear, async () => {
        try {
          const api = await ctx.dueno();
          const r = await api.bloquearTelefono(telefono.value.trim(), motivo.value.trim());
          tostada(r.ya_estaba ? 'Ese teléfono ya estaba bloqueado.' : 'Teléfono bloqueado.', 'exito');
          pintarListaNegra(ctx);
        } catch (err) {
          tostada(mensajeDeError(err), 'error');
        }
      });
    } }, [
      el('div', { clase: 'tarjeta__titulo', texto: 'Bloquear un teléfono' }),
      el('div', { clase: 'grilla grilla--2' }, [ctx.campo('Teléfono', telefono), ctx.campo('Motivo', motivo)]),
      el('div', { clase: 'fila fila--fin' }, [bloquear])
    ]);

    pintar(ctx.contenido(), el('div', { clase: 'pila pila--lg' }, [
      ctx.encabezado('Lista negra', 'Estos teléfonos no pueden reservar. El cliente ve un mensaje genérico, no sabe que está bloqueado.'),
      alta,
      lista.length
        ? el('div', { clase: 'pila' }, lista.map((c) =>
            el('div', { clase: 'tarjeta tarjeta--compacta fila fila--sep' }, [
              el('div', { clase: 'crece' }, [
                el('div', { clase: 'negrita mono', texto: UI.telefono(c.telefono) }),
                el('div', { clase: 'chico tenue',
                  texto: [c.fecha_bloqueo && `Desde ${UI.fechaRelativa(c.fecha_bloqueo)}`, c.motivo].filter(Boolean).join(' · ') })
              ]),
              el('button', {
                clase: 'boton boton--secundario boton--chico', type: 'button', texto: 'Desbloquear',
                onClick: async (e) => {
                  await conCarga(e.currentTarget, async () => {
                    try {
                      const api = await ctx.dueno();
                      await api.desbloquearTelefono(c.telefono);
                      tostada('Teléfono desbloqueado.', 'exito');
                      pintarListaNegra(ctx);
                    } catch (err) {
                      tostada(mensajeDeError(err), 'error');
                    }
                  });
                }
              })
            ])))
        : el('div', { clase: 'tarjeta' }, [vacio('No hay teléfonos bloqueados.', 'prohibido')])
    ]));
  }

  return { render: pintarListaNegra };
})();
