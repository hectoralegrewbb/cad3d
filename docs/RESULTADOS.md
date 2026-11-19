# Verificación vigente — 0.6.0 (2026-11-19)

Base: main `002de4a86e798434dd882d73b575a57606ec8a7b`. Node 24.22.3. **68/68 archivos de prueba aprobados** en la suite completa. Casos adicionales finales de guardar/reabrir y cierre de arco también aprobados en pruebas específicas. Sintaxis/importaciones relativas comprobadas en 160 módulos; diff sin errores de espacios.

Tres archivos nuevos cubren recortar/partir/alargar/unir, tangencias y coincidencias, arcos limitados y su sentido al invertir, ausencia de relleno/cuerda fantasma, bloqueo de restricciones, rechazo de solapes/ramificaciones, guardado/lectura y undo/redo atómico. El kernel extruye una red de cuatro líneas con área exacta 200 mm², dos semicírculos como círculo y un semicírculo cerrado con recta; DXF conserva bulge y dimensiones 10×5 mm. Un perfil abierto se rechaza y el siguiente cálculo correcto funciona. La suite anterior de aire, movimiento, fabricación y biblioteca pasa.

Medición orientativa local: validar un polígono de 300 segmentos tomó 22 ms; no es garantía de rendimiento de otros dispositivos. Hay límites explícitos de cantidad y geometría, con error recuperable.

No se verificó visualmente GPU/layout real en esta entrega. El navegador de revisión utilizado para 0.5.0 tenía WebGL deshabilitado. Las pruebas UI de 0.6.0 simulan canvas/eventos y no sustituyen revisión responsive 320/768/1024+ ni CAM/cortadora. Los pasos manuales y limitaciones están en VERIFICACION.md y CHANGELOG.md.

---

# Verificación vigente — 0.5.0 (2026-11-19)

Base del repositorio: `991a3f97efd31c544bb7e675ea13dd82cd6d7b0d`. Node 24.22.3.

**65/65 archivos de prueba aprobados en la ejecución final completa.** Sintaxis e importaciones locales comprobadas en 159 módulos, sin errores; `git diff --check` limpio. La primera ejecución detectó un cambio de texto en el error legacy de engranaje puntiagudo: se conservó la validación nueva y se restauró el mensaje esperado; la ejecución final pasa.

Casos nuevos: volumen/corte/movimiento/guardado de esfera; espesor y hueco teóricos, juego por rueda; separación B-Rep conocida de 40 mm; perfil de chapa con agujero; rebaje detectado como no uniforme; exclusión de esfera sin cara plana; DXF R12/R2000 reimportados; elipse con discretización adaptativa; círculo dividido y orden interior/exterior; controles de medición, lote y revisión de sólidos complejos. El caso añadido de cara inclinada 20° conserva 80×40 mm y pasó con el código final.

La revisión visual del sitio anterior al despliegue encontró WebGL deshabilitado en el navegador de revisión (`GL_VENDOR/GL_RENDERER = Disabled`); no se pudo verificar render 3D ni layout real en ese entorno. No es evidencia de un fallo del sitio para navegadores con WebGL. Los tests DOM verifican eventos y estados, no GPU o responsive. La validación 320/768/1024+ y la prueba en CAM/cortadora siguen pendientes.

La extracción de una cara no desarrolla chapa. Volumen/área/espesor es un filtro de consistencia, no prueba suficiente de extrusión uniforme. Splines/elipses se aproximan adaptativamente con objetivo 0,02 mm; dentado conserva el muestreo de la geometría existente. Sin nesting ni kerf automático.

