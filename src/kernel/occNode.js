// Carga del kernel en Node (pruebas). En el navegador se usa occBrowser.js.
import opencascade from '../../vendor/occ/replicad_single.js';
import * as rep from '../../vendor/replicad/replicad.js';
import { fileURLToPath } from 'node:url';

let ready = null;
export function loadKernel() {
  ready ??= opencascade({ locateFile: (file) => fileURLToPath(new URL(`../../vendor/occ/${file}`, import.meta.url)) }).then((oc) => {
    rep.setOC(oc);
    return rep;
  });
  return ready;
}
