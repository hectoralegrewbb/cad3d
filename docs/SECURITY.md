# Seguridad y ciclo de vida de datos

## Estado de preparación del aire — 2026-11-16

`ParticleSim.initialAirSolve` guarda motivo, iteraciones y cambio residual de la preparación en memoria del worker. `airInfo().initialSolve` envía una copia al panel; se reemplaza al reconstruir/preparar el aire y se libera al destruir el simulador. No se agrega al formato del proyecto ni a IndexedDB. Las lecturas, filtros y disparos de presión se eliminan al reiniciar. No se cambia autenticación, almacenamiento ni acceso a red.

La aplicación sigue siendo local. No se agregó autenticación, nube ni envío de proyectos a servicios externos.

## Fronteras

Los proyectos se validan antes de sustituir el documento abierto: formato, versión, piezas, IDs, instancias, transformaciones y referencias. El límite de entrada es 100 MiB. Los contadores se reconstruyen a partir de IDs para no duplicarlos al continuar una edición legacy. Las 120 plantillas existentes se verifican con el lector nuevo.

La decodificación de mallas comprueba longitud de buffers, coordenadas finitas e índices. Los atributos SVG escapan comillas, además de los caracteres de texto. El evaluador no usa eval y sólo consulta parámetros propios. El CSV protege celdas de texto que puedan interpretarse como fórmulas.

El servidor estático restringe la raíz, métodos GET/HEAD, rutas mal codificadas y acceso a node_modules. Los errores de URL no terminan el proceso. Distribución usa ETag y gzip; desarrollo conserva no-store.

## Datos nuevos

| Dato | Ubicación | Lectores | Retención / eliminación |
|---|---|---|---|
| Revisiones | IndexedDB `elcad3d/docs`, clave `current:revisions` | Panel de recuperación | Máximo 10, cada 30 s; rotación, botón Eliminar revisiones o borrado del navegador |
| Restricciones | `features[].constraints` en pieza/proyecto | Core, kernel y editor | Hasta quitarlas, eliminar entidad dependiente o borrar documento |
| Relaciones / fijo | `project.mates`, `instances[].fixed` | Core, kernel y panel de conjunto | Hasta quitar relación/instancia/pieza o borrar documento |
| STEP importado | `features[].brep` y nombre de archivo | Kernel, panel contextual | Hasta eliminar operación o documento |
| Configuración, semilla y cambios de corrida | Memoria de RunRecorder; informe JSON sólo al descargarlo | Panel de simulación | Hasta reinicio, cierre o eliminación de referencias; hasta 3 referencias, hasta 100 cambios registrados |
| Historial global | Memoria DocumentStore | Interfaz | Hasta 100 snapshots o reemplazo de proyecto; se pierde al cerrar |

Las revisiones locales pueden fallar por cuota/privacidad del navegador. El estado de guardado muestra el fallo. La descarga de proyecto sigue siendo una copia independiente bajo control del usuario. No se registran tokens, credenciales ni contenido de archivos en logs de aplicación.

## Uniones 0.2.1

La unión guarda un B-Rep en una operación `step` existente, dentro del proyecto local y sus archivos/revisiones. Lo lee el kernel y se elimina al borrar la pieza o el documento. Los originales permanecen en el catálogo. La selección de segmentos y el estado ocupado son de sesión y no se guardan. El ID de fuentes retornado por el worker no se agrega al modelo.

## Datos de simulación 0.2.2

| Dato | Ubicación | Lectores | Vida y eliminación |
|---|---|---|---|
| Parámetros de aire/granos y carga inicial | `simulation` del proyecto (Conjunto) o de la pieza; archivo descargado, IndexedDB y revisiones existentes | Validador, panel y coordinador de arranque | Hasta reemplazar/eliminar el documento; las revisiones anteriores conservan su copia hasta su rotación o borrado |
| Máscara de cavidad, rank y nube | Memoria de worker geométrico, simulador y GPU | Reservorio y visor | Se libera al detener/reiniciar; no se serializa en proyecto |
| Masas y nivel de carga | Frames, RunRecorder; CSV/informe si se descargan | Panel, gráfico, exportación | Corrida/referencias en memoria; archivos exportados bajo control del usuario |

