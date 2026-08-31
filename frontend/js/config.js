/**
 * Configuración del frontend. Es el ÚNICO archivo que hay que tocar al
 * desplegar: todo lo demás lo lee de acá.
 *
 * Nada de esto es secreto. La API key de Firebase y la site key de Turnstile
 * son públicas por diseño — viajan igual en cualquier página que las use, y lo
 * que protege la cuenta son las reglas de Firebase y el secreto de Turnstile,
 * que vive solo en las Propiedades del Script del backend.
 */

const CONFIG = {
  /**
   * URL /exec del deployment de Apps Script.
   * Al publicar una versión nueva hay que EDITAR el deployment existente
   * ("Administrar implementaciones" -> lápiz -> Versión: Nueva). Si se crea uno
   * nuevo, la URL cambia y hay que actualizarla acá.
   */
  URL_BACKEND: 'https://script.google.com/macros/s/AKfycbxVzl0uEhrncMkUtCiMJ-pD7QgpudajGfNxDdiiLERxWzJ-QuBgTy3sY1kH0F3EYXvb/exec',

  /**
   * Configuración web del proyecto de Firebase (Configuración -> Tus apps).
   * Van solo las tres claves que necesita Authentication: `storageBucket`,
   * `messagingSenderId` y `appId` son para Storage y para las notificaciones
   * push, que esta app no usa.
   */
  FIREBASE: {
    apiKey: 'AIzaSyDTkk5YIBEEySaVeIJoJcyijMuicFc5HB8',
    authDomain: 'app-turno-2030.firebaseapp.com',
    projectId: 'app-turno-2030'
  },

  /**
   * Site key del widget de Cloudflare Turnstile.
   * Vacío = no se muestra el widget. Solo sirve para desarrollo: si el backend
   * tiene TURNSTILE_SECRET cargado y acá no hay site key, toda reserva falla
   * con VERIFICACION_FALLIDA.
   */
  TURNSTILE_SITE_KEY: '',

  /** Cuántos días hacia adelante se ofrecen en la tira de fechas. */
  DIAS_A_MOSTRAR: 21,

  /**
   * Clave maestra que el panel pide antes de abrir una agenda nueva.
   *
   * ESTO NO ES UNA MEDIDA DE SEGURIDAD y no puede serlo: este archivo se
   * descarga entero en el navegador de cualquier visitante, así que la clave
   * queda a la vista y la comparación se saltea desde la consola. Sirve para
   * dar el error al instante, sin ir al servidor.
   *
   * Quien autoriza de verdad es el backend, comparando contra la propiedad de
   * script `CLAVE_ALTA_ADMIN`. Esa es la que hay que cargar; esta se puede
   * dejar vacía y el flujo sigue funcionando igual (el error llega desde el
   * servidor en vez de al instante). Si la ponés, tiene que coincidir.
   */
  CLAVE_ADMIN: ''
};

/** URL pública de la pantalla de reserva, para los comprobantes de WhatsApp. */
CONFIG.URL_SITIO = location.origin + location.pathname.replace(/panel\.html$/, 'index.html');
