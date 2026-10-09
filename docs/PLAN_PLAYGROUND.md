# Plan del Playground

## Recorrido del usuario

1. **Elegir el modo antes de escribir.** Automático clasifica el trabajo y escoge una opción disponible que admita el contexto; manual permite buscar por modelo o proveedor, filtrar el catálogo y escoger el nombre exacto. El Playground enseña las capacidades de imagen y evita enviar una conversación con imágenes a un modelo de solo texto.
2. **Probar con una conversación real.** Sugerencias de inicio ayudan a probar redacción, análisis, conversación o programación. Se pueden adjuntar hasta cuatro imágenes de 5 MB. La clave activa se escoge en la misma barra de herramientas.
3. **Seguir la solicitud mientras ocurre.** El servidor emite clasificación y complejidad, candidatos compatibles, modelo y proveedor elegidos, cada intento de respaldo y cada fragmento de respuesta. El panel de actividad muestra el origen de la clasificación, la categoría, los tiempos y los tokens devueltos por el proveedor.
4. **Guardar y retomar.** Los mensajes, imágenes y decisiones se guardan automáticamente en IndexedDB de este navegador y se organizan por cuenta. El título se puede cambiar, el historial se busca y una conversación se puede exportar a Markdown. El identificador del chat permanece en la URL para poder retomarlo con la navegación del navegador.
5. **Recuperarse de errores.** Se puede detener una generación, conservar el texto recibido, volver a generarla o copiar la respuesta. Un fallo antes de producir texto permite al router probar otro modelo; después del primer fragmento no se mezclan dos respuestas.

## Integración y límites

El endpoint de consola usa un POST con Server Sent Events, de modo que conserva autenticación de administrador y atribución a una clave API. El router ejecuta su clasificador para el modo automático del Playground sin cambiar la estrategia pública global. OpenAI compatible y Gemini transmiten el texto desde sus endpoints de streaming y entregan una respuesta acumulada al mismo servicio de cuota, salud y registro que utiliza el chat existente. Las decisiones se transmiten antes de iniciar la llamada al proveedor.

El historial se guarda localmente y no se sincroniza entre dispositivos. La generación progresiva depende de que el proveedor elegido admita streaming; algunas rutas compatibles pueden devolver una respuesta completa. Los proveedores pueden omitir el uso de tokens en su flujo; en ese caso se registra la duración y el número de intentos, y los tokens aparecen como no disponibles.
