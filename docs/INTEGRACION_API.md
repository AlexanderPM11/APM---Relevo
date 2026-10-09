# Integración de la API de Relevo

Guía operativa para que una aplicación o agente integre Relevo sin depender de la interfaz web. Está escrita a partir de las rutas, esquemas, adaptadores y configuración actuales del repositorio. Si esta guía y el código difieren, prevalece el código.

## 1. Datos rápidos

- **Base URL:** origen público de Relevo, por ejemplo `https://api.ejemplo.com`.
- **API pública:** `/v1/...`; autenticación con una clave de consumidor `rlv_...`.
- **API administrativa:** `/admin/...`; autenticación con JWT obtenido en `/admin/auth/login`.
- **Health:** `GET /health` indica si vive el proceso; `GET /ready` también comprueba base de datos y un modelo enrutable disponible.
- **OpenAPI:** `/openapi.json`; Swagger `/docs` solo si `DOCS_ENABLED=true` y `APP_ENV` no es `production`.
- **Formato habitual de error HTTP:** `{"detail":"…"}`. En un stream ya iniciado, el error se transmite dentro del canal SSE y no puede cambiar el estado HTTP original.

La consola obtiene su base pública de `API_PUBLIC_BASE_URL` o del origen de la solicitud. Este valor solo configura la URL que presenta la consola; no cambia el enrutamiento de la API.

## 2. Autenticación

### 2.1 Claves de consumidor

Una persona administradora crea una clave con `POST /admin/api-keys`. El valor completo tiene formato `rlv_<prefijo>_<secreto>`. Se almacena cifrado para que una persona administradora autenticada pueda recuperarlo después; el hash HMAC sigue siendo el que se usa para validar cada solicitud. Guárdalo también en el backend o gestor de secretos de la aplicación cliente.

```http
Authorization: Bearer rlv_<CLAVE>
```

Se requiere para `GET /v1/models` y `POST /v1/chat/completions`. La clave debe estar activa y no expirada. Su límite de solicitudes por minuto se aplica también a las solicitudes del Playground.

### 2.2 Sesión administrativa

`POST /admin/auth/login` recibe correo y contraseña y devuelve un JWT tipo Bearer. Usa el JWT para todas las demás rutas `/admin/...`.

```http
Authorization: Bearer <access_token>
```

El token contiene el correo administrador en `sub` y caduca según `JWT_EXPIRE_MINUTES`. Si vence, vuelve a iniciar sesión. El JWT no es una clave de consumidor y no sirve para `/v1/...`.

## 3. API pública compatible con OpenAI

### 3.1 `GET /v1/models`

Lista modelos habilitados, con credenciales configuradas, compatibles con el adaptador y fuera de cooldown.

```bash
curl "$RELEVO_BASE_URL/v1/models" \
  -H "Authorization: Bearer $RELEVO_API_KEY"
```

Respuesta:

```json
{
  "object": "list",
  "data": [
    { "id": "openrouter/ejemplo:free", "object": "model", "owned_by": "openrouter" }
  ]
}
```

El endpoint refresca el catálogo desde los proveedores configurados y conserva en base de datos la última instantánea si una consulta externa falla. Las respuestas del proveedor se mantienen en caché durante 5 minutos después de una consulta correcta. El catálogo puede filtrar modelos de embedding, audio, moderación y otras tareas que no parecen chat. En OpenRouter y Kilo se limitan las entradas a rutas que el catálogo identifica como gratuitas; esto no garantiza precio futuro cero.

Envía el `id` exacto del listado o `auto`. En el listado público no se devuelven capacidades, límites, estado detallado ni clasificación de tarea; la consola administrativa obtiene metadatos adicionales desde `/admin/playground/catalog` y `/admin/models`.

### 3.2 `POST /v1/chat/completions`

Envía una conversación y devuelve una respuesta con forma Chat Completion. `stream` puede ser `false` u omitirse para una respuesta JSON, o `true` para recibir chunks SSE.

```bash
curl "$RELEVO_BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $RELEVO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role":"user","content":"Hola"}],
    "temperature": 0.7,
    "max_tokens": 512
  }'
```

