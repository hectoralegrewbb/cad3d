## 0.4.0 — 2026-11-12 — Control de movimiento y corrección de cuelgue con roscas

- Corrección: la app se colgaba al extruir o colocar una rosca con «Filete real». El filete helicoidal (barrido + booleana) se recalculaba en el worker del kernel en cada edición y no se podía cancelar. Ahora cada edición se reconstruye con un filete cosmético (instantáneo) y, tras 900 ms sin tocar nada, se calcula el filete real; si llega una edición mientras ese cálculo lleva más de 1,2 s, se reinicia el kernel. Exportar STL/3MF/STEP/DXF fuerza el filete real. (No se logró reproducir un cuelgue infinito fuera del navegador: la corrección ataca la causa identificada.)
- Nuevo `core/motion/` (simulación de ejes): perfiles trapezoidal, triangular y curva en S (jerk limitado); Jog, Homing (final de carrera + marca, solo flanco, tope por par, directo), MoveAbsolute, MoveRelative, MoveVelocity, MoveTorque (inercia, fricción, tope elástico), MoveSuperimposed, Stop y Wait; GearIn (velocidad o posición), GearOut, Phasing, CamIn (subida/reposo/bajada, sincronizada con la línea, tabla), Registro con marca (TouchProbe) y Bobinador/Desbobinador; trayectorias interpoladas 2D/3D con líneas, arcos, hélices, espirales y blending (velocidad limitada por curvatura).
- Acciones nuevas «Eje de movimiento» y «Trayectoria interpolada» (panel ⚡ Acciones): programa de comandos editable, gráfico de posición/velocidad/aceleración/fuerza y avisos. Un eje lineal puede ser transportado por otros (`carriedBy`: el Z de un pórtico viaja con el X) y seguir una componente de una trayectoria.
- Plantillas en la biblioteca («Control de movimiento»): Cizalla volante, Cuchilla rotativa (leva electrónica), Registro con marca, Bobinador, Mesa indexadora y Pick & Place.
- Pruebas: `motionControl.test.mjs` (perfiles, ejes, transporte, rotativo, GearIn, trayectoria y plantillas) y bloque de rosca en `thread.test.mjs`.

## 0.3.1 — 2026-11-08 — Cadenas ASA/ANSI y DXF para láser

- Ruedas de cadena: serie A rotulada «ASA n / ANSI n» (ASA 40 = ANSI 40, paso 1/2"). Geometría ANSI B29.1: asiento Ø = 1,005·Ø rodillo + 0,076 mm y ancho de diente (0,93 | 0,95)·b1 − 0,15 mm; la serie B (ISO 606) no cambia. Las claves internas (`A40`…) se conservan.
- Los piñones nuevos llevan los asientos como arcos exactos (bulge) en el boceto; los guardados siguen con sus segmentos.
- Plano del piñón: Ø exterior, Ø primitivo y Ø pie (vista de frente, con círculos primitivo y de pie), Ø exterior y ancho del dentado de canto, y notas con designación ASA y medidas (paso, dientes, Ø rodillo, ancho interior, Ø asiento, ancho de diente).
- DXF para láser (botones «DXF láser» y «DXF láser R12», y en Propiedades de la rueda): 1:1 en mm, capa CORTE, desde la cara plana más grande del B-Rep real (contorno, agujeros, chaflanes y radios de boceto, cortes). Lo interior va primero y la esquina inferior izquierda queda en (0, 0). R2000: polilínea cerrada con arcos; R12: líneas, arcos y círculos. No compensa kerf.
- Corrección: los chaflanes y radios por vértice de una polilínea se aplicaban dos veces (error «no cabe» o recursión infinita).
- Pruebas: `sprocket.test.mjs` cubre ASA 40, el plano y el DXF para láser (piñón con agujeros y chapa chaflanada).

## 0.3.0 — 2026-11-06 — Cambios aprobados

- Sustitución del reservorio por carga completa de partículas dinámicas PBD. Red FCC, presupuesto explícito (hasta 600.000), cálculo lento y rechazo de cargas parciales. No se agranda el radio para cubrir volumen.
- Controles independientes de descarga virtual y aire; no hay emisión adicional. Medición de primer cruce por disco de salida y masa por segundo simulado. Cancelar carga completa termina el worker.
- Contactos refinados contra triángulos cerca de paredes finas; agotamiento de pares o estado no finito detiene la corrida en vez de ocultarlo.
- CAD: ocultar/aislar/restaurar, inspector de malla y operaciones fallidas, sección B-Rep o de malla, DXF de contornos, longitud/radio/diámetro/área/ángulos y colocación por caras/ejes con vista previa y aplicación deshacible.
- IDs de caras preservados en mallas compartidas para consultar referencias B-Rep. Transformaciones existentes sin cambiar el formato de proyecto.
- Pendiente: QA visual y responsive real, calibración industrial, estabilidad/convergencia de cargas grandes, aceleración de los contactos y validación experimental de descarga. Sin refactorizaciones adicionales.

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
