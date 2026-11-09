## Unir segmentos de un conducto (0.2.1)

1. Abrí **Conjunto** y su panel de propiedades. Marcá **Incluir en unión** en cada tramo estático que quieras conectar.
2. Pulsá **Unir en una pieza**. La herramienta verifica que las paredes se toquen o solapen y produce un único sólido.
3. Reiniciá la simulación para usar esa nueva geometría continua. Las piezas originales quedan en el catálogo y las instancias elegidas son reemplazadas por una sola. Podés deshacer.

Si indica que hay segmentos separados, usá **Separación mínima** para medirlos y **Mover** para alinear sus extremos. La herramienta no agrega material a través de huecos. Tampoco destapa una boca cerrada en el diseño. Con ocho piezas en el catálogo se necesita liberar un cupo antes de crear la unión.

Los marcadores blancos representan trazas visuales del aire: su presencia fuera de un tubo no basta para medir una fuga. Compará también presión y caudal en sensores y repetí a mayor resolución. La versión 0.2.1 evita que esos marcadores salten a través de las paredes de la grilla del aire calculado.

> **Actualización 0.2.0:** consultar [cambios aprobados](CHANGELOG.md), [arquitectura](ARCHITECTURE.md) y [verificación](VERIFICACION.md). Se mantienen formatos y estructura existentes.

# ElCad 3D — Guía de uso

Modelador para **piezas mecanizadas** (ejes, chavetas, bridas, soportes, cañerías, engranajes, tornillos) con **planos de taller A4/A3** listos para cotizar o pedir repuestos, y un **conjunto** para ver cómo encajan. Todo corre en tu navegador y se guarda en tu equipo.

## 1. La pantalla

- **Barra superior**: Nuevo proyecto, Abrir, Importar 2D, Importar STL, Guardar, exportar **STL / 3MF / STEP**, **Pieza | Conjunto**, **3D | Plano**, herramientas **Mover**, **Acciones**, **Partículas**, **Motor**, estilo de vista y vistas Iso/Frente/Planta/Lateral. A la derecha, el estado (medidas y tiempo). Durante cálculos largos aparece una barra con el trabajo y **Cancelar**.
- **Izquierda**: Proyecto (piezas, material, plantillas), **Operaciones** (el árbol del modelo), botones para agregar operaciones y **Parámetros**.
- **Centro**: vista 3D, editor de boceto o plano.
- **Derecha**: propiedades de lo que elegiste.

## 2. Modelar una pieza

El modelo es una **lista de operaciones** que se ejecutan de arriba hacia abajo. Podés suprimir, reordenar y cambiar cualquier valor: la pieza se recalcula.

1. **Boceto** (plano Planta XY, Alzado XZ o Perfil YZ, con desplazamiento): dibujá rectángulos, círculos, ranuras, polilíneas con arcos, elipses y polígonos.
2. **Extrusión** (sumar o cortar, hacia arriba/abajo/simétrica, pasante) o **Revolución** (ejes, bujes, poleas).
3. **Agujero** (simple, en círculo de agujeros, avellanado), **Rosca**, **Filete**, **Chaflán**.
4. Operaciones especiales: **Engranaje**, **Tornillo sin fin**, **Cañería / curva**, **Repetir** (aspas, hélices, perforaciones en círculo o fila).

### Parámetros y expresiones
Cualquier campo acepta números o expresiones: `Dext/2 + 1,5`. Creá **parámetros** (Dext, L, PCD…) en el panel izquierdo y usalos en todo el modelo; cambiar uno actualiza la pieza completa.

### Editor de boceto
| Tecla | Herramienta |
|---|---|
| `V` | Seleccionar |
| `R` / `Q` | Rectángulo / Cuadrado |
| `C` / `E` | Círculo / Elipse |
| `S` | Ranura |
| `L` / `P` | Línea / Polilínea |
| `N` | Polígono regular (tuercas, llaves) |
| `G` | Guía auxiliar (línea infinita por punto y ángulo) |
| `M` | Medir (punto a punto: distancia, Δx, Δy, ángulo) |
| `D` | **Distancia** mínima entre dos objetos o líneas |