Con el SDK de OpenAI para Python en un backend:

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url=os.environ["RELEVO_BASE_URL"].rstrip("/") + "/v1",
    api_key=os.environ["RELEVO_API_KEY"],
)
response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hola"}],
)
print(response.choices[0].message.content)
print(response.model_dump().get("relevo"))
```

Campos validados del body:

| Campo | Tipo | Regla / comportamiento |
|---|---|---|
| `model` | string | Por defecto `auto`. Acepta `auto`, el nombre/alias guardado del modelo o `proveedor/nombre`. |
| `messages` | array | Obligatorio, no vacío. Cada mensaje tiene `role` (`system`, `user`, `assistant` o `tool`) y `content` de texto o array de partes. |
| `messages[].name` | string opcional | Nombre de emisor, si aplica. |
| `messages[].tool_call_id` | string opcional | Referencia para un mensaje `tool`. |
| `temperature` | number opcional | Rango `0`–`2`. |
| `top_p` | number opcional | Rango `0`–`1`. |
| `max_tokens` | integer opcional | Debe ser mayor que cero. Se convierte a `maxOutputTokens` en Gemini. |
| `stream` | boolean | Por defecto `false`. Si es `true`, la respuesta es SSE. |
| `tools` | array opcional | Se pasa al proveedor; el enrutador exige que el modelo declare capacidad `tools`. Gemini se excluye actualmente de esta ruta. |
| `response_format` | object opcional | Se pasa al proveedor; `{"type":"json_object"}` requiere capacidad `json`. Gemini se excluye actualmente de esta ruta. |

El esquema superior permite propiedades adicionales (`extra: allow`) y los adaptadores OpenAI compatibles pueden reenviarlas. Eso no garantiza que cada proveedor las acepte. El adaptador Gemini solo traduce explícitamente los campos que implementa. No se modela `tool_calls` en los mensajes de entrada, por lo que no se debe asumir compatibilidad completa con ciclos de herramientas de varios turnos.

#### Texto e imágenes

Para imágenes se admite el formato OpenAI `image_url` con una URL de datos base64. Se requiere un modelo con capacidad `vision`.

```json
{
  "role": "user",
  "content": [
    {"type":"text","text":"Describe la imagen"},
    {"type":"image_url","image_url":{"url":"data:image/jpeg;base64,<BASE64>"}}
  ]
}
```

El adaptador Gemini convierte texto a `parts[].text` e imágenes base64 a `inlineData`. Rechaza URLs remotas de imágenes. Para garantizar compatibilidad, envía imágenes como `data:<mime>;base64,...` y no asumas que un modelo listado acepta visión.

#### Respuesta JSON

La respuesta conserva el objeto del proveedor cuando corresponda y añade información de Relevo:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 0,
  "model": "auto",
  "choices": [{
    "index": 0,
    "message": {"role":"assistant","content":"Hola."},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12},
  "relevo": {"model":"nombre-real","provider":"groq","attempts":1}
}
```

`relevo.model` es el nombre interno del modelo final; `relevo.provider` es el slug del proveedor y `relevo.attempts` el número de intentos. Cuando se clasifica la tarea, `relevo.routing` añade `task`, `complexity`, `confidence`, `classifier`, `classifier_ms`, `fallback` y `mode`. También se envían `X-Relevo-Model`, `X-Relevo-Provider` y `X-Relevo-Attempts` en las respuestas no streaming. `model` refleja el alias solicitado/seleccionado según la normalización de la ruta.

#### Streaming público (`stream: true`)

Devuelve `Content-Type: text/event-stream`. Cada evento usa `data: <JSON>` y termina con una línea en blanco. Los JSON siguen el formato `chat.completion.chunk`; al terminar llega `data: [DONE]`.

Lector SSE mínimo reutilizable para navegador o Node moderno:

```javascript
async function* readSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const dataFromFrame = (frame) => frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      pending = pending.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const data = dataFromFrame(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
        if (data) yield data;
      }
      if (done) {
        const data = dataFromFrame(pending);
        if (data) yield data;
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
```

