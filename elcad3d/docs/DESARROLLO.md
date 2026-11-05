> **Actualización 0.2.0:** consultar [cambios aprobados](CHANGELOG.md), [arquitectura](ARCHITECTURE.md) y [verificación](VERIFICACION.md). Se mantienen formatos y estructura existentes.

# ElCad 3D — Documentación de desarrollo

Modelador paramétrico de piezas + planos de taller (IRAM/ISO) + conjunto + simulación de partículas/aire/líquidos. JavaScript ES modules en el navegador, **sin build**. Kernel B-Rep: **replicad / OpenCascade (WASM)**; visor: **three.js**. Node 18+ solo para el servidor estático y los tests.

## 1. Puesta en marcha

```bash
node serve.mjs          # http://localhost:5174  (PORT=xxxx)
npm test                # ~2–3 min; descubre todos los archivos tests/*.test.mjs y continúa tras fallos
```

- `serve.mjs` sirve estáticos sin caché. Si lo reiniciás, hacelo en el mismo comando que lanza el servidor.
- Tests de interfaz: ad hoc con Playwright (Chromium con `--disable-features=WebAssemblyTrapHandler --use-gl=swiftshader` en entornos sin GPU). `window.elcad3d` expone `store`, `viewer`, `setMode`, `setScope`, `rebuild`, `project`, `assembly`, `kernelMemoryMB`, etc. para inspeccionar.

## 2. Mapa de módulos

| Carpeta | Contenido | Toca DOM |
|---|---|---|
| `src/core` | modelo de pieza/proyecto, comandos (reducers), historial, expresiones, acciones/escena, cinemática de engranajes, patrones, referencias de boceto | No |
| `src/kernel` | construcción B-Rep (`partBuilder`), geometría 2D/planos, roscas/engranajes/tornillo/cañería, mallado, exportadores, ensamble, **servicio del motor + worker** | No |
| `src/drawing` | planos: proyección, vistas, cotas, hoja, SVG/DXF, plano de conjunto | No |
| `src/particles` | simulación PBD/PBF, SDF, aire (Euler), worker de simulación | No (worker) |
| `src/io` | persistencia, importación DXF/DWG, lector STL (`stlReader.js`) | Parcial |
| `src/viewer` | escena three.js, selección, colocación con clic, partículas | Sí |
| `src/ui` | paneles y editores | Sí |
| `src/app/main.js` | **raíz de composición** | Sí |
| `vendor/` | `occ` (WASM), `replicad` (con parches), `three`, `libredwg` | — |

Dependencias hacia abajo: UI → app → core/kernel. `core` no importa kernel salvo geometría pura de definiciones de operaciones.

## 3. Modelo de datos

```js
part = {
  meta: { name, units:'mm', version, material, sheet, color? },
  params: [{ name, value }],              // valores o expresiones ("D1/2 + 1")
  features: [ { id, type, suppressed?, … } ],   // lista ORDENADA: se ejecuta de arriba hacia abajo
  counters: { sketch, extrude, … , ent },
  drawing?: {…}, actions?: [], nozzles?: [], sensors?: []
}
project = { format:'elcad3d-project', version:1, name, parts:[{id, part}], instances:[{id, partId, pos, rot}], activePartId, assembly?, counters }
```

- **Todo valor numérico puede ser un número o una expresión** (`core/expression.js`) que se evalúa con los parámetros. Se guardan como expresión.
- Tipos de operación (`featureLabels`/`featureDefaults` en `partModel.js`): `sketch`, `extrude`, `revolve`, `hole`, `thread`, `gear`, `screw`, `pipe`, `pattern`, `mesh`, `fillet`, `chamfer`. Los botones «agregar» y los iconos del árbol salen de esas tablas.
- Entidades de boceto (`t`): `rect`, `circle`, `ellipse`, `slot`, `poly` (con arcos/bulge), `polygon`, `guide`. Cada una admite repetir, rosca (círculos) y esquinas R/C.
- Persistencia: autoguardado en IndexedDB (`elcad3d` / `docs`), `.part3d` (una pieza, JSON), `.proj3d` (proyecto, JSON).

