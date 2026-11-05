import assert from 'node:assert/strict';
import { discharge, pourPile } from './granularRigs.mjs';

// 1) Descarga por orificio contra Beverloo: el flujo no debe trabarse (ni superar la fórmula en mucho)
for (const D of [14, 18]) {
  const r = discharge('arena', {}, D);
  const ratio = Number(r.ratio);
  console.log('Beverloo', D, r);
  assert.ok(ratio > 0.6 && ratio < 1.4, `descarga D=${D}: ${ratio} de Beverloo`);
  assert.ok(Number(r.stepMs) < 40, `costo por paso ${r.stepMs} ms`);
}

// 2) Pila vertida: flanco con pendiente de arena razonable (la real es ~33°; el modelo da ~26°) y todo dormido al final
for (const preset of ['arena', 'azucar']) {
  const pile = pourPile(preset);
  console.log('Pila', preset, pile);
  assert.ok(pile.slope > 17 && pile.slope < 45, `pendiente del flanco ${pile.slope}`);
  assert.ok(pile.asleep > pile.count * 0.95, `la pila en reposo debe dormir (${pile.asleep}/${pile.count})`);
  assert.ok(pile.stepMs < 15, `pila en reposo barata (${pile.stepMs} ms)`);
}
console.log('granular ok');
