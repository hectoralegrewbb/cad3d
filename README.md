# Actualización 0.3.0 — carga dinámica y herramientas CAD

Ejecutar `npm start`. El llenado se reemplazó por partículas dinámicas en todo el volumen; no hay reservorio visual ni emisión artificial durante el vaciado.

Para una primera prueba abrir `examples/Tolva_prueba_escala.proj3d`, pasar a **Conjunto → Partículas → Iniciar**, esperar el asentamiento y pulsar **Abrir descarga**. Activar aire por separado. Es una copia a escala 0,08; no representa las dimensiones reales. El conjunto original configurado está en `examples/Tolva_llena.proj3d` y exige cálculo lento.

Herramientas nuevas en **Herramientas de vista y proyecto → Inspección y montaje CAD**: visibilidad, inspector, sección/DXF, medidas B-Rep y alineación con vista previa.

Consultar `examples/LEEME.md`, `docs/GUIA_USUARIO.md` y `docs/RESULTADOS.md`. Las notas 0.2.2 siguientes son históricas y describen el reservorio sustituido.

> **0.2.2 — Tolva cargada:** iniciar con `npm start` (equivale a `node serve.mjs`). Abrir `examples/Tolva_llena.proj3d`, pasar a **Conjunto → Partículas → Iniciar**. Consultar `examples/LEEME.md` antes de interpretar resultados.

> **Actualización 0.2.1:** consultar [cambios aprobados](docs/CHANGELOG.md), [arquitectura](docs/ARCHITECTURE.md) y [verificación](docs/VERIFICACION.md). Se mantienen formatos y estructura existentes.

# ElCad 3D — modelador paramétrico de piezas + planos de taller

Documentación: [`docs/GUIA_USUARIO.md`](docs/GUIA_USUARIO.md) (uso) · [`docs/DESARROLLO.md`](docs/DESARROLLO.md) (desarrollo).

Sin build. Requiere Node 18+ (solo para el servidor estático y los tests).

    node serve.mjs          # http://localhost:5174  (PORT=xxxx para cambiar)
    npm test

## Modo 3D
- Árbol de operaciones: boceto (rect, círculo, ranura, polilínea con arcos), extrusión (suma/corte, hacia arriba/abajo/simétrica, pasante), revolución, agujero (simple/en PCD/avellanado), filete, chaflán. Suprimir/reordenar.
- Todos los campos aceptan números o expresiones con parámetros (`Dext/2 + 1,5`).
- Selección de aristas por clic ("near"): sobrevive a cambios de parámetros.
- Exporta STL (Bambu Studio / Orca) y STEP.

## Modo Plano (IRAM/ISO)
- Hoja A4 (por defecto), A3, A2; apaisada o vertical; marco y cajetín ISO 7200; escalas ISO 5455 automáticas o fijas.
- Proyección en primer diedro (símbolo en cajetín). Vistas: frente, planta, laterales, posterior, inferior; líneas ocultas y ejes opcionales; rotación 90°.
- Acotado ISO 129 automático (medidas generales, diámetros, cadenas, agujeros "n× Ø", PCD). Cualquier cota automática se puede quitar y restaurar.
- Acotado manual: Lineal (L, Shift = alineada), Ø (D), R (R); Supr quita; texto editable.
- Cotas movibles: clic para seleccionar y arrastrar (línea de cota o rótulo de Ø); la posición se recuerda aun en cotas automáticas y se restablece desde el panel. Los rótulos de Ø evitan cruzar cotas lineales.
- Color de pieza (selector en la lista de proyecto; ↺ vuelve al automático: color del material en la vista de pieza, paleta en el ensamble) y material (densidad → masa). Botón ? con atajos.
- Masa por material (densidad × volumen). Notas y tolerancia general (ISO 2768-mK) editables.
- Exporta SVG, PDF (diálogo de impresión, tamaño de hoja exacto) y DXF (R12, capas).
- El plano se guarda dentro del `.part3d`.