### Cambios al modelo
Siempre vía `core/commands.js` (reducers puros) y `DocumentStore.apply` (historial por referencias). Los gestos continuos usan `applyTransient` + commit.

## 4. El motor (kernel) en un Web Worker

```
main.js ──request(type,payload)──▶ kernelClient ──postMessage──▶ kernelWorker ──▶ kernelService ──▶ replicad/OCC
        ◀──── datos clonables (mallas con buffers transferidos, parámetros, planos) ────
```

- `kernelService.js`: motor **sin UI**; `createKernelService(rep).handle(type, payload)`. Lo usan el worker y los tests de Node (`createLocalClient`). Guarda las formas (`current`, `assembly`) dentro; hacia afuera solo salen datos.
- Pedidos: `build`, `resplit`, `drawing`, `assemblyDrawing`, `buildAssembly`, `safeTravel`, `disposeAssembly`, `nextInstancePos`, `referenceMesh`, `centerOf`, `export`, `memoryMB`, `ping`.
- `kernelWorker.js`: atiende de a uno; los pedidos con `channel` + `latestOnly` se funden (solo corre el último de cada canal; los viejos salen `{superseded:true}`). `transfer.js` junta los buffers de arrays tipados para transferirlos sin copia.
- `kernelClient.js`: promesas; `restart()` descarta el worker (y toda su memoria WASM) y arranca otro. `onBusy(jobs)` alimenta la barra de actividad (`ui/busyBar.js`); los pedidos `silent` no cuentan.
- `main.js` descarta respuestas viejas con números de secuencia (`rebuildSeq`, `viewSeq`, `planoSeq`, `assemblySeq`, `referenceSeq`). **Cancelar** = `restart()`: el motor es un hilo ocupado y no se puede interrumpir desde afuera.
- **Plano**: los `viewModels` llevan closures, que no cruzan `postMessage`. `drawing/drawingData.js` (`toDrawingData`/`fromDrawingData`) quita las funciones en el worker y reconstruye `svg()` en el hilo principal.
- **Memoria**: la memoria WASM solo crece. Al pasar 2,6 GB (o con el botón 🧠) se guarda el proyecto, se reinicia el worker y se reconstruye sin recargar la página.

### Agregar un pedido al motor
1. Método en `methods` de `kernelService.js` (entra y sale **solo** datos clonables; nada de formas ni funciones).
2. Si es de «último gana», usar `{ channel, latestOnly: true }` al pedir.
3. Llamarlo en `main.js` con `await kernel.request('nombre', payload)`, chequeando `isSuperseded` y la secuencia.
4. Test en `tests/kernelService.test.mjs`.

## 5. Construcción de piezas (`kernel/partBuilder.js`)

`buildPart(rep, part, { stopBefore, forDrawing })` ejecuta las operaciones en orden y devuelve `{ shape, results:{id:{status,error}}, params, paramErrors, solids }`.

Reglas y trampas de replicad que el código ya respeta:
- Las transformaciones (`translate/rotate/mirror/scale`) **consumen** el original: clonar antes.
- `fuse/cut/intersect` no consumen operandos.
- **Arena** (`vendor/replicad/casting-*.js`, `globalThis.__elcadArena`): libera todos los wrappers creados dentro de `buildPart` salvo los que se pasan a `arena.end(keep)` (forma resultado + `heavyShapes()`). Redujo la fuga de memoria a la mitad.
- `shifted()` aplica «Girar el cuerpo» (rotar y luego mover) con `kernel/turn.js`.
- **Tubos**: resultado = (sólido ∪ (exterior − huecos previos)) − hueco nuevo; el nivel de anidamiento define pared (profundidad 0) y hueco (1).
- **Cañería**: tramos rectos (extrusión del perfil sobre el plano del tramo) + curvas (revolución alrededor de `d×c` por `p+R·c`); `poses[id]` guarda la pose final para «Continuar desde».
- **Tornillo sin fin**: barrido de la sección sobre una hélice (espesor axial); la unión se omite (cuerpo aparte) si la envolvente no toca al resto; caché LRU de 3 cuerpos.
- `shapeOps.removeBody` evita la booleana cuando el sólido es disjunto.
- Malla adaptativa (`meshExtractor.meshQuality`): superficies libres y diagonal > 120 mm → tolerancia gruesa.
- Parches a replicad: enumeración de aristas/caras sin deduplicación cuadrática (890 ms → 18 ms con 1.500 aristas).