- **Distancias en vivo** (botón ⊥ Distancias): al dibujar con cualquier herramienta se ve la distancia perpendicular del cursor al objeto, guía o referencia más cercano; en una línea, además, Δx, Δy y ángulo del tramo.
- **Herramienta Distancia** (`D`): clic en un objeto (o línea, guía, papel cebolla) y clic en otro: muestra la distancia **mínima** entre ambos, con Δx/Δy. Dos líneas paralelas dan su separación perpendicular; si se tocan o se superponen, indica 0. `Shift` toma el punto clicado en vez del objeto (punto ↔ objeto).
- **Imanes**: vértice, centro, punto medio, cuadrante, intersección, origen y guías de 45°/90°. `Alt` los desactiva.
- **Tamaño tipeado**: tras el primer clic aparece una tarjeta; `Tab` cambia de campo, `Enter` aplica, `Esc` cancela. Acepta `25`, `2,5 cm`, `1"`, `r12` y expresiones.
- **Papel cebolla**: ves en tenue los otros bocetos y el corte de la pieza ya construida. Botones 🧅 Bocetos / 🧅 Pieza.
- **Repetir** en fila, círculo o elipse; **Rosca** en agujeros (M, MF, G, UNC, UNF: el plano rotula «M8×1,25 prof. 12»); esquinas redondeadas o chaflanadas.
- **Planos rotados**: en un boceto o agujero, «Rotar el plano» (eje X/Y/Z, ángulo, centro) para agujeros radiales o inclinados.

### Girar cuerpos, tubos y cañerías
- **Girar el cuerpo** (extrusión, revolución, engranaje, tornillo): eje X/Y/Z o vector propio, ángulo y pivote. Útil para un tramo de caño a 20° o el paso de un aspa.
- **Modo Tubo**: un boceto con círculos anidados = pared + hueco; los tubos se unen entre sí y los huecos se comunican (T, derivaciones).
- **Cañería / curva**: perfil redondo o cualquier boceto (por ejemplo un canal en U) recorriendo tramos rectos y curvas; «Continuar desde» engancha el extremo de otra.

## 3. Plano de taller

Pasá a **Plano**. Hoja A4 (o A3/A2), apaisada o vertical, marco y cajetín ISO 7200, **primer diedro**, escala automática.

- **Vistas**: frente, planta, laterales, posterior, inferior, isométrica y **cortes con rayado**; líneas ocultas y ejes opcionales; rotación 90°. *Mover vistas* (`M`, o `Alt`+arrastrar) las reubica con sus cotas.
- **Cotas automáticas** (ISO 129): medidas generales, diámetros, cadenas, «n× Ø», PCD, roscas. Cualquiera se puede quitar y restaurar.
- **Cotas manuales**: lineal (`L`, `Shift` = alineada), Ø (`D`), R (`R`). Arrastrá una cota o su rótulo para moverla; el texto se edita (prefijo/sufijo).
- **Escala por vista**: en «Vistas», cada vista tiene su **escala propia** (− / + recorren las escalas ISO, el menú elige una, y «otra» acepta `3:1`, `1:3` o `1,5`). «= hoja» sigue la escala general. Las vistas ampliadas se rotulan «Esc. 2:1» y, si todas tienen escala propia, el cajetín dice «Indicada». Sirve para agrandar un detalle sin achicar el resto.
- **Material y masa**: elegí el material (densidad × volumen). Notas y tolerancia general (ISO 2768-mK) editables.
- **Exportar**: SVG, PDF (diálogo de impresión, tamaño exacto de hoja) y DXF (R12 con capas).

> El plano se guarda dentro del archivo de la pieza.

