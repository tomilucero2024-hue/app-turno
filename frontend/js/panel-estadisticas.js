/**
 * Módulo de Estadísticas del panel del dueño con exportación a CSV.
 */

window.PanelModulos = window.PanelModulos || {};

window.PanelModulos.Estadisticas = (() => {
  const { el, ico, pintar, tostada, conCarga, mensajeDeError } = UI;

  async function pintarEstadisticas(ctx) {
    ctx.cargando('metricas');

    let r;
    let turnosDelPeriodo = [];
    try {
      const api = await ctx.dueno();
      r = await api.getEstadisticas(ctx.estado.rangoStats.desde, ctx.estado.rangoStats.hasta);
      const datosTurnos = await api.getTurnosPorRango(ctx.estado.rangoStats.desde, ctx.estado.rangoStats.hasta);
      turnosDelPeriodo = datosTurnos.turnos || [];
    } catch (err) {
      pintar(ctx.contenido(), UI.aviso(mensajeDeError(err)));
      return;
    }
    if (ctx.estado.seccion !== 'estadisticas') return;

    const botonExportar = el('button', {
      clase: 'boton boton--secundario boton--chico',
      type: 'button',
      onClick: async () => {
        if (!turnosDelPeriodo.length) {
          tostada('No hay turnos registrados en este período para exportar.', 'error');
          return;
        }
        await conCarga(botonExportar, async () => {
          const columnas = [
            'codigo_ticket',
            'fecha',
            'hora',
            'hora_fin',
            'cliente_nombre',
            'cliente_telefono',
            'servicio_nombre',
            'barbero_nombre',
            'precio',
            'estado',
            'creado_en'
          ];
          const nombreArchivo = `turnos_${ctx.estado.perfil.slug}_${ctx.estado.rangoStats.desde}_al_${ctx.estado.rangoStats.hasta}.csv`;
          UI.descargarCsv(nombreArchivo, turnosDelPeriodo, columnas);
          tostada('Archivo CSV descargado con éxito.', 'exito');
        });
      }
    }, [ico('descargar', 'ico ico--sm'), document.createTextNode('Exportar a CSV')]);

    pintar(ctx.contenido(), el('div', { clase: 'pila pila--lg' }, [
      ctx.encabezado('Números', 'La facturación cuenta solo los turnos marcados como atendidos.', botonExportar),

      ctx.selectorDeRango(ctx.estado.rangoStats, (nuevo) => {
        ctx.estado.rangoStats = nuevo;
        pintarEstadisticas(ctx);
      }),

      el('div', { clase: 'panel-tinta fila fila--sep fila--envolver' }, [
        el('div', {}, [
          el('div', { clase: 'metrica__etiqueta', texto: 'Facturado en el período' }),
          el('div', { clase: 'metrica__valor oro', texto: UI.precio(r.facturado) })
        ]),
        ico('billete', 'ico ico--xl oro')
      ]),

      (r.completados === 0 && r.total > r.cancelados)
        ? UI.aviso('Ningún turno de este período está marcado como atendido. Marcalos desde la Agenda para que sumen a la facturación.', 'atencion')
        : null,

      el('div', { clase: 'grilla grilla--4' }, [
        ctx.tarjetaMetrica('Turnos', String(r.total)),
        ctx.tarjetaMetrica('Atendidos', String(r.completados)),
        ctx.tarjetaMetrica('Por venir', String(r.confirmados)),
        ctx.tarjetaMetrica('No vinieron', String(r.no_asistio)),
        ctx.tarjetaMetrica('Cancelados', String(r.cancelados))
      ]),

      el('div', { clase: 'grilla grilla--2' }, [
        tarjetaRanking('Por profesional', r.por_barbero),
        tarjetaRanking('Por servicio', r.por_servicio)
      ])
    ]));
  }

  function tarjetaRanking(titulo, mapa) {
    const filas = Object.entries(mapa || {}).sort((a, b) => b[1] - a[1]);
    const maximo = filas.length ? filas[0][1] : 1;

    return el('div', { clase: 'tarjeta pila' }, [
      el('div', { clase: 'tarjeta__titulo', texto: titulo }),
      filas.length
        ? el('div', { clase: 'pila pila--sm' }, filas.map(([nombre, cantidad]) =>
            el('div', { clase: 'pila pila--sm' }, [
              el('div', { clase: 'fila fila--sep chico' }, [
                el('span', { texto: nombre }),
                el('span', { clase: 'negrita mono', texto: String(cantidad) })
              ]),
              el('div', { clase: 'barra-dato' }, [
                el('div', {
                  clase: 'barra-dato__relleno',
                  style: `width:${Math.round((cantidad / maximo) * 100)}%`
                })
              ])
            ])))
        : el('p', { clase: 'chico tenue', texto: 'Sin datos en este período.' })
    ]);
  }

  return { render: pintarEstadisticas };
})();