## Boceto 2D
- Herramientas: rectángulo (R), cuadrado (Q), círculo (C), elipse (E), ranura (S), línea/polilínea (L/P), medir (M), seleccionar (V).
- Imanes con marcador y nombre: vértice, centro, punto medio, cuadrante, intersección, origen; guías cada 0/45/90…° desde el último punto y líneas de alineación. Alt los desactiva; botones 🧲 / ∠ los apagan.
- Tamaño tipeado: tras el primer clic aparece una tarjeta (Tab entre campos, Enter aplica, Esc cancela). Círculo: Ø o `r12`; rectángulo/elipse: dos medidas; línea: largo + ángulo por tramo, Enter vacío cierra. Acepta `25`, `2,5 cm`, `1"` y expresiones con parámetros (se guardan como expresión).
- Guía auxiliar (G): línea infinita por un punto y ángulo, para ubicar objetos; no se extruye pero atrae el cursor ("Sobre línea") y genera intersecciones. Shift: mover o trazar en línea recta (múltiplos de 45°) desde el punto de partida.
- Polígono regular (N): lados + medida entre caras (llave) o entre vértices, giro tipeable. Sirve para tuercas, cuadrados de llave y perfiles especiales.
- Al mover una entidad (arrastrando) se muestran las distancias a lo más cercano en cada dirección: otras formas, guías rectas y ejes. Ctrl+D duplica la entidad elegida.
- Repetir: en cada entidad, sección "Repetir" → en fila (separación y ángulo), en círculo (centro, ángulo total, girar copias) o en elipse (radios y ángulo inicial). Crea las copias como entidades independientes en un solo paso de deshacer.
- Rosca: en agujeros y círculos, tilde "Rosca" + tipo (métrica gruesa/fina, gas G, UNC, UNF). La medida sale sola del Ø (broca de macho o nominal) o se elige; el plano rotula "M8×1,25 prof. 12" y dibuja el arco cosmético de rosca. El rótulo se asigna por diámetro: otro agujero del mismo Ø sin tilde también se rotula.
- Reglas superior e izquierda en mm/cm con marca del cursor; herramienta Medir (distancia, Δx, Δy, ángulo).

## Papel cebolla (referencia en el editor de bocetos)
- Al editar un boceto se ven en tenue los **otros bocetos** (azul, trazo discontinuo) y el **corte de la pieza ya construida** por el plano de este boceto (ámbar). Botones 🧅 Bocetos / 🧅 Pieza para prenderlos o apagarlos.
- Bocetos en otro plano se proyectan sobre el actual (uno perpendicular queda de canto, como una línea). El corte de la pieza usa la pieza *antes* de la operación que consume este boceto, así no se confunde con lo que dibujás. Funciona en planos rotados.
- La referencia atrae el cursor como lo propio (la etiqueta dice "· referencia"): vértices, centros y cuadrantes (bocetos en el mismo plano), puntos sobre línea, intersecciones con lo que dibujás, alineaciones, y distancias al arrastrar una entidad. No entra en el perfil ni se extruye.

## Planos de trabajo rotados
- En un boceto o agujero: "Rotar el plano (cualquier ángulo)" → eje del mundo (X/Y/Z), ángulo (acepta expresiones y parámetros), centro de giro (X, Y, Z) y atajos ±30/45/90°. El plano gira como cuerpo rígido; los demás bocetos no se mueven (comparten los ejes del mundo). Se resalta en la vista 3D con sus ejes locales (X rojo, Y verde).
- Ejemplo: prisioneros radiales en un cubo Z → plano Alzado (XZ), girar sobre Z con centro (0, 0, 0), círculo a la altura deseada (Y local = Z del mundo), corte pasante. Un agujero por ángulo; Repetir en círculo también sirve en el plano de la pieza.

