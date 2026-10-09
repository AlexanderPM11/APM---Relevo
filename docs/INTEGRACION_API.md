# Integración y referencia de la API de Relevo

Relevo ofrece chat compatible con Chat Completions de OpenAI y rutas administrativas. Usa como base URL el origen público del despliegue. La consola la obtiene de `API_PUBLIC_BASE_URL` o del origen de la petición. En desarrollo puede estar activa la documentación interactiva `/docs`; el esquema se publica en `/openapi.json`.

## Autenticación

### Clave para aplicaciones consumidoras

Crea una clave `rlv_…` desde la consola o `POST /admin/api-keys`. En rutas públicas envíala así:

```http
Authorization: Bearer rlv_<CLAVE>
```

El secreto se muestra una sola vez al crearlo. Guárdalo en el servidor como secreto; no lo incluyas en código de navegador. Cada clave tiene un límite de solicitudes por minuto. El limitador actual usa memoria del proceso, por lo que el conteo no se comparte entre varias réplicas.

### Token administrativo

Llama a `POST /admin/auth/login` con correo y contraseña. Envía el `access_token` como `Authorization: Bearer <JWT>` a rutas `/admin/*`. El token caduca según `JWT_EXPIRE_MINUTES` (60 minutos por defecto). Los intentos de acceso tienen límite por IP configurable.

## Endpoints para integrar aplicaciones

### `GET /v1/models`

Requiere clave de consumidor. Devuelve modelos activos, configurados y enrutables en formato OpenAI:

```json
{
  "object": "list",
  "data": [
    { "id": "groq/llama-model", "object": "model", "owned_by": "groq" }
  ]
}
```

El catálogo se consulta en los endpoints de listado de los proveedores configurados y se sincroniza con la base de datos; una respuesta exitosa se cachea 5 minutos. Se filtran modelos que no parecen conversacionales. En OpenRouter y Kilo solo se conservan modelos identificados explícitamente como gratuitos por metadatos de precio o sufijo `:free`. La respuesta no incluye precios ni garantiza que el proveedor mantenga gratuito el modelo. Proveedores sin credencial, deshabilitados o con modelo en cooldown no aparecen. Usa el `id` exacto recibido o `auto`.

### `POST /v1/chat/completions`

Requiere clave de consumidor. Acepta el siguiente subconjunto compatible con OpenAI:

```json
{
  "model": "auto",
  "messages": [{ "role": "user", "content": "Hola" }],
  "temperature": 0.7,
  "top_p": 1,
  "max_tokens": 512
}
```

Campos:

- `model`: `auto` o un identificador de `/v1/models` (también alias/modelos registrados).
- `messages`: lista no vacía con roles `system`, `user`, `assistant` o `tool`. `content` acepta texto o una lista de partes de contenido.
- `temperature`: 0–2; `top_p`: 0–1; `max_tokens`: entero positivo.
- `tools` y `response_format`: se envían a modelos/proveedores que soporten la capacidad.
- `stream`: debe ser `false` u omitirse. `true` responde `501`; streaming aún no está implementado.

Ejemplo de contenido con imagen en formato OpenAI (requiere modelo con visión):

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "¿Qué aparece en esta imagen?" },
    { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,<DATOS_BASE64>" } }
  ]
}
```

`GET /v1/models` no incluye capacidades; el catálogo del chat administrativo sí informa `vision`. No asumas que todos los modelos aceptan imágenes, herramientas o JSON.

Una respuesta exitosa contiene el objeto estándar `chat.completion` de OpenAI (`choices`, `usage`) y este dato adicional:

```json
"relevo": { "model": "modelo-real", "provider": "groq", "attempts": 1 }
```

También incluye los encabezados `X-Relevo-Model`, `X-Relevo-Provider` y `X-Relevo-Attempts`. El modo automático prueba candidatos compatibles y puede recurrir a otros ante fallos o restricciones. El modo manual solicita el modelo indicado y puede fallar si no está disponible.

#### cURL

```bash
curl "$RELEVO_BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $RELEVO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hola"}]}'
```

Define `RELEVO_BASE_URL` como el origen del servicio (por ejemplo `https://api.ejemplo.com`) y `RELEVO_API_KEY` en el entorno seguro de tu aplicación.