No se modifica auth ni fetch. Se usa el autoguardado existente, sin nuevo backend. Se validan rangos, vectores, modos y grilla al cruzar las fronteras de proyecto/worker. El servidor estático conserva sus controles existentes. Cambiar la configuración no guarda posiciones ni permite continuar una corrida tras recargar.



## Ciclo de vida 0.3.0

- Presupuesto, ejecución y disco de salida se guardan en `simulation.initialFill`, en archivos/autoguardado/revisiones existentes. Los leen validación, panel y worker. Duran hasta reemplazar/eliminar el documento; revisiones previas hasta su rotación o borrado.
- Posición/rotación aplicadas por alineación usan `instances[].pos/rot`, con historial y guardado existentes. No se almacena una referencia de cara persistente.
- BVH, partículas, bandera de primer cruce, contornos, inspección, firmas de vista previa y visibilidad viven sólo en memoria. Detener/reiniciar termina el worker de carga completa; cancelar/cambiar contexto descarta la vista previa. Los resultados exportados son archivos independientes bajo control del usuario.
- Rangos de presupuesto, medidas, vectores, caras y modos se verifican en sus fronteras. Se limita inspección/colisión a 300.000 triángulos por cuerpo y posiciones candidatas de carga a 12 millones. No se añade auth, backend, fetch ni telemetría.


## Datos 0.5.0

- `features[].diameter/x/y/z/mode` de esfera y `backlash/addendum/dedendum` de engranaje se guardan con la pieza, proyecto, autoguardado y revisiones existentes. Los leen validador, kernel y panel. Viven hasta borrar/cambiar la operación/documento; las revisiones hasta su rotación o borrado.
- Medidas teóricas elegidas, referencias, cara de corte, material y espesor de listado viven sólo en el panel de sesión. Al cerrar se descartan. DXF/ZIP/CSV descargados son copias bajo control del usuario.
- No se cambian auth, fetch, IndexedDB ni retención. No se transmite el proyecto para fabricar: los archivos se generan localmente. El despliegue conserva GitHub Pages público existente.
- Texto de nombres/material se renderiza con textContent; la vista SVG usa atributos numéricos. Se validan parámetros, medidas, referencias B-Rep, formatos, orden de contornos y vectores. CSV con escape de comillas y prefijo protector para fórmulas. Cambiar el proyecto bloquea descargar una preparación antigua.

## Datos de boceto 0.6.0

El único dato persistente adicional es `closed` booleano opcional en polilíneas. Vive con la entidad en el archivo .part3d/.proj3d y en el guardado local ya existente. Lo leen validación, editor, referencias y kernel; se elimina al borrar la entidad/proyecto o el guardado local. Coordenadas y bulge usan los campos existentes. Historial y previsualización son de sesión. Sin auth, fetch, endpoints ni almacenamiento nuevos.

Se validan extremos finitos, radios, tramos nulos, rangos, solapes y referencias antes del reemplazo. Edición interactiva: máximo 2000 entidades/10000 vértices; encadenado: 2000 cadenas; validación de un perfil nuevo: 2000 segmentos. Las restricciones impiden reemplazar una entidad referenciada. Los mensajes se renderizan con textContent.

## Metadatos de grupos 0.6.1

`entityGroups` vive en el boceto del archivo .part3d/.proj3d y en la persistencia local existente. Lo leen validación, comandos y panel; no lo usa el cálculo físico. Se elimina con Desagrupar, al borrar el último miembro o al borrar el boceto/proyecto. `counters.group` evita reutilizar IDs y se reconstruye al cargar. No cambia auth, fetch ni infraestructura de guardado.

Se validan nombres de 1 a 80 caracteres, tipos de repetición, IDs únicos, pertenencias existentes/exclusivas y límites (2000 grupos por boceto). Los nombres usan textContent. El plegado sólo vive en memoria del panel y se limpia al abrir otro proyecto.