```javascript
const response = await fetch(`${process.env.RELEVO_BASE_URL}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.RELEVO_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  },
  body: JSON.stringify({
    model: 'auto',
    messages: [{ role: 'user', content: 'Resume este texto: ...' }],
    stream: true,
  }),
});
if (!response.ok) throw new Error(await response.text());
for await (const chunk of readSse(response.body)) {
  if (chunk === '[DONE]') break;
  const item = JSON.parse(chunk);
  const text = item.choices?.[0]?.delta?.content;
  if (text) process.stdout.write(text);
}
```

`readSse` representa el lector SSE de la aplicación cliente. En el chunk final `finish_reason` vale `stop` y `usage` puede venir si el proveedor lo reporta. Las cabeceras `X-Relevo-Model`, `X-Relevo-Provider` y `X-Relevo-Attempts` indican el modelo seleccionado antes de comenzar el cuerpo. Si el proveedor falla antes del primer chunk, Relevo puede probar un candidato alternativo. Si falla después de emitir texto, no mezcla respuestas: el canal termina con un evento `data: {"error":{"message":"…","type":"upstream_error"}}`. Un cliente debe detectar errores SSE además de estados HTTP.

Este stream público está diseñado para completions en texto. Aunque `tools` puede enviarse en modo JSON si el modelo los soporta, el adaptador de streaming solo reenvía `delta.content`; no transmite fragmentos `tool_calls`. Para tools usa `stream:false` y confirma compatibilidad con el proveedor. El stream tampoco transmite eventos de clasificación o del router; para inspeccionar cada fase en tiempo real usa el endpoint administrativo del Playground.

## 4. API administrativa

Todas las rutas `/admin/...` requieren JWT, salvo `POST /admin/auth/login`. Envíalo en `Authorization: Bearer <JWT>`. Las operaciones administrativas tienen los mismos esquemas JSON y códigos de error de FastAPI; no hay paginación implementada actualmente.

### 4.1 Rutas operativas y sesión

| Método | Ruta | Acceso | Body / resultado |
|---|---|---|---|
| `GET` | `/health` | Público | `{"status":"ok"}` si el proceso está vivo. No verifica DB ni proveedor. |
| `GET` | `/ready` | Público | Verifica conexión DB y que exista al menos un modelo activo con proveedor configurado y fuera de cooldown. Devuelve `503` si no está listo. No hace una petición de prueba al modelo. |
| `GET` | `/console-config` | Público | `{"api_base_url":"…"}` con `API_PUBLIC_BASE_URL` o el origen HTTP recibido. |
| `POST` | `/admin/auth/login` | Público | `{ "email": "admin@ejemplo.com", "password": "…" }`; respuesta `{ "access_token": "…", "token_type": "bearer" }`. Limita todos los intentos por IP a `ADMIN_LOGIN_ATTEMPT_LIMIT` en una ventana de 5 minutos. |
| `POST` | `/admin/routing/classify` | JWT | `{ "text": "…" }`, entre 1 y 6.000 caracteres. Devuelve clasificación sin invocar un modelo de chat. Límite fijo de 30/minuto por administrador. |

Respuesta de clasificación:

```json
{
  "task": "reasoning",
  "complexity": "complex",
  "confidence": 0.87,
  "classifier": "laya+rules",
  "classifier_ms": 124,
  "fallback": "decision_adjusted_by_rules",
  "request_ms": 127,
  "mode": "shadow",
  "strategy": "laya"
}
```

Categorías válidas: `conversation`, `writing`, `summarization`, `programming`, `reasoning`, `other`. Complejidades: `simple`, `intermediate`, `complex`. Si Laya falla, responde con reglas locales y un `fallback` explicativo; la respuesta no implica que el proveedor de chat se haya llamado.

### 4.2 Claves de consumidor

| Método | Ruta | Body / respuesta |
|---|---|---|
| `GET` | `/admin/api-keys` | Lista `{id,name,prefix,owner,is_active,is_recoverable,requests_per_minute}`. Nunca devuelve el secreto completo. |
| `POST` | `/admin/api-keys` | Body `{ "name":"Mi aplicación", "owner":"Equipo", "requests_per_minute":60 }`. Nombre requerido 1–120; owner opcional hasta 120; límite 1–10.000. Devuelve `201` e incluye `api_key` completo. |
| `POST` | `/admin/api-keys/{key_id}/reveal` | Recupera el secreto cifrado de una clave. Requiere JWT admin; respuesta con `Cache-Control: no-store`. `409` si es una clave histórica sin secreto recuperable; `503` si el secreto de cifrado configurado no puede descifrarla. |
| `POST` | `/admin/api-keys/{key_id}/rotate` | Genera un secreto nuevo y reemplaza el anterior en la misma clave. Invalida inmediatamente el valor previo; devuelve el nuevo `api_key` con `Cache-Control: no-store`. Solo acepta claves activas. |
| `DELETE` | `/admin/api-keys/{key_id}` | Revoca lógicamente (`is_active=false`); `204` sin body. Devuelve `404` si no existe. |
| `DELETE` | `/admin/api-keys/{key_id}/permanent` | Elimina el registro de clave; devuelve `204`. Conserva RequestLog y desvincula de él el `api_key_id`. |

`is_recoverable=false` identifica claves creadas antes de habilitar el cifrado. No es posible derivar su secreto desde el hash; usa la ruta `rotate` para generar otro valor e invalida el anterior. La lista y el catálogo del Playground muestran metadatos, nunca ciphertext ni texto secreto.

### 4.3 Playground

Las solicitudes usan una clave de consumidor activa (`api_key_id`) y también JWT administrativo. La cuota de solicitudes por minuto de esa clave se valida en cada envío.

| Método | Ruta | Body / respuesta |
|---|---|---|
| `GET` | `/admin/playground/catalog` | Refresca el catálogo y devuelve `{api_keys, models}`. Claves incluyen `id`, `name`, `prefix`, `owner`, `requests_per_minute`; modelos incluyen `id`, `name`, `alias`, `provider`, `provider_name`, `capabilities`. `id` del modelo es el alias o `proveedor/nombre`. Solo incluye rutas configuradas, activas y fuera de cooldown. |
| `POST` | `/admin/playground/chat` | JSON Chat Completion + `api_key_id`; espera la respuesta completa. Usa la estrategia global del router y no fuerza la clasificación exclusiva del Playground. |
| `POST` | `/admin/playground/chat/stream` | JSON Chat Completion + `api_key_id`; SSE JSON con clasificación, selección, fallbacks y deltas del proveedor. En `model:"auto"` fuerza la clasificación de tarea del Playground aunque la estrategia pública global no la fuerce. |

Body mínimo para ambas rutas:

```json
{
  "api_key_id": 12,
  "model": "auto",
  "messages": [{"role":"user","content":"Planifica una migración y sus riesgos"}]
}
```

#### Eventos del stream administrativo

El servidor devuelve `Content-Type: text/event-stream`. Cada frame de datos es `data: <objeto JSON>\n\n`; el stream envía `: connected` al abrir y comentarios `: keep-alive` cada 15 segundos sin actividad. Cada objeto incluye `event` y normalmente `elapsed_ms`.

| `event` | Datos relevantes | Significado |
|---|---|---|
| `routing` | `mode`: `auto` o `manual` | Empieza el enrutamiento. |
| `classified` | `routing` (o `null`), `candidates` | Resultado de categoría y complejidad; en manual la clasificación es `null`. |
| `unavailable` | `model`, `reason` | Se omite un candidato, por ejemplo por cuota. |
| `selected` | `model`, `provider`, `provider_name`, `attempt`, `routing`, `profile`, `tasks` | Modelo elegido antes de la petición al proveedor. |
| `requesting` | `model`, `provider`, `attempt` | Llamada al proveedor iniciada. |
| `delta` | `text`, `model`, `provider` | Fragmento real del proveedor. Algunos proveedores compatibles entregan un único bloque si ignoran streaming. |
| `fallback` | `model`, `provider`, `attempt`, `status_code` | Un candidato falló antes de emitir texto y el router puede intentar otro. |
| `completed` | `completion` | Fin exitoso; contiene la respuesta completa normalizada. |
| `error` | `message`, `status_code` | Solicitud fallida. El error llega dentro de SSE después de iniciar la respuesta. |

Ejemplo de consumo en Node:

```javascript
const response = await fetch(`${baseUrl}/admin/playground/chat/stream`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${adminJwt}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  },
  body: JSON.stringify({
    api_key_id: 12,
    model: 'auto',
    messages: [{ role: 'user', content: 'Planifica una migración con riesgos' }],
  }),
  signal: abortController.signal,
});
if (!response.ok) throw new Error(await response.text());
for await (const data of readSse(response.body)) {
  if (data.startsWith(':')) continue; // comentarios de conexión/keep-alive
  const event = JSON.parse(data);
  switch (event.event) {
    case 'classified': showCategory(event.routing); break;
    case 'selected': showModel(event.model, event.provider); break;
    case 'delta': appendText(event.text); break;
    case 'completed': finish(event.completion); break;
    case 'error': showError(event.message); break;
  }
}
```

El ejemplo supone un lector `readSse` que conserva frames parciales entre lecturas. Al cancelar la conexión, el servidor cancela el trabajo del proveedor y registra la solicitud como `cancelled` cuando recibe la desconexión.

### 4.4 Proveedores y modelos

| Método | Ruta | Body / efecto |
|---|---|---|
| `GET` | `/admin/providers` | Lista `id`, `slug`, `name`, `base_url`, `env_key_name`, `is_enabled`; no devuelve adapter ni secretos. |
| `POST` | `/admin/providers/{slug}` | Upsert del proveedor. Body: `{ "name":"Proveedor", "base_url":"https://…", "env_key_name":"PROVIDER_API_KEY", "is_enabled":true }`. Requiere `name`, `base_url` y `env_key_name`; `is_enabled` es opcional y por defecto `true`. Rechaza propiedades extra. La credencial vive en el entorno, nunca en este body. Devuelve `{id,slug,is_enabled}`. |
| `DELETE` | `/admin/providers/{slug}` | Deshabilita proveedor y todos sus modelos; no elimina historial. Respuesta `204`. |
| `GET` | `/admin/models` | Lista `id`, `provider_id`, `name`, `alias`, `priority`, `weight`, `context_max`, `capabilities`, `tier`, `is_enabled`, `is_free`, `free_verified_at`, `routing_profile`, `routing_tasks`; la salud no está incluida. |
| `POST` | `/admin/models` | Crea modelo; devuelve `201` con `{id,name}`. |
| `PATCH` | `/admin/models/{model_id}` | Actualiza metadatos. En el código actual `provider_id` y `name` son campos requeridos también para PATCH; los otros campos solo cambian si se incluyen. Devuelve `{id,name,is_enabled,is_free,routing_profile,routing_tasks}`. |
| `DELETE` | `/admin/models/{model_id}` | Deshabilita el modelo sin borrar cuotas, salud ni uso. `204`. |
| `GET` | `/admin/models/{model_id}/limits` | Lista cuotas `{id,window,metric,max_value}`. |
| `PUT` | `/admin/models/{model_id}/limits` | Upsert por ventana y métrica. Body `{ "window":"day", "metric":"requests", "max_value":1000 }`. |
| `POST` | `/admin/models/{model_id}/reset-cooldown` | Reinicia circuit breaker y cooldown persistidos; devuelve `{ "status":"reset" }`. |
| `POST` | `/admin/seed/reload` | Vuelve a cargar el catálogo inicial de proveedores desde `config/models.seed.yaml`; devuelve `{ "status":"reloaded" }`. No vuelve a descargar ni habilitar secretos. |

Campos de `POST /admin/models` (y actualizables en PATCH):

```json
{
  "provider_id": 3,
  "name": "modelo-ejemplo",
  "alias": "proveedor/modelo-ejemplo",
  "priority": 100,
  "weight": 1,
  "context_max": 8192,
  "capabilities": ["text", "vision"],
  "is_enabled": true,
  "tier": 3,
  "is_free": null,
  "routing_profile": "balanced",
  "routing_tasks": ["writing", "reasoning"]
}
```

Solo `provider_id` y `name` son requeridos en el esquema. Defaults actuales: alias `null`, prioridad `100`, peso `1`, contexto `8192`, capabilities `["text"]`, habilitado `true`, tier `3`, `is_free:null`, perfil `null`, tareas `[]`. `routing_profile` acepta `light`, `balanced` o `advanced`; `routing_tasks` normalmente contiene categorías reconocidas por el clasificador. `is_free` al crear/actualizar puede marcarse con fecha de verificación actual.

Cuotas: `window` acepta `minute`, `hour`, `day`, `month`; `metric` acepta `requests`, `tokens`, `neurons`; `max_value` debe ser entero positivo. La reserva actual suma `1` a `requests` y usa tokens estimados para cualquier otra métrica; solo reconcilia con uso real las filas `tokens`. Por tanto, `neurons` es aceptado por API pero no representa una medición de neuronas en esta implementación; usa `requests` o `tokens` para límites confiables. Errores de cuota pueden hacer que el router salte el modelo y emita `unavailable`.

### 4.5 Estadísticas y métricas

| Método | Ruta | Acceso | Respuesta / observación |
|---|---|---|---|
| `GET` | `/admin/stats` | JWT | `{requests,success_rate,latency_p50_ms,latency_p95_ms,fallbacks,quota_by_model}`; agregación sin filtros ni paginación. Percentiles se calculan sobre los registros persistidos. |
| `GET` | `/metrics` | Sin auth de aplicación | Exposición Prometheus de contadores por estado y uso de cuota. Devuelve `404` si `PROMETHEUS_ENABLED=false`. Está excluida intencionalmente de OpenAPI; restringe su exposición en red/proxy si no debe ser pública. |

## 5. Cómo decide el router

Antes de llamar a un proveedor, Relevo filtra candidatos por modelo/proveedor habilitado, credenciales, adaptador soportado, contexto, capabilities requeridas, salud/cooldown y límites de intentos. Las imágenes requieren `vision`; `tools` requiere capability `tools`; `response_format.type="json_object"` requiere `json`. La combinación Gemini + tools/JSON no se enruta actualmente.

- **Modelo manual:** selecciona el modelo/alias indicado. No convierte silenciosamente un modelo manual en `auto`.
- **`auto` en API pública:** respeta `ROUTER_STRATEGY`. `priority` conserva orden tier/prioridad; `weighted_round_robin` rota pesos dentro del tier; `laya` permite clasificar cuando `LAYA_ROUTING_MODE` no es `off`. En `shadow`, clasifica para trazas pero no reordena; en `active`, reordena.
- **`auto` en Playground streaming:** ejecuta clasificación para la solicitud y usa la categoría/complejidad para ordenar modelos, aunque el modo global Laya esté apagado. Esto aplica a `/admin/playground/chat/stream`, no al chat administrativo no streaming.
- **Fallback:** puede intentar hasta `ROUTER_MAX_ATTEMPTS`. Un error antes del primer fragmento permite probar el siguiente candidato. Después de transmitir texto se devuelve el error y no se combinan respuestas de modelos distintos.
- **Clasificación:** si Laya no responde, la confianza es baja o el resultado no es válido, usa reglas locales. La petición al clasificador recibe como máximo los últimos seis mensajes de texto y hasta 6.000 caracteres; las imágenes/base64 no se envían al clasificador.

El modo automático no promete que exista un candidato compatible. Ante ausencia de candidatos puede responder `503`; revisa credenciales, catálogo, capacidades, contexto, cooldowns y cuotas.

## 6. Proveedores incluidos y credenciales

Los metadatos iniciales viven en `config/models.seed.yaml`. La base URL y el nombre del proveedor se pueden actualizar en DB; las credenciales no se guardan en DB. El `env_key_name` tiene que corresponder a un campo reconocido por `Settings` (no basta con crear un nombre arbitrario en `POST /admin/providers/{slug}`).

| Slug | Adaptador | Base URL seed | Configuración de credencial |
|---|---|---|---|
| `groq` | OpenAI compatible | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |
| `cerebras` | OpenAI compatible | `https://api.cerebras.ai/v1` | `CEREBRAS_API_KEY` |
| `google-ai-studio` | Gemini nativo | `https://generativelanguage.googleapis.com/v1beta` | `GOOGLE_AI_STUDIO_API_KEY` |
| `openrouter` | OpenAI compatible | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `cloudflare` | OpenAI compatible | `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1` | `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` |
| `cohere` | OpenAI compatible | `https://api.cohere.ai/compatibility/v1` | `COHERE_API_KEY` |
| `mistral` | OpenAI compatible | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` |
| `nvidia` | OpenAI compatible | `https://integrate.api.nvidia.com/v1` | `NVIDIA_API_KEY` |
| `kilo` | OpenAI compatible | `https://api.kilo.ai/api/gateway` | `KILO_API_KEY` opcional para rutas gratuitas anónimas |
| `ollama` | OpenAI compatible | `http://localhost:11434/v1` | `OLLAMA_BASE_URL` y `ROUTER_ENABLE_LOCAL_FALLBACK=true` |
| `huggingface` | OpenAI compatible | `https://router.huggingface.co/v1` | `HUGGINGFACE_API_KEY` |