## Plano: agujeros radiales y estabilidad
- Los agujeros se leen de las caras cilíndricas (no de las aristas): un agujero radial en un cilindro no deja aristas circulares. En cada vista se acotan: Ø/rosca con línea de referencia al eje, altura (eje horizontal/vertical en la vista) o cota angular (eje inclinado dentro de la vista), y se dibuja su eje de trazo y punto.
- Las medidas generales usan la caja exacta de la pieza (70, no 69,99).
- El reparto y la escala del plano solo dependen de las cotas automáticas en su lugar natural: mover o agregar cotas no reacomoda ni reescala las vistas (la cota movida puede salirse de la hoja si la llevás lejos).
- Las aristas tangentes (empalme de una placa con un cubo, costuras de cilindros) no se dibujan en el plano ni en el visor 3D: son uniones entre caras de un mismo cuerpo, no bordes reales. Si la pieza tiene cuerpos que no se tocan, la barra de estado avisa "N cuerpos separados".
- Cadenas de cotas: se omiten tramos menores a 12 mm de hoja para que los textos no se pisen.

## Roscas con rango, esquinas, texto de cotas y materiales
- **Operación Rosca** (`thread`): eje X/Y/Z + centro, tramo "desde–hasta", exterior o interior, tipo/medida (M, MF, G, UNC, UNF). Por defecto es cosmética: el plano dibuja las líneas finas (¾ de vuelta de frente) y cota el tramo con el rótulo `M20×1,5 L=30`; una rosca interna rotula además el agujero. "Filete real" corta un surco helicoidal (~3 s por cambio; el cilindro extruido se unifica antes del booleano porque llega partido en dos caras).
- **Esquinas por boceto**: rectángulo con R/C por esquina (↙ ↘ ↗ ↖) y polilínea con R/C por vértice; sirve para extrusiones y cortes. Error claro si no cabe.
- **Texto de cotas**: ahora también en cotas automáticas (texto, prefijo y sufijo; se conservan al reordenar).
- **Materiales**: plásticos, elastómeros (Viton, NBR, EPDM, silicona), PVC, PTFE, PE, PP, POM, PEEK, ABS, acrílico, metales extra, etc. (`features3d.js`).

## Engranajes, motor, chaflán de rosca y rendimiento
- **Operación Engranaje** (`gear`): módulo, dientes, ángulo de presión, desplazamiento de perfil, hélice (0 = recto), ancho, agujero y cubo. Contorno de evolvente (ISO 53) sobre cualquier plano de trabajo (incluso rotado). Calcula Ø primitivo/exterior/pie/base y la distancia entre centros con otro engranaje. El plano agrega el círculo primitivo y una nota con los datos; un engranaje helicoidal se dibuja con dientes rectos (la proyección de superficies helicoidales es lenta) y la nota indica la hélice.
- **Chaflán en roscas**: "al inicio" / "al final" (45°). Exterior = cono de entrada; interior = avellanado de la boca. Es geometría real, así que también aparece en el plano.
- **Motor** (botón ⚙ del encabezado): elegí una pieza o instancia, un eje (X/Y/Z) que pasa por un punto, rpm con deslizador en vivo y perfil (constante, rampa, oscilante, escalones). Es solo animación del visor: no modifica el modelo y se detiene al recalcular.
- **Motor selectivo**: en el panel se tildan las operaciones que giran (extrusiones, revoluciones, engranajes…); el resto queda quieto. Internamente la pieza se separa en `fija = pieza − lo que gira` y `gira = operaciones tildadas`. Sin tildes o con todas, gira la pieza entera. El eje de giro se dibuja amarillo punteado.
- **Zona de rosca**: al seleccionar una Rosca, el visor marca en rojo punteado el cilindro "desde–hasta" (círculos extremos, generatrices y eje con sobrante) sobre cualquier eje X/Y/Z, sin depender de la profundidad.
- **Estilo de vista** (botón ◐/▦/▱ del encabezado): Sólido, Malla (wireframe) y Aristas (caras ocultas). Malla no es más rápida que Sólido (dibuja más primitivas); Aristas es la más liviana. Se recuerda entre sesiones; no afecta al plano.
- **Mover operaciones** (botón ↔ Mover): tildá una o varias operaciones (extrusión, revolución, engranaje), bloqueá el eje (X/Y/Z), elegí el paso en mm y usá − / +. Guarda un desplazamiento global `move` en cada operación (su boceto va con ella), con un solo paso de deshacer; "Volver al origen" lo quita. Los agujeros y roscas no siguen a la operación movida (se ubican por coordenadas propias).
- **Rendimiento / robustez**: el kernel enumeraba aristas y caras con una deduplicación cuadrática (parche en `vendor/replicad/casting-*.js`: 890 ms → 18 ms con 1.500 aristas); la clasificación de aristas suaves ya no proyecta puntos sobre superficies planas ni libres (13 s → 1 s con 100 dientes); las aristas se dibujan en una sola malla; la espera antes de recalcular se adapta a lo pesado que fue el último cálculo. Límites: filete real hasta 40 vueltas; el plano y los ensambles usan rosca cosmética.

