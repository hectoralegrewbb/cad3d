import { dwgToEntities } from './dwgEntities.js';
import { unitScaleOf } from './dxfReader.js';

// Decodifica un DWG con LibreDWG (WASM) en el hilo actual. Lo usa el worker (navegador) y las pruebas (Node).
// Cada llamada crea un módulo nuevo: si el decodificador se cae con un archivo, no contamina al siguiente.
export async function decodeDwg(buffer) {
  const lib = await import('../../vendor/libredwg/dist/libredwg-web.js');
  let dwg;
  let instance;
  try {
    const wasm = await lib.createModule();
    instance = lib.LibreDwg.createByWasmInstance(wasm);
    dwg = instance.dwg_read_data(buffer, lib.Dwg_File_Type.DWG);
    const db = instance.convert(dwg);
    const units = db.header?.INSUNITS ?? 0;
    return { ...dwgToEntities(db), units, unitScale: unitScaleOf(units) };
  } finally {
    try {
      if (dwg && instance) instance.dwg_free(dwg);
    } catch {
      /* módulo ya inválido */
    }
  }
}

export const DWG_CRASH_MESSAGE = 'No se pudo decodificar este DWG (el lector se cayó). Abrilo en AutoCAD/LibreCAD/DraftSight, guardalo como DXF (R2000 o anterior) e importá el DXF.';
export const isDecoderCrash = (message = '') => /memory access out of bounds|unreachable|out of WASM memory|Aborted|RuntimeError/i.test(message);
