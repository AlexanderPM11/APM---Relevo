# Decisiones técnicas

## Acceso a proveedores

Contexto: la especificación permite LiteLLM o clientes HTTP directos para proveedores compatibles con OpenAI.

Decisión: Relevo implementa un adaptador HTTP asíncrono con `httpx` para la interfaz Chat Completions compatible con OpenAI.

Motivo: reduce dependencias y permite normalizar errores HTTP y `Retry-After` sin almacenar credenciales en la base de datos. Google AI Studio, Cloudflare, Cohere y streaming requieren adaptadores específicos aún pendientes.

## Estado de cuotas

Contexto: el plan pide cuotas compartidas entre peticiones y persistidas en MySQL, sin Redis en la primera versión.

Decisión: se definió el esquema persistente en MySQL; la reserva transaccional, reconciliación y selección ponderada deben completarse antes de anunciar límites efectivos.

Motivo: los contadores en memoria no son seguros ante concurrencia ni reinicios.

## Workers

Contexto: varios workers no compartirían estado de selección en memoria.

Decisión: Docker arranca un worker Uvicorn.

Motivo: coincide con las restricciones de consistencia de la primera versión.
