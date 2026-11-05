## 0.2.2 — Carga inicial de tolva (aprobada)

- Carga inicial 0–100 %, selección de tolva fija, asentamiento local y reservorio volumétrico con DEM local. Radio de salida independiente de la nube visual; resistencia porosa del reservorio en aire calculado.
- Reiniciar reconstruye con los valores actuales. Configuración granular/aire persistida en proyecto y autoguardado; la corrida sigue siendo transitoria.
- Reparación alternativa de aristas STL no manifold sólo si produce B-Rep válido y conserva volumen dentro de 2 %. No se omite la validación de sólidos.
- Ejemplos del proyecto recibido, original intacto y copia configurada; cono sin colocar suprimido explícitamente, caudal ideal documentado.
- Pendiente: calibración experimental, DEM de toda la carga para puentes/descarga espontánea y QA visual real. El margen numérico de precisión del aire que muestra la interfaz legacy carece de validación para esta tolva; no usarlo como garantía.


# Bitácora de cambios aprobados

## 0.2.1 — 2026-11-03

- Conjunto: selección de segmentos y **Unir en una pieza** mediante unión booleana B-Rep. Verifica conectividad, validez y un único sólido; conserva las piezas originales en el catálogo y sustituye sólo sus instancias seleccionadas. Compatible con deshacer.
- La unión conserva las posiciones del mundo y los huecos geométricos existentes; no rellena separaciones ni abre extremos tapados. No aplica a cuerpos sólo malla ni a segmentos con acciones individuales activas.
- La nueva pieza utiliza la operación B-Rep serializada existente (`step`); no agrega un formato de archivo. Requiere un cupo libre entre las ocho piezas del proyecto. Si hay materiales diferentes, la unión queda sin material para asignarlo explícitamente.
- Aire calculado: comprobación de todas las caras de grilla atravesadas por cada paso de los marcadores. Impide saltos visuales a través de membranas y retira marcadores que salen del dominio. El modo rápido reutiliza su comprobación existente de paredes.
- La corrección de marcadores no altera presión/caudal ni representa por sí sola una certificación de estanqueidad.
- Prueba nueva `weld.test.mjs`: tubos en orden no contiguo, volumen de material, hueco interior, paredes de ambas juntas en la grilla, rechazo de separaciones, IDs inválidos, segmentos duplicados y saltos de marcadores.

## 0.2.0 — 2026-11-02

Alcance aprobado: confiabilidad, rendimiento, responsive, herramientas CAD y validación de simulación; coordinación explícita de múltiples módulos.

### Confiabilidad

- Geometría exacta de conjuntos y exportaciones. Proxy separado para planos; masa/BOM tomadas del conjunto exacto.
- Error de worker y messageerror cierran solicitudes pendientes. Recuperación explícita del motor.
- Guardado atómico con estado visible y diez revisiones locales rotativas.
- Validación de proyecto/pieza, contadores legacy, mallas y escape de atributos SVG.
- Eliminación transitiva de dependientes y protección al reordenar.
- Historial de proyecto para cambios estructurales e instancias.
- Exportación espera la geometría actual y rechaza operaciones con error.

### Rendimiento y UI

- Malla base cacheada y BufferGeometry compartida por pieza repetida; matrices y colisiones del mundo verificadas.
- Sweep-and-prune para candidatos a interferencia.
- Worker de análisis STL y capacidad interior, con cancelación y timeout.
- Render consolidado, liberación de grilla/emisor y política de calidad visual.
- Layout 320/768/1024+, paneles táctiles, foco, accesibilidad de diálogos y movimiento reducido.
- Servidor de distribución con gzip, ETag y manejo de rutas inválidas.

### Herramientas

- Cámara ortográfica, orientaciones, corte visual y medición de dos puntos/normales.
- Separación mínima B-Rep entre instancias.
- BOM y listas de corte CSV.
- Instancias solo malla y exportación STL/3MF; limitaciones B-Rep visibles.
- Restricciones dirigidas de boceto: coincidencia, distancia, orientación, tangencia externa de círculos, igualdad y diámetro conductor.
- Relaciones por origen/ejes y fijación de instancias.
- Importación STEP, loft, vaciado y barrido.

### Simulación

- Referencia limpia de taponamiento capturada antes de la emisión.
- Piso de presión de referencia: máximo entre 50 Pa y presión dinámica local, para evitar cocientes dominados por ruido cerca de cero.
- Clave de SDF incluye índices de triángulos.
- Semilla editable, convergencia visible e informe JSON con configuración, geometría y cambios durante la corrida.
- Solicitudes de preparación canceladas se rechazan, en lugar de quedar pendientes.

### Pendiente / límites conocidos

- Pendiente: verificación visual interactiva en Chromium y Android. Chromium no estaba instalado y su descarga no fue utilizable en este entorno.
- Pendiente: checkpoint incremental de operaciones B-Rep; requiere estudiar propiedad de formas y memoria antes de introducirlo.
- Pendiente: InstancedMesh general para reducir draw calls; esta versión comparte buffers geométricos, manteniendo objetos individuales para selección, animación y color.
- Pendiente: solver general de restricciones y relaciones topológicas de caras. Se entregan relaciones dirigidas con alcance explícito.
- Pendiente: retención por proyecto independiente y coordinación de edición entre pestañas. Se mantiene el autoguardado `current` compatible.
- El corte visual no genera tapas ni modifica la geometría.
- Las mallas abiertas no proporcionan propiedades volumétricas certificadas. La simulación continúa siendo aproximada; una semilla común no garantiza resultados idénticos en distintas máquinas, porque la planificación del aire depende de su costo.
