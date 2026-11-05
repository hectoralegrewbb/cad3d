import { DWG_CRASH_MESSAGE, decodeDwg, isDecoderCrash } from './dwgDecode.js';

export { dwgToEntities } from './dwgEntities.js';

// Lee un DWG → { entities, layers, skipped, units, unitScale }. En el navegador corre en un Worker (se cancela a los 60 s);
// en Node (pruebas) decodifica en el mismo hilo.
export async function readDwg(buffer, { timeoutMs = 60000 } = {}) {
  if (typeof Worker === 'undefined') {
    try {
      return await decodeDwg(buffer);
    } catch (error) {
      throw new Error(isDecoderCrash(error?.message) ? DWG_CRASH_MESSAGE : error.message);
    }
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./dwgWorker.js', import.meta.url), { type: 'module' });
    const finish = (fn, value) => {
      clearTimeout(timer);
      worker.terminate();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('El DWG tardó demasiado en decodificarse (más de 60 s). Guardalo como DXF e importá el DXF.')), timeoutMs);
    worker.onmessage = ({ data }) => (data.ok ? finish(resolve, data.result) : finish(reject, new Error(isDecoderCrash(data.message) ? DWG_CRASH_MESSAGE : data.message)));
    worker.onerror = (event) => finish(reject, new Error(`${DWG_CRASH_MESSAGE} (${event.message ?? 'error del worker'})`));
    worker.postMessage({ buffer }, [buffer]);
  });
}
