# Prueba física de tolva — 0.3.0

## Arranque

1. Ejecutar `npm start` en la carpeta extraída y abrir http://localhost:5174.
2. Abrir `Tolva_prueba_escala.proj3d`. Elegir **Conjunto → Partículas**.
3. **Iniciar** prepara cavidad, colisiones y toda la carga. Durante el asentamiento la descarga está cerrada y el aire apagado.
4. Al terminar el intervalo, **Abrir descarga** libera la retención. **Activar aire** permite comparar la misma carga con/sin aire. El aro de sección pasa de rojo (cerrada) a verde (abierta).
5. **Reiniciar** reconstruye usando los parámetros actuales y la misma semilla. **Detener** termina el worker de carga completa incluso si está ocupado. El estado dinámico no se guarda.

## Ejemplos

- `Proyecto_original.proj3d`: bytes del archivo recibido, intactos.
- `Tolva_llena.proj3d`: dimensiones reales recibidas, radio numérico 3 mm, fracción sólida inicial 0,6, presupuesto 600.000, asentamiento 2 s simulados. Detecta aproximadamente 96,3 L de cavidad. La red inicial con separación a paredes coloca aproximadamente 487.580 partículas; el panel informa el porcentaje efectivo (aprox. 95,4 % volumétrico equivalente), sin inventar masa para alcanzar el objetivo.
- `Tolva_prueba_escala.proj3d`: todas las geometrías y posiciones a escala 0,08, radio numérico 0,8 mm, presupuesto 30.000 y asentamiento 0,5 s. Aproximadamente 12.000 partículas, dependiendo de exclusión por paredes. Es un ejemplo más liviano; no valida el comportamiento del equipo a tamaño real.

## Cómo se calcula

Toda partícula visible de material tiene posición, velocidad, masa, gravedad y contactos PBD. No se añade material al abrir. La red FCC inicial evita superposiciones y se filtra por cavidad y distancia a paredes. El radio no aumenta automáticamente. Si no cabe el total en el presupuesto, el arranque falla con una acción de recuperación.

El asentamiento tiene duración elegida en tiempo simulado, no un certificado de equilibrio. La retención virtual consta de un plano inferior en la cota mínima detectada de la cavidad y un disco en la sección de salida configurada. No son compuertas CAD añadidas al modelo. Abrir libera ambas; cerrar no devuelve partículas ya descargadas. Para simular una compuerta real, usar su geometría y acciones correspondientes en un caso separado.

La sección es un disco definido por eje, posición, centro U/V y radio. Para eje X, U=Y y V=Z; para Y, U=Z y V=X; para Z, U=X y V=Y. Se cuenta el primer cruce de cada centro de partícula en el sentido elegido dentro del disco. El caudal es masa cruzada en el último segundo simulado, sin contar varias veces recirculaciones. La masa retirada del dominio es otra métrica.

El refinamiento de contacto usa triángulos cerca de las paredes para conservar chapas que la grilla SDF no resuelve bien. El aire calculado recibe volumen y arrastre de todas las partículas; no de un reservorio fijo.

## Costos y alcance

La carga de tamaño real necesita alrededor de 550 MiB y varios segundos reales por cada paso de 1/60 s en este entorno. Los primeros pasos con refinamiento costaron 2,6–3,0 s y la compactación puede elevar ese costo. No es tiempo real. En móviles o equipos con poca RAM usar primero el ejemplo pequeño y un presupuesto limitado.

La dinámica PBD, su carga/fricción aproximada y el acoplamiento de aire requieren calibración. El radio numérico de contacto y la granulometría usada por el arrastre son magnitudes distintas. No presentar estas corridas como certificación de puentes, caudales o presiones industriales. El test pequeño comprueba movimiento, retención, descarga y masa; no sustituye un ensayo experimental.

## Ajustes conservados del ejemplo anterior

La operación `p1/mesh12` sigue suprimida porque el cono original estaba fuera de la tolva. Se conserva la malla y su reparación B-Rep; debe colocarse antes de activarlo. No se movieron instancias en el ejemplo de tamaño real.

La boquilla original guardaba 8 m/s y radio 20 mm. La condición de caudal ideal equivalente es 36,19 m³/h; no es una medición ni una curva de soplador. En el ejemplo a escala se reduce Q con el área para conservar la velocidad ideal. Revisar las condiciones reales antes de comparar resultados.