El adaptador OpenAI compatible llama a `<base_url>/chat/completions`; Gemini transforma mensajes a `generateContent` y usa `streamGenerateContent` para streaming. Cloudflare sustituye `{account_id}` con su configuración. Ollama reemplaza su base URL en la ruta del chat cuando `OLLAMA_BASE_URL` está configurada. El modelo exacto, parámetros aceptados y streaming real dependen de cada proveedor.

## 7. Configuración de entorno

Las variables se leen al iniciar el proceso mediante `Settings` (Pydantic Settings) y el archivo `.env`. Las variables sensibles deben vivir en el entorno/secret manager; no las publiques en este documento, repositorio ni navegador.

### Servicio, URL y almacenamiento

| Variable | Default en código | Función actual |
|---|---|---|
| `APP_ENV` | `development` | En `production` exige secretos explícitos y fuertes; también desactiva `/docs`. |
| `APP_PORT` | `8000` | Declarada en Settings y Compose. `scripts/entrypoint.sh` actualmente ejecuta Uvicorn en `8000` fijo; cambiar solo esta variable no cambia ese comando. |
| `LOG_LEVEL` | `INFO` | Declarada en configuración; el código de aplicación no configura el nivel del logger con esta variable actualmente. |
| `CORS_ORIGINS` | vacío | Lista separada por comas de orígenes permitidos por middleware CORS. |
| `API_PUBLIC_BASE_URL` | sin definir | URL que anuncia `/console-config` y usa la guía de conexión de la consola. |
| `TZ` | `UTC` | Configuración de contenedor usada por Compose/MySQL; no controla la lógica horaria de API, que usa UTC. |
| `DATABASE_URL` | sin definir | URL SQLAlchemy async completa; si existe, reemplaza las variables MySQL. Ejemplo: `mysql+asyncmy://usuario:contraseña@mysql:3306/relevo?charset=utf8mb4`. |
| `DATABASE_AUTO_CREATE` | `false` | Si es `true`, crea tablas al arrancar. En producción se recomienda usar migraciones Alembic. |
| `MYSQL_HOST` | `mysql` | Host MySQL cuando no hay `DATABASE_URL`. |
| `MYSQL_PORT` | `3306` | Puerto MySQL. |
| `MYSQL_DATABASE` | `relevo` | Base MySQL. |
| `MYSQL_USER` | `relevo` | Usuario MySQL de aplicación. |
| `MYSQL_PASSWORD` | valor local de desarrollo | Contraseña de aplicación; obligatoria y explícita en producción. |
| `MYSQL_ROOT_PASSWORD` | valor local de desarrollo | Contraseña root usada por el servicio MySQL Compose; requerida explícitamente por la validación de producción. |

