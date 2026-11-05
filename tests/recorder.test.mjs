import assert from 'node:assert/strict';
import { RunRecorder, labelOf, maxSamples } from '../src/particles/recorder.js';

const frame = (t, extra = {}) => ({ time: t, perSecond: 5, count: 10, exited: 2, sensorCounts: { s1: 3 }, air: { readings: { s1: { pressure: 100 + t, speed: 12, flow: 300 } } }, rotors: [{ key: 'pad', rpm: 58, motorTorque: 0.3, loadTorque: 0.2, frictionTorque: 0.03 }], ...extra });

// muestreo a ~10 Hz: de 60 cuadros por segundo se guarda uno de cada 6
const rec = new RunRecorder();
let saved = 0;
for (let n = 0; n < 120; n += 1) if (rec.push(frame(n / 60))) saved += 1;
assert.ok(saved >= 19 && saved <= 21, `muestras ${saved}`);
assert.ok(rec.keys().includes('p:s1') && rec.keys().includes('rpm:pad') && rec.keys().includes('zone:s1'));
assert.equal(rec.series('p:s1').values.length, rec.times.length);

// canal que aparece tarde queda con vacíos al principio y todas las series con la misma longitud
const late = new RunRecorder();
late.push(frame(0, { rotors: [] }));
late.push(frame(0.2));
assert.equal(late.series('rpm:pad').values[0], null);
assert.equal(late.series('rpm:pad').values[1], 58);
late.channels.forEach((v) => assert.equal(v.length, late.times.length));

// reinicio de la simulación (el tiempo vuelve a 0) vacía el registro
rec.push(frame(0));
assert.equal(rec.times.length, 1);

// memoria acotada: nunca pasa de maxSamples y conserva el rango completo
const long = new RunRecorder({ interval: 0.01 });
for (let n = 0; n < maxSamples * 5; n += 1) long.push(frame(n * 0.01));
assert.ok(long.times.length <= maxSamples, `muestras ${long.times.length}`);
assert.ok(long.times[long.times.length - 1] > maxSamples * 0.01 * 3, 'cubre toda la corrida');

// CSV y etiquetas
const csv = rec.csv({ s1: 'Garganta' });
assert.ok(csv.split('\n')[0].includes('Garganta · presión (Pa)'));
assert.equal(labelOf('perSecond'), 'salen/s');
const snap = late.snapshot('base');
late.push(frame(0.4));
assert.notEqual(snap.times.length, late.times.length);
console.log('recorder ok');
