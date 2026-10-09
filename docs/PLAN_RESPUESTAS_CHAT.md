# Plan de mejora de las respuestas del chat

Fecha: 9 de octubre de 2026.
Estado: propuesta preparada para implementación. Este documento no implica que los cambios de interfaz estén implementados.

## Objetivo

Convertir las respuestas del Playground en contenido cómodo de leer: títulos con jerarquía, tablas reales, listas bien organizadas, código claro y una lectura estable durante la generación. Mantener la identidad verde de Relevo y dar prioridad al contenido sobre los controles.

## Diagnóstico basado en el código

- `web/src/features/playground/ResponseText.tsx` interpreta el texto mediante expresiones regulares. Solo reconoce negrita, código inline, bloques con triple acento grave y algunas listas. No interpreta tablas, citas, enlaces, separadores ni listas anidadas. Todos los encabezados se convierten en `h3`, aunque su nivel original sea distinto.
- La tabla de la captura aparece como líneas con barras verticales porque no existe un renderizador de tablas. Los separadores `---` también quedan como texto.
- `web/src/features/playground/playground.css` define texto de respuesta de 13 px en escritorio y 12 px en móvil. Los bloques de código permiten saltos forzados que dificultan distinguir la estructura del código. El código inline usa colores claros que requieren reglas específicas para el tema oscuro.
- `web/src/features/playground/Playground.tsx` ya acumula texto durante el streaming y permite copiar o regenerar. El seguimiento del final depende de la distancia de scroll; falta un control visible para regresar al último mensaje.
- `web/package.json` no incluye una biblioteca de Markdown.
- Ya existe una corrección para que el historial tenga scroll y el compositor permanezca dentro de la ventana. La mejora debe conservar ese comportamiento y comprobarlo con tablas y respuestas largas.

## Dirección visual

Una presentación editorial sobria, integrada en el chat: cuerpo de texto con peso normal, espacios claros entre ideas y negritas reservadas para énfasis. Evitar convertir cada párrafo en una tarjeta. El nombre del modelo y el proveedor funcionan como metadatos discretos encima de la respuesta.

| Elemento | Resultado propuesto |
| --- | --- |
| Texto principal | 15–16 px en escritorio y 14–15 px en móvil; interlineado de 1,65–1,75 |
| Columna de lectura | Ancho máximo aproximado de 760–820 px, con márgenes adaptables |
| Títulos | Tamaños y espacios diferentes para cada nivel; conservar la jerarquía del contenido |
| Párrafos | Espaciado vertical consistente; líneas normales de Markdown, sin forzar cada salto del proveedor |
| Tablas | Cabecera diferenciada, divisiones sutiles, celdas cómodas y scroll horizontal propio |
| Código | Contenedor con lenguaje, botón de copiar, fuente monoespaciada y scroll horizontal |
| Citas | Borde lateral verde discreto y fondo suave |
| Enlaces | Color reconocible, subrayado y foco visible |
| Separadores | Línea fina con espacio antes y después |
| Temas | Colores coherentes para texto, código inline, tablas y bloques en claro y oscuro |

Los tamaños son objetivos iniciales: ajustarlos a la fuente actual y al ancho real disponible cuando los paneles laterales estén abiertos.

## Fase 1. Interpretación completa de Markdown — prioridad principal

1. Sustituir el análisis manual de `ResponseText.tsx` por `react-markdown` con `remark-gfm`.
2. Dar soporte a párrafos, encabezados, énfasis, enlaces, listas anidadas, listas numeradas con su número inicial, citas, separadores, tablas, tareas y texto tachado.
3. Definir componentes propios para tablas, bloques de código y enlaces; mantener el HTML semántico de los demás elementos.
4. Mantener el texto original como fuente de verdad para guardar, copiar y exportar. No modificar el contenido almacenado para añadir estilos.
5. Tratar el contenido recibido como texto Markdown: no ejecutar HTML del modelo, conservar el filtrado de URLs y no incorporar `dangerouslySetInnerHTML`. Mostrar imágenes remotas como enlaces en esta primera entrega; las imágenes adjuntas conservan su presentación actual.
6. Aplicar el renderizador también a los mensajes ya guardados al abrir una conversación.

Resultado esperado: una tabla Markdown válida como la de la captura se muestra con columnas y cabecera. Si el modelo genera una tabla inválida, conservar el contenido de forma legible; no inventar celdas ni reescribir la respuesta.

## Fase 2. Diseño de contenido y código

1. Crear `response-text.css` para los estilos de contenido, evitando aumentar los selectores generales de `playground.css`. Retirar o ajustar las reglas antiguas que entren en conflicto.
2. Definir variables de color y espaciado para ambos temas. Corregir especialmente el contraste del código inline en oscuro.
3. Crear `ResponseCodeBlock.tsx` con lenguaje visible, botón «Copiar código» y confirmación breve. Copiar el código original, sin etiquetas ni formato visual.
4. Preservar espacios y sangría de código con `white-space: pre`; permitir scroll horizontal dentro del bloque, sin ensanchar la página.
5. Incorporar resaltado de sintaxis con una biblioteca y un conjunto limitado de lenguajes después de comprobar compatibilidad y coste de carga. Los lenguajes desconocidos deben mostrarse como texto monoespaciado legible.
6. Crear `ResponseTable.tsx` con cabeceras semánticas y un contenedor horizontal accesible por teclado. En móvil, desplazar la tabla dentro de su contenedor, manteniendo visibles el chat y el compositor.
7. Mantener «Copiar respuesta» y «Volver a generar» al final, con foco visible y confirmación de copia. La copia completa seguirá conservando el Markdown original.

