# App de Turnos — Documento de Arquitectura

> Versión 2 — incorpora las correcciones de la revisión técnica.
> Los cambios respecto de la v1 están marcados con **[v2]**.

## 1. Resumen del proyecto

App web para agendar turnos, pensada inicialmente para barberías de barrio (barberos independientes o barberías con varios profesionales). El cliente final reserva sin necesidad de crear cuenta. El dueño del negocio tiene un dashboard propio para gestionar turnos, servicios, barberos y horarios.

**Objetivo de costos:** cero gasto fijo para el desarrollador. Único gasto: dominio propio (~$8.500 ARS/año).

**Criterio de costos [v2]:** en una arquitectura multi-tenant, un recurso gratuito cuya cuota pertenece a la cuenta del desarrollador se agota a medida que crecen los negocios, porque todos consumen del mismo pozo. Antes de adoptar cualquier servicio gratuito hay que preguntarse si la cuota **se divide** entre los negocios o **escala** con ellos. Si se divide, no sirve — salvo que el costo sea trasladable al negocio.

---

## 2. Stack tecnológico

| Capa | Herramienta | Costo | Rol |
|---|---|---|---|
| Frontend | HTML / CSS / JS | Gratis | Interfaz que ve el cliente y el dueño |
| Hosting frontend | GitHub Pages | Gratis | Publica el sitio, nunca se duerme |
| Dominio | Dominio propio | ~$8.500 ARS/año | Imagen profesional, reemplaza URL de github.io |
| Backend | Google Apps Script | Gratis | Lógica de negocio, procesa pedidos del frontend |
| Base de datos | Google Sheets | Gratis | Guarda cuentas, barberos, servicios, turnos |
| Autenticación | Firebase Authentication (plan Spark) | Gratis (hasta 50k usuarios/mes) | Login del dueño (email/contraseña + Google Sign-In) |
| Anti-abuso **[v2]** | Cloudflare Turnstile | Gratis (ilimitado) | Verificación de humano antes de crear un turno |
| Control de versiones | GitHub + `clasp` **[v2]** | Gratis | Versiona frontend **y backend** |

**Descartado y por qué:**
- Supabase + Render: planes gratis con "sleep" por inactividad, generarían fricción o gasto.
- Node.js + servidor propio: requiere proceso corriendo 24/7 → gasto fijo mensual.
- Firebase Cloud Functions: requiere plan Blaze (tarjeta cargada, sin tope de gasto).
- SMS/WhatsApp Business API: tiene costo por mensaje — queda como mejora futura opcional, a cargo del barbero/barbería.
- **`MailApp` de Apps Script [v2]:** aunque es gratis, da 100 destinatarios por día **para toda la instalación**, no por negocio. Con 20 barberías serían 5 avisos diarios cada una. Es una cuota que se divide, no que escala. Descartado.

---

## 3. Modelo multi-tenant

Dos tipos de cuenta:
- **Barbero independiente:** un solo profesional, un solo calendario.
- **Barbería completa:** un negocio con varios barberos, cada uno con su calendario, bajo un mismo dashboard general.

Jerarquía: **Cuenta → Barberos → Turnos**

Cada negocio se identifica en la URL mediante un slug por parámetro:

```
tudominio.com/reservar?negocio=barberia-juan
```

El slug es único a nivel global. Su unicidad se valida **dentro de un lock** al registrar la cuenta, porque dos registros simultáneos con el mismo nombre de negocio pisarían el mismo slug. **[v2]**

---

## 4. Modelo de datos

**[v2] Corrección estructural:** la v1 decía "cada negocio tiene su propia pestaña, con sub-hojas adentro". Eso no existe en Google Sheets — una pestaña no contiene pestañas.

El modelo real es: **una planilla (spreadsheet) completa por negocio**, creada automáticamente por Apps Script a partir de una plantilla al registrarse. El `spreadsheet_id` de esa planilla se guarda en la hoja maestra `Cuentas`. Ventajas:

- Aislamiento real: un bug no puede mezclar datos entre negocios.
- Evita el techo de 10 millones de celdas por planilla.
- Cada negocio puede eventualmente ser dueño de su propia planilla (ver sección 11).

### Planilla maestra — Hoja `Cuentas` (única, compartida)

