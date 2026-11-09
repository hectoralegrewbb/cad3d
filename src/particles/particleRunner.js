// Cliente del Worker de partículas. El Worker queda vivo entre simulaciones (guarda en caché los SDF de los cuerpos
// que no cambian) y se libera solo tras un rato sin uso.
const IDLE_MS = 120000;

// Huella barata de una malla (FNV-1a sobre los bits de los vértices) para reconocer geometría ya calculada.
export function meshHash(vertices) {
  const words = new Uint32Array(vertices.buffer, vertices.byteOffset, vertices.length);
  let hash = 2166136261;
  for (let i = 0; i < words.length; i += 1) hash = Math.imul(hash ^ words[i], 16777619) >>> 0;
  return `${vertices.length}:${hash.toString(36)}`;
}

export class ParticleRunner {
  constructor({ onFrame, onProgress = null, onError = null }) {
    this.onFrame = onFrame;
    this.onProgress = onProgress;
    this.onError = onError;
    this.worker = null;
    this.live = false; // hay una simulación armada (corriendo o en pausa)
    this.cached = new Set();
    this.idleTimer = null;
    this.pendingStart = null;
  }

  get active() {
    return this.live;
  }

  ensureWorker() {
    clearTimeout(this.idleTimer);
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => this.handle(data);
    worker.onerror = (event) => {
      const pending = this.pendingStart;
      this.dispose();
      pending?.reject(new Error(event.message || 'El Worker de partículas falló'));
      this.onError?.(event);
    };
    this.worker = worker;
    return worker;
  }

  handle(data) {
    if (data.type === 'frame') {
      if (this.live) {
        this.onFrame(data);
        this.worker?.postMessage({ type: 'ack' });
      } else this.worker?.postMessage({ type: 'ack' });
    } else if (data.type === 'progress') this.onProgress?.(data);
    else if (data.type === 'ready') {
      this.cached = new Set(data.keys);
      this.live = true;
      this.worker.postMessage({ type: 'run', on: true });
      this.pendingStart?.resolve(data);
      this.pendingStart = null;
    } else if (data.type === 'error') {
      this.pendingStart?.reject(new Error(data.message));
      this.pendingStart = null;
      this.stop();
      this.onError?.(new Error(data.message));
    }
  }

  // bodies: [{ vertices, triangles, key?, movable, radiusMax, label? }] en coordenadas del mundo. Los cuerpos con `cacheKey`
  // que el Worker ya tiene no vuelven a enviarse ni a calcularse.
  start({ bodies, settings, scene, fill = null }) {
    this.stop();
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker();
      this.pendingStart = { resolve, reject };
      this.heavy=!!fill;
      const radiusKey = `${settings.radius}${scene?.feeders?.length ? 'b' : ''}`; // las mallas con cajas usan otra banda de SDF
      const payload = bodies.map((body) => {
        const cacheKey = `${body.label ?? ''}|${meshHash(body.vertices)}|${meshHash(body.triangles)}|${radiusKey}`;
        if (this.cached.has(cacheKey)) return { ...body, cacheKey, vertices: undefined, triangles: undefined };
        return { ...body, cacheKey };
      });
      const transfer = payload.flatMap((body) => (body.vertices ? [body.vertices.buffer, body.triangles.buffer] : []));
      worker.postMessage({ type: 'init', bodies: payload, settings, scene, fill }, transfer);
    });
  }

  pause() {
    this.worker?.postMessage({ type: 'run', on: false });
  }

  resume() {
    this.worker?.postMessage({ type: 'run', on: true });
  }

  liveSettings(patch) {
    this.worker?.postMessage({ type: 'settings', patch });
  }

  // Corte de presión o velocidad del aire en un plano: { mode: 'ninguno'|'presion'|'velocidad', axis: 0|1|2, t: 0..1 }
  setSlice(request) {
    this.worker?.postMessage({ type: 'slice', request });
  }

  // Acciones, boquillas y sensores nuevos sin reiniciar (cambiar qué cuerpos se mueven sí pide reiniciar).
  setScene(scene) {
    this.worker?.postMessage({ type: 'scene', scene });
  }

  reset() {
    this.worker?.postMessage({ type: 'reset' });
  }

  stop() {
    if(this.heavy){this.heavy=false;this.dispose();return;}
    this.pendingStart?.reject(new Error('Simulación cancelada')); this.pendingStart=null;
    clearTimeout(this.idleTimer);
    this.live = false;
    if (this.worker) {
      this.worker.postMessage({ type: 'drop' });
      this.idleTimer = setTimeout(() => this.dispose(), IDLE_MS);
    }
  }

  dispose() {
    clearTimeout(this.idleTimer);
    this.worker?.terminate();
    this.worker = null;
    this.live = false;
    this.cached = new Set();
    this.pendingStart?.reject(new Error('Simulación cancelada'));
    this.pendingStart = null;
  }
}
