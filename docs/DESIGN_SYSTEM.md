# Sistema de diseño

Se conservan los tokens de color existentes. Se agregan ancho fluido de laterales y duración de interacción de 180 ms.

- 320–767 px: visor completo, navegación inferior, panel de proyecto o propiedades en hoja inferior. Barra superior desplazable horizontalmente.
- 768–1023 px: visor completo y un panel lateral superpuesto por vez.
- 1024 px o más: tres columnas; laterales con `clamp` y visor con `minmax(0, 1fr)`.
- Objetivos táctiles móviles: altura mínima 44 px. Acciones secundarias visibles sin hover.
- Cámara ortográfica/perspectiva y siete orientaciones desde Herramientas.
- Corte visual por X/Y/Z con posición normalizada; sin tapa y sin modificar el sólido.
- Medición de puntos y normales sobre la malla. Separación mínima entre dos instancias B-Rep calculada por el kernel.
- Calidad baja/media/alta controla densidad de píxeles, conservando geometría de fabricación.
- Guardado visible separado del estado geométrico, con reintento ante error.
- Foco visible, diálogos con rol y foco contenido, y restauración al cerrarlos.
- `prefers-reduced-motion` desactiva transiciones y animación del indicador.

La validación visual real en 320/768/1024 px y Android forma parte de la lista de comprobación manual de esta entrega.

## Carga inicial

Controles dentro del panel existente, sin nuevos anchos fijos. Progreso nativo con etiqueta accesible para el asentamiento; preparación con mensaje de etapa y errores recuperables mediante corrección/reinicio. Masa, nivel y alcance del modo visibles junto a los controles. No hay nuevas animaciones. Verificar manualmente panel y foco en 320, 768 y 1024+ px.



## 0.3.0

Herramientas agrupadas dentro del panel fluido existente, sin anchos fijos nuevos. Cálculos con etapa, resultados con aria-live, errores recuperables, botones de aplicar/exportar deshabilitados sin datos, Escape cancela y restaura vista previa. No se agregan animaciones. Revisión visual 320/768/1024+ pendiente por acceso del navegador al servidor local.


## Preparador de fabricación

Modal fluido con controles en grilla adaptable, vista SVG escalable, progreso por pieza, estado aria-live, botones deshabilitados sin datos, errores con recuperación y cierre disponible. Escape vuelve de selección en modelo o cierra. La revisión de perfil complejo es una decisión de fabricación explícita. No se agregan animaciones. Hover, foco, active y disabled siguen los controles existentes con ajustes locales.

## Edición de boceto 0.6.0

Se reutilizan botones, estados focus/hover/disabled y barra adaptable existentes. Recorte anticipa en rojo sólo el intervalo a quitar. El estado de herramienta usa aria-pressed; instrucciones y errores usan una región role=status/aria-live persistente, independiente del cursor. Operaciones síncronas con feedback inmediato, sin espera artificial ni animación nueva.

## Carpetas de repeticiones 0.6.1

Encabezado nativo details/summary con nombre que admite salto, indicador de despliegue y contador de miembros. Estado inicial plegado; formularios internos diferidos al abrir. Teclado y foco usan comportamiento nativo y estilos existentes; hover/active refuerzan el encabezado. Error de nombre con aria-live y recuperación editando el campo. Sin animaciones ni cargas artificiales nuevas.