| Columna | Descripción |
|---|---|
| id_cuenta | Identificador único |
| tipo | independiente / barberia |
| nombre_negocio | Nombre visible |
| slug | Identificador en la URL (único global) |
| email | Email de contacto |
| firebase_uid | UID del usuario en Firebase Auth |
| spreadsheet_id | **[v2]** ID de la planilla propia del negocio |
| zona_horaria | **[v2]** Por defecto `America/Argentina/Buenos_Aires` |
| paso_grilla_min | **[v2]** Granularidad de la grilla de turnos (por defecto 15) |
| antelacion_min_horas | **[v2]** Antelación mínima para reservar (por defecto 1) |
| cancelacion_min_horas | **[v2]** Hasta cuántas horas antes se puede cancelar (por defecto 2) |
| activo | **[v2]** Borrado lógico de la cuenta |
| fecha_alta | **[v2]** Auditoría |

### Planilla por negocio — hojas:

**Barberos**

| Columna | Descripción |
|---|---|
| id_barbero | Identificador único |
| nombre | Nombre del profesional |
| activo | **[v2]** Borrado lógico — nunca se borra la fila, porque hay turnos históricos que la referencian |

**Servicios**

| Columna | Descripción |
|---|---|
| id_servicio | Identificador único |
| nombre | Ej: "Corte", "Barba" |
| duracion_minutos | Duración del servicio |
| precio | Precio (opcional mostrar al cliente) |
| activo | **[v2]** Borrado lógico |

**Horarios_disponibles**

| Columna | Descripción |
|---|---|
| id_barbero | A qué barbero corresponde |
| dia_semana | 0=domingo … 6=sábado |
| hora_inicio | Hora de apertura (`HH:mm`) |
| hora_fin | Hora de cierre (`HH:mm`) |

**[v2] Se admiten varias filas por barbero y día.** Una sola fila por día solo puede representar una ventana continua, y el horario partido típico (9-13 y 16-20) necesita dos. El algoritmo de disponibilidad recorre todas las ventanas del día.

**Bloqueos**

| Columna | Descripción |
|---|---|
| id_bloqueo | **[v2]** Identificador único, para poder borrarlo |
| id_barbero | Barbero afectado (o `todos`) |
| fecha_inicio | Desde (`YYYY-MM-DD`) |
| fecha_fin | Hasta (`YYYY-MM-DD`, inclusive) |
| hora_inicio | **[v2]** Opcional. Vacío = todo el día |
| hora_fin | **[v2]** Opcional. Vacío = todo el día |
| motivo | Vacaciones, feriado, turno médico, etc. |

**[v2]** Sin las horas no se puede bloquear "el martes de 14 a 16", que es el caso más frecuente después de las vacaciones.

**Turnos**

| Columna | Descripción |
|---|---|
| id_turno | Identificador único (aleatorio, **no secuencial**) **[v2]** |
| codigo_ticket | Código de autogestión, 10 caracteres, **único secreto** **[v2]** |
| id_barbero | Profesional asignado |
| id_servicio | Servicio reservado |
| servicio_nombre | **[v2]** Snapshot del nombre al momento de reservar |
| duracion_minutos | **[v2]** Snapshot de la duración |
| precio | **[v2]** Snapshot del precio |
| cliente_nombre | Nombre del cliente |
| cliente_telefono | Teléfono del cliente (normalizado a solo dígitos) |
| fecha | Fecha del turno (`YYYY-MM-DD`, **texto**) |
| hora | Hora de inicio (`HH:mm`, **texto**) |
| hora_fin | **[v2]** Hora de fin, precalculada |
| estado | confirmado / cancelado / completado / no_asistio **[v2]** |
| creado_en | **[v2]** Timestamp ISO, para auditoría y rate limiting |
| cancelado_por | **[v2]** cliente / dueno / sistema |

**[v2] Por qué el snapshot de duración y precio es obligatorio:** si el dueño edita "Corte" de 30 a 45 minutos, todos los turnos ya reservados que apuntan a ese `id_servicio` cambiarían de duración retroactivamente y pasarían a solaparse entre sí. La duración de un turno tiene que quedar congelada al momento de reservarlo. El precio, además, es lo único de donde `getEstadisticas` puede sacar la facturación histórica.