### Autenticación y control de acceso

| Variable | Default en código | Función actual |
|---|---|---|
| `JWT_SECRET` | secreto de desarrollo inseguro | Firma JWT admin. En producción debe ser secreto aleatorio, explícito, único y de al menos 32 caracteres. |
| `JWT_ALGORITHM` | `HS256` | Algoritmo JWT permitido para emitir y verificar tokens. |
| `JWT_EXPIRE_MINUTES` | `60` | Vigencia del JWT administrador. |
| `ADMIN_LOGIN_ATTEMPT_LIMIT` | `5` | Intentos por IP en ventana fija de 5 minutos; rango validado 1–1.000. |
| `API_KEY_PEPPER` | valor de desarrollo inseguro | Pepper HMAC para hashes de claves. En producción requiere valor explícito y único de al menos 32 caracteres. Cambiarlo invalida claves existentes. |
| `API_KEY_ENCRYPTION_SECRET` | valor de desarrollo inseguro | Secreto único de al menos 32 caracteres en producción. Deriva la clave Fernet que cifra las claves recuperables. Consérvalo en un gestor de secretos y haz una copia segura: cambiarlo impide recuperar secretos cifrados previamente, aunque los hashes existentes siguen validando solicitudes. |
| `ADMIN_EMAIL` | sin definir | Cuenta inicial que se crea si no hay ningún administrador en DB. Cambiarla no renombra una cuenta ya creada. |
| `ADMIN_PASSWORD` | sin definir | Contraseña para la cuenta inicial; producción exige explícita y mínimo 12 caracteres. Cambiarla no rota la contraseña guardada de una cuenta existente. |