### Mover cuerpos con el ratón (botón ↔ Mover)
Con el panel **Mover** abierto y *Elegir y arrastrar en el visor* tildado: **clic** en un cuerpo lo elige (resaltado en naranja; **Mayús** suma o quita; clic en el vacío suelta la selección) y **arrastrar** lo mueve sobre el eje o plano que elijas en «Mover sobre» (X, Y, Z o planos XY / XZ / YZ). Mientras arrastrás:
- **Imanes**: la caja del cuerpo se alinea o se apoya con las caras, centros y el origen de los demás cuerpos (guía punteada celeste con el nombre de lo que toca). **Alt** los apaga un momento.
- **Medidas inteligentes**: distancia libre en mm hasta el vecino más cercano en cada sentido del eje, y el desplazamiento Δ.
- Al soltar se aplica de una vez (un solo paso de **Ctrl+Z**). En **Pieza** cada operación es un cuerpo (se separan al abrir el panel); en **Conjunto** cada instancia, y se frena al chocar si está tildado. Los botones − / + con paso siguen sirviendo para movimientos exactos.

## 4. Proyecto y conjunto

- Hasta **8 piezas** por proyecto. En **Conjunto** agregás instancias (posición/rotación), ves **interferencias**, la **lista de materiales** y el **plano de conjunto con globos**. Exporta 3MF (un objeto por instancia) y STEP.
- **Mover** (↔) empuja una instancia por un eje con paso fijo y **frena al chocar** con otra pieza; informa con quién.
- **Motor** (⚙): hace girar una pieza o engranajes; con *Físicas* detecta pares de engranajes (engranan / interfieren / separados) y permite *Engranar* y *Sincronizar dientes*.
- Plantillas: brida, eje con chavetero, buje, chaveta DIN 6885-A, transportador helicoidal, tolva con guillotina, canal vibratorio curvo, cañería con codo y T.

## 5. Importar 2D (DXF / DWG)

Botón **Importar 2D** (modo Pieza): lee líneas, arcos, círculos, polilíneas y elipses, **une tramos sueltos en contornos cerrados** (tolerancia ajustable) y crea un **boceto** listo para extruir.

## 5 bis. Importar STL (mallas de CAD)

Botón **Importar STL** (o **Malla STL** en el árbol; modo Pieza): agrega una operación que convierte la malla en **sólido(s) cerrado(s)** del kernel. Con eso sirve para todo lo demás: partículas, aire, conjunto, plano, STEP y booleanas con otras operaciones.

- El STL **no guarda unidades**: el diálogo pide mm / cm / m / pulgadas (o una escala propia) y muestra el tamaño resultante. «Llevar al origen» centra X/Y y apoya en Z = 0; si no, queda en las coordenadas del CAD (útil para alinear con otras piezas del mismo CAD).
- Los triángulos coplanares se **fusionan en caras planas**; los cuerpos separados del archivo quedan como cuerpos distintos.
- Si dos cuerpos o láminas se **tocan en una arista**, se separan automáticamente unas micras para poder coser cada uno por su cuenta.
- **Mallas grandes — dos caminos** (el diálogo los ofrece según el tamaño):
  - **Reducir y convertir en sólido**: simplifica la malla (colapso de aristas con métrica cuádrica) al objetivo que elijas (3k–20k) y la convierte en sólido; se informa el cambio de volumen y el desvío típico. Mantiene cuerpo cerrado, agujeros y bordes; las superficies planas casi no pierden nada.
  - **Cargar completo (solo malla)**: sin límite de triángulos (probado con 47 000: carga en décimas de segundo). Se ve y se **simula** (partículas, aire) tal cual; **no** se puede cortar, unir, exportar a STEP/STL, hacer planos ni usar en un conjunto. Ideal para soplador, tolva o embudo importados que solo necesitás para simular.
  - **Sólido completo**: hasta 20 000 triángulos (tarda unos ~1 s por cada 1 000, según la PC).
