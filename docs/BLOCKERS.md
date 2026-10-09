# Bloqueos

- Git está montado en modo de solo lectura: no es posible crear ramas, commits ni hacer push desde este entorno. Las casillas del plan se mantienen sin marcar hasta completar esas acciones.
- CI de GitHub y el release `v1.0.0` requieren acceso al repositorio remoto, no disponible desde este entorno.
- La API inicia y `/health` responde correctamente; `/ready` devuelve 503 mientras no haya al menos una credencial de proveedor configurada.
- La batería actual de pruebas pasa en un contenedor Linux. Ruff y mypy también pasan localmente.
- Las integraciones de streaming SSE (T7.2) con fallback previo al primer byte (T6.7) y la tarea periódica de sondeo y limpieza de cuotas (T8.4) han sido implementadas y verificadas con pruebas automatizadas (`test_chat_streaming.py` y `test_maintenance.py`).
- Siguen pendientes: pruebas de carga (`locust`/`k6`), auditoría de dependencias (`pip-audit`), despliegue final y verificación en Dokploy.
