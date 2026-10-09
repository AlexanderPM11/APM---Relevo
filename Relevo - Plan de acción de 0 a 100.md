# Relevo — Plan de acción de 0 a 100

Documento de instrucciones para un modelo de código · Repositorio: `relevo-router`

## 0. Cómo usar este documento

Pega este documento completo en el modelo que va a escribir el código. Es la fuente de verdad del proyecto. El modelo debe copiar la sección 10 a `docs/PLAN.md` en el repositorio y usarla como lista de tareas viva.

## 1. Rol y reglas de trabajo (instrucciones obligatorias para el modelo)

Eres un ingeniero de software senior. Vas a construir el proyecto Relevo de principio a fin siguiendo este plan. Reglas:

1. Trabaja las fases y tareas en el orden indicado en la sección 10. No saltes tareas, salvo que estén bloqueadas (regla 8).
2. Antes de empezar, crea el archivo `docs/PLAN.md` con todas las tareas de la sección 10 como casillas `- [ ]`.
3. Al terminar CADA tarea haz, en este orden: (a) ejecutar las pruebas y el linter relevantes; (b) si pasan, marcar la tarea como `- [x]` en `docs/PLAN.md`; (c) hacer un commit con ese cambio; (d) hacer push a la rama remota. Nunca marques una tarea como completada si sus validaciones fallan.
4. Usa Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `ci:`). Un commit por tarea como mínimo, con el identificador de la tarea en el mensaje (por ejemplo `feat(router): T6.3 selección por prioridad`).
5. Flujo de ramas: `main` siempre estable; trabaja en una rama por fase (`phase/0-repo`, `phase/1-docker`, etc.) y fusiona a `main` al cerrar cada fase con todas sus pruebas en verde.
6. Nunca subas secretos. Verifica con `git status` y un escaneo (por ejemplo `gitleaks` o un hook de pre-commit) que `.env` no se versiona.
7. Toda decisión técnica no especificada aquí se documenta en `docs/DECISIONS.md` (fecha omitida, solo contexto, decisión y motivo).
8. Si una tarea queda bloqueada (falta una clave de proveedor, un servicio externo no responde), regístrala en `docs/BLOCKERS.md`, déjala sin marcar y continúa con la siguiente tarea que no dependa de ella.
9. No inventes límites, modelos ni precios de proveedores. Los valores de `config/models.seed.yaml` son una referencia inicial y deben tratarse como configurables y por verificar.
10. Escribe código tipado, con docstrings breves, sin dependencias innecesarias y con manejo de errores explícito.
11. Al final de cada fase, actualiza el `README.md` con lo que cambió y cómo probarlo.

## 2. Objetivo y alcance

Relevo es un router de modelos de IA que usa solo capas gratuitas de proveedores que no exigen tarjeta de crédito. Debe:

- Mantener un registro de proveedores y modelos con sus límites.
- Seleccionar automáticamente un modelo disponible para cada petición.
- Enviar la petición al modelo elegido.
- Hacer fallback al siguiente modelo si uno falla, no está disponible o alcanzó su límite.
- Registrar latencia, disponibilidad, uso y errores.
- Exponer una API compatible con OpenAI, protegida con autenticación, y un panel de administración por API.

Fuera de alcance en la versión 1: facturación, cobro a usuarios, interfaz web visual (solo API y documentación OpenAPI), y proveedores que requieran tarjeta.

## 3. Stack tecnológico

| Capa | Elección |
| --- | --- |
| Lenguaje | Python 3.12 |
| API | FastAPI + Uvicorn (async) |
| Llamadas a proveedores | `litellm` (interfaz unificada) o clientes `httpx` directos para proveedores compatibles con OpenAI. Documentar la elección en DECISIONS.md |
| Base de datos | MySQL 8.0 |
| ORM y migraciones | SQLAlchemy 2.x (async, driver `asyncmy`) + Alembic |
| Validación y configuración | Pydantic v2 + `pydantic-settings` (lee `.env`) |
| Autenticación | JWT para administradores, API keys propias para consumidores, hash `argon2` |
| Reintentos | `tenacity` |
| Pruebas | `pytest`, `pytest-asyncio`, `respx` (simular proveedores), `testcontainers` o MySQL del compose para integración |
| Calidad | `ruff` (lint y formato), `mypy`, `pre-commit` |
| Contenedores | Docker multi-stage + Docker Compose |
| Despliegue | Dokploy (despliegue de Docker Compose) |

No se usa Redis: los contadores de cuota viven en MySQL con una caché en memoria por proceso. Se ejecuta un solo worker de Uvicorn por contenedor en la versión 1 para evitar inconsistencias de cuota (documentar la limitación).

