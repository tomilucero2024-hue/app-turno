/**
 * Panel del dueño (Orquestador principal).
 *
 * Coordina la autenticación con Firebase, la navegación entre pestañas
 * y delega el renderizado en los submódulos especializados de `PanelModulos`.
 */

(() => {
  const { $, el, ico, pintar, tostada, conCarga, mensajeDeError } = UI;

  const estado = {
    perfil: null,      // getPerfilCuenta
    negocio: null,     // getNegocio: servicios + barberos activos
    seccion: 'agenda',
    rango: { desde: UI.hoyIso(), hasta: UI.hoyIso() },
    rangoStats: { desde: primerDiaDelMes(), hasta: ultimoDiaDelMes() }
  };

  const vistas = {
    cargando: $('#vista-cargando'),
    ingreso: $('#vista-ingreso'),
    alta: $('#vista-alta'),
    panel: $('#vista-panel')
  };

  /**
   * La asigna `prepararAlta`. Vive acá arriba porque `mostrarVista` la necesita:
   * en escritorio el ingreso con Google no recarga la página, así que el vale
   * puede aparecer después de que el formulario ya se preparó.
   */
  let sincronizarCampoClaveAlta = () => {};

  function mostrarVista(nombre) {
    Object.entries(vistas).forEach(([clave, nodo]) => nodo.classList.toggle('oculto', clave !== nombre));

    // La navegación inferior solo tiene sentido con el panel abierto: en las
    // vistas de ingreso y de alta no hay adónde navegar, y como es `position:
    // fixed` se dibujaba encima del formulario.
    const navInferior = $('#bottom-nav');
    if (navInferior) navInferior.classList.toggle('oculto', nombre !== 'panel');

    if (nombre === 'alta') sincronizarCampoClaveAlta();
  }

  /** Cliente autenticado de la API, con un token recién pedido. */
  const dueno = async () => API.conToken(await Auth.token());

  async function recargarNegocio() {
    if (!estado.perfil?.slug) return;
    estado.negocio = await API.getNegocio(estado.perfil.slug);
  }

  function primerDiaDelMes() {
    const hoy = UI.aFechaLocal(UI.hoyIso());
    return UI.aIso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  }

  function ultimoDiaDelMes() {
    const hoy = UI.aFechaLocal(UI.hoyIso());
    return UI.aIso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
  }

  // ==========================================================================
  // Sesión y Autenticación
  // ==========================================================================

  function iniciar() {
    try {
      Auth.alCambiar(alCambiarSesion);
    } catch (err) {
      mostrarVista('ingreso');
      pintar($('#error-ingreso'), UI.aviso(
        'No se pudo cargar Firebase. Revisá la configuración en js/config.js.'));
      return;
    }
    prepararIngreso();
    prepararAlta();
    prepararNavegacionInferior();

    Auth.resultadoRedireccion().catch((err) => {
      pintar($('#error-ingreso'), UI.aviso(Auth.mensajeDeError(err)));
    });
  }

  async function alCambiarSesion(usuario) {
    if (!usuario) {
      estado.perfil = null;
      pintar($('#barra-acciones'), [
        el('a', { clase: 'boton boton--fantasma boton--chico', href: 'index.html', texto: 'Reservar un turno' })
      ]);
      mostrarVista('ingreso');
      return;
    }

    mostrarVista('cargando');
    pintar($('#barra-acciones'), [
      el('span', { clase: 'chip ocultar-movil', texto: usuario.email || 'Sesión iniciada' }),
      el('button', {
        clase: 'boton-ico', type: 'button', 'aria-label': 'Cerrar sesión',
        onClick: () => Auth.salir()
      }, [ico('salir')])
    ]);

    try {
      const api = await dueno();
      estado.perfil = await api.getPerfilCuenta();
      estado.negocio = estado.perfil.negocio || await API.getNegocio(estado.perfil.slug);
      abrirPanel();
    } catch (err) {
      if (err.codigo === 'SIN_CUENTA') {
        mostrarVista('alta');
        return;
      }
      mostrarVista('ingreso');
      pintar($('#error-ingreso'), UI.aviso(mensajeDeError(err)));
    }
  }

  /** Clave del vale de alta en sessionStorage. */
  const VALE_ALTA = 'vale_alta';

  const valeGuardado = () => {
    try { return sessionStorage.getItem(VALE_ALTA) || ''; } catch (err) { return ''; }
  };
  const guardarVale = (vale) => {
    try { sessionStorage.setItem(VALE_ALTA, vale); } catch (err) {}
  };
  const olvidarVale = () => {
    try { sessionStorage.removeItem(VALE_ALTA); } catch (err) {}
  };

  /**
   * Pantalla de ingreso, con dos caminos.
   *
   * "Ya tengo cuenta" entra directo: es el barbero volviendo a su agenda.
   *
   * "Abrir una agenda" pide primero la clave del administrador y no habilita el
   * ingreso hasta validarla. La validación la hace el BACKEND: comparar en el
   * navegador obligaría a publicar la clave en config.js, donde queda legible
   * para cualquiera. A cambio el servidor devuelve un vale de un solo uso, que
   * es lo único que se guarda en el teléfono y lo que después autoriza el alta.
   * El vale sobrevive al viaje de ida y vuelta del ingreso con Google, que en
   * el celular se hace por redirección y recarga la página.
   */
  function prepararIngreso() {
    let modo = 'ingresar';

    const tabBotones = UI.$$('#tabs-ingreso [data-modo]');
    const campoClave = $('#campo-clave-admin');
    const entradaClave = $('#entrada-clave-admin');
    const btnValidar = $('#btn-validar-clave');
    const ayudaClave = $('#ayuda-clave-admin');
    const btnIngresar = $('#btn-ingresar');
    const btnGoogle = $('#btn-google');
    const btnOlvide = $('#btn-olvide');

    /** En modo "crear", nada de ingresar hasta que haya vale. */
    function sincronizarModo() {
      const creando = modo === 'crear';
      const habilitado = !creando || !!valeGuardado();

      campoClave.classList.toggle('oculto', !creando);
      btnOlvide.classList.toggle('oculto', creando);
      btnIngresar.disabled = !habilitado;
      btnGoogle.disabled = !habilitado;

      if (creando && habilitado) {
        ayudaClave.textContent = 'Clave validada. Ya podés entrar con Google para abrir la agenda.';
        entradaClave.disabled = true;
        btnValidar.disabled = true;
      } else if (creando) {
        ayudaClave.textContent = 'Para abrir una agenda nueva hace falta la clave del administrador. Pedísela a él: la escribe y no queda guardada.';
        entradaClave.disabled = false;
        btnValidar.disabled = false;
      }
    }

    tabBotones.forEach((boton) => {
      boton.addEventListener('click', () => {
        modo = boton.dataset.modo;
        tabBotones.forEach((b) => b.setAttribute('aria-selected', String(b === boton)));
        pintar($('#error-ingreso'), []);
        sincronizarModo();
      });
    });

    btnValidar.addEventListener('click', async () => {
      const clave = entradaClave.value.trim();
      if (!clave) {
        pintar($('#error-ingreso'), UI.aviso('Escribí la clave del administrador.'));
        return;
      }
      pintar($('#error-ingreso'), []);

      await conCarga(btnValidar, async () => {
        try {
          const respuesta = await API.verificarClaveAlta(clave);
          // La clave se borra apenas se valida: se escribió en un teléfono
          // ajeno y a partir de acá alcanza con el vale.
          entradaClave.value = '';

          if (respuesta.requiere_clave === false) {
            tostada('El backend no tiene clave de alta configurada: el alta está abierta.', 'info');
          } else {
            guardarVale(respuesta.vale);
            tostada('Clave correcta. Entrá con Google para abrir la agenda.', 'exito');
          }
          sincronizarModo();
        } catch (err) {
          pintar($('#error-ingreso'), UI.aviso(mensajeDeError(err)));
        }
      });
    });

    $('#form-ingreso').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#entrada-email').value.trim();
      const clave = $('#entrada-clave').value;
      if (!email || !clave) return;

      pintar($('#error-ingreso'), []);

      await conCarga(btnIngresar, async () => {
        try {
          await Auth.ingresarConEmail(email, clave);
        } catch (err) {
          pintar($('#error-ingreso'), UI.aviso(Auth.mensajeDeError(err)));
        }
      });
    });

    btnGoogle.addEventListener('click', async () => {
      pintar($('#error-ingreso'), []);
      await conCarga(btnGoogle, async () => {
        try {
          await Auth.ingresarConGoogle();
        } catch (err) {
          pintar($('#error-ingreso'), UI.aviso(Auth.mensajeDeError(err)));
        }
      });
    });

    sincronizarModo();

    $('#btn-olvide').addEventListener('click', async () => {
      const email = $('#entrada-email').value.trim();
      if (!email) {
        pintar($('#error-ingreso'), UI.aviso('Escribí tu correo arriba y volvé a tocar acá.'));
        return;
      }
      try {
        await Auth.recuperarClave(email);
        tostada('Te mandamos un correo para reiniciar la contraseña.', 'exito');
      } catch (err) {
        pintar($('#error-ingreso'), UI.aviso(Auth.mensajeDeError(err)));
      }
    });
  }

  /**
   * Engancha la navegación inferior una sola vez.
   *
   * Antes esto vivía dentro de `abrirPanel()`, que corre después de resolver la
   * sesión: entre que la página carga y eso ocurre, los botones estaban a la
   * vista y no respondían.
   */
  function prepararNavegacionInferior() {
    UI.$$('#bottom-nav .nav-item').forEach((boton) => {
      boton.addEventListener('click', () => irA(boton.dataset.tab));
    });
  }

  function prepararAlta() {
    let tipo = 'independiente';

    UI.$$('#form-alta [data-tipo]').forEach((boton) => {
      boton.addEventListener('click', () => {
        tipo = boton.dataset.tipo;
        UI.$$('#form-alta [data-tipo]').forEach((b) => b.setAttribute('aria-pressed', String(b === boton)));
      });
    });

    const entradaClave = $('#entrada-alta-clave-admin');
    const campoClave = $('#campo-alta-clave-admin');

    /**
     * Borra la clave del formulario.
     *
     * La escribe el administrador en el dispositivo del barbero y se va:
     * dejarla en el input significa que queda a la vista de quien apriete
     * "mostrar contraseña" o abra el inspector, en una máquina que no es la
     * suya. Se llama pase lo que pase, también cuando el alta falla.
     */
    const olvidarClave = () => { if (entradaClave) entradaClave.value = ''; };

    /**
     * El campo de la clave solo aparece si NO hay vale.
     *
     * En el camino normal el administrador ya la escribió antes de entrar con
     * Google, así que volver a pedirla sería pedirle que esté dos veces. Queda
     * como salida de emergencia para cuando el vale caducó a mitad del trámite.
     */
    function sincronizarCampoClave() {
      if (campoClave) campoClave.classList.toggle('oculto', !!valeGuardado());
    }
    sincronizarCampoClaveAlta = sincronizarCampoClave;

    $('#form-alta').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = $('#entrada-negocio').value.trim();
      if (!nombre) return;

      pintar($('#error-alta'), []);

      // Ni la clave ni el vale se comparan acá. La única comparación vive en el
      // backend (`exigirClaveDeAlta_`): validar en el navegador obligaría a
      // publicar la clave en config.js, donde la lee cualquiera.
      const autorizacion = { vale: valeGuardado(), clave: (entradaClave?.value || '').trim() };

      await conCarga($('#btn-alta'), async () => {
        try {
          const api = await dueno();
          await api.registrarCuenta(tipo, nombre, autorizacion);
          olvidarClave();
          olvidarVale();          // el vale ya se consumió del lado del servidor
          estado.perfil = await api.getPerfilCuenta();
          await recargarNegocio();
          abrirPanel();
          tostada('¡Listo! Tu agenda ya está publicada.', 'exito');
        } catch (err) {
          olvidarClave();
          // Un vale rechazado ya no sirve: el servidor lo consumió o venció.
          // Dejarlo guardado haría que el campo de la clave siguiera oculto y
          // el alta quedaría trabada sin forma de reintentar.
          if (err.codigo === 'NO_AUTENTICADO') olvidarVale();
          sincronizarCampoClave();
          pintar($('#error-alta'), UI.aviso(mensajeDeError(err)));
        }
      });
    });

    sincronizarCampoClave();
  }

  // ==========================================================================
  // Contexto y Navegación
  // ==========================================================================

  const SECCIONES = [
    { id: 'agenda',       titulo: 'Agenda',       icono: 'calendario',   modulo: 'Agenda' },
    { id: 'servicios',    titulo: 'Servicios',    icono: 'etiqueta',     modulo: 'Servicios' },
    { id: 'equipo',       titulo: 'Equipo',       icono: 'usuarios',     modulo: 'Equipo' },
    { id: 'bloqueos',     titulo: 'Bloqueos',     icono: 'calendario-x', modulo: 'Bloqueos' },
    { id: 'clientes',     titulo: 'Lista negra',  icono: 'prohibido',    modulo: 'Clientes' },
    { id: 'estadisticas', titulo: 'Números',      icono: 'grafico',      modulo: 'Estadisticas' },
    { id: 'ajustes',      titulo: 'Ajustes',      icono: 'ajustes',      modulo: 'Ajustes' }
  ];

  const contenido = () => $('#contenido');

  function cargando(forma = 'lista', cantidad = 3) {
    pintar(contenido(), UI.esqueletoDe(forma, cantidad));
  }

  function encabezado(titulo, descripcion, accion = null) {
    return el('div', { clase: 'fila fila--sep fila--envolver' }, [
      el('div', {}, [
        el('h2', { texto: titulo }),
        el('p', { clase: 'chico apagado', texto: descripcion })
      ]),
      accion
    ]);
  }

  function botonNuevo(texto, alTocar) {
    return el('button', { clase: 'boton boton--primario boton--chico', type: 'button', onClick: alTocar },
      [ico('mas', 'ico ico--sm'), document.createTextNode(texto)]);
  }

  function campo(etiqueta, control, ayuda = null) {
    const id = 'c-' + Math.random().toString(36).slice(2, 8);
    control.id = id;
    return el('div', { clase: 'campo' }, [
      el('label', { clase: 'campo__etiqueta', htmlFor: id, texto: etiqueta }),
      control,
      ayuda ? el('span', { clase: 'campo__ayuda', texto: ayuda }) : null
    ]);
  }

  function tarjetaMetrica(etiqueta, valor) {
    return el('div', { clase: 'tarjeta tarjeta--compacta pila pila--sm' }, [
      el('div', { clase: 'metrica__valor', texto: valor }),
      el('div', { clase: 'metrica__etiqueta', texto: etiqueta })
    ]);
  }

  function selectorDeRango(rango, alCambiar) {
    const hoy = UI.hoyIso();
    const atajos = [
      ['Hoy', hoy, hoy],
      ['Mañana', UI.sumarDias(hoy, 1), UI.sumarDias(hoy, 1)],
      ['Próximos 7 días', hoy, UI.sumarDias(hoy, 6)],
      ['Este mes', primerDiaDelMes(), ultimoDiaDelMes()],
      ['Últimos 30 días', UI.sumarDias(hoy, -29), hoy]
    ];

    const desde = el('input', { clase: 'entrada', type: 'date', value: rango.desde });
    const hasta = el('input', { clase: 'entrada', type: 'date', value: rango.hasta });

    const aplicar = () => {
      if (!desde.value || !hasta.value) return;
      if (hasta.value < desde.value) {
        tostada('La fecha de fin es anterior a la de inicio.', 'error');
        return;
      }
      alCambiar({ desde: desde.value, hasta: hasta.value });
    };

    desde.addEventListener('change', aplicar);
    hasta.addEventListener('change', aplicar);

    return el('div', { clase: 'tarjeta tarjeta--compacta pila pila--sm' }, [
      el('div', { clase: 'filter-chips' }, atajos.map(([texto, d, h]) =>
        el('button', {
          clase: 'chip-item' + (rango.desde === d && rango.hasta === h ? ' active' : ''),
          type: 'button', texto,
          onClick: () => alCambiar({ desde: d, hasta: h })
        }))),
      el('div', { clase: 'fila fila--envolver' }, [
        el('span', { clase: 'chico tenue', texto: 'Del' }), desde,
        el('span', { clase: 'chico tenue', texto: 'al' }), hasta
      ])
    ]);
  }

  function botonDeTurno(icono, titulo, accion, variante = '') {
    const boton = el('button', {
      clase: `boton-ico boton-ico--chico${variante ? ' boton-ico--' + variante : ''}`,
      type: 'button', title: titulo, 'aria-label': titulo,
      onClick: async () => {
        boton.disabled = true;
        try {
          await accion();
        } catch (err) {
          tostada(mensajeDeError(err), 'error');
        } finally {
          boton.disabled = false;
        }
      }
    }, [ico(icono, 'ico ico--sm')]);
    return boton;
  }

  const contextoModulo = {
    estado,
    dueno,
    recargarNegocio,
    contenido,
    cargando,
    encabezado,
    botonNuevo,
    campo,
    tarjetaMetrica,
    selectorDeRango,
    botonDeTurno,
    irA
  };

  function abrirPanel() {
    $('#titulo-panel').textContent = estado.perfil.nombre_negocio;
    document.title = `Panel · ${estado.perfil.nombre_negocio}`;

    const url = `${CONFIG.URL_SITIO}?n=${estado.perfil.slug}`;
    pintar($('#acciones-link'), [
      el('button', {
        clase: 'boton boton--secundario boton--chico', type: 'button',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(url);
            tostada('Link copiado. Compartilo con tus clientes.', 'exito');
          } catch (err) {
            tostada('No pudimos copiarlo: ' + url, 'error');
          }
        }
      }, [ico('copiar', 'ico ico--sm'), document.createTextNode('Copiar link de reservas')]),
      el('a', {
        clase: 'boton boton--contorno boton--chico', href: url, target: '_blank', rel: 'noopener'
      }, [ico('compartir', 'ico ico--sm'), document.createTextNode('Ver mi página')])
    ]);

    pintar($('#nav-secciones'), SECCIONES.map((s) =>
      el('button', {
        clase: 'nav-pildora__item', type: 'button', role: 'tab',
        'aria-selected': String(estado.seccion === s.id),
        onClick: () => irA(s.id)
      }, [ico(s.icono, 'ico ico--sm'), document.createTextNode(s.titulo)])
    ));

    mostrarVista('panel');
    irA(estado.seccion);
  }

  function irA(id) {
    estado.seccion = id;
    UI.$$('#nav-secciones .nav-pildora__item').forEach((boton, i) =>
      boton.setAttribute('aria-selected', String(SECCIONES[i].id === id)));

    UI.$$('#bottom-nav .nav-item').forEach((boton) => {
      boton.classList.toggle('active', boton.dataset.tab === id);
    });

    // La píldora seleccionada puede quedar fuera de la franja visible: en un
    // celular entran tres de las siete secciones. Sin esto, tocar "Ajustes" en
    // la navegación inferior deja la píldora activa fuera de pantalla y parece
    // que no se seleccionó nada.
    const activa = $('#nav-secciones [aria-selected="true"]');
    if (activa) {
      try {
        activa.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      } catch (err) {}
    }

    const sec = SECCIONES.find((s) => s.id === id);
    if (sec && window.PanelModulos && window.PanelModulos[sec.modulo]) {
      window.PanelModulos[sec.modulo].render(contextoModulo);
    }
  }

  iniciar();
})();
