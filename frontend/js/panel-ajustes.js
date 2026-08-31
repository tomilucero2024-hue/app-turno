/**
 * Módulo de Ajustes del panel del dueño.
 * Configuración general, perfil comercial, buffer de descanso y archivado de turnos.
 */

window.PanelModulos = window.PanelModulos || {};

window.PanelModulos.Ajustes = (() => {
  const { $, el, ico, pintar, tostada, conCarga, mensajeDeError, confirmar } = UI;

  function pintarAjustes(ctx) {
    const p = ctx.estado.perfil;

    const nombre = el('input', { clase: 'entrada', maxlength: 80, required: true, value: p.nombre_negocio || '' });
    const paso = el('input', { clase: 'entrada', type: 'number', min: 5, max: 120, step: 5, value: p.paso_grilla_min || 15 });
    const margen = el('input', {
      clase: 'entrada', type: 'number', min: 0, max: 120, step: 5,
      value: p.margen_turno_min || 0
    });
    const antelacion = el('input', { clase: 'entrada', type: 'number', min: 0, max: 720, value: p.antelacion_min_horas || 0 });
    const cancelacion = el('input', { clase: 'entrada', type: 'number', min: 0, max: 720, value: p.cancelacion_min_horas || 0 });
    const zona = el('input', { clase: 'entrada', maxlength: 60, value: p.zona_horaria || 'America/Argentina/Buenos_Aires' });

    // Campos comerciales
    const direccion = el('input', {
      clase: 'entrada', maxlength: 120,
      placeholder: 'Ej. Av. Santa Fe 1234, CABA',
      value: p.direccion || ''
    });
    const instagram = el('input', {
      clase: 'entrada', maxlength: 80,
      placeholder: 'Ej. mibarberia.ok',
      value: p.instagram || ''
    });
    const telefonoContacto = el('input', {
      clase: 'entrada', type: 'tel', inputmode: 'tel', maxlength: 30,
      placeholder: 'Ej. 11 2345-6789',
      value: p.telefono_contacto || ''
    });
    UI.aplicarMascaraTelefono(telefonoContacto);

    const guardar = el('button', { clase: 'boton boton--primario', type: 'submit', texto: 'Guardar cambios' });

    const formulario = el('form', { clase: 'tarjeta pila', onSubmit: async (e) => {
      e.preventDefault();
      await conCarga(guardar, async () => {
        try {
          const api = await ctx.dueno();
          await api.actualizarPerfilCuenta({
            nombre_negocio: nombre.value.trim(),
            paso_grilla_min: Number(paso.value),
            margen_turno_min: Number(margen.value) || 0,
            antelacion_min_horas: Number(antelacion.value),
            cancelacion_min_horas: Number(cancelacion.value),
            zona_horaria: zona.value.trim(),
            direccion: direccion.value.trim(),
            instagram: instagram.value.trim(),
            telefono_contacto: telefonoContacto.value.trim()
          });
          ctx.estado.perfil = await api.getPerfilCuenta();
          $('#titulo-panel').textContent = ctx.estado.perfil.nombre_negocio;
          tostada('Configuración guardada.', 'exito');
        } catch (err) {
          tostada(mensajeDeError(err), 'error');
        }
      });
    } }, [
      el('div', { clase: 'tarjeta__titulo', texto: 'Datos generales del negocio' }),
      ctx.campo('Nombre del negocio', nombre),
      el('div', { clase: 'grilla grilla--2' }, [
        ctx.campo('Dirección física (aparecerá con link a Maps)', direccion),
        ctx.campo('Instagram (sin @)', instagram)
      ]),
      el('div', { clase: 'grilla grilla--2' }, [
        ctx.campo('WhatsApp / Teléfono de contacto', telefonoContacto),
        ctx.campo('Zona horaria (formato IANA)', zona, 'Por ejemplo America/Argentina/Buenos_Aires.')
      ]),
      el('div', { clase: 'tarjeta__titulo', style: 'margin-top: var(--e3)', texto: 'Parámetros de la agenda' }),
      el('div', { clase: 'grilla grilla--2' }, [
        ctx.campo('Paso de la grilla (minutos)', paso, 'Con 15, los turnos se ofrecen 9:00, 9:15, 9:30…'),
        ctx.campo('Margen / Descanso entre turnos (minutos)', margen, 'Espacio buffer automático de limpieza o descanso tras cada turno.')
      ]),
      el('div', { clase: 'grilla grilla--2' }, [
        ctx.campo('Antelación mínima para reservar (horas)', antelacion, 'Evita reservas sorpresa sobre la hora.'),
        ctx.campo('Antelación mínima para cancelar (horas)', cancelacion, 'Margen para reasignar el horario si alguien cancela.')
      ]),
      el('div', { clase: 'fila fila--fin' }, [guardar])
    ]);

    const url = `${CONFIG.URL_SITIO}?n=${p.slug}`;

    // Bloque de mantenimiento y archivado
    const btnArchivar = el('button', {
      clase: 'boton boton--secundario boton--chico',
      type: 'button',
      onClick: async () => {
        const seguro = await confirmar({
          titulo: 'Archivar turnos antiguos',
          mensaje: 'Se moverán a la hoja histórica los turnos completados o cancelados con más de 30 días de antigüedad. La agenda cargará más rápido y ningún dato se perderá.',
          textoOk: 'Archivar ahora'
        });
        if (!seguro) return;

        await conCarga(btnArchivar, async () => {
          try {
            const api = await ctx.dueno();
            const res = await api.archivarTurnos(30);
            tostada(`Mantenimiento completado: ${res.archivados} turnos archivados a Turnos_Historico.`, 'exito');
          } catch (err) {
            tostada(mensajeDeError(err), 'error');
          }
        });
      }
    }, [ico('caja', 'ico ico--sm'), document.createTextNode('Archivar turnos de más de 30 días')]);

    pintar(ctx.contenido(), el('div', { clase: 'pila pila--lg' }, [
      ctx.encabezado('Ajustes', 'Perfil comercial, comportamiento de la agenda y base de datos.'),
      formulario,

      el('div', { clase: 'tarjeta pila' }, [
        el('div', { clase: 'tarjeta__titulo', texto: 'Tu link público' }),
        el('div', { clase: 'fila fila--envolver' }, [
          el('code', { clase: 'chico oro crece', style: 'word-break:break-all', texto: url })
        ]),
        el('p', { clase: 'chico tenue', texto: 'La dirección no se puede cambiar para evitar romper los links compartidos a clientes.' })
      ]),

      el('div', { clase: 'tarjeta pila' }, [
        el('div', { clase: 'tarjeta__titulo', texto: 'Mantenimiento y rendimiento' }),
        el('p', { clase: 'chico apagado', texto: 'Para mantener la velocidad de respuesta en menos de 1 segundo a medida que pasan los meses, podés archivar los turnos finalizados antiguos a la hoja histórica.' }),
        el('div', { clase: 'fila fila--envolver' }, [btnArchivar])
      ]),

      el('div', { clase: 'tarjeta pila' }, [
        el('div', { clase: 'tarjeta__titulo', texto: 'Tus datos' }),
        el('p', { clase: 'chico apagado', texto: 'Todos los turnos viven en tu planilla de Google privada. Podés abrirla en cualquier momento para ver o exportar los datos.' }),
        el('div', { clase: 'fila fila--envolver' }, [
          el('a', {
            clase: 'boton boton--secundario boton--chico',
            href: p.spreadsheet_url,
            target: '_blank', rel: 'noopener'
          }, [ico('compartir', 'ico ico--sm'), document.createTextNode('Abrir mi planilla')]),
          el('button', {
            clase: 'boton boton--fantasma boton--chico', type: 'button', onClick: () => Auth.salir()
          }, [ico('salir', 'ico ico--sm'), document.createTextNode('Cerrar sesión')])
        ]),
        el('p', { clase: 'chico tenue', texto: `Cuenta: ${p.email}` })
      ])
    ]));
  }

  return { render: pintarAjustes };
})();