**[v2] Por qué fecha y hora van como texto:** Sheets convierte las celdas de fecha a objetos `Date` usando la zona horaria del archivo, y Apps Script las lee en la zona horaria del script. Si no coinciden, aparecen corrimientos de un día. Guardar `YYYY-MM-DD` y `HH:mm` como cadenas elimina la clase entera de bugs.

**Lista_negra**

| Columna | Descripción |
|---|---|
| telefono | Número bloqueado por abuso (normalizado) |
| fecha_bloqueo | Cuándo se bloqueó |
| motivo | **[v2]** Por qué |

---

## 5. Endpoints del backend (Apps Script)

**[v2] Contrato de transporte.** Tres reglas que condicionan todo el diseño:

1. **Apps Script no puede devolver códigos de estado HTTP.** `ContentService` responde siempre 200. Por lo tanto **toda** respuesta lleva la forma `{ok: true, data: ...}` o `{ok: false, error: {codigo, mensaje}}`, y el frontend nunca mira `response.status`.

2. **Los POST van con `Content-Type: text/plain;charset=utf-8`**, con el JSON stringificado en el body. Usar `application/json` dispara un preflight `OPTIONS` que Apps Script no puede responder (solo soporta `doGet` y `doPost`, no existe `doOptions`), y como el frontend vive en otro origen, **todas las escrituras fallarían**. El backend parsea con `JSON.parse(e.postData.contents)`.

3. **Las lecturas públicas van por GET** con parámetros de query — son requests simples, no disparan preflight, y se pueden cachear.

### Grupo 1 — Cliente final (sin login)

| Endpoint | Método | Recibe | Devuelve |
|---|---|---|---|
| `getNegocio` | GET | slug | Nombre, servicios activos, barberos activos, config pública |
| `getDisponibilidad` | GET | slug, id_barbero, id_servicio, fecha | Horarios de inicio libres |
| `crearTurno` | POST | slug, id_barbero, id_servicio, fecha, hora, cliente_nombre, cliente_telefono, turnstile_token | Confirmación + codigo_ticket, o error |
| `getTurno` **[v2]** | GET | slug, codigo_ticket | Datos del turno |
| `cancelarTurno` (cliente) | POST | slug, codigo_ticket | Confirmación |

**[v2] `getDisponibilidad` ahora recibe `id_servicio`**, porque los horarios libres dependen de la duración del servicio: un hueco de 30 minutos sirve para un corte pero no para corte+barba.

**[v2] `getTurno` no existía** aunque la sección de autogestión prometía "consultar o cancelar".

**[v2] El `codigo_ticket` reemplaza al par `id_turno + codigo_ticket`.** Si `id_turno` fuera secuencial, un atacante lo enumera y fuerza bruta un código de 5 caracteres. Ahora el código es de 10 caracteres sobre un alfabeto sin ambigüedades, es el único secreto, y los intentos fallidos están limitados por rate limiting.

### Grupo 2 — Dueño del negocio (con login)

| Endpoint | Método | Recibe | Devuelve |
|---|---|---|---|
| `getTurnosPorRango` | POST | rango fechas, token | Lista de turnos |
| `crearServicio` / `editarServicio` / `borrarServicio` | POST | datos servicio, token | Confirmación |
| `crearBarbero` / `editarBarbero` / `borrarBarbero` **[v2]** | POST | datos barbero, token | Confirmación |
| `getHorarios` | POST | token, id_barbero (opcional) | Franjas guardadas, con un flag `legible` por fila |
| `configurarHorarios` | POST | id_barbero, horarios, token | Confirmación |
| `crearBloqueo` / `borrarBloqueo` **[v2]** | POST | id_barbero, fechas, horas, motivo, token | Confirmación |
| `cancelarTurno` (dueño) | POST | id_turno, token | Confirmación |
| `marcarEstadoTurno` **[v2]** | POST | id_turno, estado, token | Confirmación |
| `bloquearTelefono` / `desbloquearTelefono` **[v2]** | POST | telefono, token | Confirmación |
| `getEstadisticas` | POST | rango, token | Resumen numérico |

**[v2] Los endpoints del Grupo 2 ya no reciben `id_cuenta`.** Se deriva siempre del token. Recibirlo era una invitación a olvidarse de validarlo.