Resultado esperado: el usuario puede leer y copiar una respuesta técnica sin descifrar símbolos de formato ni perder la sangría de sus ejemplos.

## Fase 3. Lectura estable durante el streaming

1. Renderizar el texto acumulado, incluso cuando el último bloque está incompleto. No completar artificialmente el contenido guardado.
2. Comprobar encabezados, tablas y bloques de código que llegan divididos entre eventos. Una cerca de código sin cerrar debe mantenerse legible durante la generación.
3. Seguir automáticamente la respuesta solo cuando el usuario esté cerca del final. Si sube para leer, conservar su posición.
4. Mostrar un botón «Ir al último mensaje» cuando el usuario se aleje del final, sin cubrir el campo de escritura.
5. Mantener estables los componentes de mensajes ya completados. Agrupar actualizaciones del mensaje activo si la medición muestra que el volumen de eventos afecta a la fluidez; conservar siempre el último fragmento al completar o detener.
6. Si el resaltado de código resulta costoso o cambia demasiado el diseño durante la generación, aplicarlo al finalizar ese mensaje y mostrar código simple mientras llega.
7. Mantener el compositor como una sección independiente del área desplazable. El scroll de código y tablas debe pertenecer a cada bloque.
8. Conservar el texto recibido al detener o fallar una generación, mostrando su estado de forma discreta junto a las acciones.

Resultado esperado: una respuesta larga sigue llegando mientras el usuario lee una sección anterior, y el campo de mensajes permanece accesible.

## Fase 4. Validación y criterios de aceptación

Usar contenido representativo guardado o eventos simulados; estas comprobaciones no requieren consumir proveedores reales.

- Una tabla válida de tres columnas se interpreta como tabla, incluyendo negritas y código inline dentro de las celdas.
- Los encabezados de distintos niveles mantienen una jerarquía visual clara; `---` se interpreta como separador cuando corresponde según Markdown.
- Las listas anidadas, citas, enlaces y párrafos se muestran sin símbolos de formato sobrantes cuando la sintaxis es válida.
- El código preserva la sangría, puede desplazarse horizontalmente y el botón copia el contenido exacto.
- En 360, 768 y 1440 px de ancho, las tablas y el código no provocan desplazamiento horizontal de toda la página.
- El tema oscuro no muestra etiquetas de código inline claras con texto de bajo contraste.
- Una respuesta extensa no oculta el compositor. Subir durante el streaming no devuelve automáticamente al usuario al final.
- «Ir al último mensaje» funciona con teclado y mantiene el foco utilizable.
- Un bloque Markdown dividido entre varios eventos no provoca errores; el resultado final coincide con la presentación de esa misma respuesta cargada desde el historial.
- Copiar y exportar conservan el texto original; recargar una conversación conserva contenido y metadatos.
- Las pruebas de presentación comprueban semántica y comportamiento, evitando depender exclusivamente de capturas.
- Ejecutar la compilación del frontend y las comprobaciones del Playground afectadas; comparar visualmente claro y oscuro.

## Archivos previstos para la implementación

| Archivo | Cambio |
| --- | --- |
| `web/package.json` y archivo de bloqueo existente | Dependencias de Markdown y, si procede, resaltado |
| `web/src/features/playground/ResponseText.tsx` | Renderizador Markdown y componentes personalizados |
| `web/src/features/playground/ResponseCodeBlock.tsx` | Código, lenguaje y copia |
| `web/src/features/playground/ResponseTable.tsx` | Tablas accesibles con scroll propio |
| `web/src/features/playground/response-text.css` | Tipografía y estilos de contenido en ambos temas |
| `web/src/features/playground/playground.css` | Ajustes de espacio, compositor y eliminación de reglas incompatibles |
| `web/src/features/playground/Playground.tsx` | Estado de lectura y regreso al último mensaje |
| `web/e2e/playground.spec.ts` | Casos de Markdown, scroll, copia y streaming |

## Contrato con el backend

El frontend ya recibe texto y lo acumula durante la generación. La interpretación del Markdown puede implementarse sobre ese contrato. Para esta mejora no se identifica un cambio necesario en endpoints o en el formato de persistencia.

Durante la implementación, confirmar que los fragmentos mantienen saltos de línea y espacios originales. Si se detecta una transformación en el transporte que dañe Markdown, corregir ese punto con un caso concreto. El renderizador no debe depender de forzar respuestas idénticas de todos los modelos.

## Orden de entrega

1. Markdown completo y estilos de lectura, incluyendo tablas y temas.
2. Bloques de código con copia y resaltado limitado.
3. Seguimiento del scroll y regreso al último mensaje.
4. Comprobaciones de streaming, accesibilidad, móvil e historial.

Primera entrega satisfactoria: la respuesta de la captura se presenta como un documento legible, con su tabla interpretada, secciones diferenciadas y compositor visible.

## Referencias oficiales

- [react-markdown](https://github.com/remarkjs/react-markdown): componentes React para Markdown, personalización de elementos y tratamiento del contenido.
- [remark-gfm](https://github.com/remarkjs/remark-gfm): extensión para tablas, listas de tareas, enlaces automáticos y texto tachado.

Confirmar las versiones compatibles con el proyecto al instalar las dependencias; el plan no fija versiones sin realizar la instalación.
