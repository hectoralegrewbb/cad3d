// Trabajo aislado, con cancelación y tiempo máximo; no modifica el documento.
export function geometryJob(type, payload, { signal, timeout = 120000 } = {}) {
  return new Promise((resolve,reject) => {
    if (signal?.aborted) return reject(new Error('Cancelado'));
    const worker=new Worker(new URL('./geometryWorker.js',import.meta.url),{type:'module'});
    const finish=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();fn(value);};
    const abort=()=>finish(reject,new Error('Cancelado'));
    const timer=setTimeout(()=>finish(reject,new Error('El cálculo tardó demasiado. Reducí la complejidad y reintentá.')),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=({data})=>data.error?finish(reject,new Error(data.error)):finish(resolve,data.result);
    worker.onerror=(event)=>finish(reject,new Error(event.message || 'Falló el cálculo'));
    worker.onmessageerror=()=>finish(reject,new Error('Respuesta ilegible'));
    worker.postMessage({type,payload}, payload instanceof ArrayBuffer ? [payload] : []);
  });
}