**[v2] `marcarEstadoTurno`** habilita `completado` y `no_asistio`, sin los cuales `getEstadisticas` no puede decir nada útil y la lista negra pierde su disparador natural.

### Grupo 3 — Cuenta / registro

| Endpoint | Método | Recibe | Devuelve |
|---|---|---|---|
| `registrarCuenta` | POST | tipo, nombre_negocio, **token** | id_cuenta + slug (dispara creación de la planilla) |
| `getPerfilCuenta` | POST | token | Datos de configuración de la cuenta |
| `actualizarPerfilCuenta` **[v2]** | POST | config, token | Confirmación |

**[v2] Corrección de seguridad:** la v1 hacía que `registrarCuenta` recibiera el `firebase_uid` **desde el frontend**. Cualquiera podía enviar un uid arbitrario y crear o reclamar la cuenta de otro usuario. El uid se deriva ahora del token verificado, igual que en el Grupo 2.

**Regla de seguridad:** todo endpoint del Grupo 2 y 3 exige `token` de Firebase. El `id_cuenta` sobre el que se opera se deriva del token verificado — nunca se confía en un `id_cuenta` que venga del frontend.

---

## 6. Flujo de autenticación

**Login del dueño:** email/contraseña o Google Sign-In (ambos vía Firebase Authentication, gratis).

**Paso a paso:**

1. Dueño inicia sesión → Firebase le devuelve un ID token (JWT).
2. Frontend guarda el token en memoria y lo envía con cada pedido al backend.
3. Apps Script verifica el token contra
   `POST https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=FIREBASE_WEB_API_KEY`
   con body `{"idToken": "..."}`. **[v2]**
4. Si es válido, obtiene el `localId` (el uid) y busca en `Cuentas` qué `id_cuenta` le corresponde.
5. Ejecuta la acción pedida, limitada a esa `id_cuenta`.

**[v2] Corrección:** la v1 no especificaba el endpoint. El candidato intuitivo, `oauth2.googleapis.com/tokeninfo`, **no sirve** para ID tokens de Firebase: están firmados por `securetoken@system.gserviceaccount.com`, no por el emisor OAuth de Google. El endpoint correcto es `accounts:lookup` de Identity Toolkit. La API key web de Firebase es pública por diseño, así que puede vivir en el script sin riesgo.

**[v2] Caché de verificación.** Cada request autenticado agrega un round-trip de red encima del arranque en frío de Apps Script, y consume de los 20.000 `UrlFetch`/día. Se cachea en `CacheService` el mapa `hash(token) → {uid, id_cuenta, spreadsheet_id}` por 5 minutos. El token de Firebase dura 1 hora, así que 5 minutos es conservador.

**[v2] Dominios autorizados.** El dominio propio hay que agregarlo en Firebase → Authentication → Settings → Authorized domains, o Google Sign-In falla en producción aunque funcione en local.

---

## 7. Reglas de negocio — Anti-abuso

**[v2] Se elimina el estado `pendiente` del MVP.** La v1 decía que el turno quedaba pendiente y expiraba a los 15-30 minutos si no se confirmaba, pero no existía ningún endpoint de confirmación ni nada en el flujo del cliente que lo disparara. Además: liberar el turno exigía un trigger temporal (que consume de los 90 min/día de triggers), y mientras estuviera pendiente tenía que contar como ocupado — con lo cual un spammer bloqueaba la agenda igual. El turno se crea directamente en `confirmado`, y el esfuerzo va al anti-abuso real.

Capas activas en el MVP (todas gratuitas):

1. **Cloudflare Turnstile [v2].** Es la capa principal. El widget corre en el frontend y devuelve un token; el backend lo valida contra `https://challenges.cloudflare.com/turnstile/v0/siteverify` con `UrlFetchApp`. Gratis, sin límite de verificaciones, y es la única capa que un script automatizado no atraviesa. Se puede desactivar por configuración durante el desarrollo.

2. **Rate limiting por teléfono** (vía `CacheService`): máximo 3 reservas por teléfono por hora, y máximo 10 consultas fallidas por `codigo_ticket` por hora.

3. **Lista negra manual:** el dueño puede bloquear un teléfono desde el dashboard.