## Físicas del conjunto, vistas libres en el plano y memoria
- **Transmisión por engranajes** (`src/core/kinematics.js`): en Conjunto, ⚙ Motor con "Físicas" detecta los pares de engranajes de instancias distintas (ejes paralelos, tramos axiales que se solapan, mismo módulo) y los clasifica: *engranan* (centros a (z1+z2)·m/2 ± 0,1·m + 0,05 mm), *interfieren*, *separados* o *módulos distintos*. El motor va en una instancia y el resto gira con ω₂ = −ω₁·z₁/z₂ (sentido correcto aunque un engranaje esté dado vuelta); cadenas con intermedios; un anillo con sentidos incompatibles se informa como **trabado**. Los dientes se intercalan con la fase Σ z·θ = K (validada contra el kernel: ~0 mm³ de interferencia con la fase calculada, >60 mm³ con medio paso de error). Botones: **Engranar** (lleva el par a la distancia de engrane y sincroniza) y **Sincronizar dientes** (gira la instancia; cambia su `rot`/`pos`). Límites: engranajes exteriores, sin cremallera/interior/cónicos/sin fin; la fase de helicoidales usa el plano medio.
- **Físicas dentro de una pieza**: con dos o más operaciones Engranaje en la misma pieza, ⚙ Motor → "Físicas" arma un cuerpo por engranaje (los demás elementos quedan fijos); *Engranar* mueve el engranaje (campo `move`) y *Sincronizar dientes* ajusta su **fase** (parámetro "Giro del dentado", `phase`, en °).
- **Empujar con colisión**: ↔ Mover también funciona en Conjunto: eje bloqueado, paso, y se frena al tocar otra pieza (muestreo del recorrido + bisección con el volumen común del kernel; los choques previos se ignoran). Informa a cuántos mm se frenó y con quién chocó.
- **Vistas libres en el plano**: herramienta *Mover vistas* (M, o Alt+arrastrar en Seleccionar). Arrastrás una vista con sus cotas; ajuste 1 mm (Shift 5 mm, Alt libre); se guarda en `drawing.viewOffsets` y acompaña cotas, rayados y exportaciones SVG/DXF. "Reubicar vistas" las devuelve al lugar automático.
- **Importar 2D (DXF / DWG)** (botón *Importar 2D*, modo Pieza): lee entidades 2D (LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, ELLIPSE completa), **encadena** tramos sueltos en contornos cerrados (tolerancia configurable) y crea un **boceto** listo para extruir: contornos → `poly` con arcos (bulge), círculos y elipses; los anidados quedan como agujeros. El diálogo permite elegir capas, escala (se toma de `$INSUNITS`; DWG: de INSUNITS), plano, centrar en el origen y muestra vista previa y lo que no se importa (cotas, hatch, textos, splines, bloques `INSERT`…). DWG usa LibreDWG en WASM (`vendor/libredwg`, **GPL-3.0**, carga solo al importar) dentro de un Worker con cancelación a los 60 s; si el decodificador se cae con un archivo (pasa con algunos, p. ej. `tests/data/example_2000.dwg`) se pide guardar como DXF. Límites: sin sólidos 3D (ACIS), splines ni expansión de bloques; DXF binario no soportado.
- **Memoria**: el kernel WASM no devuelve memoria al navegador y cada reconstrucción pesada deja restos (~10 MB por un engranaje de 60 dientes). Se agregó una *arena* de objetos en `vendor/replicad` (libera los intermedios de cada `buildPart`; redujo la fuga a la mitad), caché de piezas en el conjunto (mover una instancia ya no reconstruye todo) y un indicador 🧠 (aparece desde 1 GB; reinicio automático con guardado cerca de 2,6 GB). El arreglo de fondo sería correr el kernel en un Web Worker reciclable.