- Mientras se convierte en sólido, la **barra de arriba** muestra la fase (creando caras · cosiendo · uniendo), el porcentaje y el tiempo restante estimado; se puede **Cancelar**. La reducción tiene su propia barra en el diálogo.
- Para sólido la malla debe estar **cerrada** (sin huecos); «solo malla» acepta mallas abiertas.
- Escala, giro del cuerpo y modo (agregar / cortar) se editan en el panel de la operación; para ubicarla usá **Mover**. Una malla puede girar con el **Motor** o recibir **Acciones**.
- Las superficies curvas quedan facetadas como en el STL (no se recupera el cilindro original): se ven las aristas de los triángulos.

## 6. Acciones y partículas

Para ver cómo se comporta granulado, polvo, aire o líquido en tu equipo (cualitativo, **no sirve para dimensionar caudales**).

1. **⚡ Acciones**: secuencias por tiempo. **Girar** (rpm continuo o barrido de ángulo), **Deslizar** (guillotinas, correderas), **Vibrar** (amplitud en mm y frecuencia 1–60 Hz sobre un vector: inclinado, el granulado avanza por saltos) y **Aire** (boquilla que arranca o corta). Disparadores: en el segundo N, al terminar otra acción, cuando salen N partículas o cuando entran N a una **zona** (sensor).
2. **Boquillas y sensores**: posición, dirección, velocidad, cono y alcance; el botón 📍 coloca con clic sobre una cara del modelo.
3. **✦ Partículas**: elegí material (arena, granulado, harina, agua, aceite/jarabe), caja de emisión, caudal, viento y calidad de aire; **Iniciar**. Las piezas fijas pueden verse translúcidas. Mover una operación mientras corre detiene la simulación.

**Aire calculado y soplador.** En una boquilla elegí *Tipo de entrada*: **Chorro** (cono simplificado), **Caudal** (m³/h) o **Presión** (Pa de un plenum). Con Caudal o Presión, y *Modelo de aire = Calculado*, se resuelve el flujo real dentro de la geometría (venturi, embudo importado de STL, línea taponada). Los **sensores** dan presión, velocidad y caudal; el panel de partículas muestra el avance del cálculo y las lecturas. Con *Caudal de producto* (kg/h) y el diámetro real del grano, los granos arrastran el aire y una línea cargada sube la presión. Es una aproximación: sirve para comparar variantes, no reemplaza un CFD certificado.

**Eje con dinámica real.** En una acción **Girar** continua tildá *Dinámica real del eje*: cargá inercia (kg·m²), par máximo del motor, fricción estática/deslizamiento/viscosa. El eje acelera con el par del motor, lo frenan la fricción y los granos que empujan las paletas; si la carga supera el par máximo se frena o se traba (se avisa en el panel). Las rpm y los pares (motor, carga de los granos, fricción) se leen en el panel de partículas.

### Estructuras de perfiles
Operación **Estructura (perfiles)**: barras rectas entre dos puntos con un perfil comercial (tubos, ángulos, U, planchuelas, caños). Donde se encuentran **exactamente dos** barras no alineadas se **ingletean** solas. Podés cargar las barras a mano (Desde / Hasta / giro del perfil), generar un **marco en caja** (4 columnas + 2 aros, con los travesaños entre caras de columna) o tomar los lados de rectángulos y polilíneas de un **boceto** como esqueleto. Muestra la **lista de cortes** agrupada (cantidad × perfil × largo × ángulos × kg) y la exporta a CSV. El largo a cortar es la punta larga del inglete; el peso es de acero.

