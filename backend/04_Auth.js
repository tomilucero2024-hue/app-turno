/**
 * Verificación de los ID tokens de Firebase.
 *
 * Por qué Identity Toolkit y no `oauth2.googleapis.com/tokeninfo`:
 * ese endpoint valida ID tokens de OAuth de Google, pero los ID tokens de
 * Firebase los firma `securetoken@system.gserviceaccount.com`, así que no los
 * reconoce. El endpoint correcto es `accounts:lookup`, que además devuelve el
 * perfil del usuario en la misma llamada.
 *
 * La API key web de Firebase es pública por diseño (viaja en el frontend de
 * todas formas), así que vivir en las propiedades del script no le agrega
 * ninguna exposición.
 */

var URL_LOOKUP = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

/**
 * Decodifica el payload de un JWT SIN verificar la firma.
 *
 * Se usa solo como filtro barato previo: descartar acá un token vencido o de
 * otro proyecto evita una llamada de red y consume menos de los 20.000
 * UrlFetch diarios. La verificación real es siempre la de la red.
 */
function decodificarJwtSinVerificar_(idToken) {
  try {
    var partes = String(idToken).split('.');
    if (partes.length !== 3) return null;
    var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[1])).getDataAsString();
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

/**
 * Verifica un ID token y devuelve {uid, email}.
 * Cachea el resultado 5 minutos: el token de Firebase dura una hora, así que
 * la ventana de caché es conservadora frente a su vencimiento real.
 */
function verificarToken_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 20) {
    throw errorApp_(ERR.NO_AUTENTICADO, 'Falta el token de sesión.');
  }

  var payload = decodificarJwtSinVerificar_(idToken);
  if (!payload) {
    throw errorApp_(ERR.NO_AUTENTICADO, 'El token de sesión no tiene un formato válido.');
  }

  var ahoraSeg = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < ahoraSeg) {
    throw errorApp_(ERR.NO_AUTENTICADO, 'La sesión venció. Volvé a iniciar sesión.');
  }

  var proyecto = proyectoFirebase_();
  if (proyecto && payload.aud && payload.aud !== proyecto) {
    throw errorApp_(ERR.NO_AUTENTICADO, 'El token no pertenece a esta aplicación.');
  }

  var cache = CacheService.getScriptCache();
  var clave = claveCacheToken_(idToken);
  var cacheado = cache.get(clave);
  if (cacheado) {
    return JSON.parse(cacheado);
  }

  var respuesta = UrlFetchApp.fetch(URL_LOOKUP + '?key=' + encodeURIComponent(apiKeyFirebase_()), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true
  });

  var codigo = respuesta.getResponseCode();
  var cuerpo = respuesta.getContentText();

  if (codigo !== 200) {
    // Identity Toolkit devuelve 400 con INVALID_ID_TOKEN / USER_NOT_FOUND para
    // tokens inválidos, revocados o de usuarios borrados.
    //
    // El motivo real queda solo del lado del servidor: al usuario se le muestra
    // un mensaje genérico, pero sin este log un error de configuración (API key
    // mal copiada, Identity Toolkit deshabilitado) es indistinguible de un
    // token vencido, y los dos se ven como "volvé a iniciar sesión". El cuerpo
    // de la respuesta no incluye la clave.
    console.error('Identity Toolkit respondió ' + codigo + ': ' + cuerpo);
    throw errorApp_(ERR.NO_AUTENTICADO, 'La sesión no es válida. Volvé a iniciar sesión.');
  }

  var datos;
  try {
    datos = JSON.parse(cuerpo);
  } catch (err) {
    throw errorApp_(ERR.INTERNO, 'Respuesta inesperada del servicio de autenticación.');
  }

  if (!datos.users || !datos.users.length || !datos.users[0].localId) {
    throw errorApp_(ERR.NO_AUTENTICADO, 'La sesión no es válida. Volvé a iniciar sesión.');
  }

  var usuario = {
    uid: String(datos.users[0].localId),
    email: String(datos.users[0].email || '')
  };

  cache.put(clave, JSON.stringify(usuario), LIMITES.CACHE_TOKEN_SEG);
  return usuario;
}

/**
 * Clave de caché derivada del token.
 * Se guarda el hash y no el token: si alguien llega a inspeccionar el caché,
 * no se lleva credenciales reutilizables.
 */
function claveCacheToken_(idToken) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8);
  return 'tok_' + Utilities.base64EncodeWebSafe(digest);
}

/**
 * Resuelve el usuario y la cuenta a partir del token.
 *
 * Este es el único camino por el que el backend obtiene un `id_cuenta` para
 * operar: nunca se acepta uno que venga del frontend, porque cualquiera podría
 * mandar el de otro negocio.
 */
function contextoAutenticado_(params) {
  var usuario = verificarToken_(params && params.token);
  var cuenta = cuentaPorUid_(usuario.uid);
  if (!cuenta) {
    throw errorApp_(ERR.SIN_CUENTA, 'Este usuario todavía no tiene un negocio registrado.');
  }
  return { usuario: usuario, cuenta: cuenta };
}

/** Igual que el anterior pero admite que el usuario aún no tenga cuenta. */
function contextoUsuario_(params) {
  var usuario = verificarToken_(params && params.token);
  return { usuario: usuario, cuenta: cuentaPorUid_(usuario.uid) };
}
