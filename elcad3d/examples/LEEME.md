# Prueba de tolva llena — 0.2.2

1. Desde la carpeta extraída ejecutar `npm start`. Abrir http://localhost:5174.
2. Abrir `Tolva_llena.proj3d` y seleccionar **Conjunto**.
3. Abrir **Partículas**. Carga inicial activada, pieza `i1`, 100 %, radio local 3 mm, fracción sólida 0,6, asentamiento 2 s y transferencia máxima 150 partículas/s.
4. Pulsar **Iniciar** y esperar la detección de cavidad y las colisiones. El asentamiento se mide en tiempo simulado; el aire y la transferencia comienzan después.
5. Comparar 25 / 50 / 100 % usando **Reiniciar**. Observar nivel y masas almacenada, activa y retirada del dominio. El tope adaptativo limita las partículas locales, sin aumentar su radio ni borrar masa del reservorio.
6. Guardar el proyecto, recargarlo y comprobar que se conservan los parámetros. El estado instantáneo de la corrida no se guarda.

## Qué contiene el ejemplo

`Proyecto_original.proj3d` conserva los bytes del proyecto recibido. No fue modificado.

En `Tolva_llena.proj3d` la operación `p1/mesh12` (`cono 60mm.stl`) está suprimida: estaba fuera de la tolva y no aparecía antes porque su construcción fallaba. Se conserva su malla; ahora es reparable, pero debe colocarse correctamente antes de activarla. No se movieron las instancias del conjunto.

La boquilla original tenía velocidad guardada de 8 m/s y radio 20 mm. Se usa su equivalente ideal Q = v·π·r² = 36,19 m³/h como entrada **Caudal** para activar el solver de presión. No es un caudal medido ni una curva de soplador; una fuente ideal impone Q aunque aumente la resistencia. Cambiar a entrada por presión requiere datos reales del equipo. No se certificó la estanqueidad del conjunto original.

## Alcance físico

La carga visible es un reservorio volumétrico estacionario, con resistencia porosa en el aire calculado. Sólo la zona de salida contiene esferas dinámicas con colisión. La transferencia del reservorio a esa zona tiene un límite elegido por el usuario; no deriva de una ley física de descarga global. El nivel baja por volumen retirado y se conserva la masa contable.

**No valida puentes, presiones mecánicas de toda la carga, vaciado espontáneo ni caudal industrial.** La capacidad se estima sobre una grilla de la cavidad cerrada lateralmente; depende de resolución y geometría. Requiere una tolva fija, preferentemente vertical en Z y aislada de otras cavidades. Revisar visualmente la máscara representada antes de usarla. Material, granulometría y condiciones de contorno requieren calibración.

El asentamiento relaja sólo las partículas locales, con retención temporal en el nivel inferior detectado; no asienta físicamente cada grano del volumen superior. La nube del reservorio no aumenta el radio de colisión. Para validar toda la tolva se requiere DEM de la carga completa y contraste experimental.
