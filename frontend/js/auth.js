/**
 * Autenticación con Firebase, envuelta para que el resto del panel no dependa
 * del SDK.
 *
 * El ingreso con Google crea el usuario de Firebase solo, la primera vez. Eso es
 * deliberado y no hay que cerrarlo: autenticarse no da acceso a nada: el que
 * decide si existe una agenda es el backend, que exige la clave maestra en
 * `registrarCuenta`. Por eso este módulo no necesita exponer `crearConEmail`.
 *
 * El ID token NUNCA se guarda en localStorage: se pide con `getIdToken()` en
 * cada llamada al backend y vive solo en memoria. El SDK ya persiste su propio
 * refresh token en IndexedDB, que es donde corresponde; copiar el ID token a
 * localStorage solo agregaría una credencial de larga vida legible por
 * cualquier script de la página.
 */

const Auth = (() => {

  let iniciado = false;

  function inicializar() {
    if (iniciado) return;
    if (!window.firebase || !firebase.auth) {
      throw new Error('No se cargó el SDK de Firebase.');
    }
    firebase.initializeApp(CONFIG.FIREBASE);
    iniciado = true;
  }

  /**
   * Los mensajes del SDK vienen en inglés y hablan de "credenciales" y
   * "identity toolkit". Se traducen a algo que un dueño de barbería entienda.
   */
  const MENSAJES = {
    'auth/invalid-email': 'Ese correo no parece válido.',
    'auth/user-disabled': 'Esta cuenta está deshabilitada.',
    'auth/user-not-found': 'No hay ninguna cuenta con ese correo.',
    'auth/wrong-password': 'La contraseña no es correcta.',
    'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Probá ingresando.',
    'auth/weak-password': 'La contraseña tiene que tener al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos y probá de nuevo.',
    'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Habilitá las ventanas emergentes.',
    'auth/network-request-failed': 'No pudimos conectarnos. Revisá tu conexión.',
    'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase. Agregalo en Authentication → Settings → Dominios autorizados.',
    'auth/operation-not-supported-in-this-environment': 'Este navegador no admite esa forma de ingreso. Probá con el correo y la contraseña.',
    'auth/operation-not-allowed': 'Ese método de ingreso no está habilitado en Firebase.',
    // Solo aparece si alguien cerró "Enable create" en la consola de Firebase.
    // No es la configuración esperada: con el registro cerrado, el ingreso con
    // Google deja de funcionar para todo negocio nuevo.
    'auth/redirect-sin-sesion': 'El navegador bloqueó el ingreso con Google. Permití las ventanas emergentes para este sitio, o entrá con correo y contraseña.',
    'auth/admin-restricted-operation': 'El registro está cerrado en Firebase. Habilitá "Enable create" en Authentication → Settings.'
  };

  function mensajeDeError(err) {
    if (err && err.code && MENSAJES[err.code]) return MENSAJES[err.code];
    return (err && err.message) || 'No pudimos completar el ingreso.';
  }

  /** Se dispara al cargar la página y en cada login/logout. */
  function alCambiar(callback) {
    inicializar();
    firebase.auth().onAuthStateChanged(callback);
  }

  const usuario = () => (iniciado ? firebase.auth().currentUser : null);

  /**
   * Token fresco para el backend.
   * `getIdToken()` renueva solo si está por vencer, así que llamarlo en cada
   * request es barato y evita el NO_AUTENTICADO por token vencido en una
   * sesión larga.
   */
  async function token() {
    const u = usuario();
    if (!u) throw new Error('No hay sesión iniciada.');
    return u.getIdToken();
  }

  const ingresarConEmail = (email, clave) =>
    firebase.auth().signInWithEmailAndPassword(email, clave);

  /** Marca que salimos a Google por redirección, para detectar la vuelta vacía. */
  const MARCA_REDIRECCION = 'volviendo_de_google';

  /**
   * Ingreso con Google.
   *
   * Ventana emergente PRIMERO, en el celular también, y redirección solo si el
   * navegador bloquea la ventana. Es al revés de lo que parece razonable, y el
   * motivo es concreto:
   *
   * `signInWithRedirect` deja de funcionar cuando la página no vive en el mismo
   * dominio que el `authDomain` de Firebase — que es exactamente el caso al
   * publicar en GitHub Pages. Los navegadores que particionan el almacenamiento
   * por sitio (Safari desde iOS 16, Chrome con cookies de terceros
   * bloqueadas) descartan el estado que Firebase deja antes de irse a Google, y
   * al volver la sesión no queda iniciada. Lo peor es que no tira ningún error:
   * el usuario vuelve al formulario, igual que antes, sin explicación. Ese es
   * el síntoma de "en el celular no me deja entrar con Google".
   *
   * La ventana emergente no depende de ese estado. Los navegadores móviles la
   * abren como pestaña y la cierran solas al terminar; la bloquean solo si no
   * la disparó un gesto del usuario, y acá siempre sale de un toque en el
   * botón. Para el caso en que igual la bloqueen queda la redirección.
   */
  function ingresarConGoogle() {
    const proveedor = new firebase.auth.GoogleAuthProvider();

    return firebase.auth().signInWithPopup(proveedor).catch((err) => {
      // Solo se cae a la redirección cuando el navegador NO dejó abrir la
      // ventana. Si el usuario la cerró a propósito, insistir mandándolo a otra
      // página sería pelearle.
      const bloqueada = [
        'auth/popup-blocked',
        'auth/operation-not-supported-in-this-environment',
        'auth/web-storage-unsupported'
      ].indexOf(err && err.code) >= 0;

      if (!bloqueada) throw err;

      try {
        sessionStorage.setItem(MARCA_REDIRECCION, '1');
      } catch (e) {}
      return firebase.auth().signInWithRedirect(proveedor);
    });
  }

  /**
   * Resultado del ingreso por redirección, al volver de Google.
   *
   * La sesión en sí llega sola por `onAuthStateChanged`; esto se pide para
   * enterarse de los errores, que de otro modo se pierden en la navegación y
   * dejan al usuario de vuelta en el formulario sin ninguna explicación.
   *
   * Y hay un caso que no llega ni como error: la redirección que vuelve sin
   * usuario y sin excepción, que es como se manifiesta el bloqueo de
   * almacenamiento de terceros. Por eso se deja una marca antes de salir: si al
   * volver está la marca y no hay sesión, se devuelve un error propio en vez de
   * dejar la pantalla muda.
   */
  function resultadoRedireccion() {
    inicializar();

    let volviamos = false;
    try {
      volviamos = sessionStorage.getItem(MARCA_REDIRECCION) === '1';
      sessionStorage.removeItem(MARCA_REDIRECCION);
    } catch (e) {}

    return firebase.auth().getRedirectResult().then((resultado) => {
      if (volviamos && !(resultado && resultado.user) && !firebase.auth().currentUser) {
        const err = new Error(
          'El navegador bloqueó el ingreso con Google al volver de la pantalla de Google. ' +
          'Probá permitiendo las ventanas emergentes para este sitio, o entrá con correo y contraseña.');
        err.code = 'auth/redirect-sin-sesion';
        throw err;
      }
      return resultado;
    });
  }

  const recuperarClave = (email) => firebase.auth().sendPasswordResetEmail(email);

  const salir = () => firebase.auth().signOut();

  return {
    alCambiar, usuario, token, mensajeDeError, resultadoRedireccion,
    ingresarConEmail, ingresarConGoogle, recuperarClave, salir
  };
})();