### Malla STL (`mesh`)
`kernel/meshSolid.js` convierte la malla guardada en la operación (`feature.mesh = { nv, nt, v, t }`: vértices Float32 e índices Uint32 en base64, ver `core/meshCodec.js`) en sólido(s) B-Rep:
1. `core/meshTopology.makeManifold`: en las aristas con más de 2 triángulos (cuerpos/láminas que se tocan) empareja triángulos por ángulo y duplica los vértices del abanico sobrante desplazándolos hacia adentro `10 × tolerancia` (≈ 6 µm en una pieza de 500 mm). Sin esto el cosido empareja caras al azar y el sólido sale inválido.
2. `splitBodies`: componentes conectados por aristas de exactamente 2 triángulos; cada cuerpo se cose solo (`BRepBuilderAPI_Sewing`, tolerancia `diagonal × 1e-6`).
3. `ShapeUpgrade_UnifySameDomain` con tolerancias por defecto (fusiona solo lo exactamente coplanar), un sólido por cáscara y, si el volumen sale negativo, `Reversed()`.
4. Va por `combine`/`shifted` como cualquier operación (modo agregar/cortar, `turn`, `move`).

**Trampa:** replicad re-unifica caras tras cada `fuse/cut/intersect` (`SimplifyResult(…, 1e-3)`), y eso invalida las caras casi coplanares de una malla teselada. Por eso `buildPart` y `kernelService.handle` encienden `globalThis.__elcadNoSimplify` (parche en `vendor/replicad/casting-*.js`) cuando la pieza —o el ensamble construido— contiene una operación `mesh`. Límite del camino B-Rep: `maxStlTriangles` = 20 000 (`io/stlReader.js`); por encima, el diálogo ofrece simplificar (`core/meshSimplify.js`: colapso de aristas con cuádricas, asíncrono por tandas con progreso/cancelación, condición de enlace para conservar la variedad, sin triángulos invertidos, bordes protegidos) o `feature.meshOnly`: `kernel/meshOnlyData.js` arma el mismo formato que `extractMesh` (normales suavizadas salvo pliegues > 35°, aristas = pliegues y bordes abiertos) sin pasar por el B-Rep; `buildPart` devuelve `meshOnly: [data]` y `kernelService.build` los agrega como ítems `meshonly` (la pieza no tiene `shape`: no hay planos/STEP/ensamble de ella). Progreso: `meshSolid.js` llama `globalThis.__elcadProgress(fase, fracción, estimadoMs, hasta)`; el worker lo reenvía como `{ id, progress }`, el cliente lo entrega a `onProgress` y `BusyBar.progress` dibuja la barra determinada (las fases de una sola llamada —cosido, unificación— avanzan por estimado a partir de lo que tardaron las caras).

### Agregar un tipo de operación
1. Defaults y etiqueta en `partModel.js` (+ icono en `ui/featureTree.js`).
2. Builder en `partBuilder.js` y rama en el despachador.
3. Controles en `ui/propertiesPanel.js`.
4. Si afecta al plano: `drawing/features3d.js`/`viewModel.js`.
5. Prueba en `tests/` y alta en la cadena de `npm test`.

