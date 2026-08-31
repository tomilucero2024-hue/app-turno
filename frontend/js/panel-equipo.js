/**
 * Módulo de Equipo y Horarios del panel del dueño.
 */

window.PanelModulos = window.PanelModulos || {};

window.PanelModulos.Equipo = (() => {
  const { el, ico, pintar, vacio, tostada, conCarga, mensajeDeError, confirmar, dialogo } = UI;

  const DIAS_EDITOR = [1, 2, 3, 4, 5, 6, 0];

  async function pintarEquipo(ctx) {
    ctx.cargando('lista', 3);
    try {
      await ctx.recargarNegocio();
    } catch (err) {
      pintar(ctx.contenido(), UI.aviso(mensajeDeError(err)));
      return;
    }
    if (ctx.estado.seccion !== 'equipo') return;

    const barberos = ctx.estado.negocio?.barberos || [];

    pintar(ctx.contenido(), el('div', { clase: 'pila pila--lg' }, [
      ctx.encabezado('Equipo', 'Cada profesional tiene su propia agenda y sus propios horarios.',
        ctx.botonNuevo('Agregar profesional', () => formularioBarbero(null, ctx))),

      barberos.length
        ? el('div', { clase: 'pila' }, barberos.map((b) => filaBarbero(b, ctx)))
        : el('div', { clase: 'tarjeta' }, [vacio('No hay profesionales cargados.', 'usuarios')])
    ]));
  }

  function filaBarbero(barbero, ctx) {
    return el('div', { clase: 'tarjeta tarjeta--compacta fila fila--sep fila--envolver' }, [
      el('div', { clase: 'fila crece' }, [
        el('span', { clase: 'marca__sello' }, [ico('usuario', 'ico ico--sm')]),
        el('span', { clase: 'negrita', texto: barbero.nombre })
      ]),
      el('div', { clase: 'fila' }, [
        el('button', {
          clase: 'boton boton--secundario boton--chico', type: 'button',
          onClick: () => formularioHorarios(barbero, ctx)
        }, [ico('reloj', 'ico ico--sm'), document.createTextNode('Horarios')]),
        ctx.botonDeTurno('lapiz', 'Cambiar el nombre', async () => formularioBarbero(barbero, ctx)),
        ctx.botonDeTurno('tacho', 'Quitar del equipo', async () => {
          const seguro = await confirmar({
            titulo: 'Quitar del equipo',
            mensaje: `${barbero.nombre} deja de aparecer para reservar. Sus turnos ya tomados siguen en la agenda.`,
            textoOk: 'Quitar'
          });
          if (!seguro) return;
          const api = await ctx.dueno();
          await api.borrarBarbero(barbero.id_barbero);
          tostada('Profesional dado de baja.', 'exito');
          pintarEquipo(ctx);
        }, 'peligro')
      ])
    ]);
  }

  function formularioBarbero(barbero = null, ctx) {
    const nombre = el('input', { clase: 'entrada', maxlength: 60, required: true, value: barbero?.nombre || '' });
    const guardar = el('button', {
      clase: 'boton boton--primario', type: 'submit',
      texto: barbero ? 'Guardar' : 'Agregar'
    });

    const formulario = el('form', { clase: 'pila', onSubmit: async (e) => {
      e.preventDefault();
      await conCarga(guardar, async () => {
        try {
          const api = await ctx.dueno();
          if (barbero) await api.editarBarbero(barbero.id_barbero, nombre.value.trim());
          else await api.crearBarbero(nombre.value.trim());
          cerrar();
          tostada(barbero ? 'Nombre actualizado.' : 'Profesional agregado.', 'exito');
          pintarEquipo(ctx);
        } catch (err) {
          tostada(mensajeDeError(err), 'error');
        }
      });
    } }, [
      ctx.campo('Nombre', nombre),
      el('div', { clase: 'fila fila--fin' }, [guardar])
    ]);

    const cerrar = dialogo({ titulo: barbero ? 'Editar profesional' : 'Nuevo profesional', cuerpo: formulario });
  }

  async function formularioHorarios(barbero, ctx) {
    const cuerpo = el('div', { clase: 'pila' });
    pintar(cuerpo, UI.esqueletoDe('lista', 4));
    const cerrar = dialogo({ titulo: `Horarios de ${barbero.nombre}`, cuerpo });

    let franjas = [];
    let rotas = [];
    try {
      const api = await ctx.dueno();
      const todas = (await api.getHorarios(barbero.id_barbero)).horarios || [];
      franjas = todas.filter((f) => f.legible).map((f) => ({
        dia_semana: f.dia_semana,
        hora_inicio: f.hora_inicio,
        hora_fin: f.hora_fin
      }));
      rotas = todas.filter((f) => !f.legible);
    } catch (err) {
      pintar(cuerpo, UI.aviso(mensajeDeError(err)));
      return;
    }

    function repintar() {
      pintar(cuerpo, [
        el('div', { clase: 'aviso aviso--atencion' }, [
          ico('alerta', 'ico'),
          el('span', { texto: 'Al guardar se reemplaza toda la semana de este profesional por lo que veas acá.' })
        ]),

        rotas.length
          ? el('div', { clase: 'aviso' }, [
              ico('alerta', 'ico'),
              el('span', { texto:
                `Hay ${rotas.length} franja${rotas.length === 1 ? '' : 's'} en la planilla que este editor no puede mostrar ` +
                `(${rotas.map((f) => `día ${f.dia_semana ?? '?'}: "${f.hora_inicio}" a "${f.hora_fin}"`).join('; ')}). ` +
                'La agenda ya las está ignorando. Si guardás acá, se eliminan.' })
            ])
          : null,

        ...DIAS_EDITOR.map(filaDia),
        el('div', { clase: 'fila fila--fin' }, [guardar])
      ]);
    }

    function filaDia(dia) {
      const delDia = franjas.filter((f) => f.dia_semana === dia);

      return el('div', {
        clase: 'pila pila--sm',
        style: 'padding-block: var(--e2); border-bottom:1px solid var(--borde)'
      }, [
        el('div', { clase: 'fila fila--sep' }, [
          el('span', { clase: 'negrita', texto: UI.DIAS_LARGOS[dia] }),
          el('button', {
            clase: 'boton boton--fantasma boton--chico', type: 'button',
            onClick: () => {
              const ultima = delDia[delDia.length - 1];
              franjas.push({
                dia_semana: dia,
                hora_inicio: ultima ? '16:00' : '09:00',
                hora_fin: ultima ? '20:00' : '13:00'
              });
              repintar();
            }
          }, [ico('mas', 'ico ico--sm'), document.createTextNode('Franja')])
        ]),
        delDia.length
          ? el('div', { clase: 'pila pila--sm' }, delDia.map(filaFranja))
          : el('span', { clase: 'chico tenue', texto: 'Cerrado' })
      ]);
    }

    function filaFranja(franja) {
      const inicio = el('input', { clase: 'entrada', type: 'time', value: franja.hora_inicio, step: 300 });
      const fin = el('input', { clase: 'entrada', type: 'time', value: franja.hora_fin, step: 300 });

      inicio.addEventListener('change', () => { franja.hora_inicio = inicio.value; });
      fin.addEventListener('change', () => { franja.hora_fin = fin.value; });

      return el('div', { clase: 'fila' }, [
        inicio,
        el('span', { clase: 'tenue', texto: 'a' }),
        fin,
        el('button', {
          clase: 'boton-ico boton-ico--chico boton-ico--peligro', type: 'button', 'aria-label': 'Quitar franja',
          onClick: () => { franjas.splice(franjas.indexOf(franja), 1); repintar(); }
        }, [ico('tacho', 'ico ico--sm')])
      ]);
    }

    const guardar = el('button', {
      clase: 'boton boton--primario', type: 'button', texto: 'Guardar horarios',
      onClick: async () => {
        if (franjas.some((f) => !f.hora_inicio || !f.hora_fin)) {
          tostada('Hay una franja sin completar. Poné las dos horas o borrala.', 'error');
          return;
        }
        if (franjas.some((f) => f.hora_fin <= f.hora_inicio)) {
          tostada('Hay una franja que termina antes de empezar.', 'error');
          return;
        }

        await conCarga(guardar, async () => {
          try {
            const api = await ctx.dueno();
            await api.configurarHorarios(barbero.id_barbero, franjas);
            cerrar();
            tostada('Horarios guardados.', 'exito');
          } catch (err) {
            tostada(mensajeDeError(err), 'error');
          }
        });
      }
    });

    repintar();
  }

  return { render: pintarEquipo };
})();
