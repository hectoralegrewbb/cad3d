// Worker: decodifica el DWG fuera del hilo de la interfaz (un DWG pesado o que tumba al decodificador no congela ni cierra la pestaña).
import { decodeDwg } from './dwgDecode.js';

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ ok: true, result: await decodeDwg(data.buffer) });
  } catch (error) {
    self.postMessage({ ok: false, message: String(error?.message ?? error) });
  }
};
