# App de Turnos

App web para agendar turnos en barberías. El cliente reserva sin crear cuenta; el dueño gestiona todo desde un dashboard.

Backend en **Google Apps Script** sobre **Google Sheets**, frontend estático en **GitHub Pages**, autenticación con **Firebase Auth**. Costo fijo: cero.

La arquitectura completa, con las decisiones y sus motivos, está en [`docs/arquitectura-app-turnos.md`](docs/arquitectura-app-turnos.md).

## Estado

| Parte | Estado |
|---|---|
| Backend Apps Script + Sheets | ✅ Completo |
| Tests de la lógica de disponibilidad | ✅ 50 tests |
| Test de humo del router y la validación | ✅ 19 tests |
| Cliente de API del frontend | ✅ Completo |
| Pantalla de reserva del cliente (Combos, Calendario, .ics, PWA) | ✅ Completo |
| Dashboard del dueño (Buscador, Filtros, CSV, Perfil, Módulos) | ✅ Completo |
| Despliegue y conexión con el backend | ⬜ Pendiente |

## Estructura

```
backend/     Google Apps Script. Los prefijos numéricos fijan el orden de carga.
  00_Config.js            Constantes, esquemas de las hojas (incluye Turnos_Historico), lectura de secretos
  01_Utils.js             Errores, respuestas, ids, fechas, validación IANA
  02_Disponibilidad.js    Lógica pura del cálculo de horarios (buffer time, unión multi-barbero)
  03_Sheets.js            Acceso a datos, normalización y creación de planillas
  04_Auth.js              Verificación de ID tokens de Firebase
  05_AntiAbuso.js         Turnstile, rate limiting, lista negra
  10_EndpointsPublicos.js Grupo 1: cliente final, combos de servicios, cualquier barbero
  11_EndpointsDueno.js    Grupo 2: dueño, gestión y archivado de turnos históricos
  12_EndpointsCuenta.js   Grupo 3: registro, perfil comercial y sincronización de timezone
  99_Main.js              doGet / doPost y tabla de rutas
  Instalacion.js          instalar(), verificarInstalacion(), datos de ejemplo

frontend/    Sitio estático + PWA. Sin build, sin dependencias: se abre tal cual.
  index.html              Pantalla de reserva del cliente
  panel.html              Panel del dueño
  _demo.html              Hub de prueba interactivo local
  manifest.json           Web App Manifest para instalación PWA
  sw.js                   Service Worker con caché para carga instantánea
  css/estilo.css          Tokens, reset y el fondo aurora
  css/componentes.css     Tarjetas de vidrio, botones, formularios, listas, calendarios
  js/config.js            ÚNICO archivo a tocar al desplegar (URLs y claves públicas)
  js/api.js               Cliente de la API + link de comprobante por WhatsApp
  js/ui.js                Helpers de DOM, fechas, formatos, diálogos, máscaras, .ics y CSV
  js/auth.js              Firebase Auth envuelto para el resto del panel
  js/reserva.js           Flujo servicios múltiples → profesional → día → hora → datos
  js/panel-agenda.js      Módulo de agenda con buscador en tiempo real y filtro por barbero
  js/panel-servicios.js   Módulo de gestión de catálogo de servicios
  js/panel-equipo.js      Módulo de gestión de profesionales y horarios semanales
  js/panel-bloqueos.js    Módulo de bloqueos de agenda puntuales o por día
  js/panel-clientes.js    Módulo de lista negra y control de teléfonos
  js/panel-estadisticas.js Módulo de métricas de facturación y exportación a CSV
  js/panel-ajustes.js     Módulo de perfil comercial, buffer de turnos y archivado
  js/panel.js             Orquestador central del panel y autenticación

tests/                    Tests en Node, sin dependencias
docs/                     Documento de arquitectura
```

El frontend no usa framework ni empaquetador a propósito: son archivos que GitHub Pages sirve tal cual, sin un paso de build que pueda romperse. El estilo se apoya en dos ideas — un fondo *aurora* de manchas de luz difuminadas y tarjetas de vidrio que lo dejan pasar con `backdrop-filter` — y todos los colores salen de variables CSS en `:root`, así que cambiar la paleta de una marca es tocar un solo bloque.

Apps Script evalúa los archivos en orden alfabético dentro de un único ámbito global, por eso los prefijos numéricos: una constante tiene que existir antes de que otro archivo la use al cargarse.

## Tests

```bash
npm test
```