4. **Antelación mínima:** no se puede reservar dentro de la próxima hora (configurable), lo que corta la reserva-y-cancelación instantánea.

**[v2] Lo que NO se puede hacer:** limitar por IP. Apps Script no expone la IP del cliente en el objeto `e` de `doPost`. La v1 lo daba por hecho. El límite por teléfono se falsea escribiendo otro número, y por eso Turnstile pasa a ser la capa que realmente sostiene el sistema.

**[v2] `CacheService` es best-effort:** máximo 6 horas de retención y las entradas pueden ser desalojadas antes. Sirve para rate limiting (donde perder una entrada solo relaja el límite un rato) y para caché, pero nunca para datos que deban ser confiables.

**Mejora futura (no en el MVP):** verificación por WhatsApp/SMS antes de confirmar el turno. Queda como feature paga, a cargo del gasto del barbero/barbería (nunca del cliente final ni del desarrollador).

---

## 8. Concurrencia — el problema de la doble reserva

**[v2] Sección nueva.** Es el riesgo técnico más serio del MVP y la v1 no lo mencionaba.

`crearTurno` lee la disponibilidad y después escribe la fila. Eso **no es atómico**, y Apps Script permite hasta 30 ejecuciones simultáneas por usuario. Dos clientes que tocan "Reservar" sobre el mismo horario en el mismo instante generan dos turnos superpuestos. En una app de turnos eso no es un caso borde: es exactamente el bug que hace que el negocio deje de usarla.

**Solución:** `LockService.getScriptLock()` con `waitLock(20000)` alrededor de la sección crítica.

**Por qué el lock es de script y no de documento:** `LockService.getDocumentLock()` solo funciona en scripts vinculados a un documento. El nuestro es standalone porque administra muchas planillas, así que solo dispone del script lock, que serializa las escrituras de **todos** los negocios.

**Por qué eso igual está bien:** una barbería hace del orden de 20 reservas por día. Aun con cientos de negocios, la tasa de escritura queda muy por debajo de lo que un lock serializado aguanta. El patrón correcto es hacer las lecturas caras **fuera** del lock y dejar adentro solo la re-verificación del conflicto y el append:

```
1. (sin lock)  leer horarios, bloqueos y turnos del día → calcular slots libres
2. (sin lock)  validar entrada, Turnstile, lista negra, rate limit
3. [ LOCK ]    releer solo los turnos de ese barbero y esa fecha
4. [ LOCK ]    si el slot sigue libre → append de la fila
5. [ /LOCK ]
```

Si en el paso 3 el slot ya fue tomado, se devuelve `SLOT_OCUPADO` y el frontend refresca la grilla.

---

## 9. Cálculo de disponibilidad

**[v2] Sección nueva** — la v1 no definía cómo se generan los horarios ofrecidos, que es el corazón del sistema.

Entrada: las ventanas de `Horarios_disponibles` del barbero para ese día de la semana, los `Bloqueos` que tocan esa fecha, los turnos no cancelados de ese barbero ese día, y la duración del servicio elegido.

Algoritmo:

1. Tomar cada ventana de trabajo del día (puede haber más de una: horario partido).
2. Generar horarios candidatos cada `paso_grilla_min` minutos (por defecto 15) desde el inicio de la ventana.
3. Descartar el candidato si `[inicio, inicio + duracion_servicio)` **no entra completo** dentro de la ventana.
4. Descartar si se solapa con algún turno existente (`confirmado`, `completado` y `no_asistio` ocupan; `cancelado` libera).
5. Descartar si se solapa con un bloqueo (de ese barbero o de `todos`).
6. Descartar si empieza antes de `ahora + antelacion_min_horas`.

**Por qué grilla fija en lugar de encadenar por duración:** una grilla de 15 minutos con verificación de "entra completo" permite ofrecer las 10:15 para un servicio de 45 minutos sin dejar huecos muertos, y no depende del orden en que se hicieron las reservas previas.

**[v2] Este cálculo vive en `Disponibilidad.js`, sin ninguna dependencia de `SpreadsheetApp`.** Es la única parte del backend con lógica no trivial, y aislarla permite testearla con Node en `tests/`, cosa que dentro de Apps Script es impracticable.

