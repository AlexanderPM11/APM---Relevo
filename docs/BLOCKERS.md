# Bloqueos

- Git está montado en modo de solo lectura: no es posible crear ramas, commits ni hacer push desde este entorno. Las casillas del plan se mantienen sin marcar hasta completar esas acciones.
- CI de GitHub y el release `v1.0.0` requieren acceso al repositorio remoto, no disponible desde este entorno.
- La API inicia y `/health` responde correctamente; `/ready` devuelve 503 mientras no haya al menos una credencial de proveedor configurada.
- La batería actual de pruebas pasa en un contenedor Linux. Ruff y mypy también pasan localmente.
- Siguen pendientes las integraciones completas y verificadas de streaming, sondeo periódico de salud, pruebas de carga, auditoría de dependencias, cobertura objetivo y despliegue en Dokploy.