### Transmisiones: un motor, varios ejes
En una acción **Girar** elegí el modo **Sigue a otro eje**: indicá qué eje lo mueve y el tipo de transmisión — **reductor** (i : 1), **correa o cadena** (diámetros o dientes motriz y conducida), **engranaje externo** (invierte el giro), directa o relación manual. Se pueden encadenar (motor → reductor → engranaje → rodillo). Una acción **Deslizar** puede seguir a un eje que gira (cremallera, correa con carro, tornillo de potencia) con su **recorrido por vuelta**. Si el eje motor tiene *Dinámica real*, la carga de los granos sobre los ejes conducidos le llega al motor dividida por la relación y con el rendimiento, y la inercia de lo conducido se suma a la del motor: así ves cuánto par le pide cada mecanismo.

### Cintas, productos y fotoceldas
- **Válvulas y clapetas temporizadas**: en **Deslizar** (compuerta, guillotina, corredera) y en **Girar** (clapeta) elegí el modo **Válvula**. Se definen la posición cerrada y la abierta y los tiempos: **apertura** (cuánto tarda en abrir), **abierta** (cuánto queda abierta; 0 = queda abierta) y **cierre**; con *Repetir* se suma **cerrada entre ciclos** y se repite sola. Cada recorrido arranca y frena suave. Para encadenar con otra acción usá «Al terminar otra acción» (espera a que la válvula termine de cerrar).
- **Tamaño de la partícula** (panel Partículas → *Tamaño de partícula*): cada partícula simulada representa muchos granos, así que podés **agrandarla** (×2, ×3, ×5 o un radio propio) para llenar espacios grandes —una tolva, un canal— con pocas partículas y que la simulación no se ponga lenta. Masa y volumen crecen con el radio al cubo; con «Mantener el caudal de material» la carga por segundo baja en esa proporción (×3 → 27 veces menos partículas por segundo). Se aplica al **reiniciar**. Contra: menos detalle fino (los granos grandes no copian el comportamiento de un polvo). El arrastre del aire sigue usando el tamaño real del grano del material.
- **Cinta transportadora:** en una acción **Deslizar** elegí el modo *Cinta*. La pieza no se desplaza: su superficie arrastra por fricción lo que apoya (granos o cajas) a la velocidad indicada, o a la que da el rodillo que la mueve (recorrido por vuelta = π·diámetro del rodillo). Arranca suave en 0,5 s.
- **Productos:** en ⚡ Acciones → *Productos (cajas)* agregá un alimentador: aparece una caja rígida (tamaño, masa, fricción) cada cierto tiempo hasta un máximo en simultáneo. Las cajas tienen gravedad, fricción y choques entre sí y contra las piezas (cintas, guías laterales, topes). No interactúan con los granos. Con unas guías laterales hacen fila ordenada contra un tope.
- **Fotocelda:** un *sensor de zona* con *Qué cuenta = Productos* cuenta las cajas dentro de su caja. Como disparo («Cuando hay N en un sensor») arranca otra acción: un empujador, una compuerta, otro motor.
- **Motores del catálogo:** con *Dinámica real del eje* elegí un motor de 0,37 a 7,5 kW (4 polos): carga rpm, par máximo (≈ 2,3 × nominal) e inercia del rotor. El panel muestra el **% del par nominal** y avisa **SOBRECARGA** cuando el motor lo supera. Valores típicos de catálogo: verificá con la chapa.

### Gráficos, CSV y comparación de corridas
El panel de partículas dibuja en el tiempo el canal que elijas (salidas por segundo, presión/velocidad/caudal de cada sensor, rpm y pares de los ejes, relación de taponamiento). **Guardar como referencia** congela la corrida actual (hasta 3) y la superpone punteada con la siguiente: por ejemplo antes y después de modificar un venturi. **Exportar CSV** baja todos los canales.

### Aire: plano de corte y taponamiento
Con el aire calculado, *Plano de corte del aire* pinta presión (azul −, rojo +) o velocidad sobre un plano ⟂ X, Y o Z que podés deslizar a lo largo del dominio. Si una línea se tapa, el panel avisa: con caudal impuesto sube la presión de entrada sobre la de la línea limpia; con presión impuesta cae el caudal («Posible taponamiento» desde ×1,4, «LÍNEA TAPONADA» desde ×2,2).