## 4. Estructura del repositorio

```
relevo-router/
├── app/
│   ├── main.py
│   ├── core/            # config, seguridad, logging, errores
│   ├── db/              # sesión, modelos SQLAlchemy, repositorios
│   ├── auth/            # JWT, API keys, dependencias
│   ├── providers/       # un adaptador por proveedor + base común
│   ├── router/          # selector, cuotas, cooldown, fallback, estrategia
│   ├── api/             # rutas v1 (OpenAI) y admin
│   └── schemas/         # modelos Pydantic
├── alembic/
├── config/models.seed.yaml
├── tests/               # unit/, integration/, e2e/
├── docs/                # PLAN.md, DECISIONS.md, BLOCKERS.md, ARCHITECTURE.md
├── scripts/             # entrypoint.sh, seed, healthcheck
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore  .dockerignore
├── pyproject.toml
└── README.md
```

## 5. Variables de entorno (archivo `.env`)

Todo lo configurable vive en `.env` y se lee con `pydantic-settings`. Entrega un `.env.example` completo y comentado, sin valores reales. El `.env` real nunca se versiona. El arranque debe fallar con un mensaje claro si falta una variable obligatoria.

**Aplicación**

- `APP_ENV` (`development` | `production`), `APP_PORT` (por defecto 8000), `LOG_LEVEL`, `CORS_ORIGINS`, `TZ`.

**Base de datos**

- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`.
- Opcional: `DATABASE_URL` (si se define, tiene prioridad).

**Seguridad**

- `JWT_SECRET`, `JWT_ALGORITHM`, `JWT_EXPIRE_MINUTES`.
- `API_KEY_PEPPER` (valor extra para el hash de las API keys).
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` (crean el primer administrador al arrancar si no existe ninguno).

**Router**

- `ROUTER_MAX_ATTEMPTS` (máximo de modelos a probar por petición), `ROUTER_REQUEST_TIMEOUT_SECONDS`, `ROUTER_COOLDOWN_DEFAULT_SECONDS`, `ROUTER_CIRCUIT_FAILURE_THRESHOLD`, `ROUTER_STRATEGY` (`priority` | `weighted_round_robin`), `ROUTER_ENABLE_LOCAL_FALLBACK`.

**Claves de proveedores** (todas opcionales; un proveedor sin clave queda deshabilitado automáticamente)