## 6. Planos (`src/drawing`)

`buildDrawing(rep, shape, part, { mass, extras })` → proyecta vistas (primer diedro), detecta círculos/agujeros/roscas/engranajes (`features3d`), arma `viewModels` (`viewModel.js`), cotas automáticas (ISO 129, `autoDims`), hoja ISO 7200 (`sheet*`) y devuelve `{ sheet, layout, primitives, dims, drawing, mass, viewModels }`. Salidas: `svgWriter` (SVG/PDF por impresión) y `dxfWriter` (R12 con capas). Las cotas movidas y las vistas libres se guardan en `drawing.dimOverrides` / `drawing.viewOffsets`. Con rosca real o engranaje helicoidal el plano reconstruye con `forDrawing: true` (rosca cosmética).

Escala por vista: `view.scale` (número o `'auto'`); `layoutViews` usa `viewScaleOf(view) ?? escalaHoja` en cada vista (`placement.scale`, `placement.own`), así que cotas, exportaciones y arrastres ya trabajan con la escala de cada una. `parseScale` / `stepScale` en `drawing/sheet.js`.

### Propiedades físicas y distancias
- `core/massProps.js`: volumen, superficie, centroide, inercia por tetraedros firmados (puro). `core/capacity.js`: voxelización por cruces de columna (par-impar) + «interior» = material a ambos lados en ≥ 2 de 3 ejes (admite bocas abiertas) y flood fill para la cavidad cerrada. UI: `ui/propertiesDialog.js` (mallas de `viewer.itemGeometry`).
- `core/sketchDistance.js`: distancia mínima punto/forma/forma (contornos y guías infinitas). El editor de boceto arma las formas con `shapes()` y las usa en `drawProximity` (distancia viva al dibujar) y en la herramienta `gap`.

## 7. Conjunto

`kernel/assemblyBuilder.js`: caché de piezas por contenido (`partKey`), instancias con `placeShape`, interferencias por intersección (con filtro de cajas), lista de materiales y compuesto. `safeTravel` = muestreo + bisección del volumen común. Cinemática de engranajes en `core/kinematics.js` (pares, relación, fase).

## 8. Simulación (`src/particles`)

