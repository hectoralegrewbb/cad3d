# Mapa de módulos — ElCad 3D 0.2

| Módulo | Responsabilidad | API pública principal | Consumidores |
|---|---|---|---|
| core | Modelos, comandos, historial, expresiones y geometría pura | DocumentStore, commands, parseProject, solveSketchConstraints, solveAssemblyMates, transformMesh | app, kernel, ui |
| kernel | Construcción y validación B-Rep, mallado, conjuntos, importación y exportación | createKernelClient.request / createKernelService.handle | app; pruebas |
| drawing | Proyección, cotas y composición de planos | buildDrawing, buildAssemblyDrawing, toDrawingData/fromDrawingData | kernel, app, ui |
| particles | Colisiones, dinámica, aire y registro temporal | ParticleRunner, ParticleSim, RunRecorder | app, ui, worker |
| io | Frontera de archivos y persistencia | parsePart, saveLocal/loadLocal, listRevisions/clearRevisions, geometryJob | app, ui |
| viewer | Escena Three.js, picking, poses, cámara y cortes visuales | Viewer | app; herramientas UI por inyección |
| ui | Controles y paneles | Clases de panel; createWorkbench(viewer, hooks) | app |
| app | Composición de módulos y coordinación de estados | Entrada main.js | index.html |
| data | Plantillas y catálogo | templates, libraryItems | app, ui, pruebas |

Los objetos OpenCascade permanecen en el worker. Sus respuestas contienen datos clonables; las mallas cacheadas se copian antes de transferir buffers. El visor comparte BufferGeometry entre instancias de una pieza y aplica matrices de colocación; las colisiones reciben coordenadas del mundo.

Las restricciones de boceto son dirigidas: A es referencia y B se ajusta. Las relaciones de conjunto operan sobre orígenes/ejes de instancias. No se promete un solver general de grados de libertad ni relaciones persistentes de caras.

## Carga de tolva 0.2.2

- `core/hopperFill.js`: API `hopperCavity`, `validateInitialFill`; detección geométrica y configuración pura. `core/capacity.js` reexporta la detección; `io/geometryWorker.js` la ejecuta mediante `geometryJob('hopper', mesh)`.
- `core/particleConfig.js`: API `particleConfig`; frontera compartida de validación y defaults, consumida por validación, comandos, app y UI.
- `particles/hopperLoad.js`: API `HopperLoad`; contabilidad y deposición porosa, consumida por `ParticleSim`. No importa lógica de UI/kernel.
- `ParticleRunner.start` admite `fill` opcional. Frames y ready transportan datos de carga; `Viewer.setHopperFill/updateHopperFill` representan la nube sin alterar colisiones. El panel comunica y persiste mediante hooks.



## API vigente 0.3.0 (sustituye el reservorio 0.2.2)

| Archivo | API pública | Consumidores |
|---|---|---|
| `core/inspection.js` | meshAudit, meshSection, sectionContours, sectionDxf | IO worker, kernel, UI |
| `core/alignment.js` | alignedPlacement | app |
| `core/motion/*` | buildMotionPlan, getMotionPlan, perfiles, comandos, leva, trayectoria | core/actions, ui/motionPanel, biblioteca |
| `ui/motionPanel.js` | axisBody, pathBody | ui/scenePanel |
| `kernel/inspection.js` | describeEntity, exactSection | kernelService |
| `ui/cadTools.js` | createCadTools | workbench |
| `particles/meshCollider.js` | MeshCollider | ParticleSim |
| `particles/hopperLoad.js` | HopperLoad: seed, track, info | ParticleSim |

Los métodos de reservorio visual se sustituyeron dentro del alcance aprobado. Se mantienen nombres y firmas de los puntos de entrada existentes de app/worker/visor; las capacidades nuevas se agregan mediante hooks y mensajes.
