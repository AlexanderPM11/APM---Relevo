# Arquitectura

Relevo es un servicio FastAPI asíncrono con autenticación separada para consumidores y administradores. SQLAlchemy async persiste configuración, cuotas, salud y métricas en MySQL. Los adaptadores de proveedores se invocan detrás de un selector que aplica compatibilidad, cuotas, cooldown y fallback. La API pública mantiene el formato OpenAI; administración y operación se exponen bajo `/admin`, `/health` y `/ready`.

En la versión inicial se usa un único worker Uvicorn y una caché de selección por proceso. Los límites transaccionales persisten en MySQL.
