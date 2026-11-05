# Resultados — 0.2.2

Fecha: 2026-11-03. Node 24.22.1.

- Suite completa: **56/56 archivos aprobados**. Después de las últimas validaciones se repitieron hopperFill, hardening y recorder: aprobados.
- Sintaxis e importaciones locales: 133 módulos fuente, sin errores.
- Cono del proyecto recibido: B-Rep válido con volumen entre 550000 y 575000 mm³; se conserva la validación estricta.
- Cargas 25/50/100 %, carga vacía, reinicio con radio nuevo, parámetros inválidos, resistencia porosa y balance de masa: aprobados. El original permanece intacto.
- Integración del conjunto completo (`scripts/check-hopper-air.mjs`): sin errores de construcción, solver calculado activo sin fallback, deposición del reservorio y coordenadas finitas durante 0,5 s simulados. Cavidad estimada 96,33 L, masa inicial 153,17 kg con arena a fracción sólida 0,6. El balance contable cierra con tolerancia 1e-7 kg. Estos valores no constituyen una medición de capacidad o caudal.
- Chromium está instalado, pero no pudo iniciarse por restricción de sockets del entorno. QA visual, responsive y persistencia interactiva en navegador quedan pendientes según VERIFICACION.md.

El modo nuevo no simula las tensiones mecánicas de todo el lecho ni predice puentes o descarga espontánea. No se verificó el vaciado completo, la estanqueidad del conjunto original ni un caudal experimental.

```text
PASS actions.test.mjs
PASS advanced.test.mjs
PASS airParticles.test.mjs
PASS airSlice.test.mjs
PASS airSolver.test.mjs
PASS airflow.test.mjs
PASS batchMesh.test.mjs
PASS belt.test.mjs
PASS corners.test.mjs
PASS dimText.test.mjs
PASS drag.test.mjs
PASS drawing.test.mjs
PASS dwgImport.test.mjs
PASS dxfImport.test.mjs
PASS frame.test.mjs
PASS frameGeometry.test.mjs
PASS gear.test.mjs
PASS gearPair.test.mjs
PASS granular.test.mjs
PASS hardening.test.mjs
PASS holes.test.mjs
PASS hopperFill.test.mjs
PASS kernel.test.mjs
PASS kernelService.test.mjs
PASS kinematics.test.mjs
PASS library.test.mjs
PASS libraryScenes.test.mjs
PASS massProps.test.mjs
PASS meshOnly.test.mjs
PASS meshSimplify.test.mjs
PASS motion.test.mjs
PASS motors.test.mjs
PASS move.test.mjs
PASS moveSnap.test.mjs
PASS particles.test.mjs
PASS pcg.test.mjs
PASS products.test.mjs
PASS recorder.test.mjs
PASS reference.test.mjs
PASS rigid.test.mjs
PASS rotor.test.mjs
PASS rotorDynamics.test.mjs
PASS scene.test.mjs
PASS screw.test.mjs
PASS server.test.mjs
PASS shapeOps.test.mjs
PASS sketch.test.mjs
PASS sketchDistance.test.mjs
PASS sprocket.test.mjs
PASS stlImport.test.mjs
PASS thread.test.mjs
PASS transmission.test.mjs
PASS turn.test.mjs
PASS viewerShared.test.mjs
PASS views.test.mjs
PASS weld.test.mjs
RESULTADO: 56/56 archivos aprobados
```

---

# Resultados de verificación — 0.2.1

Fecha: 2026-11-03. Runtime: v24.22.1.

**55/55 archivos aprobados.** Sintaxis e importaciones locales verificadas en 130 módulos; sin fallos.

La prueba nueva confirma que tres tubos se convierten en un único sólido, conserva el volumen del material y el hueco interior, y que las membranas de aire cierran la pared de ambas juntas. También cubre rechazo de separaciones y saltos largos/diagonales de los marcadores a través de las paredes.

La escena de la captura no fue reproducida: no se recibió su .proj3d. Los resultados verifican los casos de regresión y no certifican la estanqueidad de esa escena concreta. Sigue pendiente QA visual real de la interfaz.