### Router y clasificación

| Variable | Default en código | Función actual |
|---|---|---|
| `ROUTER_MAX_ATTEMPTS` | `3` | Máximo de modelos que se intentan en una solicitud. |
| `ROUTER_REQUEST_TIMEOUT_SECONDS` | `60` | Timeout de llamadas a proveedores de chat. |
| `ROUTER_COOLDOWN_DEFAULT_SECONDS` | `60` | Cooldown al abrir circuit breaker y fallback para `Retry-After`. |
| `ROUTER_CIRCUIT_FAILURE_THRESHOLD` | `3` | Fallos consecutivos de servidor antes de abrir circuit breaker. |
| `ROUTER_STRATEGY` | `priority` en Settings | `priority`, `weighted_round_robin` o `laya`. Compose `.env.example` propone `laya`; el código por defecto es `priority`. |
| `LAYA_ROUTING_MODE` | `off` | `off`, `shadow` o `active` para el router público con estrategia Laya. En shadow registra decisión sin reordenar; active reordena. |
| `LAYA_BASE_URL` | `http://laya:8000` | URL del clasificador Laya. La ruta usada es `/v1/systemone`. |
| `LAYA_API_KEY` | sin definir | Bearer opcional de Laya; en producción con estrategia Laya activa debe ser explícita y fuerte. |
| `LAYA_CLASSIFIER_MODEL` | `multilingual` | Modelo de clasificación solicitado a Laya. |
| `LAYA_TIMEOUT_SECONDS` | `2` | Timeout de clasificación; rango 0,1–30 segundos. |
| `LAYA_MIN_CONFIDENCE` | `0.55` | Confianza mínima; rango 0–1. Por debajo usa reglas locales. |
| `ROUTER_FREE_ONLY` | `false` | En `auto`, excluye modelos no verificados como gratuitos. No aplica a solicitudes manuales. |
| `ROUTER_ENABLE_LOCAL_FALLBACK` | `false` | Permite enrutar a proveedor Ollama local. |

