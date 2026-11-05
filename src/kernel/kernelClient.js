// Cliente del motor para el hilo principal: pedidos con promesas. Un pedido con `channel` + `latestOnly` reemplaza a los
// anteriores del mismo canal que sigan en cola (resuelven con { superseded: true }).
export const isSuperseded = (result) => Boolean(result?.superseded);

export function createKernelClient({ createWorker, onBusy = null, onProgress = null }) {
  let worker = null;
  let pending = new Map();
  let nextId = 1;
  let ready = null;

  const settleAll = (value) => {
    pending.forEach((entry) => entry.resolve(value));
    pending = new Map();
    notify();
  };

  // Avisa qué trabajos siguen pendientes (los `silent`, como medir memoria, no cuentan): [{ type, since }] del más viejo al más nuevo.
  const notify = () => onBusy?.([...pending.values()].filter((entry) => !entry.silent).map(({ type, since }) => ({ type, since })));

  function start() {
    worker = createWorker();
    ready = new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        const message = event.data;
        if (message.ready) return resolve();
        if (message.fatal) return fail(new Error(message.fatal));
        const entry = pending.get(message.id);
        if (!entry) return;
        if (message.progress) { onProgress?.({ type: entry.type, ...message.progress }); return; } // avance de un trabajo largo: no lo cierra
        pending.delete(message.id);
        notify();
        if (message.superseded) entry.resolve({ superseded: true });
        else if (message.error) entry.reject(new Error(message.error));
        else entry.resolve(message.result);
      };
      const fail = (error) => {
        pending.forEach((entry) => entry.reject(error));
        pending.clear();
        worker?.terminate(); worker = null;
        notify(); reject(error);
      };
      worker.onerror = (event) => fail(new Error(event.message ?? 'Falló el motor. Usá Recuperar motor.'));
      worker.onmessageerror = () => fail(new Error('Respuesta del motor ilegible. Usá Recuperar motor.'));
    });
    ready.catch(() => {}); // también puede haber pedidos antes del aviso ready
    return ready;
  }

  return {
    start,
    get ready() {
      return ready;
    },
    request(type, payload = {}, { channel = null, latestOnly = false, silent = false } = {}) {
      if (!worker) start().catch(() => {});
      return new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve, reject, type, silent, since: Date.now() });
        notify();
        try { worker.postMessage({ id, type, payload, channel, latestOnly }); }
        catch (error) { pending.delete(id); notify(); reject(error); }
      });
    },
    // Descarta el hilo (y con él toda la memoria WASM) y arranca uno nuevo. Los pedidos en vuelo salen `superseded`.
    restart() {
      worker?.terminate();
      settleAll({ superseded: true });
      return start();
    },
  };
}

// Mismo contrato, en el mismo hilo (tests de Node): los pedidos corren de a uno y en orden.
export function createLocalClient(service) {
  let chain = Promise.resolve();
  return {
    start: () => Promise.resolve(),
    ready: Promise.resolve(),
    request(type, payload = {}) {
      const run = chain.then(() => service.handle(type, payload));
      chain = run.catch(() => {});
      return run;
    },
    restart: () => Promise.resolve(),
  };
}
