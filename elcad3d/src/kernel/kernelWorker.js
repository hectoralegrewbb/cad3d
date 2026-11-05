import { loadKernel } from './occBrowser.js';
import { createKernelService } from './kernelService.js';
import { collectTransfers } from './transfer.js';

// Hilo del motor: carga OpenCascade y atiende pedidos de a uno. Los pedidos de un mismo `channel` marcados
// `latestOnly` se funden: si llegaron varios mientras corría otro trabajo, solo corre el último (los anteriores salen `superseded`).
let service = null;
let queue = [];
let pumping = false;

const reply = (message, transfer = []) => self.postMessage(message, transfer);

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    await new Promise((resolve) => setTimeout(resolve, 0)); // deja entrar los pedidos que llegaron durante el trabajo anterior
    const batch = queue;
    queue = [];
    const lastOfChannel = new Map();
    batch.forEach((job, index) => job.latestOnly && job.channel && lastOfChannel.set(job.channel, index));
    for (let index = 0; index < batch.length; index += 1) {
      const job = batch[index];
      if (job.latestOnly && job.channel && lastOfChannel.get(job.channel) !== index) {
        reply({ id: job.id, superseded: true });
        continue;
      }
      const started = performance.now();
      globalThis.__elcadProgress = (phase, fraction, estimateMs = 0, until = fraction) => reply({ id: job.id, progress: { phase, fraction, estimateMs, until } });
      try {
        const result = await service.handle(job.type, job.payload);
        reply({ id: job.id, result, ms: performance.now() - started }, collectTransfers(result));
      } catch (error) {
        reply({ id: job.id, error: error?.message ?? String(error), ms: performance.now() - started });
      } finally {
        globalThis.__elcadProgress = null;
      }
    }
  }
  pumping = false;
}

self.onmessage = (event) => {
  queue.push(event.data);
  if (service) pump();
};

loadKernel()
  .then((rep) => {
    service = createKernelService(rep);
    reply({ ready: true });
    if (queue.length) pump();
  })
  .catch((error) => reply({ fatal: error?.message ?? String(error) }));