- `GOOGLE_AI_STUDIO_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `COHERE_API_KEY`, `MISTRAL_API_KEY`, `NVIDIA_API_KEY`, `KILO_API_KEY`, `OLLAMA_BASE_URL`.

## 6. Modelo de datos (MySQL)

Tablas mínimas, todas con `id`, `created_at`, `updated_at` y migración Alembic:

- `admin_users`: email único, password\_hash, is\_active.
- `api_keys`: nombre, prefijo visible, hash, owner, is\_active, límite de peticiones por minuto, último uso, fecha de expiración opcional.
- `providers`: slug único, nombre, base\_url, env\_key\_name, is\_enabled, requires\_card (booleano verificado a mano), requires\_phone, usa\_datos\_para\_entrenamiento.
- `models`: provider\_id, nombre del modelo en el proveedor, alias lógico, prioridad, peso, contexto máximo, capacidades (texto, visión, herramientas, JSON mode), is\_enabled, nivel (`tier`).
- `model_limits`: model\_id, tipo de ventana (`minute` | `hour` | `day` | `month`), métrica (`requests` | `tokens` | `neurons`), valor máximo.
- `model_usage`: model\_id, ventana, inicio de ventana, métrica, consumido (índice único por model\_id + ventana + inicio).
- `model_health`: model\_id, estado (`closed` | `open` | `half_open`), fallos consecutivos, cooldown\_until, último error, última latencia.
- `request_logs`: api\_key\_id, modelo solicitado, modelo final, intentos, estado, latencia total, tokens de entrada y salida, código de error. No guardar el contenido de los prompts salvo que `LOG_PROMPTS=true`.

## 7. Autenticación y seguridad

Hay dos mecanismos separados:

1. **API keys para consumidores** de `/v1/*`. Formato `rlv_<prefijo>_<secreto>`. Se muestra completa solo al crearla; en la base de datos se guarda únicamente el hash (SHA-256 con `API_KEY_PEPPER`) y el prefijo. Cabecera `Authorization: Bearer <key>`.
2. **JWT para administradores** de `/admin/*`. Login con email y contraseña (hash argon2), token con expiración configurable.

Requisitos de seguridad: límite de peticiones por API key, límite de intentos de login con bloqueo temporal, comparación de hashes en tiempo constante, cabeceras de seguridad, CORS configurable, errores sin filtrar datos internos, redacción de claves en los logs, contenedor sin root, y las claves de proveedores solo en variables de entorno (nunca en la base de datos).

## 8. Estrategia de selección, rotación y fallback

**Niveles de prioridad** (configurables en el seed):

- Nivel 1, velocidad: Groq y Cerebras.
- Nivel 2, volumen: Gemma en Google AI Studio y Cloudflare Workers AI.
- Nivel 3, respaldo: OpenRouter con modelos `:free`, Cohere, Mistral, NVIDIA NIM, Kilo Gateway.
- Nivel 4, último recurso: Ollama local (si `ROUTER_ENABLE_LOCAL_FALLBACK=true`).

**Algoritmo de selección por petición:**

1. Detectar requisitos (contexto estimado, visión, herramientas, JSON mode, streaming, modelo o alias solicitado).
2. Filtrar: proveedor con clave presente, modelo habilitado, capacidades suficientes, circuito no abierto, sin cooldown y con cuota restante en todas sus ventanas.
3. Ordenar por nivel y, dentro del nivel, según `ROUTER_STRATEGY`: `priority` (por prioridad numérica) o `weighted_round_robin` (ponderado por cuota restante y peso).
4. Intentar el primer candidato; en caso de fallo pasar al siguiente hasta `ROUTER_MAX_ATTEMPTS`.

**Clasificación de errores:**

- 429 o cuota agotada: poner el modelo en cooldown (usar `Retry-After` si existe, si no `ROUTER_COOLDOWN_DEFAULT_SECONDS`) y pasar al siguiente.
- 5xx, timeout, error de red: sumar un fallo; al llegar a `ROUTER_CIRCUIT_FAILURE_THRESHOLD` abrir el circuito con cooldown, y pasar al siguiente.
- 401 o 403 del proveedor: deshabilitar el proveedor hasta reinicio y registrar alerta.
- 400 por contexto excedido: descartar ese modelo para esa petición y pasar al siguiente.
- 400 por petición inválida del cliente: devolver el error sin reintentar.

**Cuotas:** antes de llamar, reservar la cuota (peticiones; tokens estimados); después de la respuesta, ajustar con el uso real. Si ningún modelo está disponible, devolver 503 con el cuándo-reintentar más cercano (`Retry-After`).

**Streaming:** el fallback solo es posible antes de enviar el primer byte al cliente. Si falla a mitad del stream, cerrar con un evento de error.

## 9. API

**Pública (API key):**

- `POST /v1/chat/completions` (compatible con OpenAI, con y sin streaming). Cabeceras de respuesta `X-Relevo-Model`, `X-Relevo-Provider`, `X-Relevo-Attempts`.
- `GET /v1/models` (modelos y alias disponibles ahora).

**Operación:**

- `GET /health` (el proceso vive) y `GET /ready` (base de datos accesible y al menos un modelo disponible).

**Administración (JWT):**

- `POST /admin/auth/login`.
- CRUD de `/admin/api-keys`, `/admin/providers`, `/admin/models` y `/admin/models/{id}/limits`.
- `POST /admin/models/{id}/reset-cooldown`.
- `GET /admin/stats` (peticiones, tasa de éxito, latencia p50 y p95, fallbacks, uso de cuota por modelo).
- `POST /admin/seed/reload` (recarga `config/models.seed.yaml`).

Documentación automática en `/docs`, desactivable en producción con una variable.

## 10. Plan por fases (copiar a `docs/PLAN.md`)

### Fase 0 — Repositorio y gobernanza

- [ ] T0.1 Inicializar repositorio, `.gitignore` (incluye `.env`), `.dockerignore`, licencia MIT.
- [ ] T0.2 `pyproject.toml` con dependencias y herramientas (`ruff`, `mypy`, `pytest`).
- [ ] T0.3 `pre-commit` con ruff, mypy y escaneo de secretos.
- [ ] T0.4 Crear `docs/PLAN.md`, `DECISIONS.md`, `BLOCKERS.md`, `ARCHITECTURE.md`.
- [ ] T0.5 CI en GitHub Actions: lint, tipos y pruebas en cada push.

* Validación: el CI corre y pasa con un test de ejemplo.

### Fase 1 — Configuración y Docker base

- [ ] T1.1 `app/core/config.py` con `pydantic-settings` y validación de variables obligatorias.
- [ ] T1.2 `.env.example` completo y comentado (sección 5).
- [ ] T1.3 `Dockerfile` multi-stage, usuario sin root, `HEALTHCHECK`.
- [ ] T1.4 `docker-compose.yml` con servicios `app` y `mysql` (sección 11).
- [ ] T1.5 Endpoint `/health` y arranque mínimo de FastAPI.

* Validación: `docker compose up --build` levanta todo y `/health` responde 200.

### Fase 2 — Base de datos

- [ ] T2.1 Sesión async de SQLAlchemy y gestión de conexiones.
- [ ] T2.2 Modelos de la sección 6.
- [ ] T2.3 Migración inicial con Alembic.
- [ ] T2.4 `scripts/entrypoint.sh`: esperar a MySQL, ejecutar `alembic upgrade head`, arrancar la app.
- [ ] T2.5 Repositorios con pruebas de integración.
- [ ] T2.6 Endpoint `/ready`.

* Validación: migraciones aplican en una base vacía y se pueden revertir.

### Fase 3 — Autenticación

- [ ] T3.1 Hash argon2 y creación del primer administrador desde `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
- [ ] T3.2 Login y emisión de JWT.
- [ ] T3.3 Dependencia de autorización para `/admin/*`.
- [ ] T3.4 Generación, hash y validación de API keys; CRUD de API keys.
- [ ] T3.5 Límite de peticiones por API key y límite de intentos de login.

* Validación: pruebas de credenciales válidas, inválidas, expiradas, revocadas y fuerza bruta.

### Fase 4 — Registro de proveedores y modelos

- [ ] T4.1 `config/models.seed.yaml` con los proveedores de la sección 8 (límites marcados como por verificar).
- [ ] T4.2 Cargador del seed, idempotente, que se ejecuta al arrancar y con `/admin/seed/reload`.
- [ ] T4.3 Deshabilitar automáticamente proveedores sin clave en `.env`.
- [ ] T4.4 CRUD admin de proveedores, modelos y límites.

* Validación: el seed no duplica registros al ejecutarse varias veces.

### Fase 5 — Adaptadores de proveedores

- [ ] T5.1 Interfaz base: `chat()`, `stream()`, normalización de errores a un conjunto común.
- [ ] T5.2 Adaptador genérico compatible con OpenAI (Groq, Cerebras, OpenRouter, Mistral, NVIDIA, Kilo, Ollama).
- [ ] T5.3 Adaptador de Google AI Studio.
- [ ] T5.4 Adaptador de Cloudflare Workers AI.
- [ ] T5.5 Adaptador de Cohere.
- [ ] T5.6 Lectura de cabeceras de límite y `Retry-After`.

* Validación: pruebas con `respx` simulando éxito, 429, 5xx, timeout y 401 por proveedor.

### Fase 6 — Núcleo del router

- [ ] T6.1 Contador de cuotas por ventana (minuto, hora, día, mes) con reserva y ajuste.
- [ ] T6.2 Cooldown y circuit breaker persistidos en `model_health`.
- [ ] T6.3 Selector con filtros y orden por nivel y prioridad.
- [ ] T6.4 Estrategia `weighted_round_robin`.
- [ ] T6.5 Bucle de fallback con clasificación de errores (sección 8).
- [ ] T6.6 Estimación de tokens y detección de contexto excedido.
- [ ] T6.7 Soporte de streaming con fallback previo al primer byte.

* Validación: pruebas unitarias de cada regla de la sección 8 y una prueba que simule la caída consecutiva de tres modelos.

### Fase 7 — API compatible con OpenAI

- [ ] T7.1 `POST /v1/chat/completions` sin streaming.
- [ ] T7.2 Streaming por SSE.
- [ ] T7.3 `GET /v1/models`.
- [ ] T7.4 Cabeceras `X-Relevo-*` y respuestas 503 con `Retry-After`.
- [ ] T7.5 Registro en `request_logs`.

* Validación: el cliente oficial de `openai` funciona apuntando a Relevo como `base_url`.

### Fase 8 — Observabilidad y administración

- [ ] T8.1 Logs estructurados en JSON con redacción de secretos.
- [ ] T8.2 `GET /admin/stats` con métricas agregadas.
- [ ] T8.3 Endpoint de métricas en formato Prometheus (opcional, activable por variable).
- [ ] T8.4 Tarea periódica de sondeo de salud de modelos y limpieza de ventanas antiguas.

* Validación: las estadísticas coinciden con los registros de prueba.

### Fase 9 — Pruebas integrales y endurecimiento

- [ ] T9.1 Pruebas end-to-end con proveedores simulados y MySQL real del compose.
- [ ] T9.2 Prueba de carga básica (`locust` o `k6`) para verificar que las cuotas no se exceden bajo concurrencia.
- [ ] T9.3 Revisión de seguridad: dependencias (`pip-audit`), cabeceras, errores, secretos.
- [ ] T9.4 Cobertura mínima del 80 % en `app/router` y `app/auth`.
- [ ] T9.5 `README.md` completo: instalación, configuración, ejemplos con `curl` y con el SDK de OpenAI, limitaciones conocidas.

### Fase 10 — Despliegue en Dokploy

- [ ] T10.1 Ajustar `docker-compose.yml` a los requisitos de Dokploy (sección 11).
- [ ] T10.2 Documentar el despliegue paso a paso en `docs/DEPLOY.md` (repositorio, variables, dominio, volumen, healthchecks).
- [ ] T10.3 Respaldo de MySQL documentado (volcado programado y restauración probada).
- [ ] T10.4 Prueba de humo posterior al despliegue (`/health`, `/ready`, una petición real).
- [ ] T10.5 Etiquetar la versión `v1.0.0` y crear el release en GitHub.

## 11. Docker y Dokploy

**Dockerfile:** imagen `python:3.12-slim`, etapa de construcción con dependencias y etapa final mínima, usuario sin privilegios, sin copiar `.env`, `HEALTHCHECK` contra `/health`, `ENTRYPOINT` que ejecuta `scripts/entrypoint.sh`.

**docker-compose.yml:**

- Servicio `app`: build local, `env_file: .env`, `depends_on` con `condition: service_healthy`, `restart: unless-stopped`, `expose` del puerto interno.
- Servicio `mysql`: imagen `mysql:8.0`, variables tomadas de `.env`, volumen con nombre para persistencia, `healthcheck` con `mysqladmin ping`, juego de caracteres `utf8mb4`, sin publicar el puerto 3306 al exterior.
- Red interna entre servicios.

**Requisitos para Dokploy** (verificar contra la documentación vigente de Dokploy antes de cerrar la Fase 10):

- Desplegar como aplicación de tipo Docker Compose.
- No definir `container_name` y no fijar puertos del host; el acceso externo se configura con el dominio en Dokploy, apuntando al puerto interno del servicio `app`.
- Las variables de entorno se definen en el panel de Dokploy; el `.env` local sirve solo para desarrollo, y el compose debe funcionar tanto con `env_file` como con variables inyectadas.
- Volúmenes con nombre para MySQL, para no perder datos entre despliegues.
- Healthchecks definidos para que Dokploy detecte el estado del servicio.
- Migraciones automáticas en el arranque, de forma idempotente y segura ante reinicios.

## 12. Pruebas y validaciones

- **Unitarias:** selector, cuotas, cooldown, clasificación de errores, hashing de API keys, validación de configuración.
- **Integración:** repositorios y migraciones contra MySQL real; adaptadores contra proveedores simulados.
- **End-to-end:** flujo completo petición → selección → fallback → respuesta, incluido el caso en que todos los modelos fallan.
- **Seguridad:** acceso sin credenciales, credenciales revocadas, límites de tasa, ausencia de secretos en logs y respuestas.
- **Pruebas reales opcionales:** una suite marcada `@pytest.mark.live` que usa claves reales de `.env`; nunca se ejecuta en CI.
- Antes de cada commit: `ruff check`, `ruff format --check`, `mypy` y `pytest`.

## 13. Definición de terminado

El proyecto está terminado cuando:

1. Todas las casillas de `docs/PLAN.md` están marcadas y el CI está en verde.
2. `docker compose up --build` desde cero, con solo un `.env` copiado de `.env.example`, deja el sistema funcionando.
3. Una petición con el SDK de OpenAI contra `/v1/chat/completions` obtiene respuesta y, al desactivar el primer modelo, se atiende con el siguiente sin error visible para el cliente.
4. No hay secretos en el repositorio ni en el historial de git.
5. El despliegue en Dokploy está documentado y probado.

## 14. Notas pendientes (sin fecha)

- Revisar periódicamente límites, modelos y requisitos de registro (tarjeta, teléfono) de cada proveedor contra su documentación oficial y contra el repositorio comunitario cheahjs/free-llm-api-resources. Actualizar `config/models.seed.yaml` en consecuencia.
- Verificar a mano, uno por uno, qué proveedores no exigen tarjeta de crédito al registrarse y reflejarlo en el campo `requires_card`.
- Medir latencia y disponibilidad reales con pruebas en vivo, y reajustar niveles y prioridades.
- Varias capas gratuitas usan los prompts para entrenamiento: no enviar datos sensibles por Relevo; considerar una marca de privacidad por modelo para excluirlos de ciertas peticiones.
- Evaluar más adelante Redis para cuotas compartidas si se necesita más de un worker.
