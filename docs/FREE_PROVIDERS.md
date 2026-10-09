# Proveedores con acceso gratuito para Relevo

Revisión de documentación oficial: 2026-10-08. “Gratis” no implica capacidad continua, SLA ni que todos los modelos estén disponibles en todos los países. Los límites y el catálogo cambian; el dashboard del proveedor prevalece sobre esta lista.

## Proveedores incorporados al catálogo

| Proveedor | Tipo de acceso gratuito | Variable | Modelo semilla | Observaciones |
| --- | --- | --- | --- | --- |
| Groq | Nivel gratuito con límites por modelo | `GROQ_API_KEY` | `openai/gpt-oss-120b` | Límites por minuto/día; `429` pausa el modelo. |
| Cloudflare Workers AI | Asignación de 10.000 Neurons por día en Workers Free | `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` | `@cf/meta/llama-3.1-8b-instruct-fp8` | El token necesita permisos de Workers AI. Algunos modelos requieren plan de pago. |
| Google AI Studio | Nivel gratuito para modelos seleccionados | `GOOGLE_AI_STUDIO_API_KEY` | `gemini-3.8-flash` | Límites según proyecto, modelo y región. La facturación de Google está migrando a planes prepago/pospago; comprueba el nivel Free en AI Studio. |
| OpenRouter | Modelos gratuitos; límite publicado del plan Free de 50 solicitudes al día | `OPENROUTER_API_KEY` | `openrouter/free` | Un gateway con modelos de terceros; los modelos gratuitos disponibles cambian. |
| Kilo Gateway | Modelo dinámico `kilo-auto/free`; permite llamadas anónimas gratuitas, hasta 200 solicitudes/hora por IP | No requiere clave para la ruta gratuita; `KILO_API_KEY` es opcional | `kilo-auto/free` | Los modelos subyacentes cambian y pueden incluir endpoints NVIDIA de prueba. Kilo advierte que algunos pueden registrar solicitudes y usar datos para mejorar sus servicios; no envíes información personal o confidencial. |
| Cohere | Clave de evaluación gratuita, limitada a 1.000 llamadas al mes | `COHERE_API_KEY` | `command-r7b-12-2024` | Es cuota de evaluación; 20 llamadas/min para Chat según el modelo. |
| Hugging Face Inference Providers | Crédito mensual de $0.10 en cuentas Free | `HUGGINGFACE_API_KEY` | `openai/gpt-oss-120b:groq` | Crédito compartido del router de Hugging Face; al agotarlo se requieren créditos para seguir. |
| Cerebras | El material oficial presenta un nivel Free de $0 y también anuncia $5 de crédito inicial | `CEREBRAS_API_KEY` | `gpt-oss-120b` | Lo incluimos como candidato, pero no contamos su crédito de bienvenida como cuota recurrente. Verifica el saldo y el plan visible en tu cuenta. |
| Mistral | Free mode anuncia creación de clave sin tarjeta; algunos endpoints pueden responder `402` si el modelo requiere método de pago | `MISTRAL_API_KEY` | `mistral-small-latest` | Fallback continúa si la cuenta/modelo no tiene cuota gratuita habilitada. |
| Ollama | Inferencia local sin cuota cloud | `OLLAMA_BASE_URL` | Alta manual | Requiere instalar y ejecutar Ollama con modelos descargados; desactivado por defecto. |

## Credenciales de prueba, no incluidas como cuota gratuita recurrente

NVIDIA API Catalog ofrece claves para probar modelos y puede conceder créditos de prueba; no hay una asignación recurrente general garantizada. SambaNova pide añadir un medio de pago y comprar créditos. OpenCode Zen requiere configurar datos de facturación y cobra por solicitud. Por eso no se activan en la ruta gratuita automática.

GitHub Models dejó de ofrecer su API el 30 de julio de 2026. DeepSeek API se factura por uso. Los proveedores que solo dan créditos promocionales, aunque no pidan tarjeta al registrarse, no se cuentan como cuota permanente.

## Configuración

1. Crea una cuenta en uno o varios proveedores de la tabla y genera claves desde sus consolas oficiales.
2. Añade las claves elegidas a `.env` o a los secretos de Docker/Dokploy. No compartas ni subas las claves al repositorio.
3. Conserva vacío el valor de los proveedores que no usarás. El cargador de catálogo habilita cada proveedor solo cuando detecta su clave; Cloudflare también requiere `CLOUDFLARE_ACCOUNT_ID`.
4. Reinicia el servicio o llama `POST /admin/seed/reload`. Luego consulta `GET /ready` y `GET /v1/models`.
5. Cada proveedor conserva su propia cuota y límite. Relevo intenta el siguiente modelo compatible cuando un upstream rechaza la petición o agota su cuota.

El fallback no combina las cuotas contractuales de un proveedor ni está pensado para repartir varias cuentas del mismo servicio a fin de evitar límites. Cada proveedor aparece una vez con una sola credencial.

## Fuentes oficiales

- [Groq: límites de solicitudes](https://console.groq.com/docs/rate-limits)
- [Cerebras: precios y acceso Free](https://inference-docs.cerebras.ai/support/pricing) y [Cerebras: API key/crédito inicial](https://www.cerebras.ai/inference)
- [Google Gemini: facturación y niveles](https://ai.google.dev/gemini-api/docs/billing), [modelos](https://ai.google.dev/gemini-api/docs/models)
- [OpenRouter: plan Free](https://openrouter.ai/pricing) y [enrutador de modelos gratuitos](https://openrouter.ai/openrouter/free/apps)
- [Kilo: modelos gratuitos y ruta automática](https://kilo.ai/docs/gateway/models-and-providers), [acceso anónimo y límites](https://kilo.ai/docs/gateway/authentication)
- [Cloudflare Workers AI: cuotas](https://developers.cloudflare.com/workers-ai/platform/pricing/), [API compatible con OpenAI](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/)
- [Cohere: límites de claves de evaluación](https://docs.cohere.com/v2/docs/rate-limits), [modelo Command R7B](https://docs.cohere.com/docs/command-r7b)
- [Hugging Face: créditos y facturación](https://huggingface.co/docs/inference-providers/pricing), [API compatible y proveedores integrados](https://huggingface.co/docs/inference-providers)
- [Mistral: modo Free sin tarjeta](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)
- [NVIDIA: API Catalog](https://docs.api.nvidia.com/nim/docs/api-quickstart)
- [SambaNova: planes y facturación](https://cloud.sambanova.ai/plans)
- [OpenCode Zen: condiciones de facturación](https://docs.opencode.ai/docs/zen/)
- [Aviso de retirada de GitHub Models](https://docs.github.com/en/github-models)