## Proyecto, conjunto y catálogo
- Hasta 8 piezas por proyecto; Conjunto: instancias con posición/rotación, interferencias, lista de materiales y plano de conjunto con globos.
- Catálogo: chaveta DIN 6885-A, eje con chavetero, buje.
- Vistas en corte (con rayado) e isométrica. Exporta 3MF (un objeto por instancia).
- Nuevo proyecto: pide confirmación y borra piezas, conjunto, planos, cotas, historial y autoguardado.

## Atajos
Ctrl+S guardar · Ctrl+Z/Y deshacer/rehacer · Plano: V/L/D/R herramientas, F ajustar, Espacio+arrastrar mover. Boceto: ver arriba.

## Pendiente
Vista auxiliar para agujeros inclinados fuera de las vistas ortogonales (hoy se rotulan con línea de referencia y ángulo); Restricciones de boceto; deshacer a nivel de conjunto; cotas en la vista isométrica.

## Tornillo sin fin y partículas

- **🌀 Tornillo sin fin** (operación nueva): eje + filete helicoidal de sección rectangular (largo, Ø eje, Ø exterior, paso, espesor, 1–4 entradas, hélice a izquierdas). En el plano se dibuja la envolvente cilíndrica. Plantilla lista: *Transportador helicoidal (tornillo + camisa)*.
- **✦ Partículas** (solo en modo Pieza): material granular/polvo que se emite en una caja (celeste), cae por gravedad y es transportado por el tornillo al girar. Materiales: arena, granulado, harina/polvo. Viento en vivo (vector en mm/s), caudal de carga, rpm y sentido de transporte, camisa translúcida, contador de salida (partículas/s, cm³/s, total).
- **Cómo funciona** (`src/particles/`): simulación PBD en un **Worker** (no toca el hilo de la interfaz): granos esféricos con fricción entre sí y con la pared, colisión contra la malla mediante un **SDF** de grilla (`sdf.js`), el tornillo gira en su marco y arrastra por fricción (`sim.js`), arrastre del aire hacia el viento. Render con puntos-esfera en el shader (una sola llamada de dibujo). Tope de partículas adaptativo según el costo medido (objetivo ≈ 9 ms por paso).
- **Límites honestos**: es cualitativo (no sirve para dimensionar caudales). Con hélice derecha, giro positivo lleva el material hacia −eje; el panel lo resuelve con «Transportar hacia». Líquidos (PBF) y flujo de aire real (LBM) quedan para una etapa con GPU (WebGPU).

## Acciones, boquillas de aire y partículas con cualquier operación

