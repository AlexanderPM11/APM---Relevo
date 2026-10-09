# Bloqueos

- Git está montado en modo de solo lectura: no es posible crear ramas, commits ni hacer push desde este entorno. Se intentó iniciar phase/0-repo; la operación fue denegada al acceder a .git.
- No hay `ruff`, `mypy` ni `pytest` instalados en el entorno. El Python disponible sí compiló sintácticamente `app`, `alembic` y `tests`; pytest no pudo ejecutarse porque el módulo no está instalado.
- El daemon de Docker Desktop no está accesible. `docker compose config --quiet` sí validó la sintaxis del Compose, pero no se pudo construir ni levantar MySQL.
- La comprobación de CI depende de GitHub Actions y no se pudo ejecutar desde este entorno.
- Los tests unitarios para ventanas de cuota, estimación de tokens y adaptadores están escritos, pero no se pudieron ejecutar porque `pytest` y las dependencias del proyecto no están instalados.