Todo en un worker propio (`worker.js`, `particleRunner.js`):
- Granulares: PBD con fricción; colisión contra malla por **SDF** de grilla (caché reutilizable si la geometría no cambió).
- Líquidos: PBF con densidad de pared (`rhoScale` 0,65, 3 pasadas por subpaso), viscosidad XSPH, tensión superficial.
- Aire rápido (`airflow.js`): grilla Euler 12k/20k/40k celdas, acoplamiento de una vía; sirve para chorros y viento con boquillas `bc:'chorro'`.
- Aire calculado (`airSolver.js`, `pcg.js`): flujo incompresible cuasi-estacionario en grilla MAC, proyección de presión con PCG (MIC(0)), semi-Lagrangiana con MacCormack solo en el interior limpio, Smagorinsky y fricción de pared. Entradas por caudal (`bc:'caudal'`, m³/h) o por presión de plenum (`bc:'presion'`, Pa); salida a p = 0 en el borde del dominio. Las chapas finas (mallas STL de ~1,5 mm contra celdas de 7–10 mm) se tratan como **membrana**: una cara se bloquea si un triángulo cruza el segmento entre centros. Cuerpos analíticos con `distance()` usan celdas cortadas fraccionarias. Se resuelve en rebanadas de 12 ms (`solveAirSlice`) para no trabar la animación; solo la solución inicial frena la emisión.
- Acople con granos (`drag.js`): arrastre Gidaspow (Schiller–Naumann + Wen–Yu para ε ≥ 0,8, Ergun por debajo) con el diámetro real `grain` (mm) y `density`; los granos depositan fracción de sólido y arrastre en la grilla (dos vías), por lo que una línea cargada sube la presión. Validado: velocidad terminal de una esfera de vidrio de 1 mm (6,2–7,4 m/s) y Ergun ±5 %.
- Granular: contacto PBD con fricción de Coulomb con fuerza normal acumulada entre pasadas (`pairNormal/wallNormal`), piel de contacto 1,03, `sweepBodies` (colisión continua), pasadas adaptivas (3 + ⌈carga/1,5⌉, máx 10) y **sueño de granos** (calma 20 cuadros; los despierta un vecino en movimiento, un cuerpo móvil a < 3 radios o aire por encima de `liftSpeed`). `overburden` (peso de las capas superiores como capacidad de fricción) y `stabilize` quedan **apagados** por defecto: el primero reduce la descarga a 19–32 % de Beverloo, el segundo abre las pilas. Medido (`tests/granular.test.mjs`): descarga por orificio ≈ 83–110 % de Beverloo; pendiente del flanco de una pila vertida 33° (arena) y 25° (azúcar). El vértice queda achatado por el impacto, por eso `atan(altura/radio)` subestima (9–13°): se mide la pendiente del flanco. Una resistencia a la rodadura dependiente de la velocidad se probó y no cambió la pila; se descartó.
- Ejes con dinámica (`rotor.js`): una acción `rotate` continua con `dynamics:true` integra J·dω/dt = τmotor − τcarga − τfricción. Motor proporcional saturado en `torqueMax`, fricción de Stribeck (estática → Coulomb) + viscosa, adherencia por debajo del par estático, integración semi-implícita. El par de carga sale de los empujes de los granos sobre el cuerpo (`accumulateTorque`: F = m·Δx/h², proyectado sobre el eje, pasabajos 20 ms). `rotorInfo()` entrega rpm, pares y `stuck`.
- Acciones (`core/actions.js`): `rotate`, `slide`, `vibrate`, `air`; disparadores `time`, `after`, `exited`, `zone`. `evaluateActions(actions, t, ctx)` es puro; `applyScene` corre por subpaso (con *vibrate* los subpasos ≥ ⌈dt·f·10⌉, tope 12).
- Precisión: el aire calculado sigue Bernoulli en conos convergentes (presión +0…+40 % según criterio y resolución), el difusor se desprende y recupera ~40 % de la presión ideal, el área de paso tiene ±2–14 % de error de escalera según la resolución; el caudal de entrada se conserva ±3 %. Úsese para comparar variantes y detectar taponamientos, no como CFD certificado. Los granos son *coarse-grained* (una partícula representa varias): el flujo en masa sirve, la harina cohesiva y los ángulos de reposo reales no se reproducen.

- Estructuras (`kernel/frameGeometry.js`, `buildFrame` en partBuilder): operación `frame` = catálogo de perfiles (`profileShape`: tube/bar/angle/channel/pipe) + barras `{a, b, roll, label}` (expresiones aceptadas). `frameSpec` resuelve marcos y **planos de inglete** (nudos de exactamente 2 extremos no alineados: plano bisector `n = unit(d1 − d2)`; cada barra conserva su lado). `buildFrame` extruye el perfil, corta el hueco y quita el semiespacio del inglete con un rectángulo grande extruido. `cutList` agrupa cortes y calcula punta larga y peso. `boxMembers` y `sketchMembers` generan barras. Tests: `frameGeometry`, `frame`.

- Transmisiones (`core/actions.js`): `rotate`/`slide` con `mode:'follow'` y `link {master, type, a, b, ratio, eff, inertia, pitch}`. `linkRatio` da la relación salida/entrada. `evaluateActions` resuelve los seguidores en cadena sobre los aportes cinemáticos (`contrib`) y devuelve `links`. `ParticleSim.applyLinks` suma la parte dinámica del motor real (rotor), refleja la carga de los granos al eje motor (`factor = Π ratio / Π eff`) y su inercia (`J·ratio²`). Los seguidores de tipo `slide` no devuelven carga todavía.