- **⚡ Acciones** (Pieza y Conjunto): secuencias de movimientos que se reproducen por tiempo. Tipos: **Girar** (continuo en rpm, o barrido de un ángulo a otro: clapetas, válvulas), **Deslizar** (de una posición a otra sobre un eje: guillotinas, correderas) y **Aire** (una boquilla arranca o se corta con rampa). Disparo: en un segundo dado, al terminar otra acción, o cuando salieron N partículas. Repetición: una vez, repetir o ida y vuelta. Lo que se mueve se tilda entre las operaciones de la pieza (extrusión, revolución, engranaje, tornillo: hélices, espirales, levas…) o entre las instancias del conjunto. Se guardan en la pieza (`actions`, `nozzles`) o en el proyecto.
- **Boquillas de aire**: posición, dirección, velocidad, apertura del cono y alcance. El aire arrastra las partículas (cono, caída con la distancia) y las paredes le hacen sombra. No rodea esquinas ni se desvía: es un chorro, no un solver de fluidos.
- **✦ Partículas** usa las acciones del documento (si hay un tornillo y ninguna acción, crea el giro por vos). Las piezas fijas pueden verse translúcidas en vivo. Plantillas: *Transportador helicoidal* y *Tolva con guillotina*.
- Los cuerpos que se mueven colisionan con pose general (giro + desplazamiento) y arrastran el material por fricción. Mover una operación o instancia mientras corre la simulación la detiene.

## Sensores, flujo de aire, líquidos y colocación con clic

- **Sensores de zona** (⚡ → + Sensor): caja que cuenta partículas; una acción puede arrancar cuando entran N (disparador «zona»), p. ej. abrir una compuerta al llenarse un vaso.
- **Aire**: grilla Euler gruesa (12k/20k/40k celdas según «Calidad de aire») con chorros de boquilla, viento, proyección de presión y advección. Rodea obstáculos y se desvía con piezas móviles (se revoxeliza solo cuando la pieza cambia de pose). Acoplamiento de una vía (el aire empuja las partículas, no al revés). Las trazadoras celestes muestran el flujo real. Es cualitativo, no CFD.
- **Líquidos** (agua, aceite/jarabe): PBF en CPU con densidad de pared, viscosidad XSPH y tensión superficial. Con ~700 partículas llena recipientes en capas; el tope se adapta solo al costo por paso.
- **Rendimiento**: un solo worker persistente, caché de SDF (se reutiliza si la geometría no cambió) y barra de progreso.
- **Colocar con clic**: 📍 en boquilla, sensor y emisor; clic en una cara del modelo (Esc cancela).

## Girar cuerpos y repetir (aspas, hélices, impulsores)

- **Girar el cuerpo** (extrusión, revolución, engranaje, tornillo): sección «Girar el cuerpo» con eje X/Y/Z o vector propio, ángulo y pivote en coordenadas del mundo. Se gira el sólido ya construido (después se aplica el desplazamiento). Ej.: tramo de caño a 20° → pivote en el centro de la boca de unión y eje perpendicular al plano de la curva. El eje/pivote de motor, partículas y acciones sigue el giro.
- **Repetir** (nueva operación): copia el cuerpo (o el corte) de otra operación, en círculo alrededor de X/Y/Z con centro y ángulo total, o en línea. Para una hélice: buje + aspa (extrusión con «Girar el cuerpo» para el paso) + Repetir circular. Si el cuerpo original se anima en ⚡ Acciones, sus copias lo acompañan.

## Tubos, cañerías curvas y canal vibratorio