## 6 bis. Biblioteca de piezas de máquina
Botón **Biblioteca** de la barra superior: **109 piezas paramétricas** ordenadas por categoría, con buscador (probá «rodamiento», «venturi», «M10», «motor», «cinta»). Elegí una, completá sus medidas (o doble clic para usar las de ejemplo) y se agrega al proyecto como una pieza más: todas son operaciones editables, con parámetros.

| Categoría | Qué trae |
|---|---|
| Tornillería y fijación | Tornillos hexagonal, Allen, avellanado y botón (ISO 4017/4762/10642/7380), prisionero, varilla, tuercas (hexagonal, autofrenante, cuadrada), arandelas, pasadores, seeger, O-ring, cáncamo, remache, abrazadera U, juego tornillo-arandela-tuerca |
| Rodamientos y soportes | Rodamientos de bolas series 60/62/63 y axial (con bolas), caja de rodamiento, chumaceras UCP/UCF/UCFL, guía lineal (riel y carro), casquillo lineal |
| Transmisión y mecánica | Polea en V y dentada, rueda de cadena, engranaje recto y cremallera, acople de mordazas, collar, rodillo y tambor de cinta, reductor de sinfín, motor IEC B3/B5 |
| Estructura y perfilería | Perfil de aluminio ranurado, vigas IPE, UPN, ángulo, tubo, escuadra, placa base, pata nivelante, rueda giratoria, abrazadera, base de motor, chapa perforada, bastidor de mesa, baranda |
| Tolvas, canales y chapa | Tolva cónica y piramidal, silo, canales en U y semicircular, caja de chapa, bandeja, tapa, guarda |
| Neumática, fluidos y aire | **Venturi con escena de aire lista**, reducción, bridas, caños, codo, te, válvulas (bola, mariposa, guillotina), ciclón, esclusa rotativa, ventilador, soplador centrífugo, cilindro neumático ISO 15552 |
| Máquinas completas | Cinta transportadora completa (motor → reductor → tambor → cinta, cajas y fotocelda), línea con empujador, transportador de rodillos, mesa giratoria, mezclador de paletas, alimentador a tornillo |
| Eléctrica y automatización | Riel DIN, canaleta, gabinete con puerta animada, botonera, emergencia, baliza, sensor inductivo, fotocélula, variador, prensacable, celda de carga, escalerilla |
| Mecanismos | Levas, biela, manivela, pistón, horquilla, terminal articulado, bisagra, volante, palanca, husillo y tuerca, polea tensora |

Las **máquinas completas** y varias piezas (compuerta, esclusa, ventilador, soplador, cilindro, gabinete) traen su **escena** cargada: acciones, motores con dinámica, transmisiones, alimentadores de cajas y sensores. Abrí ⚡ Acciones para ver y cambiar todo, y ✦ Partículas → *Iniciar*. Las dimensiones salen de tablas normalizadas o de catálogo típicas: **verificá con la norma o el fabricante antes de fabricar**.

## 6 ter. Propiedades físicas (botón «Propiedades»)

Mide lo que está en pantalla (la pieza o el conjunto): **volumen de material, superficie** (pintura/chorreado), **masa** (con el material elegido en el mismo cuadro), **dimensiones, centro de masa** y **momentos de inercia** en el centro de masa. Para estructuras de perfiles suma **barras, metros y kg de perfil**.

**Capacidad interior** («Calcular capacidad»): volumen hueco de tolvas, silos, cañerías o tanques, contando las bocas abiertas (una tolva abierta arriba cuenta hasta la boca). Se puede llenar por **porcentaje** o por **altura Z**, elegir el producto (trigo, arena, agua… o una densidad propia) y ver los **kg de producto**. Es una estimación por voxeles: ±3–5 %; para más precisión usá piezas más chicas o medí por partes. «Cavidad cerrada» separa los tanques con tapa.

