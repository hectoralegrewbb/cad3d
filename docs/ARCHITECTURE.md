# Arquitectura — ElCad 3D 0.2

Se mantiene JavaScript ES modules sin build, Three.js y replicad/OpenCascade vendorizados. Node 18+ sirve los archivos y ejecuta pruebas. No se requieren paquetes npm para ejecutar el producto.

## Representaciones geométricas

La pieza y el conjunto de fabricación conservan roscas reales y geometrías helicoidales. Solamente el cálculo del plano de conjunto utiliza una representación simplificada. Su BOM y masa se obtienen del conjunto exacto, no del proxy del plano.

Los cuerpos solo malla pueden visualizarse, simularse, instanciarse y exportarse a STL/3MF. STEP y planos requieren sólidos B-Rep. Las comprobaciones de interferencia excluyen explícitamente las mallas; se informa cuáles no fueron verificadas. El bloqueo preciso de desplazamiento rechaza conjuntos que las contengan.

El conjunto cachea la construcción y malla por contenido de pieza. Un barrido de cajas por X elimina candidatos antes de las booleanas. La app pide `sharedItems` para transportar una malla por pieza, no una por instancia. Se conserva el contrato anterior `meshes` para otros consumidores y pruebas.

## Nuevas operaciones

- STEP: se importa en el worker y se guarda una representación B-Rep serializada en la operación. Se reconstruye con `deserializeShape`.
- Loft: une dos bocetos con un contorno cerrado simple cada uno; admite superficie reglada.
- Barrido: un perfil simple sigue la primera polilínea del boceto de trayectoria, usada abierta. Ubicar el perfil perpendicular al comienzo. No es un solver de autorreparación de trayectorias.
- Vaciado: espesor positivo hacia el interior, apertura en un extremo mínimo/máximo del eje seleccionado. Puede fallar en geometrías donde el espesor solicitado no cabe.

## Concurrencia y recuperación

Errores de arranque, error de worker y `messageerror` rechazan las solicitudes afectadas y liberan el estado ocupado. Cancelar termina el worker y reconstruye al editar. Recuperar motor guarda antes de reiniciarlo; un guardado fallido bloquea ese reinicio.

STL y capacidad interior se procesan en un worker auxiliar con cancelación y tiempo máximo. La simplificación conserva su implementación asíncrona por tandas.

El render se consolida a un frame. Las capturas renderizan inmediatamente antes de leer el canvas. La grilla y los emisores liberan sus recursos al reemplazarse.

## Historial

Se conserva DocumentStore y sus transacciones de gesto. La interfaz registra además snapshots del proyecto para deshacer estructura, instancias y edición. La restauración detiene simulaciones y recupera el boceto si todavía existe. El historial es de sesión y no se escribe dentro del archivo.

## Ejecución

- `npm start`: desarrollo, sin caché.
- `npm run start:production`: servidor estático con gzip y ETag/revalidación; no publica la app.
- `npm test`: todos los archivos `tests/*.test.mjs`, secuenciales y con resumen de fallos. Un fallo no oculta los archivos siguientes.

La suite del visor valida geometría y matrices con Three.js en Node; no equivale a una validación visual en Chromium/Android.

## Carga dinámica 0.3.0

`HopperLoad` administra la siembra completa FCC, compuerta virtual, métricas y sección finita. `ParticleSim` mantiene todos los estados dinámicos; no recibe un reservorio ni genera granos al descargar. Presupuesto de carga separado del tope adaptativo de emisión. `MeshCollider` refina contactos por BVH de triángulos sólo en banda próxima a pared; el SDF saturado conserva la fase amplia. Las cargas completas no reducen su cantidad por rendimiento. Fallos de capacidad o valores no finitos se informan.

## Herramientas CAD 0.3.0

`core/inspection.js` inspecciona conectividad y contornos; `core/alignment.js` resuelve colocación rígida Rz·Ry·Rx. `kernel/inspection.js` consulta caras/aristas y calcula intersecciones B-Rep. Área/perímetro/DXF se obtienen de contornos muestreados; no se presentan como curvas analíticas exactas. Se conservan huecos por profundidad de anidación y se rechazan contornos ambiguos para exportar.

`createCadTools(viewer,hooks)` recibe sólo APIs públicas de la composición. Las consultas no modifican el documento. La vista previa mueve únicamente matrices de sesión; aplicar valida la firma del proyecto y usa el comando existente de instancias. Instancias fijas, relacionadas o accionadas se rechazan. No se crean relaciones persistentes. Visibilidad de sesión restaurada al cambiar pieza/proyecto/ámbito.
