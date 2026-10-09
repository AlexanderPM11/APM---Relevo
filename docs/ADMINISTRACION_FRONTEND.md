# Panel administrativo de Relevo

Este documento describe las funciones disponibles hoy en la consola React de administración, servida en `/console/`. Está dirigido a quien opera Relevo. No todas las capacidades administrativas del backend tienen una pantalla en la consola.

## Acceso y estado del servicio

- Inicio de sesión con correo y contraseña de administrador; permite mostrar u ocultar la contraseña.
- La sesión usa un token temporal guardado en `sessionStorage`; cerrar sesión lo elimina. Si caduca, la consola vuelve al acceso.
- Consulta `/ready` y muestra si la base de datos responde y hay al menos un modelo habilitado, configurado y disponible.

## Pestaña «Claves API»

- Muestra total de claves registradas y cantidad activa.
- Crea una clave con nombre, propietario opcional y límite por minuto de 1 a 10.000 (por defecto, 60).
- Al crearla, muestra el secreto completo una sola vez y permite copiarlo. Se guarda un hash, no un secreto recuperable.
- Lista nombre, propietario, prefijo identificador, límite y estado; permite buscar por nombre, propietario o prefijo y actualizar la lista.
- Revoca claves activas con confirmación. La revocación impide nuevas llamadas y conserva el registro para auditoría.

El prefijo no permite recuperar una clave perdida. Crea otra y revoca la anterior. El secreto debe guardarse como contraseña.

## Pestaña «Conectar una app»

- Muestra la URL base pública y `POST /v1/chat/completions`.
- Incluye ejemplos copiables en cURL, Node.js y Python con el cliente OpenAI.
- Recomienda guardar la clave como variable de entorno en el servidor, usar una por aplicación y no exponerla en el navegador.
- Enlaza el esquema OpenAPI de `/openapi.json`.

## Pestaña «Ejemplos API» (chat de prueba)

- Carga el catálogo dinámico de modelos enrutables y claves activas. Permite actualizar el catálogo manualmente.
- Permite seleccionar qué clave se atribuirá a la prueba; se aplica su límite por minuto y queda registrada con esa clave. La clave completa no se envía al navegador.
- Permite elegir «Automático» o un modelo concreto. Automático prueba candidatos compatibles y puede recurrir a otro modelo cuando uno falla; la selección manual solicita el elegido.
- Ofrece una conversación de texto e imágenes, sugerencias, indicador de respuesta y metadatos del modelo, proveedor e intentos.
- Admite hasta 4 imágenes de hasta 5 MB cada una, con vista previa y opción de quitarlas. Para imágenes se requiere visión; Automático prioriza modelos compatibles.
- «Nueva conversación» limpia mensajes y adjuntos. El historial solo vive en el estado actual de la interfaz.

El chat llama a `/admin/playground/chat` con el JWT administrativo; el identificador de la clave elegida se usa para atribución y límites.

## Adaptación a dispositivos

La consola reorganiza navegación, tarjetas, formularios, listados, chat y ejemplos para pantallas estrechas. Las funciones son las mismas; cambia la disposición según el ancho.

## Funciones del backend sin pantalla React

El backend expone administración de proveedores y modelos, límites por modelo, reinicio de cooldown, estadísticas, recarga de datos iniciales y métricas Prometheus opcionales. No aparecen como pestañas o controles de la consola actual. Consulta [Integración y referencia de la API](INTEGRACION_API.md).
