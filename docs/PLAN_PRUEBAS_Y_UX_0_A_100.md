# Relevo pruebas completas y mejora de interfaz de 0 a 100

Documento de trabajo para implementar, verificar y publicar Relevo con una API confiable y una consola administrativa adaptable a móvil, tablet y PC.

**Fecha:** 9 de octubre de 2026, America/La_Paz. **Responsables:** desarrollo, diseño y verificación. **Alcance:** FastAPI, autenticación, claves de consumidores, proveedores, modelos, cuotas, selección y fallback, registros, operación y consola React.

El objetivo es que una persona pueda entrar al panel, crear una clave, conectar su aplicación y revocar ese acceso, con resultados comprobados desde el navegador hasta MySQL. Este documento define 100 escenarios de prueba y un plan de ejecución con entregables y condiciones para avanzar. Los 100 puntos del plan representan hitos de trabajo; no equivalen a un porcentaje de cobertura de código ni a pruebas ya aprobadas.

## 1 Estado comprobado y pendientes

| Área | Evidencia disponible | Límite de la evidencia |
|---|---|---|
| Navegador | El último informe `test-results/frontend-test-report.json` registra 7 pruebas aprobadas y 0 fallidas en Chromium. Incluye UI con stubs y llamadas reales a FastAPI. | Backend aislado en SQLite en memoria; no comprueba MySQL ni una imagen desplegada. |
| Flujo de claves | La suite verifica acceso, creación, mostrar/ocultar, respuesta de una sola vez, listado, secreto oculto, revocación y rechazo de la clave revocada. | No comprueba portapapeles del sistema ni una llamada de chat a un proveedor externo. |
| Accesibilidad | axe-core verifica acceso, panel, guía y diálogo de creación; Playwright verifica el ciclo de foco, Escape y retorno del foco. | No incluye lector de pantalla, todos los estados de error ni pruebas manuales WCAG. |
| Móvil y escritorio | El panel autenticado no desborda a 320, 360, 390, 768, 1024 y 1440 px; el cierre de sesión permanece visible en móvil. | No incluye rotación, contenido largo, todos los recorridos en cada ancho ni dispositivos físicos. |
| Backend | 17 pruebas pytest aprobadas. Dos pruebas Playwright adicionales ejercitan FastAPI por HTTP y SQLite independiente con claves de prueba. | SQLite no verifica transacciones, migraciones ni operaciones específicas de MySQL. |
| Compilación y estilo | `npm run build` y `ruff check app tests` completaron correctamente. | La compilación no valida despliegue ni proveedores externos. |
| Operación | El motor Docker no está accesible en este equipo; la suite HTTP local funciona con una base SQLite temporal en memoria. | Sigue pendiente MySQL, migraciones de la imagen final y verificación con proveedor real. |

La última ejecución Playwright se realizó el 9 de octubre de 2026 y aprobó 7/7 pruebas. La última ejecución pytest aprobó 17 pruebas. Son avances parciales: el catálogo T001–T100 continúa sin certificación global y se debe registrar cada caso conforme se implemente.

**Implementado en esta iteración:** API `/console-config` para ofrecer la URL pública configurable mediante `API_PUBLIC_BASE_URL`; estados del panel basados en `/ready`; límites de claves alineados entre React y FastAPI (1–10.000 solicitudes/minuto, nombre y propietario hasta 120 caracteres); salida de sesión que limpia datos sensibles; diálogos accesibles con foco atrapado, Escape y retorno de foco; comprobaciones axe sobre acceso, panel, guía y diálogo; adaptación sin desbordamiento entre 320 y 1440 px; flujo real de navegador y API en una base SQLite en memoria; integración de Playwright en CI.

**Límites funcionales actuales:** `stream: true` responde 501. El enrutador selecciona adaptadores `openai` y `google`; otros adaptadores requieren implementación y verificación antes de anunciarse como disponibles. Proveedores y modelos tienen rutas administrativas, pero la consola actual presenta claves y guía de conexión. La configuración contempla proveedores sin credencial cuando su implementación lo permite; las pruebas no deben exigir una clave externa para todos los proveedores.

## 2 Cómo utilizar Playwright en frontend y backend