- Cintas: `slide` con `mode:'belt'` no desplaza el cuerpo: aporta `surf` (mm/s) que `solveBodies` suma a la velocidad de la superficie en el cálculo de fricción (Coulomb contra el desplazamiento relativo). Puede seguir a un rodillo por `link.pitch`. Validado en `belt.test` (299 mm/s con cinta a 300).
- Productos (`rigid.js`): cajas rígidas con XPBD de posiciones: 14 puntos de prueba por caja (vértices + centros de cara) contra el SDF del entorno (`ParticleSim.envQuery`, con velocidad de superficie) y contra las otras cajas (SDF analítico de caja), fricción de Coulomb por contacto, 6 iteraciones con barrido simétrico y el entorno al final. Alimentadores `scene.feeders` (`simFeeders`); `spawnProducts`/`cullProducts`; el visor los dibuja con una `InstancedMesh` (`setProducts`). Los sensores cuentan `counts: 'granos'|'productos'|'todo'`. ~0,4 ms por subpaso con 20 cajas. Límite: las cajas no interactúan con los granos; sin guías laterales una fila contra un tope se desordena.
- `buildPairs` sale de inmediato sin granos (recorría la grilla entera en cada subpaso: 85 % del costo de una línea de cajas).
- Registro y gráficos: `recorder.js` (muestreo a 10 Hz, acotado a 4000 muestras con decimación, CSV) y `ui/seriesChart.js` (canvas). Corte de aire: `AirSolver.sliceField` + `colormap.js` + `Viewer.setAirSlice`. Detector de taponamiento: `ParticleSim.monitorInlets` (línea base al asentarse el aire).
- Motores (`data/motors.js`): catálogo típico 0,37–7,5 kW; `motorPatch` fija rpm, `torqueMax` = 2,3 × nominal, inercia y `ratedTorque`; `rotorInfo` reporta `rated` para el % de carga.

- Biblioteca (`src/data/library`): ítems `{ id, category, label, description?, ask?, build(args), expect? }` repartidos por módulos (`fasteners`, `bearings`, `transmission`, `structure`, `hoppers`, `fluids`, `machines`, `electrical`, `mechanisms`), tablas normalizadas en `tables.js` y un constructor fluido `PartBuilder` en `helpers.js` (`add`, `cut`, `tube`, `lathe` = revolución alrededor de Z con puntos [radio, z], `frame`, `radial` = copias en círculo como operaciones propias —a diferencia de «Repetir», cada una se puede elegir como cuerpo móvil—, `action`, `nozzle`, `sensor`, `feeder`). Convención: eje de las piezas de revolución a lo largo de Z desde z = 0. `main.js` las registra como plantillas `lib:<id>` y `ui/libraryDialog.js` las muestra por categoría. Pruebas: `library.test` construye las 109 piezas (válidas, con volumen y las medidas de `expect`) y `libraryScenes.test` simula las máquinas con la misma cadena de la aplicación (`libraryScene.mjs`). Trampas del kernel: el desplazamiento de una operación es numérico (no admite expresiones); un toro fusionado con un plano da mallas incompletas (usar anillos planos); cientos de círculos en un boceto son lentísimos (máx. ~100–500); con cajas rígidas el SDF usa banda de 10 mm (si no, una caja que penetra no encuentra la salida).
- Disparo por zona con rearmado (`start.rearm`): `ParticleSim.zoneLast` guarda el último flanco ascendente del sensor; la acción se reinicia cada vez que se vuelve a cumplir (empujador por fotocelda).

## 9. Interfaz

`ui/*` son clases que reciben `root` y *hooks* (no conocen el dominio). `main.js` los cablea. Paneles: árbol de operaciones, parámetros, propiedades, editor de boceto (`sketchEditor` + `sketchSnap`), plano (`planoView`/`planoPanel`), motor, mover, acciones (`scenePanel`), partículas, proyecto, conjunto. `busyBar` muestra actividad del motor con **Cancelar**.

