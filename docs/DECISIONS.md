# Decisiones técnicas

## Acceso a proveedores

Contexto: la especificación permite LiteLLM o clientes HTTP directos para proveedores compatibles con OpenAI.

Decisión: Relevo implementa un adaptador HTTP asíncrono con `httpx` para la interfaz Chat Completions compatible con OpenAI.

Motivo: reduce dependencias y permite normalizar errores HTTP y `Retry-After` sin almacenar credenciales en la base de datos. Google AI Studio usa traducción propia; los demás endpoints configurados siguen la interfaz compatible con OpenAI.

Actualización: streaming y funciones específicas no compatibles con OpenAI aún requieren implementación. Se configuraron los endpoints compatibles con OpenAI para Cohere, Mistral, NVIDIA NIM, Kilo Gateway y Cloudflare. Los modelos y límites de esos proveedores no se rellenan hasta verificarlos por separado.

## Métricas de operación

Decisión: `/metrics` publica contadores por resultado y consumo de cuotas en formato Prometheus cuando `PROMETHEUS_ENABLED=true`; en otro caso responde 404.

Motivo: permite integrar el monitoreo sin agregar una dependencia de instrumentación en tiempo de ejecución. La ruta debe limitarse desde la red o el proxy de despliegue.

## Estado de cuotas

Contexto: el plan pide cuotas compartidas entre peticiones y persistidas en MySQL, sin Redis en la primera versión.

Decisión: las cuotas configuradas se reservan en MySQL con `INSERT IGNORE`, bloqueos de filas y una transacción que valida todas las ventanas antes de incrementar contadores. El uso de tokens se ajusta con los valores reportados por el proveedor cuando están disponibles.

Motivo: los contadores compartidos y bloqueados por ventana evitan exceder los límites por concurrencia entre procesos. La estrategia ponderada mantiene su cursor en memoria, por lo que requiere un único worker por proceso.

## Workers

Contexto: varios workers no compartirían estado de selección en memoria.

Decisión: Docker arranca un worker Uvicorn.

Motivo: coincide con las restricciones de consistencia de la primera versión.
