# Pruebas de Laya con Docker y Postman

## Servicios disponibles

La configuración productiva local se levanta con:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.production.yml ps
```

El frontend y la API se publican en `http://127.0.0.1:8080`; Laya permanece dentro de la red Docker y no tiene un puerto público. Health checks: `/health`, `/ready`. El modelo multilingüe se precarga; el primer arranque descarga los pesos y puede tardar más.

Para observar sin cambiar la selección de modelos, usa el perfil base, que lee `LAYA_ROUTING_MODE=shadow` del `.env` local:

```powershell
docker compose -f docker-compose.yml up -d app web laya
```

Para volver al selector activo:

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d app web laya
```

El perfil activo actual restringe `model: auto` a modelos con gratuidad confirmada por los catálogos. Las cuotas gratuitas y disponibilidad dependen de cada proveedor.

## Importar Postman

Importa estos dos archivos desde Postman:

- `postman/Relevo-Docker.postman_collection.json`
- `postman/Relevo-Docker.postman_environment.json`

Selecciona el entorno **Relevo Docker local** y completa `admin_email` y `admin_password` con la cuenta administradora configurada en el despliegue. No exportes ni compartas el entorno después de iniciar sesión: guardará el JWT y la clave `rlv_…` de consumidor.

Ejecuta las solicitudes en este orden:

1. **Health** debe dar `200` y `{"status":"ok"}`.
2. **Ready** debe dar `200`; si da `503`, revisa los proveedores, modelos habilitados y cooldowns.
3. **Iniciar sesión de administrador** guarda `admin_token`.
4. **Crear clave de consumidor** guarda la clave una sola vez y su id. Revócala al terminar.
5. **Listar modelos habilitados** confirma que el token de consumidor y el catálogo funcionan.
6. **Clasificar y medir una consulta** llama únicamente a Laya; no consume cuota de un modelo de chat.
7. Ejecuta las dos solicitudes **Chat auto** para revisar el recorrido completo de clasificación, selección y respuesta.
8. **Estadísticas** muestra resultados registrados; opcionalmente revoca la clave temporal.

La colección usa la API servida por `web` como proxy. No apuntes Postman a `laya:8000`: ese nombre solo se resuelve dentro de Docker.

## Medir velocidad de clasificación

La ruta administrativa `POST /admin/routing/classify` está protegida por JWT, limita el texto a 6.000 caracteres y permite hasta 30 mediciones por minuto y administrador. No llama al proveedor del chat. Ejemplo:

```json
{
  "text": "Traduce al inglés: buenos días"
}
```

La respuesta contiene `task`, `complexity`, `confidence`, `classifier`, `classifier_ms`, `request_ms`, `fallback`, `mode` y `strategy`. `classifier_ms` mide la llamada al clasificador y su procesamiento en la API; `request_ms` mide el tramo de diagnóstico. Postman añade el tiempo HTTP de extremo a extremo, que incluye proxy, autenticación y red local.

Para obtener una muestra inicial comparable:

1. Envía una vez **Clasificar y medir una consulta** para calentar el modelo.
2. Envía **Reiniciar mediciones** una vez.
3. En Collection Runner ejecuta únicamente **Clasificar y medir una consulta** durante 20 iteraciones. Evita ejecutar Login o Crear clave en cada iteración.
4. Revisa `benchmark_summary` en el entorno Postman. Incluye media, p50 y p95 para `classifier_ms` y tiempo HTTP, además de cuántos resultados usaron fallback local.
5. Repite con `benchmark_text` para traducción, resumen, programación y razonamiento. Mantén el mismo conjunto de frases entre modo `shadow` y `active`.

Compara por separado el primer resultado (arranque en frío) y las iteraciones posteriores (modelo precargado). El tiempo de clasificación esperado debe evaluarse localmente: CPU, contención Docker, longitud del texto y carga concurrente pueden cambiarlo. No uses el tiempo de chat como si fuera tiempo de Laya: incluye generación del proveedor y reintentos.

## Interpretar trazas y fallos

La respuesta de chat incluye `relevo.routing`:

- `task` y `complexity`: señales de enrutamiento.
- `confidence`: confianza mínima de las dos respuestas de Laya.
- `classifier`: `laya` si Laya clasificó; `laya+rules` si reglas de alta señal corrigieron tarea/dificultad; `rules` si se usó el fallback local por baja confianza, truncamiento o indisponibilidad.
- `classifier_ms`: tiempo del clasificador local/remoto.
- `fallback`: motivo si se degradó al clasificador local; `null` cuando Laya clasificó.
- `mode`: `shadow` calcula y registra la decisión sin reordenar modelos; `active` sí reordena.

Una clasificación válida debe devolver una categoría y dificultad válidas, y normalmente `classifier: laya`. Si aparece `rules`, inspecciona `fallback` y los logs de Laya:

```powershell
docker compose logs --tail 100 app laya
```

`/admin/stats` mide latencia de solicitudes de chat, no solo clasificación. Su `fallbacks` cuenta reintentos entre modelos/proveedores; no cuenta el fallback local de Laya. En respuestas fallidas `429`, respeta `Retry-After`; `503` indica que no hubo candidato utilizable o fallaron los proveedores.

## Criterios para decidir si está funcionando

- **Disponibilidad:** `app`, `web`, `mysql` y `laya` siguen arriba; `app`, `mysql` y `laya` saludables.
- **Clasificación:** las categorías corresponden al tipo de consulta y la dificultad aumenta con restricciones y pasos; registra confianza y fallback.
- **Calidad de selección:** en `active`, contrasta `relevo.model`, `relevo.provider`, tarea/dificultad y perfiles de modelos. En `shadow`, verifica que la clasificación sea útil sin esperar que cambie el modelo elegido.
- **Latencia:** usa al menos 20 muestras, separa frío/cálido y revisa p50/p95; define límites aceptables para tu máquina antes de evaluarlos.
- **Coste y límites:** `ROUTER_FREE_ONLY=true` solo usa rutas con gratuidad declarada por el catálogo; aun así puede haber cuotas, rate limits o cambios de precio aguas arriba.
- **Resiliencia:** el fallback `rules` debe devolver una respuesta diagnóstica cuando Laya no está disponible; el chat debe informar `429`/`503` de forma visible y recuperarse al restaurar el servicio.
- **Privacidad:** el endpoint de preview no devuelve ni registra el texto en `RequestLog`; no compartas tokens, contraseñas ni claves de Postman.

## Límites conocidos

- El clasificador mide una decisión, no evalúa si la respuesta final del LLM fue correcta.
- `/ready` comprueba que hay un proveedor/modelo habilitado y configurado; no garantiza que un endpoint gratuito concreto acepte solicitudes en ese instante.
- El límite de preview y el rate limit de API se guardan en memoria de proceso; están pensados para esta instancia local de Docker.
- `classifier_ms` no sustituye una prueba de carga ni un SLA. Haz pruebas con concurrencia y volumen reales antes de publicar el servicio.
