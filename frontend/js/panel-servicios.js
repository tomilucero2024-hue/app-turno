/**
 * Módulo de Servicios del panel del dueño.
 */

window.PanelModulos = window.PanelModulos || {};

window.PanelModulos.Servicios = (() => {
  const { el, ico, pintar, vacio, tostada, conCarga, mensajeDeError, confirmar, dialogo } = UI;

  async function pintarServicios(ctx) {
    ctx.cargando('lista', 3);
    try {
      await ctx.recargarNegocio();
    } catch (err) {
      pintar(ctx.contenido(), UI.aviso(mensajeDeError(err)));
      return;
    }
    if (ctx.estado.seccion !== 'servicios') return;

    const servicios = ctx.estado.negocio?.servicios || [];

    pintar(ctx.contenido(), el('div', { clase: 'pila pila--lg' }, [
      ctx.encabezado('Servicios', 'La duración define cuánto ocupa cada turno en la agenda.',
        ctx.botonNuevo('Nuevo servicio', () => formularioServicio(null, ctx))),

      servicios.length
        ? el('div', { clase: 'grilla grilla--2' }, servicios.map((s) => tarjetaServicio(s, ctx)))
        : el('div', { clase: 'tarjeta' }, [
            vacio('Todavía no cargaste ningún servicio. Sin servicios nadie puede reservar.', 'etiqueta')
          ]),

      el('div', { clase: 'aviso' }, [
        ico('info', 'ico'),
        el('span', { texto: 'Editar un servicio no cambia los turnos ya reservados: cada turno guarda la duración y el precio con los que se reservó.' })
      ])
    ]));
  }

  function tarjetaServicio(servicio, ctx) {
    return el('div', { clase: 'tarjeta tarjeta--compacta fila fila--sep' }, [
      el('div', { clase: 'crece' }, [
        el('div', { clase: 'negrita', texto: servicio.nombre }),
        el('div', { clase: 'chico tenue',
          texto: `${UI.duracion(servicio.duracion_minutos)} · ${UI.precio(servicio.precio)}` })
      ]),
      el('div', { clase: 'item__acciones' }, [
        ctx.botonDeTurno('lapiz', 'Editar', async () => formularioServicio(servicio, ctx)),
        ctx.botonDeTurno('tacho', 'Eliminar', async () => {
          const seguro = await confirmar({
            titulo: 'Eliminar el servicio',
            mensaje: `"${servicio.nombre}" deja de ofrecerse. Los turnos ya reservados con este servicio no se tocan.`,
            textoOk: 'Eliminar'
          });
          if (!seguro) return;
          const api = await ctx.dueno();
          await api.borrarServicio(servicio.id_servicio);
          tostada('Servicio eliminado.', 'exito');
          pintarServicios(ctx);
        }, 'peligro')
      ])
    ]);
  }

  function formularioServicio(servicio = null, ctx) {
    const nombre = el('input', { clase: 'entrada', maxlength: 60, required: true, value: servicio?.nombre || '' });
    const duracion = el('input', {
      clase: 'entrada', type: 'number', min: 5, max: 600, step: 5, required: true,
      value: servicio ? servicio.duracion_minutos : 30
    });
    const precio = el('input', {
      clase: 'entrada', type: 'number', min: 0, step: 100,
      value: servicio ? servicio.precio : 0
    });

    const guardar = el('button', {
      clase: 'boton boton--primario', type: 'submit',
      texto: servicio ? 'Guardar cambios' : 'Crear servicio'
    });

    const formulario = el('form', { clase: 'pila', onSubmit: async (e) => {
      e.preventDefault();
      await conCarga(guardar, async () => {
        try {
          const api = await ctx.dueno();
          const datos = {
            nombre: nombre.value.trim(),
            duracion_minutos: Number(duracion.value),
            precio: Number(precio.value) || 0
          };
          if (servicio) await api.editarServicio({ id_servicio: servicio.id_servicio, ...datos });
          else await api.crearServicio(datos);

          cerrar();
          tostada(servicio ? 'Servicio actualizado.' : 'Servicio creado.', 'exito');
          pintarServicios(ctx);
        } catch (err) {
          tostada(mensajeDeError(err), 'error');
        }
      });
    } }, [
      ctx.campo('Nombre', nombre),
      el('div', { clase: 'grilla grilla--2' }, [
        ctx.campo('Duración (minutos)', duracion),
        ctx.campo('Precio', precio)
      ]),
      el('div', { clase: 'fila fila--fin' }, [guardar])
    ]);

    const cerrar = dialogo({ titulo: servicio ? 'Editar servicio' : 'Nuevo servicio', cuerpo: formulario });
  }

  return { render: pintarServicios };
})();