Playwright permite comprobar APIs HTTP con `APIRequestContext` y ejecutar acciones reales de navegador. Por ello, la suite propuesta cubre ambas superficies con el mismo ejecutor. Las pruebas unitarias pytest existentes seguirán comprobando lógica interna, como límites de ventanas y normalización de adaptadores. [Referencia oficial sobre pruebas de API](https://playwright.dev/docs/api-testing).

Se necesitan cuatro grupos con propósito explícito:

| Grupo | Sistema utilizado | Qué demuestra |
|---|---|---|
| API | `request.get/post/patch/put/delete` contra FastAPI real y base aislada. La suite local usa SQLite en memoria; la etapa MySQL debe añadirse al entorno de integración. | Contratos HTTP, autorización, ciclo de claves y acceso con clave revocada. La persistencia MySQL permanece pendiente. |
| Interfaz aislada | Navegador y `page.route` para escenarios controlados de demora y error. | Estados del panel, validación, interacción y presentación. |
| Integración completa | Navegador, FastAPI y SQLite en memoria en la suite local; MySQL y proveedor simulado quedan para el entorno dedicado. | El flujo real de acceso, creación y revocación sin interceptar las rutas de Relevo. |
| Verificación de despliegue | Aplicación publicada en un entorno de prueba y proveedor gratuito disponible, cuando esté configurado. | Conectividad real y configuración final; ejecutar bajo demanda con límites pequeños. |

La simulación de proveedores debe ser un servidor HTTP al que llama el adaptador real de Relevo. Debe poder devolver éxito, 429, 5xx, retrasos y respuestas inválidas. Así se prueba la integración del backend sin depender de cuotas, cuentas externas o cambios de catálogo.

### Entorno y datos

1. Crear un MySQL de prueba con base y volumen propios. Las migraciones y el seed se ejecutan contra esa base. No reutilizar la base habitual del proyecto.
2. Arrancar la imagen con el panel compilado y esperar `/health`. Comprobar `/ready` según el caso preparado; puede ser 503 en una prueba que deliberadamente no dispone de modelos.
3. Crear fixtures de administrador activo e inactivo; JWT válido y vencido; claves activas, revocadas y vencidas; modelos habilitados, deshabilitados, con cuotas y en cooldown.
4. Separar datos por ejecución y por worker. Para pruebas del límite por IP, usar ejecución serial y un proceso aislado. Evitar que el límite de login de una prueba contamine otra.
5. Usar credenciales sintéticas. Excluir archivos de sesión del repositorio y limpiar datos al terminar, incluso cuando falle una prueba.
6. Las trazas pueden contener peticiones y secretos. Usar únicamente secretos de prueba en los artefactos; en pruebas con credenciales reales, desactivar capturas sensibles y revisar los informes antes de conservarlos.
7. La sesión del panel está en `sessionStorage`. Un login con el cliente HTTP no inicia automáticamente la sesión del navegador; el recorrido integral debe entrar desde el formulario. No asumir que `storageState` conserva ese almacenamiento.

### Organización propuesta de archivos

```text
web/e2e/
  api/auth.spec.ts
  api/api-keys.spec.ts
  api/providers-models.spec.ts
  api/routing-quotas.spec.ts
  ui/access.spec.ts
  ui/keys.spec.ts
  ui/connection-guide.spec.ts
  ui/accessibility.spec.ts
  ui/responsive.spec.ts
  integrated/consumer-lifecycle.spec.ts
  operations/deployment.spec.ts
  fixtures/test-environment.ts
  fixtures/provider-server.ts
  pages/login.page.ts
  pages/keys.page.ts
```

Esta estructura está propuesta, no creada. Mantener los selectores basados en roles y etiquetas. Usar `data-testid` solo cuando no haya una referencia semántica estable. Esperar estados observables con `expect`, sin pausas fijas. Separar la URL de la API y la URL del panel mediante configuración de pruebas.

## 3 Prioridades y registro de resultados

**P0:** falla que impide acceder, conecta sin autorización, rompe creación o revocación, expone secretos, consume cuotas indebidamente o invalida el flujo principal. **P1:** función importante, recuperación ante errores, accesibilidad o adaptación visual. **P2:** comportamiento complementario o presentación de menor riesgo.

Cada ejecución debe registrar ID, versión del código, entorno, navegador, viewport, datos preparados, resultado, duración y evidencia. Estados permitidos: pendiente, aprobado, fallido, bloqueado y no aplicable con motivo. Una prueba que pasa solo al reintentar se registra como intermitente y se investiga. No convertir un escenario bloqueado en aprobado.

## 4 Catálogo de 100 escenarios

Cada fila expresa una preparación o acción y un resultado esperado. Convertirla en uno o varios casos automatizados cuando el flujo lo necesite. El ID debe aparecer en el título de la prueba para vincular el informe con el documento.

### 4.1 Salud y autenticación

| ID | Prioridad | Preparación y acción | Resultado esperado |
|---|---|---|---|
| T001 | P0 | Consultar `/health` con API iniciada. | 200 y estado `ok`, sin requerir autenticación. |
| T002 | P0 | Consultar `/ready` con MySQL y modelo compatible configurado. | 200; disponibilidad coherente con la configuración. |
| T003 | P0 | Interrumpir MySQL y consultar `/ready`. | 503 controlado, sin credenciales ni detalles internos. |
| T004 | P0 | Preparar cero modelos utilizables y consultar `/ready`. | 503; no afirmar disponibilidad. |
| T005 | P0 | Iniciar sesión con administrador activo y contraseña correcta. | 200, JWT con sujeto y vencimiento; sin devolver contraseña. |
| T006 | P0 | Enviar contraseña incorrecta y correo inexistente. | 401 con mensaje genérico, sin revelar existencia de la cuenta. |
| T007 | P0 | Entrar con administrador inactivo. | 401; no emitir acceso válido. |
| T008 | P1 | Enviar correo inválido y campos requeridos ausentes. | 422; no crear sesión ni ejecutar una acción administrativa. |
| T009 | P0 | Acceder a todas las rutas `/admin/*` protegidas con JWT ausente, alterado o vencido. | 401 en cada ruta; sin cambios en MySQL. |
| T010 | P0 | Hacer seis intentos de login desde la misma IP en 300 segundos. | El sexto devuelve 429 y `Retry-After`; un entorno aislado comprueba recuperación. |

### 4.2 Claves y acceso de consumidores

| ID | Prioridad | Preparación y acción | Resultado esperado |
|---|---|---|---|
| T011 | P0 | Crear una clave como administrador. | 201, ID y secreto con formato `rlv_`; guardado como digest. |
| T012 | P0 | Generar varias claves con nombres diferentes. | Secretos únicos; ninguna colisión ni reutilización. |
| T013 | P1 | Crear con nombre, propietario y límite; consultar la lista. | Metadatos persistidos y correspondientes a la clave creada. |
| T014 | P1 | Crear sin propietario. | Se permite; la lista representa correctamente el dato ausente. |
| T015 | P0 | Crear con nombre vacío o mayor al límite del contrato. | 422; no insertar la clave. |
| T016 | P0 | Enviar límite cero, negativo y un valor no entero. | Validación conforme al contrato; ningún límite inválido almacenado. |
| T017 | P0 | Listar claves después de crearlas. | No incluir secreto ni digest en ninguna fila. |
| T018 | P0 | Usar una clave activa en `/v1/models`. | Acceso autorizado y respuesta del catálogo. |
| T019 | P0 | Usar secreto alterado, formato inválido o cabecera ausente. | 401 y desafío Bearer en rutas de consumidores. |
| T020 | P0 | Revocar una clave existente. | 204; registro conservado como inactivo. |
| T021 | P0 | Usar inmediatamente la clave revocada en modelos y chat. | 401; no contactar al proveedor. |
| T022 | P0 | Preparar una clave vencida y usarla. | 401; no permitir acceso aunque siga activa. |
| T023 | P1 | Revocar ID inexistente y volver a revocar una clave ya inactiva. | 404 para inexistente; repetición de revocación coherente y sin error interno. |
| T024 | P0 | Configurar límite bajo y superar peticiones por minuto. | 429, `Retry-After`; después de la ventana vuelve el acceso. |
| T025 | P0 | Presentar una clave de consumidor como autorización administrativa. | 401; no crear claves ni modificar proveedores o modelos. |

### 4.3 Proveedores y modelos

| ID | Prioridad | Preparación y acción | Resultado esperado |
|---|---|---|---|
| T026 | P1 | Listar proveedores como administrador. | Metadatos completos; ningún valor secreto de entorno. |
| T027 | P1 | Crear y actualizar el mismo slug de proveedor. | Mismo registro actualizado; sin duplicados inesperados. |
| T028 | P0 | Enviar propiedades extra a `ProviderInput`. | 422; contrato cerrado sin modificaciones. |
| T029 | P0 | Deshabilitar proveedor y consultar catálogo y chat. | Sus modelos quedan excluidos de uso, aunque el registro se conserve. |
| T030 | P0 | Habilitar proveedor que requiere credencial y dejarla ausente. | Modelos excluidos; no enviar peticiones anónimas no permitidas. |
| T031 | P1 | Preparar proveedor que admite acceso sin clave en la implementación. | Elegibilidad conforme a esa implementación; sin exigir una credencial artificial. |
| T032 | P0 | Crear un modelo con proveedor existente e inexistente. | 201 cuando existe; 404 cuando falta; sin registros huérfanos. |
| T033 | P1 | Actualizar alias, prioridad, capacidades y estado de un modelo. | Cambios persistidos y reflejados en selección y listado. |
| T034 | P0 | Deshabilitar modelo y pedirlo explícitamente. | No se utiliza; respuesta controlada cuando no queda alternativa compatible. |
| T035 | P1 | Consultar `/v1/models` con estados y credenciales diferentes. | Solo modelos habilitados y elegibles; alias o nombre y proveedor correctos. |
| T036 | P0 | Preparar modelo con adaptador todavía no soportado. | Excluido de selección; no anunciar soporte inexistente. |
| T037 | P0 | Preparar modelo en cooldown y consultar catálogo antes y después del vencimiento. | Exclusión temporal y recuperación conforme al estado. |
| T038 | P1 | Crear, actualizar y listar límites del modelo. | Ventana, métrica y máximo correctos; actualización sin duplicados. |
| T039 | P0 | Enviar ventana, métrica o máximo de cuota inválidos. | 422; contador y configuración conservan integridad. |
| T040 | P1 | Recargar el seed dos veces y reiniciar la API. | Carga idempotente; sin duplicados y con configuración persistida según política definida. |

### 4.4 Chat selección cuotas y observabilidad

| ID | Prioridad | Preparación y acción | Resultado esperado |
|---|---|---|---|
| T041 | P0 | Solicitar chat `model: auto` con un proveedor simulado disponible. | 200 y respuesta compatible con el contrato OpenAI. |
| T042 | P0 | Solicitar nombre y alias explícitos. | Selección compatible con el modelo solicitado. |
| T043 | P0 | Enviar mensajes vacíos o estructura inválida. | Validación HTTP del contrato; ningún consumo externo indebido. |
| T044 | P0 | Solicitar modelo desconocido o sin candidato disponible. | 503 controlado y cabeceras de reintento cuando correspondan. |
| T045 | P0 | Hacer que el primer proveedor devuelva 429 y el segundo éxito. | Fallback, respuesta final correcta y cooldown del primero. |
| T046 | P0 | Simular 5xx, caída de conexión y timeout del proveedor. | Reintentos acotados y alternativa disponible; nunca espera indefinida. |
| T047 | P0 | Hacer fallar todos los proveedores elegibles. | Error normalizado; sin respuesta falsa de éxito ni secretos del upstream. |
| T048 | P0 | Configurar máximo de intentos menor al número de proveedores. | No exceder el máximo de llamadas configurado. |
| T049 | P1 | Variar niveles y prioridad con proveedores exitosos. | Orden de selección correspondiente a la estrategia configurada. |
| T050 | P1 | Ejecutar secuencia suficiente con `weighted_round_robin`. | Distribución determinista esperada en un worker y respeto de niveles. |
| T051 | P0 | Solicitar herramientas, JSON y visión con candidatos incompatibles. | Seleccionar solo candidatos que declaren y soporten esas capacidades. |
| T052 | P0 | Exceder el contexto estimado del modelo. | Excluir candidato antes de llamar al proveedor; resultado controlado. |
| T053 | P0 | Enviar `stream: true` en la versión actual. | 501 explícito. SSE requiere implementación y nuevos criterios antes de activarse. |
| T054 | P0 | Alcanzar cuota de solicitudes por minuto, hora, día y mes. | Rechazo o fallback sin superar el límite persistido. |
| T055 | P0 | Comparar tokens reservados con consumo real. | Ajuste de la reserva sin contadores negativos ni doble contabilización. |
| T056 | P0 | Lanzar peticiones concurrentes cerca de una cuota en MySQL. | Reservas transaccionales; ninguna sobreasignación del límite. |
| T057 | P0 | Provocar fallo tras reservar cuota y reintentar. | Liberación o contabilización conforme a la política documentada, sin fugas de reserva. |
| T058 | P1 | Abrir el circuito, resetear cooldown por API y volver a solicitar. | Estado persistido coherente; recuperación controlada del candidato. |
| T059 | P1 | Obtener chat exitoso con varios intentos. | Cabeceras `X-Relevo-*`, registro de resultado y estadísticas coherentes. |
| T060 | P0 | Inspeccionar registros, errores, estadísticas y `/metrics`. | No incluir claves o contraseñas; prompts ausentes con configuración predeterminada y métricas deshabilitadas con 404. |

### 4.5 Interfaz y estados de interacción

| ID | Prioridad | Preparación y acción | Resultado esperado |
|---|---|---|---|
| T061 | P0 | Entrar desde el formulario usando backend real. | Panel autenticado; carga de claves autorizada sin errores de consola. |
| T062 | P1 | Simular credenciales incorrectas, 429 y conexión interrumpida. | Mensajes comprensibles en español y recuperación disponible. |
| T063 | P0 | Hacer doble clic al entrar o crear una clave. | Una operación efectiva por envío; botón bloqueado durante espera. |
| T064 | P0 | Vencer la sesión y recibir 401 durante una acción. | Regreso al acceso; sesión y datos sensibles limpiados. |
| T065 | P0 | Cerrar sesión, recargar e iniciar otra sesión. | Sin acceso residual, sin secreto anterior y perfil consistente. |
| T066 | P0 | Crear clave desde el diálogo y usarla en una petición real. | Una clave emitida, metadatos visibles y autorización de consumidor válida. |
| T067 | P0 | Revelar, ocultar y cerrar el diálogo del secreto. | Oculto por defecto; no recuperable desde el listado ni tras recargar. |
| T068 | P1 | Copiar secreto con permiso y con permiso denegado. | Copia exacta o alternativa manual clara; no falsa confirmación. |
| T069 | P1 | Buscar por nombre, propietario y prefijo. | Filtrado correcto; estado sin coincidencias y recuperación al limpiar búsqueda. |
| T070 | P1 | Abrir lista vacía, carga lenta y error de listado. | Estados diferenciados; acción de crear o reintentar según corresponda. |
| T071 | P0 | Cancelar y confirmar revocación en el diálogo. | Cancelar conserva acceso; confirmar lo revoca y actualiza el panel. |
| T072 | P1 | Validar campos de creación con valores límite y textos largos. | Reglas alineadas con backend; error junto al campo, sin cortar información. |
| T073 | P1 | Cambiar cURL, Node.js y Python; copiar ejemplos y URL. | URL del servicio correcta y ejemplos de sintaxis utilizable con la clave del usuario. |
| T074 | P1 | Acceder desde dominio de despliegue y desde desarrollo con puerto diferente. | URL pública obtenida de configuración; no inferida únicamente del puerto 5173. |
| T075 | P1 | Cambiar disponibilidad real y entorno del servidor. | Indicador de salud y etiqueta de entorno reflejan datos, incluyendo desconocido y degradado. |

### 4.6 Adaptación visual y accesibilidad

| ID | Prioridad | Preparación y acción | Resultado esperado |
|---|---|---|---|
| T076 | P0 | Recorrer acceso, lista, guía y diálogos a 320 y 360 px. | Sin desplazamiento horizontal de la página ni acciones inaccesibles. |
| T077 | P1 | Repetir recorridos a 390 y 430 px. | Información esencial legible, controles táctiles y cierre de sesión disponible. |
| T078 | P1 | Cambiar orientación en móvil durante un formulario. | Contenido y datos conservados; botón principal alcanzable. |
| T079 | P1 | Abrir a 768 y 1024 px. | Tablet y PC compacto con distribución estable, sin columnas comprimidas. |
| T080 | P1 | Revisar a 1280, 1440 y 1920 px. | Ancho de lectura controlado; lista, guía y jerarquía equilibradas. |
| T081 | P0 | Ampliar texto 200 % y probar reflow a 320 CSS px. | Controles completos y lectura sin desplazamiento en dos direcciones, salvo contenido que realmente lo requiera. |
| T082 | P1 | Usar nombres, propietarios, URLs y errores extensos. | Ajuste de líneas o expansión accesible; sin ocultar acciones. |
| T083 | P0 | Recorrer todo con Tab, Shift+Tab, Enter y Espacio. | Orden lógico, foco visible y ejecución de acciones sin ratón. |
| T084 | P0 | Abrir, recorrer y cerrar diálogos con teclado. | Foco dentro del diálogo, retorno al disparador y Escape conforme a la política del secreto. |
| T085 | P1 | Ejecutar axe sobre todas las pantallas y estados. | Sin infracciones automáticas conocidas; revisión manual complementaria. |
| T086 | P1 | Medir contraste de texto, estados, bordes y foco. | Cumplimiento WCAG 2.2 AA aplicable; estados no comunicados solo por color. |
| T087 | P1 | Medir objetivos táctiles y separación. | Meta de producto de 44 × 44 px para acciones; verificar también criterios WCAG aplicables. |
| T088 | P1 | Activar reducción de movimiento y bloquear fuentes externas. | Animación prescindible; texto y controles funcionales con fuentes de respaldo. |
| T089 | P1 | Emular dispositivo táctil, abrir teclado y desplazar diálogo largo. | Campo y acción principal visibles; considerar áreas seguras y altura dinámica. |
| T090 | P1 | Comparar capturas por navegador y viewport estable. | Sin cambios visuales no revisados, recortes ni superposiciones. |

### 4.7 Integración despliegue y recuperación

| ID | Prioridad | Preparación y acción | Resultado esperado |
|---|---|---|---|
| T091 | P0 | Entrar, crear clave, solicitar chat, revocar y solicitar de nuevo. | Éxito previo a revocación y 401 posterior, con backend y MySQL reales. |
| T092 | P0 | Repetir recorrido integral con 429 del primer proveedor. | Fallback visible en registros y respuesta correcta del segundo. |
| T093 | P0 | Reiniciar API y MySQL después de crear claves y modelos. | Datos persistidos; secretos guardados como digest; estado operativo recuperado. |
| T094 | P0 | Desplegar imagen final desde base limpia con migraciones. | Arranque reproducible, `/console/` y recursos cargados desde el servidor real. |
| T095 | P0 | Verificar cabeceras y peticiones desde origen permitido y no permitido. | Política CORS configurada aplicada; protección de rutas basada en autenticación y cabeceras esperadas. |
| T096 | P1 | Ejecutar recorridos en Chromium, Firefox y WebKit. | Funciones principales aprobadas en los tres motores con informes separados. |
| T097 | P1 | Medir carga con un escenario móvil controlado y lista grande. | Objetivos acordados cumplidos; sin bloqueos de interacción o errores de consola. |
| T098 | P0 | Respaldar y restaurar MySQL de prueba y repetir recorrido crítico. | Restauración utilizable y claves conservadas sin exponer secretos. |
| T099 | P0 | Ejecutar prueba breve con proveedor gratuito real configurado. | Respuesta auténtica; cuota respetada. Si no hay disponibilidad, registrar bloqueo externo. |
| T100 | P0 | Ejecutar suite final y revisar evidencia de publicación. | Todos los P0 aplicables aprobados, incidentes resueltos y aprobación basada en resultados verificables. |

## 5 Plan para mejorar la interfaz

### Hallazgos de código que guían el trabajo

| Hallazgo observado | Acción propuesta | Criterio de aceptación |
|---|---|---|
| `body` exige 360 px de ancho mínimo. | Permitir 320 px y utilizar distribución flexible. | T076 y T081 aprobados. |
| En móvil se oculta `.sidebar-bottom`, que contiene cierre de sesión. | Mantener acceso a cuenta y salida en el menú móvil. | T065 y T077 aprobados desde móvil. |
| Numerosos textos y controles usan entre 7 y 11 px. | Definir escala legible y aumentar áreas de interacción. | Lectura cómoda y T086/T087 aprobados. |
| Salud y entorno aparecen como textos fijos. | Obtener estado real o mostrar desconocido mientras carga. | T075; ninguna afirmación falsa de disponibilidad. |
| El pie presenta una afirmación de cifrado de extremo a extremo. | Describir únicamente garantías implementadas: secreto mostrado una vez y digest almacenado; TLS según despliegue. | Copy revisado y coherente con la arquitectura. |
| URL de integración depende de detectar el puerto 5173. | Añadir URL pública configurable y usarla en todos los ejemplos. | T073/T074 aprobados. |
| Diálogos declaran `aria-modal`, pero no se observa manejo completo de foco y Escape. | Implementar control de foco, retorno y desplazamiento interno. | T084 aprobado, incluyendo teclado virtual. |
| Login no muestra bloqueo de envío en espera. | Añadir estado de envío y prevención de dobles operaciones. | T063 aprobado. |
| Límites del formulario y del backend difieren. | Definir una política común de longitud, propietario y RPM. | T072 y validación HTTP alineadas. |
| El cierre de sesión no limpia explícitamente todas las variables de diálogos y secretos. | Vaciar secreto, diálogos, errores y estado de identidad al terminar la sesión. | T064/T065 aprobados. |

Estos son hallazgos por inspección del código; los escenarios correspondientes deben demostrar su efecto antes y después de la corrección.

### Diseño y navegación

Mantener la identidad verde oscuro, fondo cálido y acento lima. Reducir elementos decorativos cuando compitan con las tareas. Usar títulos descriptivos como “Claves API” y una acción principal “Crear clave”. La prioridad visual será tarea, datos de acceso y estado real del servicio.

En PC, conservar una navegación lateral compacta y un área de contenido con ancho máximo. En tablet, permitir navegación plegable. En móvil, usar encabezado con botón de menú etiquetado, enlaces legibles y acceso permanente a cuenta y salida. Las claves se presentan como tarjetas en móvil con nombre, propietario, prefijo, estado, RPM y acción; ninguno de estos datos esenciales desaparece por falta de ancho.

La guía de conexión se organiza en tres pasos: crear clave, guardarla en el servidor y enviar solicitud. Mostrar URL pública y formato de autenticación junto a ejemplos copiables. Un secreto completo no debe aparecer en la lista ni en los ejemplos almacenados. Las futuras pantallas de proveedores, modelos, límites y estadísticas se añaden cuando exista información utilizable y pruebas de sus operaciones.

### Sistema visual y reglas adaptables

| Elemento | Regla de diseño propuesta |
|---|---|
| Texto principal | 16 px como base; formularios de al menos 16 px en móvil. Texto secundario de 14 px cuando sea información utilizable. |
| Encabezados | Escala fluida con `clamp`; evitar que un título desplace la acción principal fuera del área visible. |
| Botones | Meta de 44–48 px de alto; iconos con nombre accesible. La meta de 44 px es una decisión de producto, superior al mínimo WCAG de 24 px con sus excepciones. |
| Espaciado | Escala común 4, 8, 12, 16, 24, 32 y 48 px. Márgenes móviles de 16–20 px. |
| Contenido | Una columna en móvil; dos columnas cuando ambas mantengan legibilidad; ancho máximo aproximado de 1200 px en PC. |
| Cambios de distribución | Puntos iniciales 480, 768 y 1024 px, ajustados por contenido; probar también los anchos entre ellos. |
| Diálogos | Ancho limitado, altura máxima relativa a `dvh`, desplazamiento interno y botón accesible con teclado abierto. |
| Listados | Tarjetas móviles y filas de escritorio. Para grandes volúmenes, añadir paginación de backend; no descargar indefinidamente toda la lista. |
| Estados | Cargando, vacío, sin coincidencias, error, sin conexión, éxito y permiso vencido con acciones claras. |
| Animación | Breve y funcional; respetar `prefers-reduced-motion`. |

El objetivo de reflow y los mínimos de interacción se basan en [WCAG 2.2 sobre reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) y [tamaño mínimo de objetivos](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum). La auditoría automática se complementa con teclado y lector de pantalla.

### Organización de React

Dividir la pantalla actual en funciones de acceso, claves, guía y estado del servicio. Extraer componentes reutilizables para formulario, botón, diálogo, notificación, lista y estado vacío. Separar el cliente de API de la presentación, normalizar mensajes al español y compartir reglas de validación.

Usar rutas de navegación reales cuando aumenten las pantallas, para conservar ubicación al recargar y soportar enlaces directos. Mantener consultas y sus estados en una capa común de datos; cancelar solicitudes obsoletas y evitar mostrar información de la sesión anterior. La identidad del administrador debe poder restaurarse mediante un contrato del backend, en vez de quedar reemplazada por un nombre genérico después de recargar.

## 6 Etapas de ejecución de 0 a 100

Los intervalos representan la secuencia de entrega. Se cierra una etapa cuando existen implementación y evidencia de sus criterios; no se avanza únicamente porque se hayan consumido días.

| Etapa | Avance | Trabajo y entregable | Responsable principal | Condición para cerrar | Estimación |
|---|---|---|---|---|---|
| E0 | 0–10 | Fixtures y configuración Playwright; servidor API local con SQLite en memoria. | Backend y verificación | API tests y un recorrido real ejecutables con datos limpios. **Parcial:** MySQL y proveedor simulado pendientes. | 1–2 días |
| E1 | 10–25 | Autenticación y ciclo de claves; casos T001–T025. | Backend | P0 de acceso y claves aprobados; secretos ausentes en listas y registros. **Parcial:** login, crear/listar/revocar y protección del secreto están cubiertos; resta ampliar el catálogo. | 3–4 días |
| E2 | 25–40 | Proveedores, modelos, fallback y cuotas; T026–T060. | Backend | Selección y cuotas verificadas en MySQL, incluida concurrencia controlada. | 3–5 días |
| E3 | 40–60 | Sistema visual, navegación adaptable, formularios, diálogos y estados del panel. | Frontend y diseño | Flujos principales utilizables entre 320 y 1920 px; salida de sesión accesible. **Parcial:** se verificó 320–1440 px. | 4–6 días |
| E4 | 60–75 | Pruebas de interfaz y recorridos integrales; T061–T075 y T091–T094. | Frontend y verificación | Crear y revocar desde navegador contra backend real, sin interceptar Relevo. **Parcial:** recorrido aprobado sobre SQLite en memoria. | 3–4 días |
| E5 | 75–85 | Accesibilidad, capturas base y tres motores; T076–T090 y T096. | Diseño y verificación | axe, teclado y matriz visual aprobados; excepciones documentadas. **Parcial:** Chromium, axe y teclado aprobados en los estados indicados. | 2–3 días |
| E6 | 85–95 | Rendimiento, CORS, reinicios, respaldo y CI; T095, T097 y T098. | Operación y desarrollo | Imagen reproducible y evidencia de recuperación y presupuesto de rendimiento. | 2–3 días |
| E7 | 95–100 | Verificación con proveedor real, revisión final y publicación; T099–T100. | Responsable del producto y operación | Sin P0 abiertos; informe final firmado con alcance y limitaciones reales. | 1–2 días |

**Estimación orientativa:** 19–29 días efectivos de una persona con dedicación continua. No es una fecha comprometida: disponibilidad de Docker, defectos de concurrencia, nuevos módulos o cambios de streaming pueden modificarla. La creación de streaming queda fuera de esta estimación; se verifica el rechazo 501 actual.

**Dependencias:** E1 y E2 dependen de E0. E3 puede avanzar después de definir contratos en E1. E4 requiere E1–E3; E5 se apoya en E3/E4; E6 integra los resultados anteriores; E7 requiere todas las etapas aplicables. No publicar una capacidad por tener una pantalla si el backend no la soporta.

### Primeras acciones ejecutables

1. Recuperar acceso a Docker o habilitar un MySQL exclusivo de pruebas, y confirmar la imagen final.
2. Añadir el proyecto API de Playwright con `request` y tres pruebas iniciales: login, crear/listar clave y revocar/denegar consumidor.
3. Preparar el proveedor HTTP simulado y conectar un modelo de prueba al adaptador real.
4. Crear el recorrido integral T091 sin respuestas administrativas interceptadas.
5. Corregir ancho mínimo, cierre de sesión móvil, estados fijos y URL pública.
6. Aplicar escala tipográfica, tarjetas de claves y comportamiento de diálogos.
7. Ampliar la matriz visual y de accesibilidad antes de incorporar pantallas administrativas adicionales.

## 7 Matriz de dispositivos y ejecución

| Grupo | Viewports de referencia | Recorridos obligatorios |
|---|---|---|
| Móvil estrecho | 320 × 568 y 360 × 800 | Acceso, crear, copiar, revocar, guía y salir. |
| Móvil habitual | 390 × 844 y 430 × 932 | Flujo completo, teclado virtual, orientación y texto largo. |
| Tablet | 768 × 1024 y 1024 × 768 | Navegación, formularios y guía. |
| PC compacto | 1280 × 720 | Datos densos, diálogos y navegación con teclado. |
| PC habitual y amplio | 1440 × 900 y 1920 × 1080 | Límites de ancho, lectura y listas con muchos registros. |

Ejecutar el flujo crítico en Chromium, Firefox y WebKit. Las capturas se comparan con bases propias por motor y entorno de renderizado estable. Cubrir todos los anchos de la tabla en Chromium; al menos móvil habitual y PC en los otros motores. Añadir verificaciones en un Android y un iPhone físicos: la emulación del navegador no reproduce todas las condiciones del sistema, portapapeles o teclado.

La adaptación se garantiza para la matriz y rango verificados, no para una afirmación ilimitada de “cualquier dispositivo”. Probar anchos intermedios reduce fallos entre puntos de cambio de distribución.

## 8 Rendimiento evidencia y condiciones de publicación

Los siguientes valores son objetivos iniciales para acordar y medir, no resultados existentes: LCP ≤ 2,5 s, CLS ≤ 0,1 y respuesta de interacción ≤ 200 ms. Medir bajo un perfil móvil y una red controlados, registrar hardware, navegador y volumen de datos, y repetir varias veces. El tiempo de respuesta del proveedor se mide por separado para no atribuir su latencia al renderizado del panel.

Playwright sirve para los recorridos y la concurrencia funcional acotada de cuotas. Una prueba de carga sostenida necesita una herramienta dedicada como k6 o Locust y un entorno dimensionado; no presentar las pruebas del navegador como certificación de capacidad de carga.

Condiciones para publicar:

- Todos los casos P0 aplicables aprobados; ninguna prueba crítica omitida, bloqueada o intermitente sin resolver.
- Todos los P1 aplicables ejecutados; excepciones concretas con impacto, responsable y decisión de aceptación.
- Flujo real crear, usar y revocar aprobado contra MySQL y la imagen final.
- Navegación y diálogos completos con teclado; sin infracciones automáticas de accesibilidad conocidas en los estados auditados.
- Matriz adaptable aprobada, con capturas revisadas; comparar solo contenido determinista y ocultar valores volátiles.
- No registrar secretos reales. Aprobar el copy de disponibilidad y seguridad contra el comportamiento real.
- Verificar migraciones, restauración de respaldo, reinicio, `/health` y `/ready`.
- Registrar la prueba externa gratuita como aprobada o bloqueada por proveedor; no mezclar disponibilidad externa con éxito de pruebas simuladas.

El informe final debe mostrar totales por grupo y prioridad, fallos, bloqueos, intermitencias, dispositivos, versión probada y vínculos a evidencia. Medir cobertura de código por separado; el 80 % planteado para autenticación y enrutador necesita un informe de instrumentación, no el conteo de estos 100 escenarios.

## 9 Automatización y comandos

**Disponibles hoy:**

```powershell
# Backend actual desde la raíz
.\.venv\Scripts\python.exe -m pytest tests\unit -q

# Navegador actual desde web
npm run test:e2e

# Compilación desde web
npm run build
```

**Estado actual:** `npm run test:e2e` levanta automáticamente FastAPI en el puerto 8765 con SQLite en memoria y Vite en 5173, ejecuta stubs de UI y dos pruebas HTTP contra el servidor real. No necesita Docker ni credenciales de proveedores. La creación automática de tablas (`DATABASE_AUTO_CREATE=true`) se activa únicamente en ese proceso de prueba.

**Pendiente:** separar proyectos Playwright `api`, `ui`, `integrated` y `deployment`, configurar MySQL de pruebas, añadir el servidor de proveedor simulado y cubrir T001–T100. La verificación de despliegue y de proveedor real se ejecuta bajo demanda.

En cada propuesta de cambio, ejecutar pruebas unitarias, build y comprobaciones rápidas de API y Chromium. Antes de publicar, ejecutar suite de MySQL, los tres motores, accesibilidad y capturas. Conservar informe HTML/JSON y trazas de fallos sintéticos con retención definida. La configuración de CI actual ejecuta calidad de Python; añadir instalación de Node y las suites de Playwright.

Los navegadores se instalan desde `web` con `npx playwright install chromium firefox webkit`; en un runner Linux puede necesitarse `--with-deps`. Usar versiones del lockfile y el mismo entorno de renderizado para las capturas base. No actualizar bases automáticamente para hacer pasar un cambio visual.

## 10 Referencias

Fuentes del proyecto para mantener este documento: `app/api/routes.py`, `app/auth/dependencies.py`, `app/router/service.py`, `app/router/quotas.py`, `app/main.py`, `web/src/main.tsx`, `web/src/styles.css`, `web/playwright.config.ts`, `web/e2e/admin.spec.ts`, `tests/unit/`, `.github/workflows/ci.yml` y el informe de Playwright citado al inicio.

Referencias oficiales para implementación:

- [Playwright pruebas de API](https://playwright.dev/docs/api-testing): peticiones HTTP y preparación de datos.
- [Playwright APIRequestContext](https://playwright.dev/docs/api/class-apirequestcontext): contexto de peticiones y autenticación.
- [Playwright emulación](https://playwright.dev/docs/emulation): dispositivos y condiciones del contexto.
- [Playwright comparaciones visuales](https://playwright.dev/docs/test-snapshots): capturas base y comparación.
- [WCAG 2.2 reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): adaptación y ampliación de contenido.
- [WCAG 2.2 tamaño de objetivos](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): interacción y excepciones del mínimo.
