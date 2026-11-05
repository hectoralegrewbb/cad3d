import opencascade from '../../vendor/occ/replicad_single.js';
import * as rep from '../../vendor/replicad/replicad.js';

let ready = null;
// Carga el kernel (WASM ~23 MB, una sola vez; el navegador lo cachea).
export function loadKernel() {
  ready ??= opencascade({ locateFile: (file) => new URL(`../../vendor/occ/${file}`, import.meta.url).href }).then((oc) => {
    rep.setOC(oc);
    return rep;
  });
  return ready;
}
