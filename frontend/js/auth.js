/**
 * Autenticación con Firebase, envuelta para que el resto del panel no dependa
 * del SDK.
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
    'auth/operation-not-allowed': 'Ese método de ingreso no está habilitado en Firebase.'
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

  const crearConEmail = (email, clave) =>
    firebase.auth().createUserWithEmailAndPassword(email, clave);

  /**
   * Ingreso con Google.
   *
   * En el celular la ventana emergente no sirve: Safari en iOS la bloquea por
   * defecto y varios navegadores la abren como pestaña aparte que vuelve
   * vacía, así que el ingreso queda colgado sin error. La redirección usa la
   * misma pestaña y es el camino soportado ahí. En escritorio se queda el
   * popup, que no hace perder lo que haya en pantalla.
   *
   * `pointer: coarse` distingue el dedo del mouse mejor que mirar el user
   * agent, que miente y hay que ir parchando con cada navegador nuevo.
   */
  function ingresarConGoogle() {
    const proveedor = new firebase.auth.GoogleAuthProvider();
    if (window.matchMedia('(pointer: coarse)').matches) {
      return firebase.auth().signInWithRedirect(proveedor);
    }
    return firebase.auth().signInWithPopup(proveedor);
  }

  /**
   * Resultado del ingreso por redirección, al volver de Google.
   *
   * La sesión en sí llega sola por `onAuthStateChanged`; esto se pide para
   * enterarse de los errores, que de otro modo se pierden en la navegación y
   * dejan al usuario de vuelta en el formulario sin ninguna explicación.
   */
  function resultadoRedireccion() {
    inicializar();
    return firebase.auth().getRedirectResult();
  }

  const recuperarClave = (email) => firebase.auth().sendPasswordResetEmail(email);

  const salir = () => firebase.auth().signOut();

  return {
    alCambiar, usuario, token, mensajeDeError, resultadoRedireccion,
    ingresarConEmail, crearConEmail, ingresarConGoogle, recuperarClave, salir
  };
})();