```text
PASS actions.test.mjs
PASS advanced.test.mjs
PASS airParticles.test.mjs
PASS airSlice.test.mjs
PASS airSolver.test.mjs
PASS airflow.test.mjs
PASS batchMesh.test.mjs
PASS belt.test.mjs
PASS corners.test.mjs
PASS dimText.test.mjs
PASS drag.test.mjs
PASS drawing.test.mjs
PASS dwgImport.test.mjs
PASS dxfImport.test.mjs
PASS frame.test.mjs
PASS frameGeometry.test.mjs
PASS gear.test.mjs
PASS gearPair.test.mjs
PASS granular.test.mjs
PASS hardening.test.mjs
PASS holes.test.mjs
PASS kernel.test.mjs
PASS kernelService.test.mjs
PASS kinematics.test.mjs
PASS library.test.mjs
PASS libraryScenes.test.mjs
PASS massProps.test.mjs
PASS meshOnly.test.mjs
PASS meshSimplify.test.mjs
PASS motion.test.mjs
PASS motors.test.mjs
PASS move.test.mjs
PASS moveSnap.test.mjs
PASS particles.test.mjs
PASS pcg.test.mjs
PASS products.test.mjs
PASS recorder.test.mjs
PASS reference.test.mjs
PASS rigid.test.mjs
PASS rotor.test.mjs
PASS rotorDynamics.test.mjs
PASS scene.test.mjs
PASS screw.test.mjs
PASS server.test.mjs
PASS shapeOps.test.mjs
PASS sketch.test.mjs
PASS sketchDistance.test.mjs
PASS sprocket.test.mjs
PASS stlImport.test.mjs
PASS thread.test.mjs
PASS transmission.test.mjs
PASS turn.test.mjs
PASS viewerShared.test.mjs
PASS views.test.mjs
PASS weld.test.mjs
RESULTADO: 55/55 archivos aprobados
```

---

# Resultados anteriores — 0.2.0

Fecha: 2026-11-02. Runtime de pruebas: Node 24.22.1.

## Suite

54/54 archivos aprobados. Se mantuvieron las pruebas existentes y se agregaron cuatro archivos de regresión.

```text
PASS actions.test.mjs
PASS advanced.test.mjs
PASS airParticles.test.mjs
PASS airSlice.test.mjs
PASS airSolver.test.mjs
PASS airflow.test.mjs
PASS batchMesh.test.mjs
PASS belt.test.mjs
PASS corners.test.mjs
PASS dimText.test.mjs
PASS drag.test.mjs
PASS drawing.test.mjs
PASS dwgImport.test.mjs
PASS dxfImport.test.mjs
PASS frame.test.mjs
PASS frameGeometry.test.mjs
PASS gear.test.mjs
PASS gearPair.test.mjs
PASS granular.test.mjs
PASS hardening.test.mjs
PASS holes.test.mjs
PASS kernel.test.mjs
PASS kernelService.test.mjs
PASS kinematics.test.mjs
PASS library.test.mjs
PASS libraryScenes.test.mjs
PASS massProps.test.mjs
PASS meshOnly.test.mjs
PASS meshSimplify.test.mjs
PASS motion.test.mjs
PASS motors.test.mjs
PASS move.test.mjs
PASS moveSnap.test.mjs
PASS particles.test.mjs
PASS pcg.test.mjs
PASS products.test.mjs
PASS recorder.test.mjs
PASS reference.test.mjs
PASS rigid.test.mjs
PASS rotor.test.mjs
PASS rotorDynamics.test.mjs
PASS scene.test.mjs
PASS screw.test.mjs
PASS server.test.mjs
PASS shapeOps.test.mjs
PASS sketch.test.mjs
PASS sketchDistance.test.mjs
PASS sprocket.test.mjs
PASS stlImport.test.mjs
PASS thread.test.mjs
PASS transmission.test.mjs
PASS turn.test.mjs
PASS viewerShared.test.mjs
PASS views.test.mjs
RESULTADO: 54/54 archivos aprobados
```

## Compatibilidad

120 plantillas de catálogo y plantillas iniciales construidas y validadas con el lector de proyectos nuevo. IDs HTML de main.js comprobados contra index.html; sin referencias ausentes. Importaciones locales comprobadas; sin destinos ausentes. Análisis de sintaxis de los 129 módulos JavaScript: sin fallos.

## Benchmark de conjunto

Escenario: brida repetida sin solapamientos, motor local, geometría exacta, mallas compartidas. La primera medición incluye construir la pieza; las siguientes reutilizan caché. Son mediciones de este escenario, no una garantía de rendimiento en Android ni una comparación de FPS.

| Instancias | Tiempo ms | Mallas compartidas | Memoria WASM MiB |
|---:|---:|---:|---:|
| 1 | 445 | 1 | 100 |
| 10 | 30 | 1 | 100 |
| 40 | 98 | 1 | 100 |

## Límites de verificación

No se completó QA visual en Chromium o Android: no había navegador instalado y la descarga no produjo un ejecutable utilizable. Ver VERIFICACION.md para los casos manuales. Las pruebas viewerShared validan geometría y matrices con Three.js, sin GPU real. IndexedDB requiere la verificación manual de cuota, recuperación y comportamiento entre pestañas.