### Documentación, métricas y valores declarados sin efecto aplicado

| Variable | Default | Estado actual |
|---|---|---|
| `DOCS_ENABLED` | `true` | Habilita Swagger solo fuera de producción. El OpenAPI JSON permanece disponible. |
| `PROMETHEUS_ENABLED` | `false` | Habilita `GET /metrics`; cuando está apagada responde `404`. |
| `LOG_PROMPTS` | `false` | Campo declarado, pero no hay lectura de esta opción en la lógica actual. No activar esperando que cambie el registro de prompts. |

`LAYA_THREADS` aparece en `.env.example` y Compose lo pasa al contenedor Laya como número de hilos; no pertenece a Settings de FastAPI.

### Variables secretas de proveedor

| Variable | Requisito adicional |
|---|---|
| `GOOGLE_AI_STUDIO_API_KEY` | Credencial de Google AI Studio. |
| `GROQ_API_KEY` | Credencial de Groq. |
| `CEREBRAS_API_KEY` | Credencial de Cerebras. |
| `OPENROUTER_API_KEY` | Credencial de OpenRouter. |
| `CLOUDFLARE_ACCOUNT_ID` | Requerido junto con `CLOUDFLARE_API_TOKEN`. |
| `CLOUDFLARE_API_TOKEN` | Requerido junto con `CLOUDFLARE_ACCOUNT_ID`. |
| `COHERE_API_KEY` | Credencial de Cohere. |
| `MISTRAL_API_KEY` | Credencial de Mistral. |
| `NVIDIA_API_KEY` | Credencial de NVIDIA NIM. |
| `KILO_API_KEY` | Opcional para las rutas gratuitas anónimas actuales. |
| `HUGGINGFACE_API_KEY` | Credencial de Hugging Face Inference Providers. |
| `OLLAMA_BASE_URL` | URL base del Ollama accesible desde el contenedor/host y `ROUTER_ENABLE_LOCAL_FALLBACK=true`. |

En `config/models.seed.yaml`, un proveedor se habilita según su credencial; Kilo es una excepción que puede operar en rutas gratuitas anónimas. La credencial se resuelve por `env_key_name` y no se almacena en base de datos. Si se integra un proveedor nuevo, además del registro DB hay que añadir su campo reconocido a `Settings`, el mapping de credencial y un adaptador compatible si no usa OpenAI o Gemini.

## 8. Errores, rate limits y operación