> En un conjunto, las piezas que se superponen se suman dos veces (mirá la lista de interferencias).

## 7. Guardar y exportar

| Qué | Cómo |
|---|---|
| Autoguardado | Automático en el navegador |
| Pieza | **Guardar pieza (.part3d)** |
| Proyecto completo | **Guardar** → `.proj3d` (piezas, conjunto, planos, cotas) |
| Modelo 3D | **STL** (Bambu Studio / Orca), **STEP**, **3MF** |
| Plano | SVG, PDF, DXF |

Copiá el `.proj3d` para abrir el proyecto en otra computadora. **Nuevo proyecto** pide confirmación y borra piezas, conjunto, planos, historial y autoguardado.

## 8. Rendimiento con piezas pesadas

**Memoria**: el motor (OpenCascade en WebAssembly) pide memoria y no la devuelve nunca; el botón 🧠 aparece desde 1 GB. Mejoras: el mallado se hace **por tandas de caras** (importar un STL cosido como sólido gastaba ~130 KB por cara en un pico: 10 000 caras ≈ +1,3 GB; ahora ≈ +0,1 GB); y el motor **se reinicia solo en reposo** (sin tocar nada 20 s, sin simulación, desde 1,2 GB) y siempre cerca de 2,6 GB: la pieza se vuelve a calcular sola. Para mallas grandes que solo querés simular, usá **Cargar completo (solo malla)**: no pasa por el motor.

- El cálculo corre en segundo plano: podés girar la vista y seguir editando mientras tanto. Si algo tarda, mirá la barra de actividad; **Cancelar** descarta ese cálculo (el modelo en pantalla puede quedar desactualizado hasta tu próximo cambio).
- Un tornillo sin fin largo y tubos con muchas operaciones son lo más pesado. Suprimir operaciones que no estás tocando acelera.
- El botón **🧠** aparece cuando el motor usa mucha memoria: **liberar** guarda y reinicia el motor sin recargar la página.
- «N cuerpos separados» en la barra no es un error: indica sólidos que no se tocan (normal con un tornillo dentro de una camisa).

## 9. Atajos

| Dónde | Teclas |
|---|---|
| General | `Ctrl S` guardar · `Ctrl Z` / `Ctrl Y` deshacer / rehacer |
| Plano | `V` seleccionar · `L` lineal · `D` Ø · `R` radio · `M` mover vistas · `F` ajustar · `Espacio`+arrastrar mover · `Supr` quitar cota |
| Boceto | ver tabla de herramientas · `Ctrl D` duplica · `Alt` sin imanes · `Shift` línea recta |

## 10. Problemas frecuentes

| Síntoma | Qué hacer |
|---|---|
| «Operación con error» en el árbol | Seleccionala: el panel indica el motivo (por ejemplo un filete que no cabe o una expresión inválida) |
| La pieza tarda mucho en recalcular | Suprimí operaciones pesadas mientras editás otras; esperá la barra de actividad o cancelá |
| La barra dice «Cálculo cancelado» | Hacé cualquier cambio (o cambiá de modo) para que vuelva a calcular |
| Una cota quedó fuera de la hoja | Arrastrala de vuelta o restablecé su posición desde el panel |
| Un agujero inclinado no se acota como querés | Se rotula con línea de referencia y ángulo (pendiente: vista auxiliar) |
| «La malla no es un sólido cerrado» al importar un STL | El archivo tiene huecos o triángulos faltantes: repará la malla en el CAD o exportá de nuevo como sólido |
| «La malla no forma un sólido válido» | Triángulos superpuestos o auto-intersecciones: reexportá el STL desde el CAD |

## 14. Par engranado (v24)