#### Python con SDK OpenAI

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
```

#### JavaScript en servidor

```javascript
const response = await fetch(`${process.env.RELEVO_BASE_URL}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.RELEVO_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'auto',
    messages: [{ role: 'user', content: 'Hola' }],
  }),
});

if (!response.ok) throw new Error(`Relevo respondió ${response.status}: ${await response.text()}`);
const result = await response.json();
console.log(result.choices[0].message.content);
```

## Endpoints operativos

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| `GET` | `/health` | Público | Confirma que el proceso está vivo: `{"status":"ok"}`. |
| `GET` | `/ready` | Público | Comprueba base de datos y disponibilidad de al menos un modelo; responde `503` si no está listo. |
| `GET` | `/console-config` | Público | Devuelve `api_base_url` para la consola. |

## Endpoints administrativos

Todas las rutas siguientes requieren JWT administrativo, excepto el login.

### Sesión y claves

| Método | Ruta | Función / entrada |
|---|---|---|
| `POST` | `/admin/auth/login` | Body `{ "email": "admin@ejemplo.com", "password": "…" }`; devuelve `{access_token, token_type}`. |
| `GET` | `/admin/api-keys` | Lista id, nombre, prefijo, propietario, estado y límite; nunca devuelve el secreto. |
| `POST` | `/admin/api-keys` | Crea clave. Body `{ "name": "Mi app", "owner": "Equipo", "requests_per_minute": 60 }`; devuelve `201` y `api_key` una vez. |
| `DELETE` | `/admin/api-keys/{key_id}` | Revoca (desactivación lógica) y devuelve `204`. |

### Playground administrativo

| Método | Ruta | Función / entrada |
|---|---|---|
| `GET` | `/admin/playground/catalog` | Actualiza catálogo y devuelve claves activas y modelos enrutables con proveedor y capacidades. |
| `POST` | `/admin/playground/chat` | Solicitud de chat más `api_key_id`; atribuye uso y aplica el límite de esa clave. Requiere JWT admin. |

### Proveedores y modelos

| Método | Ruta | Función / entrada |
|---|---|---|
| `GET` | `/admin/providers` | Lista metadatos de proveedores, sin secretos. |
| `POST` | `/admin/providers/{slug}` | Crea/actualiza: `{ "name": "Proveedor", "base_url": "https://…", "env_key_name": "PROVIDER_API_KEY", "is_enabled": true }`. La credencial se define en el entorno. |
| `DELETE` | `/admin/providers/{slug}` | Deshabilita el proveedor, sin borrarlo. |
| `GET` | `/admin/models` | Lista modelos y metadatos de enrutamiento. |
| `POST` | `/admin/models` | Crea modelo. Requiere `provider_id`, `name`; admite `alias`, `priority` (100), `weight` (1), `context_max` (8192), `capabilities` (por defecto `text`), `is_enabled` (true), `tier` (3). Devuelve `201`. |
| `PATCH` | `/admin/models/{model_id}` | Actualiza metadatos con el mismo esquema que `POST`. |
| `DELETE` | `/admin/models/{model_id}` | Deshabilita modelo y conserva historial. |
| `GET` | `/admin/models/{model_id}/limits` | Lista cuotas definidas para el modelo. |
| `PUT` | `/admin/models/{model_id}/limits` | Crea/actualiza cuota: `{ "window": "day", "metric": "requests", "max_value": 1000 }`. Ventanas: `minute`, `hour`, `day`, `month`; métricas: `requests`, `tokens`, `neurons`. |
| `POST` | `/admin/models/{model_id}/reset-cooldown` | Reinicia el cooldown/circuit breaker del modelo. |
| `POST` | `/admin/seed/reload` | Recarga metadatos iniciales de proveedores/modelos. |

### Estadísticas y métricas

| Método | Ruta | Acceso | Función |
|---|---|---|---|
| `GET` | `/admin/stats` | JWT admin | Agrega solicitudes, tasa de éxito, latencia p50/p95, fallbacks y consumo de cuotas por modelo. |
| `GET` | `/metrics` | Sin autenticación de aplicación | Métricas Prometheus; responde `404` si `PROMETHEUS_ENABLED` está apagado. No aparece en OpenAPI. |

## Errores y reintentos

Los errores de FastAPI suelen tener forma `{ "detail": "…" }`. Códigos comunes: `401` autenticación inválida, `404` recurso inexistente/inactivo, `422` datos inválidos, `429` límite excedido (puede incluir `Retry-After`), `501` streaming solicitado y `503` ningún modelo utilizable o fallo de proveedores. Respeta `Retry-After` y aplica backoff para `429`/`503`.

Las solicitudes registran clave, modelo solicitado/final, resultado, latencia, intentos y tokens usados; los registros ordinarios no almacenan el contenido de los mensajes.

## CORS y documentación

Para llamadas desde navegador, configura los orígenes permitidos con `CORS_ORIGINS`. Se recomienda llamar desde un backend propio para no exponer la clave. `/docs` solo está activo si `DOCS_ENABLED` está habilitado y el entorno no es `production`; `/openapi.json` sirve el esquema FastAPI.