| Estado | Uso típico |
|---|---|
| `400` | Body o contenido no aceptado por el adaptador/proveedor, por ejemplo imagen Gemini en formato incorrecto. |
| `401` | Falta clave/JWT, es inválida, venció o no es del tipo correcto. |
| `404` | Recurso administrativo inexistente, clave inactiva o `/metrics` desactivada. |
| `422` | JSON que no cumple el esquema o parámetros fuera de rango. |
| `429` | Límite de clave, login, clasificación, cuota o proveedor; revisa el header `Retry-After` si está presente. |
| `502` | Respuesta upstream inválida o fallo de autenticación de todos los proveedores candidatos. |
| `503` | No hay modelo compatible/disponible o todos los intentos fallaron. |
| `504` | Timeout del proveedor. |

Reintenta `429` respetando `Retry-After`; para fallos transitorios `502`/`503`/`504`, aplica backoff exponencial con jitter y un máximo. No reintentes automáticamente errores de validación `400`/`422`.

Los contadores de rate limit viven en memoria de proceso (ventana móvil de 60 s para claves y clasificación; 300 s para login). No se comparten entre workers ni réplicas; despliega con un solo worker si necesitas estos límites tal como están o implementa almacenamiento compartido. Las cuotas de modelo y RequestLog sí se persisten en DB. Las claves se validan con HMAC SHA-256 y pepper, y se guardan cifradas con `API_KEY_ENCRYPTION_SECRET` para permitir recuperarlas desde la consola. Al eliminar permanentemente una clave, RequestLog conserva sus datos pero pierde la asociación con esa clave. Los prompts no se registran en `RequestLog`.

## 9. Rutas completas implementadas

Este inventario es la lista de rutas del servicio actual. `/metrics` se implementa fuera del esquema OpenAPI.

| Método | Ruta | Acceso |
|---|---|---|
| `GET` | `/health` | Público |
| `GET` | `/ready` | Público |
| `GET` | `/console-config` | Público |
| `GET` | `/openapi.json` | Público (FastAPI lo expone por defecto) |
| `GET` | `/docs` | Público en desarrollo si `DOCS_ENABLED=true` |
| `POST` | `/v1/chat/completions` | Clave consumidor |
| `GET` | `/v1/models` | Clave consumidor |
| `POST` | `/admin/auth/login` | Público, limitado por IP |
| `POST` | `/admin/routing/classify` | JWT admin |
| `GET` | `/admin/api-keys` | JWT admin |
| `POST` | `/admin/api-keys` | JWT admin |
| `POST` | `/admin/api-keys/{key_id}/reveal` | JWT admin |
| `POST` | `/admin/api-keys/{key_id}/rotate` | JWT admin |
| `DELETE` | `/admin/api-keys/{key_id}` | JWT admin |
| `DELETE` | `/admin/api-keys/{key_id}/permanent` | JWT admin |
| `GET` | `/admin/providers` | JWT admin |
| `POST` | `/admin/providers/{slug}` | JWT admin |
| `DELETE` | `/admin/providers/{slug}` | JWT admin |
| `GET` | `/admin/models` | JWT admin |
| `POST` | `/admin/models` | JWT admin |
| `PATCH` | `/admin/models/{model_id}` | JWT admin |
| `DELETE` | `/admin/models/{model_id}` | JWT admin |
| `GET` | `/admin/models/{model_id}/limits` | JWT admin |
| `PUT` | `/admin/models/{model_id}/limits` | JWT admin |
| `POST` | `/admin/models/{model_id}/reset-cooldown` | JWT admin |
| `GET` | `/admin/playground/catalog` | JWT admin |
| `POST` | `/admin/playground/chat` | JWT admin + clave consumidor activa |
| `POST` | `/admin/playground/chat/stream` | JWT admin + clave consumidor activa |
| `GET` | `/admin/stats` | JWT admin |
| `POST` | `/admin/seed/reload` | JWT admin |
| `GET` | `/metrics` | Público si está habilitado; fuera de OpenAPI |

## 10. Recomendaciones para el agente integrador

1. Usa `GET /v1/models` con la clave de la aplicación y guarda sus IDs de forma dinámica; no codifiques el catálogo del proveedor.
2. Usa `model:"auto"` si quieres que Relevo elija, pero consulta al administrador qué estrategia global está desplegada. Para selección por tarea en tiempo real, integra el SSE del Playground solo si tu cliente está autorizado como administrador.
3. Mantén la clave de consumidor en un backend; no la incluyas en JavaScript entregado al navegador, prompts, logs o parámetros URL.
4. Implementa timeout, cancelación, parsing incremental SSE, detección de errores dentro del stream y backoff con `Retry-After`.
5. Trata `relevo.model`, `relevo.provider` y los headers `X-Relevo-*` como metadatos de la ruta real; el `model` OpenAI puede ser alias.
6. Verifica las capabilities del modelo para imágenes, tools y JSON y respeta las limitaciones concretas de cada adaptador.
7. Antes de integrar un proveedor nuevo, registra la variable de credencial en `app/core/config.py`, metadata del proveedor en `config/models.seed.yaml`, adapter y sus pruebas. `POST /admin/providers/{slug}` por sí sola no instala integración de código.