- **Modo «Tubo»** (extrusión y revolución): un boceto con círculos/rectángulos anidados se interpreta como pared + hueco. Los tubos se unen entre sí y sus huecos quedan comunicados (T, derivaciones, ramales). En modo «Agregar» la pared de un caño tapaba el hueco del otro. «Repetir» también copia los huecos.
- **Cañería / curva** (operación nueva): perfil redondo (Ø exterior + pared) o un boceto cualquiera (p. ej. un canal en U) que recorre tramos rectos + curvas (ángulo, radio, hacia ±X/±Y/±Z). «Continuar desde» engancha el extremo de otra cañería. Admite «Girar el cuerpo» y movimiento como cualquier operación.
- **Acción Vibrar** (⚡): oscila sobre un vector con amplitud (mm) y frecuencia (1–60 Hz); inclinándolo (p. ej. 30° sobre la horizontal) el granulado avanza por saltos hacia donde apunta su componente horizontal. Plantillas: «Canal vibratorio curvo» y «Cañería con codo y derivación en T».

## Rendimiento con piezas pesadas (tornillos largos, cañerías)

- **Tornillo sin fin**: el filete es ahora un barrido de la sección (radial × axial) sobre una hélice exacta, no una extrusión con torsión. Construir, unir y mallar es ~10× más rápido (un tornillo de 450 mm × 15 vueltas: de ~16 s a ~3 s con el caño). **El espesor del filete se mide ahora en el eje (axial)**: antes era tangencial, por lo que los filetes salían mucho más finos; ajustá el espesor si querés el aspecto anterior.
- **Unión sin booleana**: si la envolvente del tornillo no toca al resto, se agrega como cuerpo aparte (el aviso «2 cuerpos separados» es normal en ese caso). Al separar lo que se mueve en ⚡/✦/Motor, un cuerpo suelto se saca sin booleana.
- **Malla adaptativa**: piezas con superficies libres y más de ~120 mm de diagonal se mallan con tolerancia 0,2 (de ~150 000 a ~20 000 triángulos); las normales suavizadas disimulan la diferencia.
- **Iniciar partículas** ya no recalcula toda la pieza si el modelo no cambió (solo re-separa los cuerpos), y agregar acciones/sensores/boquillas no dispara reconstrucciones.

## El motor corre en un Web Worker

- **La interfaz nunca se congela**: OpenCascade vive en `src/kernel/kernelWorker.js`. `main.js` solo pide trabajos (`build`, `resplit`, `drawing`, `assemblyDrawing`, `buildAssembly`, `safeTravel`, `export`, `referenceMesh`, `centerOf`, `nextInstancePos`) y recibe datos clonables: mallas (con transferencia de buffers, sin copia), parámetros, resultados por operación, instancias del ensamble y planos.
- **Un servicio, dos entornos**: `src/kernel/kernelService.js` es el motor sin UI; lo usa el worker y los tests de Node (`createLocalClient`). Las formas (`current`, ensamble) quedan dentro del worker; hacia afuera no sale ninguna.
- **Pedidos superpuestos**: cada pedido con `channel` + `latestOnly` reemplaza a los anteriores del mismo canal que sigan en cola (salen `{ superseded: true }`) y la respuesta de un pedido viejo se descarta por número de secuencia. Editar rápido solo calcula lo último.
- **Plano sin funciones**: `toDrawingData` quita las funciones de los `viewModels` (solo las usa el armado de la hoja, dentro del motor) y `fromDrawingData` reconstruye `svg()` en el hilo principal.
- **Memoria**: la memoria WASM solo crece. Cerca de 2,6 GB (o con el botón 🧠) se guarda el proyecto, se descarta el worker y se arranca otro; la pieza y el ensamble se reconstruyen **sin recargar la página**.
- No acelera el cálculo en sí (sigue siendo un solo hilo de motor): el beneficio es que ver, girar, editar paneles y cancelar no se traba mientras el motor trabaja.
- **Barra de actividad y cancelar** (`src/ui/busyBar.js`): si un trabajo del motor tarda más de ~0,35 s aparece en la cabecera una barra con qué se calcula, los segundos y el botón **Cancelar**. Como el motor es un solo hilo ocupado, cancelar descarta el worker y arranca otro (≈2 s); lo que se ve no cambia y cualquier edición posterior vuelve a calcular. Los pedidos `silent` (medir memoria) no cuentan.
