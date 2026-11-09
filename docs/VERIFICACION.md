# Casos vigentes 0.3.0

Automáticos: `npm test`; `node scripts/check-hopper-air.mjs` para conjunto a escala con carga y aire; `node scripts/benchmark-hopper.mjs` para primeros pasos de tamaño real (puede tardar y consumir >500 MiB).

Manuales pendientes en navegador:
1. Revisar el panel CAD y partículas a 320/768/1024+ px, foco, scroll y recuperación de errores.
2. Elegir caras/aristas de sólidos y de mallas: consultas exactas sólo en B-Rep; verificar que piezas ocultas no capturen selección.
3. Alinear dos instancias con giro y separación, cancelar, aplicar, deshacer/rehacer, guardar/reabrir. Cambiar el proyecto durante la consulta invalida la vista previa.
4. Seccionar un tubo: hueco visible y área descontada; abrir DXF en otro CAD y comprobar unidades. Caras extremas y contornos abiertos deben informar error.
5. Carga completa: esperar asentamiento en tiempo simulado, abrir y comparar aire apagado/activo. Aro de sección rojo/verde, masa por sección separada de retirada del dominio. Cerrar no teletransporta partículas descargadas.
6. Detener durante colisiones, siembra y paso lento debe recuperar la interfaz. Guardar/recargar conserva parámetros, no el estado instantáneo.

Las notas anteriores siguientes se conservan como histórico.

# Verificación de entrega

## Automatizada

Ejecutar `npm test`. Incluye las pruebas existentes y regresiones de:

- error de worker antes/después de ready y cancelación;
- archivo inválido, versión desconocida, referencias, dependencias y SVG;
- restricciones incompatibles, relaciones cíclicas y datos originales inmutables;
- volumen de rosca individual/conjunto;
- loft, vaciado, barrido y STEP ida/vuelta;
- mallas solo malla instanciadas/exportadas y rechazo de STEP incompatible;
- geometría GPU compartida, transformaciones, colisión del mundo y restauración de pose;
- servidor gzip, ETag, rutas inválidas y permanencia del proceso.

El runner escribe un resumen de archivos aprobados/fallidos y retorna código no cero si alguno falla. No sustituye una comprobación visual de UI.

## Manual, navegador real

1. Arrancar `npm start` y abrir localhost:5174. Esperar construcción inicial y estado de guardado.
2. En 320, 768 y 1024 px verificar visor visible, barra desplazable, paneles Proyecto/Propiedades, cierre de paneles y controles sin overflow lateral del documento.
3. Abrir biblioteca, ayuda, importación y revisiones: Tab/Shift+Tab deben mantenerse en el diálogo; al cerrar, el foco vuelve al control de origen.
4. Modificar una pieza; deshacer/rehacer. Agregar, duplicar, mover y quitar instancias y repetir. El boceto debe reabrirse tras deshacer si aún existe.
5. Importar archivo inválido: conservar proyecto actual. Intentar archivo mayor a 100 MiB: error con acción de reducirlo.
6. Bloquear IndexedDB o agotar cuota: estado Error al guardar y botón Reintentar. Recuperar motor no debe continuar si el guardado falla.
7. Crear al menos dos revisiones separadas 30 s; restaurar una; eliminar revisiones y comprobar que el documento actual sigue abierto.
8. Exportar una rosca real desde Pieza y Conjunto; comparar en CAD externo. Modificar una dimensión y exportar inmediatamente: debe salir la dimensión nueva.
9. Agregar tres instancias de una pieza; comprobar posiciones, orientación, mover/volver, motor y partículas sin perder colocación.
10. Probar cámara ortográfica, zoom, vistas y corte X/Y/Z. Desactivar corte. Medir dos puntos y separación mínima entre dos sólidos del conjunto.
11. Importar STL grande como solo malla; instanciar y exportar STL/3MF. STEP/planos y bloqueo preciso de choque deben mostrar su limitación.
12. Crear restricciones sobre círculos y guías. Introducir una contradicción y corregirla: error visible sin exportar geometría parcial.
13. Crear relaciones por origen/ejes; fijar una referencia. Crear ciclo o intentar mover instancia fija por relación: rechazar y conservar el estado previo.
14. Importar STEP de proveedor. Crear loft con dos contornos, vaciado de caja y barrido de círculo por trayectoria perpendicular inicial.
15. Simular, pausar, reanudar, cambiar parámetros y descargar informe JSON. Comparar dos referencias. Cambiar geometría durante una corrida: debe detenerse e invalidar lectura actual.
16. Activar movimiento reducido del sistema y navegar sólo con teclado. En Android comprobar gestos de cámara y selección con dedo.

## Uniones de conductos (0.2.1)

- Unir tres tramos huecos consecutivos, reiniciar aire calculado y comparar sensores antes/después de cada junta. Verificar que la boca de salida siga abierta.
- Deshacer la unión: las instancias originales y sus posiciones deben recuperarse; las piezas originales nunca se borran del catálogo.
- Separar un tramo y repetir: la app debe avisar sin reemplazar ninguna instancia. Alinear con Separación mínima/Mover y volver a unir.
- Seleccionar una malla, un ID inexistente o un segmento animado: error explícito sin modificación del conjunto.
- Repetir con calidad de aire alta para distinguir discretización de una separación física. No inferir estanqueidad sólo de los marcadores.

## 0.2.2 — Casos adicionales

Automático: `node tests/hopperFill.test.mjs`; cono del proyecto real válido/conservación de volumen, carga 25/50/100 %, masa y reinicio con tamaño nuevo. `npm test` cubre regresiones existentes.

Manual pendiente en navegador real:
1. Abrir el ejemplo según `examples/LEEME.md`; verificar representación interior sin material en patas/exterior.
2. Observar el progreso de asentamiento y activación posterior de aire/transferencia. Detener durante la preparación debe recuperar controles.
3. Cambiar porcentaje/radio, reiniciar y comprobar nueva carga; guardar/recargar y comprobar parámetros. Un radio mayor no debe aplicarse hasta reiniciar.
4. Comparar aire apagado/encendido y entradas por caudal/presión con parámetros medidos; sensores para salida real, no confundir retirada del dominio con cruce por boca.
5. Error recuperable para tolva móvil, líquido, selección ausente o geometría con operaciones fallidas.
6. Panel, tabulación y scroll a 320/768/1024+ px; sin validación visual automatizada en esta entrega.


Integración reproducible del conjunto recibido: `node scripts/check-hopper-air.mjs`. Comprueba construcción sin errores, resolución inicial del aire, deposición porosa, coordenadas finitas y masa durante 0,5 s simulados. No verifica caudal experimental ni vaciado completo.
