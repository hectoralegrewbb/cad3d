import { primitivesToSvg } from './svgWriter.js';

// Los viewModels llevan closures (map, revolve.at) que solo usa el armado de la hoja, dentro del motor.
// Para cruzar el límite del worker se envían solo datos y `svg` se reconstruye en el hilo principal.
const stripView = (view) => {
  const { map, ...rest } = view;
  if (rest.revolve?.at) {
    const { at, ...revolve } = rest.revolve;
    rest.revolve = revolve;
  }
  return rest;
};

export function toDrawingData(result) {
  const { svg, viewModels, ...rest } = result;
  return { ...rest, viewModels: viewModels.map(stripView) };
}

export function fromDrawingData(data) {
  return { ...data, svg: (options) => primitivesToSvg(data.sheet, data.primitives, options) };
}