Seleccioná un engranaje y, en **Propiedades → Par engranado**, elegí *Engranaje conjugado* o *Cremallera*, hacia dónde va (±X / ±Y del plano del piñón) y apretá el botón. La cantidad de dientes sale del campo «Dientes del engranaje conjugado» (en la cremallera se usa la mitad).

- **Engranaje conjugado:** mismo módulo, ancho y ángulo de presión; hélice opuesta; centrado a la distancia exacta y con la fase calculada para que los dientes entren en los huecos.
- **Cremallera:** boceto + extrusión con el perfil normal (cabeza = m, pie = 1,25 m) alineada con el piñón.
- **Acciones:** se crea (o se reutiliza) el giro del piñón y una acción *seguir* enlazada: engranaje externo (invierte el giro, relación z₁/z₂) o avance por paso (π·m·z₁ mm por vuelta).
- Límites: se verifica sin interferencia para dientes rectos del mismo módulo; no cubre cadena/rueda dentada ni tornillo sinfín.

### Ruedas dentadas para cadena (v24)

Biblioteca → *Rueda dentada para cadena de rodillos*: elegís la cadena (ISO 606 serie B: 05B–24B; ANSI 25–100), dientes (9–120), hileras (simple/doble/triple) y agujero. Genera el perfil con asiento de rodillo, cubo y agujero. Seleccioná la extrusión del dentado y en **Propiedades → Rueda de cadena** cargá los dientes de la otra rueda y la distancia entre centros: **Armar par** crea la segunda rueda, corrige la distancia a un número **par de eslabones** (se muestra antes de crear) y deja en ⚡ Acciones el giro de la motriz + el de la conducida enlazado como cadena (mismo sentido, relación z₁/z₂).
- Los valores de la tabla (rodillo, ancho interior, paso entre hileras) son de catálogo: verificá con tu fabricante antes de fabricar.
- El diente es una aproximación del perfil ISO (asiento circular + flanco recto); la cadena no se dibuja.
- Si cambiás los dientes de una rueda ya creada hay que volver a generarla (los datos del par se guardan al crearla).

## Tolva llena (0.2.2)

Ver `examples/LEEME.md`. En Partículas activar **Arrancar con la tolva cargada**, elegir la pieza fija, porcentaje, asentamiento, radio local y fracción sólida. **Reiniciar** aplica todos los valores nuevos. Con carga inicial no se utiliza el emisor regular: la transferencia a la salida se ajusta en partículas/s. El reservorio es una aproximación y no valida puentes ni descarga espontánea.



## Uso vigente 0.3.0

El reservorio descrito en 0.2.2 fue sustituido. Seguir `examples/LEEME.md` para carga física.

Abrir **Herramientas de vista y proyecto → Inspección y montaje CAD**:
- Elegir una pieza para ocultar, aislar o inspeccionar; Restaurar todas recupera la vista.
- Inspeccionar muestra conectividad, bordes abiertos/no manifold y degenerados. Localizar dibuja hasta 500 bordes problemáticos; las operaciones fallidas se pueden seleccionar. No repara automáticamente.
- Sección: elegir eje y posición absoluta. B-Rep calcula la intersección geométrica; Malla es aproximada. Contornos cerrados exportan DXF 2D en milímetros. El plano UV corresponde a los ejes cíclicos (X→YZ, Y→ZX, Z→XY).
- Medir cara/arista: tocar la entidad para consultar área, longitud o círculo exacto B-Rep. Ángulo: tocar dos caras compatibles.
- Alinear: en Conjunto seleccionar primero una cara plana/cilíndrica de la instancia móvil y luego la fija. La colocación centra referencias y enfrenta normales planas o hace coincidir ejes cilíndricos. Separación y giro adicional se aplican al preparar la vista previa. Aplicar confirma y permite deshacer; Cancelar/Escape restaura. No actúa sobre instancias fijas, relacionadas o con acciones; no detecta automáticamente colisiones durante la vista previa: revisar interferencias después de aplicar.

