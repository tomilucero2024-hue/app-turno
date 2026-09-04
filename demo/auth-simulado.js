/**
 * Reemplazo de `frontend/js/auth.js` para el modo demo del servidor local.
 *
 * El servidor lo sirve EN LUGAR del archivo real cuando corre con `--demo`. El
 * archivo de producción no se toca ni se copia: se intercambia la respuesta.
 *
 * Existe porque el panel no se puede mirar de otra forma en una máquina de
 * desarrollo. Entrar de verdad pide un proyecto de Firebase con `localhost`
 * entre los dominios autorizados y una cuenta ya dada de alta contra el backend
 * real; sin eso el panel se queda para siempre en la pantalla de ingreso y no
 * hay nada que ver.
 *
 * Expone exactamente la misma superficie que el módulo real —las nueve
 * funciones que consume `panel.js`— así que el panel no sabe que está hablando
 * con una sesión de mentira. La "sesión" es una marca en sessionStorage: dura
 * lo que dura la pestaña y se corta con "Cerrar sesión", para poder recorrer el
 * ingreso y la salida y no solamente el panel ya abierto.
 */

const Auth = (() => {

  const CLAVE_SESION = 'demo_sesion_email';
  const EMAIL_POR_DEFECTO = 'demo@barberia.test';

  let avisar = null;

  const leerEmail = () => {
    try { return sessionStorage.getItem(CLAVE_SESION) || ''; } catch (e) { return ''; }
  };
  const guardarEmail = (email) => {
    try { sessionStorage.setItem(CLAVE_SESION, email); } catch (e) {}
  };
  const borrarEmail = () => {
    try { sessionStorage.removeItem(CLAVE_SESION); } catch (e) {}
  };

  const usuarioDe = (email) => (email ? {
    email,
    uid: 'uid-demo',
    getIdToken: () => Promise.resolve('token-de-demo')
  } : null);

  const usuario = () => usuarioDe(leerEmail());

  function notificar() {
    if (avisar) avisar(usuario());
  }

  function alCambiar(callback) {
    avisar = callback;
    // Asíncrono a propósito: el real llega por `onAuthStateChanged`, y el panel
    // dibuja su pantalla de carga antes de recibirlo. Resolver en el mismo tick
    // escondería ese estado y con él cualquier error que solo aparezca ahí.
    setTimeout(notificar, 150);
  }

  /** El demo no valida nada: cualquier correo con una clave de 6+ entra. */
  function ingresarConEmail(email, clave) {
    if (!email || String(clave || '').length < 6) {
      const err = new Error('La contraseña tiene que tener al menos 6 caracteres.');
      err.code = 'auth/weak-password';
      return Promise.reject(err);
    }
    guardarEmail(String(email));
    notificar();
    return Promise.resolve({ user: usuario() });
  }

  function ingresarConGoogle() {
    guardarEmail(EMAIL_POR_DEFECTO);
    notificar();
    return Promise.resolve({ user: usuario() });
  }

  const resultadoRedireccion = () => Promise.resolve(null);

  const token = () => {
    const u = usuario();
    return u ? u.getIdToken() : Promise.reject(new Error('No hay sesión iniciada.'));
  };

  const recuperarClave = () => Promise.resolve();

  function salir() {
    borrarEmail();
    notificar();
    return Promise.resolve();
  }

  const mensajeDeError = (err) =>
    (err && err.message) || 'No pudimos completar el ingreso.';

  console.info(
    '%c MODO DEMO ', 'background:#C5A059;color:#141414;font-weight:bold',
    'La sesión del panel es simulada y los datos viven en memoria. ' +
    'Entrá con cualquier correo y una contraseña de 6 caracteres, o con el botón de Google.');

  return {
    alCambiar, usuario, token, mensajeDeError, resultadoRedireccion,
    ingresarConEmail, ingresarConGoogle, recuperarClave, salir
  };
})();