## 10. Pruebas

Cadena en `package.json`: kernel, drawing, views, sketch, holes, reference, dimText, thread, corners, gear, motion, move, kinematics, dxfImport, dwgImport, screw, particles, actions, scene, airflow, turn, shapeOps, stlImport, kernelService. `stlImport` acepta `STL_SAMPLE=/ruta/archivo.stl` para probar una malla real. Los tests de Node cargan OCC con `kernel/occNode.js`; el navegador usa `occBrowser.js`.

## 11. Convenciones

- lowerCamelCase; módulos pequeños con una responsabilidad; principios SOLID.
- Nada de formas OCC fuera de `kernelService`/`partBuilder`/`assemblyBuilder`.
- Sin build ni dependencias nuevas sin discutirlo.
- Español en la interfaz; `console.debug` no queda en el código.

## 12. Límites y pendientes

Restricciones de boceto; deshacer a nivel de conjunto; cotas en isométrica; vista auxiliar para agujeros inclinados; líquidos/aire con GPU (WebGPU). Cálculo del motor sigue siendo de un solo hilo: el worker evita congelar la interfaz, no acelera el cálculo.


## 13. Válvulas, mover en el visor y memoria (v23)
- **Válvula** (`core/actions.js`): `mode: 'valve'` en `slide` y `rotate` con `openTime / holdOpen / closeTime / closedHold`; `valve()` devuelve progreso y pendiente suavizados, `actionSpan()` da la duración para encadenar con «Al terminar otra acción» (null si no termina: repetida o abierta sin fin se trata como continua).
- **Mover en el visor**: `core/moveSnap.js` (puro: `snapMove` imanes por eje contra cajas y origen, `neighbourGaps` distancia libre a vecinos enfrentados, `dragDelta` rayo → eje/plano) + `ui/moveTool.js` (clic/arrastre, guías con `Viewer.showGuides`, un solo `onCommit`). En Pieza, `splitSpec` separa cada operación movible como grupo `grp:<id>` mientras el panel Mover está abierto con «elegir en el visor»; en Conjunto el id del ítem es el de la instancia. Las operaciones «solo malla» son `meshonly`, `meshonly1`…
- **Memoria WASM**: `kernel/batchMesh.js` malla por tandas de 200 caras (`meshShape`) y las aristas por tandas de 1000 (`meshEdgesShape`); idéntico resultado y pico ~10× menor (medido: 9 800 caras 1 474 MB → 199 MB). Lo usan `extractMesh`, ensamble, planos y 3MF. Liberación automática en reposo en `main.js` (`updateMemory`).

## 14. Pares engranados (v24)

`src/core/gearPair.js` (puro): `matingPhase` (fracción de diente f₂ = ½ − f₁ en el punto primitivo), `rackToothOrigin`, `matingGearFeature`, `rackOutline` y `addGearMate(state, gearId, params, opts)`, que devuelve el estado con la pieza nueva y las acciones enlazadas. `tests/gearPair.test.mjs` valida con el kernel: volumen de intersección ≈ 0 con la fase calculada y > 180 mm³ con medio diente corrido (4 direcciones + 37°). UI: `PropertiesPanel.gearMateControls`; handler `onAddGearMate` en `main.js`.

`src/core/sprocket.js` (puro): `chainTable`, `sprocketGeometry`, `sprocketOutline`, `chainLinks`/`centerForLinks`/`chainLayout` (eslabones pares), `addSprocket` (boceto+extrusión del dentado con `feature.sprocket`, cubo y agujero) y `addSprocketPair` (segunda rueda + acciones `correa`). Tests: `tests/sprocket.test.mjs` (contorno entre Ø pie y Ø exterior para toda la tabla, volumen en kernel, par). UI: `PropertiesPanel.sprocketControls`; handler `onAddSprocketPair`.
