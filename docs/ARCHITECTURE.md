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

## Reservorio de tolva

Se mantiene la estructura de módulos. El cálculo de cavidad cruza la API de geometría IO; las mallas están en coordenadas del mundo. La intersección de rayos X/Y distingue el hueco entre paredes finas sin engrosarlas. La nube se ordena por Z y su drawRange sigue el volumen restante. Capacidad aproximada; no es un solver de superficies libres.

El reservorio estacionario y las partículas locales conservan masa contable. El reservorio deposita volumen sólido y arrastre en la grilla del aire; no transmite el peso completo a las colisiones DEM. Transferencia limitada por parámetro, espacio libre y presupuesto de partículas. No usar sus tasas como predicción de vaciado espontáneo.

La reparación STL conserva el camino existente. Sólo si falla su validación intenta emparejar caras opuestas alrededor de aristas múltiples, exige sólidos válidos y volumen próximo al original; de lo contrario conserva el error.