```text
PASS actions.test.mjs
PASS advanced.test.mjs
PASS airInlet.test.mjs
PASS airParticles.test.mjs
PASS airPreparation.test.mjs
PASS airSlice.test.mjs
PASS airSolver.test.mjs
PASS airflow.test.mjs
PASS batchMesh.test.mjs
PASS belt.test.mjs
PASS cadTools.test.mjs
PASS corners.test.mjs
PASS dimText.test.mjs
PASS drag.test.mjs
PASS drawing.test.mjs
PASS dwgImport.test.mjs
PASS dxfImport.test.mjs
PASS fabrication.test.mjs
PASS fabricationPanel.test.mjs
PASS frame.test.mjs
PASS frameGeometry.test.mjs
PASS gear.test.mjs
PASS gearPair.test.mjs
PASS granular.test.mjs
PASS hardening.test.mjs
PASS holes.test.mjs
PASS hopperFill.test.mjs
PASS inspection.test.mjs
PASS kernel.test.mjs
PASS kernelService.test.mjs
PASS kinematics.test.mjs
PASS laserPanel.test.mjs
PASS library.test.mjs
PASS libraryScenes.test.mjs
PASS massProps.test.mjs
PASS meshOnly.test.mjs
PASS meshSimplify.test.mjs
PASS motion.test.mjs
PASS motionControl.test.mjs
PASS motors.test.mjs
PASS move.test.mjs
PASS moveSnap.test.mjs
PASS particles.test.mjs
PASS pcg.test.mjs
PASS pressureSensor.test.mjs
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
RESULTADO: 65/65 archivos aprobados
```

---

Histórico de entregas anteriores:

# Resultados vigentes — 0.3.0

Fecha: 2026-11-06. Node 24.22.1.

- Suite general: **57/57 archivos aprobados**. Se agregó después `cadTools.test.mjs`, aprobado, para eventos de vista previa, aplicar/cancelar, centro de sección e invalidación. Total de archivos de prueba actuales verificados: **58**. Las últimas ampliaciones de hopperFill, inspection y viewerShared se verificaron por separado; sin fallos.
- Sintaxis e importaciones locales verificadas en 138 módulos fuente, sin errores.
- Carga física: 0/25/50/100 %, retención cerrada, descarga por gravedad sin emisión, masa, rechazo de presupuesto insuficiente, primer cruce por sección finita sin duplicados y chapa de 0,2 mm contra SDF de 4 mm: aprobados.
- CAD: sección de caja de 10×20 mm da 200 mm² y perímetro 60 mm; tubo descuenta el hueco; DXF exportado se reimporta. Radio, longitud y área B-Rep, cara de instancia rotada/trasladada, alineación con giro adicional, historial y serialización: aprobados.
- Visor: ocultar/restaurar y previsualizar/cancelar conservan las matrices base; prueba sin GPU.
- Integración de `Tolva_prueba_escala.proj3d`: solver calculado activo sin fallback, toda la carga participa, aire/descarga habilitados después del intervalo previo, coordenadas finitas y masa conservada durante los primeros 0,32 s simulados. No es prueba de vaciado completo.

## Costo del conjunto recibido

Benchmark de los primeros 3 pasos con refinamiento de triángulos: **487.580 partículas**, ~550 MiB RSS, 2,6–3,0 s reales por paso de 1/60 s simulado. Ningún centro fuera de la envolvente lateral en esos primeros pasos; 0 salidas y masa contable conservada. Son mediciones de este entorno, no garantía de FPS ni estabilidad del vaciado completo. La compactación aumenta el costo.

También se ejecutaron 125 pasos con la versión previa del contacto SDF dentro de este desarrollo: conservó la masa, pero no se usa ese resultado como validación de la versión final de contactos. El benchmark reproducible vigente usa los 3 primeros pasos, para evitar presentar una validación más extensa de la que se completó con el motor final.

## Pendiente / alcance

El navegador de revisión no pudo acceder al servidor local (conexión rechazada). No se completó QA visual real, responsive o IndexedDB interactivo; los eventos de UI se verifican con un DOM mínimo sin layout. Ver VERIFICACION.md para pasos manuales.

La dinámica PBD y el aire son aproximados. No se certificaron puentes, presión de toda la carga, caudal industrial, descarga completa del conjunto real ni estanqueidad de sus uniones. El porcentaje efectivo y la masa inicial proceden de las partículas realmente colocadas.

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
PASS inspection.test.mjs
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
RESULTADO: 57/57 archivos aprobados
PASS cadTools.test.mjs (adicional después de la suite)
```

---

Resultados históricos anteriores; el reservorio 0.2.2 fue sustituido.

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
