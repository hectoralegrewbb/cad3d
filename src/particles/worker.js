// Worker de partículas: construye los SDF, corre la simulación a ~60 Hz y manda cuadros al hilo principal (con contrapresión).
import { buildSdf } from './sdf.js';
import { ParticleSim } from './sim.js';

const cache = new Map(); // cacheKey → { sdf, mesh } (LRU): los cuerpos que no cambian no se vuelven a calcular
const CACHE_MAX = 10;
let sim = null;
let running = false;
let pending = 0;
let timer = null;
let lastStart = 0;

let sliceRequest = null; // { mode, axis, t } pedido por el panel; el corte viaja cada 6 cuadros
let frameNumber = 0;

const frame = () => {
  frameNumber += 1;
  const slice = sliceRequest && sliceRequest.mode !== 'ninguno' && frameNumber % 6 === 0 ? sim.airSlice(sliceRequest) : null;
  const snapshot = sim.snapshot();
  const tracers = sim.tracerSnapshot();
  const products = sim.productSnapshot();
  const rate = sim.exitRate();
  postMessage({
    type: 'frame',
    pos: snapshot,
    poses: sim.bodies.filter((body) => body.key).map((body) => ({ key: body.key, axis: body.axis, pivot: body.pivot, angle: body.angle, offset: body.offset })),
    nozzleLevels: sim.nozzleLevels,
    sensorCounts: sim.sensorCounts,
    count: sim.count,
    cap: sim.cap,
    exited: sim.exited,
    perSecond: rate.perSecond,
    volumePerSecond: rate.volumePerSecond,
    stepMs: sim.stepMs,
    airMs: sim.air ? sim.air.stepCost : 0,
    airCells: sim.air ? sim.air.n : 0,
    air: sim.airInfo(),
    fill: sim.fillInfo(),
    capNote: sim.capNote,
    slice,
    sliceMode: slice ? sliceRequest.mode : null,
    rotors: sim.rotorInfo(),
    tracers,
    products,
    productsExited: sim.productsExited,
    time: sim.time,
  }, [snapshot.buffer, tracers.buffer, products.buffer]);
  pending += 1;
};

const loop = () => {
  timer = null;
  if (!running || !sim) return;
  lastStart = performance.now();
  if (pending < 2) {
    try {
      if (sim.airPending()) {
        // aire calculado inicial: se resuelve por tandas sin frenar la cola de mensajes (se puede detener en cualquier momento)
        sim.solveAirSlice(12);
      } else {
        sim.step(1 / 60);
        sim.adapt();
      }
      frame();
    } catch (error) {
      // un fallo numérico o de memoria no debe matar la pestaña: se detiene la simulación y se avisa
      running = false;
      postMessage({ type: 'error', message: `La simulación se detuvo: ${error?.message ?? error}` });
      return;
    }
  }
  const spent = performance.now() - lastStart;
  timer = setTimeout(loop, Math.max(0, 1000 / 60 - spent));
};

const kick = () => {
  if (running && !timer) timer = setTimeout(loop, 0);
};

onmessage = ({ data }) => {
  if (data.type === 'init') {
    try {
      running = false;
      sim = null;
      const radius = data.settings.radius;
      const cell = Math.max(0.6, radius * 0.7);
      // con cajas rígidas el SDF necesita una banda más ancha: sin normal dentro del material una caja que penetró no puede salir
      const band = Math.max(4, radius * 2.5, data.scene?.feeders?.length ? 10 : 0);
      const total = data.bodies.length;
      const bodies = data.bodies.map((body, index) => {
        // La caché guarda el SDF (colisión de granos) y la malla (paredes del aire calculado, que son membranas)
        let entry = body.cacheKey ? cache.get(body.cacheKey) : null;
        if (entry) {
          cache.delete(body.cacheKey); // reinsertar = más reciente
          cache.set(body.cacheKey, entry);
        } else {
          if (!body.vertices) throw new Error('Falta la geometría de un cuerpo');
          postMessage({ type: 'progress', done: index, total, name: body.label ?? '' });
          entry = { sdf: buildSdf(body.vertices, body.triangles, { cell, band }), mesh: { vertices: body.vertices, triangles: body.triangles, normals:body.normals } };
          if (body.cacheKey) {
            cache.set(body.cacheKey, entry);
            while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
          }
        }
        return { ...body, sdf: entry.sdf, mesh: entry.mesh, vertices: undefined, triangles: undefined };
      });
      sim = new ParticleSim(bodies, data.settings);
      sim.setScene(data.scene ?? {});
      if(data.fill)sim.initializeFill(data.fill);
      pending = 0;
      postMessage({ type: 'ready', cell: bodies.map((body) => body.sdf.cell), keys: [...cache.keys()], fill: null });
    } catch (error) {
      postMessage({ type: 'error', message: error?.message ?? String(error) });
    }
  } else if (data.type === 'drop') {
    running = false;
    sim = null;
  } else if (data.type === 'settings' && sim) {
    sim.setSettings(data.patch);
  } else if (data.type === 'slice') {
    sliceRequest = data.request;
  } else if (data.type === 'scene' && sim) {
    sim.setScene(data.scene);
  } else if (data.type === 'run') {
    running = data.on;
    if (running) kick();
  } else if (data.type === 'reset' && sim) {
    sim.count = 0;
    sim.exited = 0;
    sim.exitWindow = [];
    sim.exitSum = [0, 0, 0];
    sim.time = 0;
    sim.cap = Math.min(sim.s.cap, sim.max);
    sim.exitTimes = [];
    sim.zoneReached = new Map();
    sim.zoneLast = new Map();
    sim.zoneAbove = new Map();
    sim.air?.clearParticles?.();
    sim.resetDynamics();
    frame();
  } else if (data.type === 'ack') {
    pending = Math.max(0, pending - 1);
    kick();
  }
};