---

## 10. Autogestión del cliente sin cuenta

Al confirmar la reserva se genera un `codigo_ticket` único de 10 caracteres sobre el alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin `0`, `O`, `1`, `I` ni `L`, para que se pueda dictar por teléfono sin confusión). Con ese código el cliente puede consultar o cancelar su turno sin necesidad de cuenta.

**Envío del comprobante — Camino A (link `wa.me`, gratis, sin API paga):**

Tras confirmar la reserva, la pantalla de éxito muestra un botón tipo "Enviarme los datos por WhatsApp". Este botón arma un link con el formato:

```
https://wa.me/?text=<mensaje_codificado>
```

El `mensaje_codificado` es el texto (URL-encoded) con los datos del turno:

```
Turno confirmado ✅
Negocio: {nombre_negocio}
Barbero: {nombre_barbero}
Servicio: {nombre_servicio}
Fecha: {fecha} - Hora: {hora}
Código de ticket: {codigo_ticket}
Para cancelar, ingresá a {url_del_sitio} con este código.
```

Al tocar el botón se abre WhatsApp (web o app) con el mensaje pre-cargado. El botón **no envía nada automáticamente**: el clic final de "enviar" lo hace el cliente. No requiere backend adicional ni WhatsApp Business API — es 100% frontend, solo arma la URL con datos que ya están en la pantalla de confirmación.

**Importante para la implementación:** el texto debe pasar por `encodeURIComponent()` antes de insertarse en la URL, para que los saltos de línea y los caracteres especiales no rompan el link.

---

## 11. Operación y límites

**[v2] Sección nueva.**

**Cuotas reales de Apps Script (cuenta gratuita de Gmail):**

| Límite | Valor |
|---|---|
| Tiempo por ejecución | 6 min |
| Ejecuciones simultáneas | 30 |
| Llamadas `UrlFetch` | 20.000 / día |
| Tiempo total de triggers | 90 min / día |
| Destinatarios de mail | 100 / día |

Todos son techos **globales**, no por negocio. Una cuenta de Workspace los amplía, pero eso ya es un costo fijo.

**Latencia.** Apps Script tiene un arranque en frío de 1 a 3 segundos. Sumado a la verificación del token, un request autenticado puede tardar varios segundos la primera vez. El frontend tiene que asumirlo desde el diseño: skeletons, botones deshabilitados mientras se espera, y nunca una pantalla en blanco. Sin esto la app se siente rota aunque funcione perfecto.

**El techo real de la arquitectura** no es el lock de escritura (ver sección 8), sino la latencia de lectura: escanear la planilla entera en cada consulta. Se mitiga cacheando en `CacheService` los datos que casi no cambian (servicios, barberos, horarios) y leyendo rangos acotados en vez de hojas completas.

**Despliegue del backend.** La URL del web app **cambia si se crea un deployment nuevo**. Hay que editar siempre el deployment existente → "Nueva versión". El código se versiona en GitHub con `clasp`; sin eso el backend queda fuera del control de versiones aunque el frontend esté adentro.

**Privacidad.** Las planillas contienen nombres y teléfonos de los clientes de todos los negocios, bajo la cuenta personal del desarrollador. Es PII de terceros (Ley 25.326). Antes de escalar comercialmente conviene evaluar transferir la propiedad de cada planilla al negocio correspondiente, dejando al script con permiso de edición.

**Backup.** Sheets tiene historial de versiones, pero un bug en el script puede borrar filas masivamente. Un trigger diario que copie cada planilla a una carpeta de backup es gratis y cubre el caso.

---

## 12. Pendientes para siguientes iteraciones (fuera del MVP)

- Verificación por WhatsApp/SMS antes de confirmar turno (pago, a cargo del negocio).
- Notificaciones de recordatorio — pendiente de encontrar un canal cuya cuota escale por negocio y no se divida entre todos.
- Varios usuarios por cuenta (hoy `Cuentas` tiene un solo `firebase_uid`; haría falta una hoja `Usuarios`).
- Migración a Node.js / base de datos real si el volumen de negocios crece mucho.
- Dashboard con estadísticas más avanzadas (ingresos, clientes recurrentes).
- Transferencia de propiedad de las planillas a cada negocio.
