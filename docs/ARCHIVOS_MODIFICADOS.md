# Archivos de esta entrega

## Modificados

- `README.md`
- `docs/DESARROLLO.md`
- `docs/GUIA_USUARIO.md`
- `index.html`
- `package-lock.json`
- `package.json`
- `serve.mjs`
- `src/app/main.js`
- `src/core/commands.js`
- `src/core/expression.js`
- `src/core/meshCodec.js`
- `src/core/partModel.js`
- `src/core/projectModel.js`
- `src/drawing/svgWriter.js`
- `src/io/persistence.js`
- `src/kernel/assemblyBuilder.js`
- `src/kernel/exporters.js`
- `src/kernel/kernelClient.js`
- `src/kernel/kernelService.js`
- `src/kernel/kernelWorker.js`
- `src/kernel/partBuilder.js`
- `src/kernel/threeMf.js`
- `src/particles/particleRunner.js`
- `src/particles/recorder.js`
- `src/particles/sim.js`
- `src/ui/assemblyPanel.js`
- `src/ui/busyBar.js`
- `src/ui/dom.js`
- `src/ui/featureTree.js`
- `src/ui/particlePanel.js`
- `src/ui/propertiesDialog.js`
- `src/ui/propertiesPanel.js`
- `src/ui/sketchEditor.js`
- `src/ui/stlImportDialog.js`
- `src/viewer/viewer.js`
- `styles.css`

## Nuevos

- `docs/ARCHITECTURE.md`
- `docs/ARCHIVOS_MODIFICADOS.md`
- `docs/CHANGELOG.md`
- `docs/DESIGN_SYSTEM.md`
- `docs/PROJECT_MAP.md`
- `docs/RESULTADOS.md`
- `docs/SECURITY.md`
- `docs/VERIFICACION.md`
- `scripts/benchmark.mjs`
- `scripts/test.mjs`
- `scripts/three-loader.mjs`
- `src/core/assemblyMates.js`
- `src/core/meshTransform.js`
- `src/core/sketchConstraints.js`
- `src/core/validation.js`
- `src/io/geometryClient.js`
- `src/io/geometryWorker.js`
- `src/ui/assemblyRelations.js`
- `src/ui/constraintPanel.js`
- `src/ui/workbench.js`
- `tests/advanced.test.mjs`
- `tests/hardening.test.mjs`
- `tests/server.test.mjs`
- `tests/viewerShared.test.mjs`

## Actualización 0.2.1

- `README.md`
- `docs/CHANGELOG.md`
- `docs/GUIA_USUARIO.md`
- `docs/RESULTADOS.md`
- `docs/SECURITY.md`
- `docs/VERIFICACION.md`
- `package-lock.json`
- `package.json`
- `src/app/main.js`
- `src/kernel/assemblyWeld.js`
- `src/kernel/kernelService.js`
- `src/particles/airSolver.js`
- `src/particles/sim.js`
- `src/ui/assemblyPanel.js`
- `src/ui/busyBar.js`
- `tests/weld.test.mjs`
- `docs/ARCHIVOS_MODIFICADOS.md`

## Actualización 0.2.2

Modificados: `package.json`, `package-lock.json`, `README.md`, `src/app/main.js`, `src/core/{capacity,commands,meshTopology,validation}.js`, `src/io/geometryWorker.js`, `src/kernel/{kernelService,meshSolid}.js`, `src/particles/{particleRunner,recorder,sim,worker}.js`, `src/ui/particlePanel.js`, `src/viewer/viewer.js`; documentación de mapa, arquitectura, diseño, seguridad, uso, cambios, verificación y resultados.

Nuevos: `src/core/{hopperFill,particleConfig}.js`, `src/particles/hopperLoad.js`, `tests/hopperFill.test.mjs`, `examples/{LEEME.md,Proyecto_original.proj3d,Tolva_llena.proj3d}`.

Nuevo: `scripts/check-hopper-air.mjs` (integración reproducible del ejemplo).
