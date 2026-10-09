# Despliegue

## Requisitos

- Un servidor administrado por Dokploy con Docker Compose disponible.
- Un dominio apuntado al servidor y HTTPS terminado por Dokploy o por su proxy.
- Una base de datos MySQL persistente. El Compose del repositorio crea MySQL 8 y el volumen `mysql-data`.
- Al menos una credencial de proveedor compatible configurada como variable de entorno.

## Publicación en Dokploy

1. Crea una aplicación Docker Compose desde el repositorio y selecciona la rama de despliegue.
2. Configura las variables del apartado siguiente en la pantalla de entorno de Dokploy. No guardes secretos en el repositorio.
3. Define `APP_ENV=production`, `DOCS_ENABLED=false`, contraseñas únicas de MySQL y secretos aleatorios de al menos 32 caracteres para `JWT_SECRET` y `API_KEY_PEPPER`. `ADMIN_PASSWORD` debe tener al menos 12 caracteres.
4. Configura la clave de uno o más proveedores. Para Ollama, configura `OLLAMA_BASE_URL` y habilita expresamente el fallback local.
5. Despliega el Compose y espera a que MySQL pase su healthcheck y a que la aplicación termine las migraciones.
6. En la configuración de dominios de Dokploy, enruta el dominio HTTPS al servicio `app` en el puerto interno `8000`. No publiques MySQL.
7. Conserva el volumen `mysql-data` al actualizar o recrear servicios. Una eliminación de volúmenes borra la base de datos.

## Variables obligatorias de producción

Configura `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET` y `API_KEY_PEPPER`. El Compose conecta el servicio `app` al servicio `mysql`; no hace falta cambiar `MYSQL_HOST` salvo que se use una base externa. Configura también las variables del proveedor que hayas elegido. La lista completa está en `.env.example`.

El despliegue de un solo proceso es el perfil soportado por la versión actual. Usa un único worker de Uvicorn: algunos controles de frecuencia y selección mantienen estado en memoria.

## Comprobación posterior

Desde el servidor o desde una máquina con acceso al dominio:

```sh
curl --fail https://relevo.example.com/health
curl --fail https://relevo.example.com/ready
```

`/health` debe responder `200`. `/ready` también debe responder `200` después de configurar una credencial y disponer de un modelo habilitado. Para la comprobación funcional, crea una API key desde `/admin/api-keys` usando un JWT administrador y llama a `POST /v1/chat/completions` con un modelo anunciado por `GET /v1/models`. No incluyas secretos reales en tickets ni registros.

## Respaldo y restauración de MySQL

Programa un respaldo cifrado fuera del servidor y guarda las credenciales del respaldo en el gestor de secretos del entorno. Ejemplo manual desde el host, usando las variables protegidas del despliegue:

```sh
docker compose exec -T mysql sh -c 'exec mysqldump --single-transaction -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' > relevo-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Restringe el archivo resultante al usuario operador y cópialo a almacenamiento cifrado externo. Para restaurar, detén la aplicación para evitar escrituras concurrentes y carga el volcado en la base correcta:

```sh
docker compose exec -T mysql sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < relevo-backup.sql
```

Vuelve a iniciar la aplicación y confirma `/health`, `/ready` y una petición de chat. Antes de depender de un respaldo, restaura periódicamente una copia en un entorno aislado y confirma que la aplicación puede leer sus datos.

## Límites conocidos

- La disponibilidad de `/ready` requiere una credencial válida de proveedor.
- Verifica nombres de modelo, cuotas, compatibilidad y condiciones de cada proveedor antes de producción.
- `PROMETHEUS_ENABLED=true` habilita `/metrics`; limita el acceso a esa ruta desde el proxy o la red de monitoreo.
- Las actualizaciones automáticas de esquema se ejecutan al iniciar el contenedor mediante Alembic. Mantén un respaldo antes de actualizar.
