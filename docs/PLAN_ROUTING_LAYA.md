# Plan de implementación: selección de modelos con Laya

Fecha: 2026-10-09. Proyecto: Relevo. Estado: integración implementada; el modo queda apagado por defecto hasta que se habilite Laya. La evaluación con consultas reales queda pendiente de datos representativos.

## 1. Decisión implementada

Integrar Laya como clasificador local en un servicio Docker independiente. Relevo utilizará su clasificación para ordenar los modelos gratuitos que puedan resolver cada solicitud. La elección cambiará con la tarea, las capacidades necesarias, la disponibilidad y las cuotas.

Una precisión sobre el repositorio: el `Router` de Laya selecciona un checkpoint del propio clasificador. `route()` no ejecuta inferencia ni elige automáticamente un LLM de nuestro catálogo. Para nuestro objetivo utilizaremos preguntas personalizadas mediante `predict()` o su API HTTP. La respuesta `routing.model = multilingual` identifica el clasificador, no el modelo que contestará al usuario. [Documentación de routing](https://nandhakishorm.github.io/laya/routing/).

Empezaremos con el checkpoint multilingüe, adecuado como candidato para consultas en español. Su calidad para las categorías de Relevo deberá medirse. [Ficha del modelo](https://huggingface.co/convaiinnovations/laya-multilingual).

**Flujo propuesto:** solicitud → requisitos técnicos y candidatos disponibles → clasificación Laya → orden por adecuación → reserva de cuota → respuesta del proveedor → registro y fallback.

## 2. Qué aprovechamos del proyecto

`app/router/service.py` ya concentra la selección y el fallback de la API pública y el Playground. Filtra habilitación, credenciales, contexto, capacidades y cooldown. Conservaremos esa entrada común, añadiendo una estrategia `laya` junto a `priority` y `weighted_round_robin`.

Hay dos requisitos previos para que el resultado sea fiable:

- **Cuotas:** `adjust_token_reservation`, en `app/router/quotas.py`, suma reservas de varias ventanas y aplica la misma diferencia a todas. Se debe reconciliar cada contador por separado y tratar las unidades distintas de tokens con su propia regla. Una decisión basada en contadores incorrectos desperdiciaría disponibilidad.
- **Gratuidad:** `app/providers/catalog.py` detecta información de gratuidad que no se conserva en `Model`. Añadiremos un estado verificable y fecha de revisión. Un modelo de precio desconocido quedará fuera del modo «solo gratuitos» hasta confirmarlo.

El `tier` actual depende del proveedor. No se utilizará como prueba de que un modelo sea más potente. Las calificaciones serán por modelo y tarea.

## 3. Clasificación inicial

Una sola petición a Laya contendrá dos preguntas de elección:

| Pregunta | Opciones propuestas |
| --- | --- |
| ¿Qué tarea necesita resolver? | Conversación, redacción/traducción, resumen/extracción, programación, razonamiento/análisis, otra |
| ¿Qué dificultad tiene? | Simple, intermedia, compleja |

Las descripciones tendrán criterios concretos: reformular una frase es simple; reparar código con varias restricciones puede ser intermedio; analizar una arquitectura con dependencias y decisiones justificadas puede ser complejo. La longitud del mensaje por sí sola no determina la dificultad.

Usaremos `Choice` para ambas preguntas. La documentación de benchmarks advierte de limitaciones en clasificación, calibración y en la primitiva `Score`; las métricas publicadas no demuestran precisión para nuestra selección de modelos. [Benchmarks y límites](https://nandhakishorm.github.io/laya/benchmarks/).

El contexto incluirá la consulta actual y los turnos necesarios para entender referencias. Definiremos un presupuesto explícito para ese texto y registraremos recortes. No enviaremos imágenes en base64 al clasificador; la API seguirá detectando visión, herramientas y formato estructurado por separado.

El adaptador usará `POST /v1/systemone`, fijará `model: multilingual` y normalizará las respuestas. Para decisiones de baja confianza utilizará `answer_confidence`, con umbrales calibrados por pregunta. También comprobará indicadores de truncamiento y respuestas incompletas. El parámetro `min_confidence` no sustituye nuestra política de fallback. Mantendremos la respuesta completa, sin modo JEV estricto. [API HTTP](https://nandhakishorm.github.io/laya/http-api/).

## 4. Cómo escogeremos el modelo final

Crearemos tres perfiles iniciales, con candidatos identificados por proveedor y modelo:

| Perfil | Uso esperado | Criterio para incluir un modelo |
| --- | --- | --- |
| Ligero | Consultas simples, traducción breve, extracción sencilla | Calidad suficiente y bajo consumo observado |
| Equilibrado | Programación habitual, resúmenes y análisis moderado | Buen equilibrio de calidad, latencia y disponibilidad |
| Avanzado | Razonamiento difícil, depuración compleja, decisiones con muchas restricciones | Mejor calidad comprobada para esa tarea |

Un modelo puede ser avanzado en programación y equilibrado en redacción. El tamaño y la marca no bastarán para asignarlo a un perfil. Las asignaciones iniciales serán provisionales hasta evaluarlas.

La primera versión utilizará una política explícita y configurable:

1. Respetar el modelo solicitado expresamente; clasificar únicamente solicitudes `auto`.
2. Excluir candidatos incompatibles con capacidades, contexto, gratuidad o estado operativo.
3. Determinar el perfil recomendado a partir de tarea y dificultad.
4. Ordenar por calidad mínima requerida y adecuación a la tarea; entre candidatos suficientes, favorecer disponibilidad de cuota y latencia observada.
5. Reservar cuota de forma atómica. Si otro usuario la consumió entretanto, continuar con el siguiente candidato.
6. Ante rechazo del proveedor, probar una alternativa de calidad suficiente, favoreciendo otro proveedor cuando comparta el mismo fallo o límite.

Si no quedan modelos del perfil, intentar uno superior disponible. No bajar silenciosamente de calidad en tareas complejas: cualquier degradación será una política configurable y quedará registrada. Si solo se permiten gratuitos y no hay candidatos, devolver una falta de disponibilidad explícita.

Si Laya falla, está saturado, devuelve datos inválidos o no alcanza el umbral, una política local elegirá un perfil conservador. Las consultas ambiguas no se enviarán automáticamente al modelo ligero. Esa política reutilizará las mismas restricciones y cuotas.

**Ejemplos de comportamiento esperado, pendientes de evaluación:**

- «Traduce esta frase» → redacción/traducción simple → candidato ligero adecuado.
- «Corrige este error con estos archivos» → programación intermedia → equilibrado competente en código.
- «Analiza estos bloqueos y propón una solución con varias restricciones» → programación compleja → avanzado competente en código.
- «Describe esta imagen» → requisito de visión obligatorio; la clasificación textual no lo elimina.

## 5. Despliegue y cambios concretos

Laya irá en la red interna de Docker, con volumen para los pesos, autenticación interna y sin publicar un puerto al exterior. Así las dependencias de inferencia no entran en el proceso FastAPI de Relevo.

La guía de Docker pide prever 8 GB de RAM y 10 GB de disco para su inicio rápido; esto es una referencia de capacidad, no una medición de consumo del despliegue propuesto. Empezaremos con CPU, un checkpoint precargado y versiones fijadas del código y de los pesos. No hace falta una API de pago para esa inferencia local, aunque sí recursos de la máquina. [Guía Docker](https://nandhakishorm.github.io/laya/docker/).

Configuración upstream prevista: `LAYA_DEVICE=cpu`, `LAYA_MODELS=multilingual`, `LAYA_PRELOAD=1`, `LAYA_MAX_LOADED=1`, revisión fijada y clave interna. Relevo fijará también el checkpoint en cada petición. Antes de habilitar la estrategia, una clasificación de arranque comprobará que la inferencia funciona.

Configuración nueva de Relevo, cuyos nombres son propuestas:

- `LAYA_BASE_URL`, clave interna y tiempo máximo de clasificación.
- `LAYA_ROUTING_MODE=off|shadow|active`.
- Versión de preguntas, perfiles y umbrales.
- Límite de peticiones simultáneas al clasificador.

El límite configurable comienza en 2 segundos por clasificación. La integración usa timeout y fallback local, sin reintentar una clasificación saturada. Cancelar HTTP no garantiza detener un cálculo ya iniciado en el servidor. [Implementación del servidor](https://github.com/NandhaKishorM/laya/blob/main/laya/serve.py).

| Área | Cambios previstos |
| --- | --- |
| `app/router/classifiers/` — nuevo | Contrato común, adaptador HTTP de Laya y alternativa local |
| `app/router/selection.py` — nuevo | Traducción de clasificación a candidatos ordenados |
| `config/routing.profiles.yaml` — nuevo | Perfiles, especialidades y políticas versionadas |
| `app/router/service.py` | Incorporar estrategia y reutilizar reservas/fallback |
| `app/core/config.py` y ciclo de vida de la API | Configuración y cliente HTTP reutilizable |
| Catálogo, modelos y migraciones | Gratuidad verificable y trazabilidad de decisiones |
| `app/router/quotas.py` | Corrección de reconciliación de reservas |
| `docker-compose.yml` y configuración de ejemplo | Servicio opcional Laya y caché persistente |
| Consola y Playground | Activación, perfiles, disponibilidad y explicación de la elección |

La consola incluye ahora «Modelos» para editar gratuidad, perfil y tareas por modelo. Los campos se guardan en base de datos y el backend aplica el perfil en modo activo. La API y el Playground devuelven la clasificación en `relevo.routing`; el texto de las consultas no se añade al registro. Los modos y credenciales se configuran mediante variables de entorno.

Para levantar el clasificador local en Docker Compose, configura `ROUTER_STRATEGY=laya`, `LAYA_ROUTING_MODE=shadow` y una `LAYA_API_KEY` aleatoria de al menos 32 caracteres; inicia Compose con el perfil `laya`. El perfil construye la versión upstream `v0.3.28`, precarga el checkpoint multilingüe y conserva los pesos en `laya-cache`. Tras observar decisiones, cambia `LAYA_ROUTING_MODE=active`. La migración `0002_laya_routing` se aplica con el arranque habitual de la API.

El código deja el modo en `off` por defecto. El piloto y la medición de calidad no pueden darse por completados hasta probar una muestra representativa de consultas y asignar perfiles/tareas basados en evaluación; la pantalla de modelos permite configurar ese catálogo.

Los registros conservarán tarea, dificultad, confianza, versiones, tiempo del clasificador, proveedor/modelo final y motivo de fallback. No guardaremos el contenido de las consultas por defecto. La API existente conservará su contrato principal; la información adicional irá en los metadatos de Relevo.

## 6. Fases y criterios de entrega

| Fase | Trabajo | Resultado para aprobar el avance |
| --- | --- | --- |
| 1. Base y perfiles — 1–2 días | Corregir cuotas, persistir gratuidad, inventariar candidatos y definir categorías | Pool gratuito identificable y perfiles iniciales revisables |
| 2. Servicio local — 1–2 días | Docker, pesos fijados, precarga, conexión y límites de espera | Clasificación real en español y medición de recursos |
| 3. Clasificador — 1–2 días | Dos preguntas, normalización, contexto y fallback local | Decisión estructurada consistente y fallos controlados |
| 4. Integración — 2–3 días | Estrategia `laya`, ranking, reservas, trazas y controles mínimos en consola | API y Playground usan el mismo selector configurable |
| 5. Evaluación y piloto — 2–4 días | Comparación, calibración y activación gradual | Evidencia de calidad y disponibilidad antes de activar por defecto |

Estimación orientativa: **7–13 días de trabajo**, condicionada por recursos locales, comportamiento del checkpoint y calidad del catálogo. El ajuste fino, nuevas capacidades de proveedores y cuotas compartidas complejas pueden ampliar el alcance.

Evaluaremos 150–300 consultas representativas en español, incluyendo código, conversaciones con referencias, entradas largas, imágenes y consultas ambiguas. Separaremos ejemplos de ajuste y evaluación final para evitar calibrar sobre el mismo conjunto usado para informar resultados.

Se compararán tres políticas: selector actual, reglas locales y Laya. Mediremos clasificación, calidad de las respuestas, consumo por respuesta aceptable, latencia y fallos por cuota. Un HTTP 200 no será una evaluación de calidad.

Las pruebas previstas cubrirán errores de Laya, confianza baja, truncamiento, capacidades, cuotas concurrentes, caída de proveedores y solicitudes de modelo explícito. No se han ejecutado en esta etapa de planificación.

Primero usaremos `shadow`: Laya propondrá una decisión mientras responde el selector actual. Este modo permite medir decisiones y latencia; para comparar la calidad de modelos alternativos hará falta una evaluación separada que sí consume sus cuotas. Después activaremos un subconjunto de solicitudes y finalmente el modo general si supera los criterios acordados. El retorno al selector anterior será inmediato mediante configuración.

## 7. Evolución después del piloto

1. Actualizar puntuaciones por tarea con evaluaciones periódicas y muestras revisadas.
2. Incorporar cuotas compartidas por cuenta/proveedor cuando los límites conocidos lo requieran; no asumir independencia entre modelos que usan la misma cuenta.
3. Añadir escalamiento a un modelo superior cuando una evaluación específica detecte una respuesta insuficiente, con presupuesto acotado.
4. Si la clasificación inicial no supera reglas simples, mantenerla en observación y evaluar ajuste fino con ejemplos propios.

La primera entrega se concentra en Laya, tres perfiles y selección según disponibilidad. El aprendizaje automático del ranking y un evaluador adicional de cada respuesta quedan para después de demostrar utilidad en el piloto.