No hay dependencias: son dos scripts de Node.

- `tests/disponibilidad.test.js` prueba el cálculo de horarios (grilla, horario partido, solapamientos, bloqueos, antelación mínima). Es posible porque `02_Disponibilidad.js` no toca ningún servicio de Apps Script.
- `tests/router.test.js` carga todo el backend en un sandbox con los servicios de Google simulados y verifica que el proyecto compile, que el router resuelva todos sus handlers y que ningún camino de error rompa el contrato `{ok, data|error}`.

## Puesta en marcha

### 1. Firebase

1. Crear un proyecto en [Firebase](https://console.firebase.google.com).
2. Authentication → habilitar **Correo/contraseña** y **Google**.
3. Authentication → Settings → **User actions** → destildar **Enable create (sign-up)**. Esto cierra el registro público: nadie puede darse de alta solo, las cuentas las crea el administrador. Ver [Dar de alta un negocio](#dar-de-alta-un-negocio).
4. Anotar la **Web API Key** y el **Project ID** (Configuración del proyecto).
5. Authentication → Settings → **Dominios autorizados**: agregar el dominio propio. De fábrica solo vienen `localhost` y los dos de Firebase, así que cualquier otro origen —el dominio de producción, o la IP de la PC en la red local para probar desde el celular— falla con `auth/unauthorized-domain`. El campo acepta también direcciones IP, pero conviene tratarlas como algo temporal: el router puede asignar otra.

### 2. Apps Script

1. Crear un proyecto nuevo en [script.google.com](https://script.google.com).
2. Subir el código:
   ```bash
   npm install -g @google/clasp
   clasp login
   cp backend/.clasp.json.ejemplo .clasp.json   # y pegar el scriptId
   npm run push
   ```
3. Configuración del proyecto → **Propiedades del script**, cargar:

   | Propiedad | Obligatoria | Para qué |
   |---|---|---|
   | `FIREBASE_API_KEY` | Sí | Verificar los ID tokens contra Identity Toolkit |
   | `FIREBASE_PROJECT_ID` | Sí | Validar el `aud` del token |
   | `TURNSTILE_SECRET` | En producción | Verificación anti-spam. Vacío = desactivada |
   | `CLAVE_ALTA_ADMIN` | En producción | Clave que autoriza abrir una agenda nueva. Vacía = alta abierta |
   | `DRIVE_FOLDER_ID` | No | Carpeta donde agrupar las planillas de los negocios |
   | `MASTER_SPREADSHEET_ID` | Automática | La escribe `instalar()` |

4. Ejecutar `instalar()` una vez desde el editor. Crea la planilla maestra y guarda su id.
5. Ejecutar `verificarInstalacion()` y revisar el log.
6. **Implementar → Nueva implementación → Aplicación web**, con:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
7. Copiar la URL `/exec` en `URL_BACKEND` dentro de `frontend/js/config.js`.

> Al publicar cambios después, **editar la implementación existente** (lápiz → Versión: Nueva). Si se crea una implementación nueva, la URL cambia y hay que actualizar el frontend.

### 3. Cloudflare Turnstile

Crear un widget gratuito en el panel de Cloudflare. La *site key* va en `TURNSTILE_SITE_KEY` dentro de `frontend/js/config.js`, la *secret key* en la propiedad de script `TURNSTILE_SECRET`.

Es la capa anti-abuso principal: Apps Script no expone la IP del cliente, así que limitar por IP no es posible, y el límite por teléfono se esquiva cambiando de número.

Las dos mitades van juntas: con `TURNSTILE_SECRET` cargado y sin *site key* en el frontend, toda reserva falla con `VERIFICACION_FALLIDA`; con las dos vacías la verificación queda desactivada, que es lo cómodo para desarrollar y lo inaceptable para publicar.

### Clave de alta

`CLAVE_ALTA_ADMIN` es lo que impide que alguien con sesión de Firebase abra una agenda: el backend la exige en `registrarCuenta` antes de crear nada. Con la propiedad vacía, el alta queda abierta.

`CONFIG.CLAVE_ADMIN`, en `frontend/js/config.js`, es un espejo opcional de esa clave que sirve para mostrar el error sin ir al servidor. **No protege nada**: `config.js` se descarga en el navegador de cualquier visitante, así que la clave queda a la vista y la comparación se saltea desde la consola. Se puede dejar vacía; si se completa, tiene que coincidir con la del script.

### 4. Frontend

Cargar en `frontend/js/config.js` la URL `/exec` del deployment y los datos web de Firebase (`apiKey`, `authDomain`, `projectId`). Es el único archivo que hay que tocar: `api.js` lee la URL de ahí.

Para probarlo en local alcanza con un servidor estático — `python -m http.server 4173 --directory frontend` — y abrir `http://localhost:4173`. Abrir el `index.html` con doble clic no sirve: bajo `file://` el navegador bloquea las llamadas al backend.

Publicado en GitHub Pages, hay que agregar el dominio (`usuario.github.io`) en Firebase → Authentication → Settings → Dominios autorizados, o el ingreso con Google falla solo en producción.

## Dar de alta un negocio

No hay registro autoservicio. El registro público está cerrado en Firebase y la clave maestra la tiene solo el administrador, así que cada negocio entra porque el administrador lo dio de alta. Son dos cosas separadas y las dos las hace él:

**Crear el usuario** (una vez por negocio):

1. Consola de Firebase → **Authentication** → pestaña **Users** → **Add user**.
2. Cargar el correo del dueño de la barbería y una contraseña provisoria.

Esto crea la credencial pero todavía no existe ninguna agenda: si el dueño entrara ahora, vería la pantalla de "Creá tu agenda" y no podría pasar de ahí, porque no tiene la clave maestra.

**Crear la agenda** (el administrador, con la contraseña provisoria que acaba de poner):

3. Entrar a `panel.html` con ese correo y esa contraseña.
4. Aparece la pantalla **Creá tu agenda**. Cargar el nombre del negocio, elegir si trabaja solo o con equipo, y escribir la **clave maestra** — la misma que está en `CLAVE_ALTA_ADMIN`.
5. Al confirmar se crea la planilla del negocio, su slug y un profesional por defecto.
6. Copiar el link de reservas desde el panel y pasárselo al dueño junto con el correo y la contraseña provisoria.

**Entrega**: el dueño entra con esas credenciales y, si quiere, cambia la contraseña con "Olvidé mi contraseña", que le manda un correo de reinicio. La clave maestra nunca sale del administrador: el dueño no la necesita para nada, porque el alta ya está hecha.

Si alguien que no fue dado de alta intenta entrar, Firebase responde `auth/admin-restricted-operation` y el panel le muestra que las cuentas las crea el administrador.

## Contrato de la API

Dos reglas que no se pueden cambiar sin romper la app:

**1. Los POST van con `Content-Type: text/plain;charset=utf-8`.** Con `application/json` el navegador manda antes un preflight `OPTIONS`, que Apps Script no puede responder porque solo expone `doGet` y `doPost`. Como el frontend vive en otro origen, todas las escrituras fallarían con un error de CORS.

**2. Apps Script responde siempre HTTP 200.** El éxito y el error viajan en el cuerpo; el frontend nunca debe mirar `response.status`.

```jsonc
// Éxito
{ "ok": true, "data": { } }

// Error
{ "ok": false, "error": { "codigo": "SLOT_OCUPADO", "mensaje": "Ese horario ya no está disponible." } }
```

### Códigos de error

| Código | Significa |
|---|---|
| `ENTRADA_INVALIDA` | Falta un campo o tiene formato incorrecto |
| `NO_AUTENTICADO` | Token ausente, vencido o inválido |
| `SIN_CUENTA` | El usuario está logueado pero no registró un negocio |
| `NO_ENCONTRADO` | Negocio, turno, servicio o barbero inexistente |
| `SLOT_OCUPADO` | El horario se tomó entre la consulta y la reserva |
| `LIMITE_EXCEDIDO` | Rate limiting |
| `TELEFONO_BLOQUEADO` | El teléfono está en la lista negra |
| `VERIFICACION_FALLIDA` | Turnstile rechazó el pedido |
| `FUERA_DE_PLAZO` | Cancelación fuera de la antelación mínima |
| `YA_REGISTRADO` | Ese usuario ya tiene un negocio |
| `SISTEMA_OCUPADO` | No se pudo tomar el lock; reintentar |
| `ACCION_DESCONOCIDA` | La acción no existe en la tabla de rutas |
| `INTERNO` | Error inesperado (el detalle queda solo en los logs del servidor) |

### Acciones

**GET** (lecturas públicas): `getNegocio`, `getDisponibilidad`, `getTurno`

**POST** (escrituras y acciones con token): `crearTurno`, `cancelarTurno`, `getTurnosPorRango`, `cancelarTurnoDueno`, `marcarEstadoTurno`, `crearServicio`, `editarServicio`, `borrarServicio`, `crearBarbero`, `editarBarbero`, `borrarBarbero`, `getHorarios`, `configurarHorarios`, `crearBloqueo`, `borrarBloqueo`, `getBloqueos`, `bloquearTelefono`, `desbloquearTelefono`, `getListaNegra`, `getEstadisticas`, `registrarCuenta`, `getPerfilCuenta`, `actualizarPerfilCuenta`

## Detalles que no son obvios

- **Doble reserva.** `crearTurno` lee y después escribe, y eso no es atómico: Apps Script admite 30 ejecuciones simultáneas. La escritura va dentro de `LockService.getScriptLock()`, con las lecturas caras deliberadamente afuera para que la sección crítica sea corta. El lock es global a todos los negocios porque `getDocumentLock()` solo existe en scripts vinculados a un documento.
- **Duración y precio congelados.** Cada turno guarda su propia `duracion_minutos` y `precio`. Si el dueño edita un servicio, los turnos ya reservados no cambian; si no fuera así, subir "Corte" de 30 a 45 minutos haría que todos los turnos existentes pasaran a solaparse.
- **Fechas y horas como texto.** `YYYY-MM-DD` y `HH:mm` en celdas con formato `@`. Guardarlas como fecha real hace que Sheets y Apps Script las interpreten en zonas horarias distintas y aparezcan corrimientos de un día.
- **Borrado lógico.** Servicios y barberos se marcan `activo = false`, nunca se borra la fila: hay turnos históricos que los referencian.
- **`id_cuenta` sale del token.** Ningún endpoint lo acepta del frontend, `registrarCuenta` incluido — ahí el `firebase_uid` también sale del token verificado.
- **El código de ticket es el único secreto.** 10 caracteres sin `0`, `O`, `1`, `I` ni `L`, para poder dictarlo por teléfono. No se pide junto al `id_turno`, así que no hay nada enumerable que sirva de punto de partida.
- **Una fila ilegible ocupa, no desaparece.** Las columnas de fecha y hora se guardan con formato `@`, pero si alguna pierde ese formato Sheets reinterpreta `11:00` como una hora y la devuelve como `11:00:00`. La versión anterior descartaba en silencio toda fila que no calzara con `HH:mm`, así que el día entero figuraba libre y se podían reservar turnos encima de otros: pasó de verdad. Ahora la lectura de celdas tolera esas variantes (`aMinutosDeCelda`, `aFechaIsoDeCelda`, `mismaFecha`) y, si aun así una fila no se puede interpretar, se bloquea el día completo y se registra el motivo en los logs. Bloquear un día es visible y el dueño lo reclama; una doble reserva se descubre con las dos personas paradas en el local. La validación de lo que manda el cliente sigue siendo estricta: por la API solo entra `HH:mm`.

- **Ninguna fecha leída de la planilla se compara como cadena cruda.** Es la misma falla que la anterior, en otros tres lugares donde estaba latente. `"1/9/2026" >= "2026-09-01"` es `false`, así que un bloqueo cuya celda perdió el formato no aplicaba a **ningún** día —unas vacaciones cargadas se evaporaban y el negocio volvía a ofrecer turnos—, y un turno en ese estado desaparecía de la agenda del dueño y de las estadísticas aunque siguiera ocupando el horario. Todo pasa ahora por `aFechaIsoDeCelda`. Ante una fecha que no se puede interpretar, cada lugar elige el lado seguro *de su propio riesgo*: la disponibilidad bloquea el día, la agenda muestra el turno en todos los rangos (esconderlo es como no tenerlo, y el dueño necesita verlo para arreglar la celda) y las estadísticas lo excluyen, porque la facturación tiene que ser exacta.

- **El formato `@` se fija fila por fila, no de una vez.** `prepararHoja_` formatea las filas que existen al crear la planilla: 999 en una hoja nueva. A partir del turno número mil las filas caían fuera de ese rango y Sheets volvía a interpretar la fecha y la hora — a unos diez turnos por día, la bomba explotaba a los cuatro meses. `agregarFila_` ya no usa `appendRow`: agranda la grilla si hace falta y aplica el formato **antes** de escribir. El orden importa; si primero se escribe `09:00` en una celda sin formato, Sheets ya la convirtió en una hora y aplicarle `@` después muestra el número de serie. Cuesta una lectura extra por inserción, que ocurre dentro del lock, y solo escribe el formato cuando falta.
- **Horario partido.** `Horarios_disponibles` admite varias filas por barbero y día. Una sola franja no puede representar 9-13 y 16-20.

- **El editor de horarios lee de la planilla, no del navegador.** `configurarHorarios` reemplaza la semana completa del profesional, así que el editor tiene que partir de lo que hay guardado. Antes partía de lo último guardado en *ese* navegador (`localStorage`): abrir el panel desde el celular mostraba la semana entera vacía y guardar borraba los horarios reales sin ningún aviso. `getHorarios` marca cada franja con un flag `legible`, que no significa "la fila está bien" sino "el editor puede mostrarla y volver a guardarla tal cual": quedan afuera las que `ventanasDelDia` ya descarta y las que terminan a las 24:00, que son válidas para el cálculo pero que `<input type="time">` no representa ni `exigirHora_` aceptaría de vuelta. El editor las muestra igual, con el texto crudo de la celda, avisando que guardar las elimina — si no, el dueño pierde una ventana dos veces: primero en la agenda y después en la planilla.
- **Toda espera tiene señal.** Apps Script arranca en frío y la primera llamada puede tardar varios segundos. El cliente de API cuenta los pedidos en vuelo y avisa por suscripción (`API.alCambiarActividad`); `ui.js` engancha ahí una barra de progreso global, que aparece recién a los 180 ms para que las respuestas rápidas no parpadeen. Las pantallas completas además dibujan esqueletos con la forma de lo que viene (`UI.esqueletoDe`), y `UI.pintar` hace entrar el contenido con una animación corta para que se note el cambio. Bajo `prefers-reduced-motion` el barrido del esqueleto y la barra no se apagan: se cambian por un latido de opacidad, porque lo que molesta de esas animaciones es el desplazamiento, y un indicador de carga inmóvil deja de ser un indicador.
- **Google Sign-In según el dispositivo.** En escritorio va por ventana emergente; donde el puntero es grueso (`pointer: coarse`, o sea el dedo) va por redirección, porque iOS bloquea la emergente y otros navegadores la abren en una pestaña que vuelve vacía y deja el ingreso colgado sin error. Al volver de la redirección hay que pedir `getRedirectResult()`: la sesión llega sola por `onAuthStateChanged`, pero el error no.
- **Notificaciones.** `MailApp` está descartado a propósito: sus 100 mails diarios son una cuota de la instalación entera, no de cada negocio, así que se divide entre todas las barberías en lugar de escalar con ellas.

## Rendimiento

Medido contra el deployment real, con la planilla tibia:

| Llamada | Tiempo |
|---|---|
| Ida y vuelta sin tocar ninguna planilla | ~1 s |
| Con la planilla maestra abierta y leída | ~2 s |
| Arranque en frío del script | 3 a 5 s |

El piso de ~1 s es de la plataforma y no se puede bajar: es lo que tarda Apps Script en despachar un pedido. Lo que sí se puede evitar es todo lo que se repetía encima de ese piso.

- **La resolución de la cuenta se cachea** (`CacheService`, 5 minutos, por slug y por uid). Antes, cada llamada —pública o del dueño— abría la planilla maestra y leía la hoja `Cuentas` entera solo para traducir un slug. Era medio segundo largo en todos los endpoints.
- **`getNegocio` se cachea por slug.** Servicios y profesionales cambian unas pocas veces por mes y los lee cada visitante. Toda alta, baja o edición invalida la clave, así que el dueño ve sus cambios enseguida.
- **`getPerfilCuenta` devuelve el negocio adentro**, así el panel abre con una llamada en vez de dos encadenadas.
- **La pantalla de reserva recuerda la disponibilidad** de cada combinación profesional + servicio + día por 45 segundos, y mientras el cliente mira un día va adelantando en segundo plano los tres siguientes. Es solo para que la pantalla responda: lo que evita una doble reserva es la verificación del backend al confirmar, bajo lock.
- **Los turnos NO se cachean.** Son el dato que cambia a cada minuto y el único donde servir algo viejo tiene consecuencias reales.

## Cuotas (cuenta gratuita de Gmail)

| Límite | Valor |
|---|---|
| Tiempo por ejecución | 6 min |
| Ejecuciones simultáneas | 30 |
| Llamadas `UrlFetch` | 20.000 / día |
| Tiempo total de triggers | 90 min / día |

Son techos globales, no por negocio.
