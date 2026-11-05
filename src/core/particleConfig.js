import { validateInitialFill } from './hopperFill.js';

export function particleConfig(value = {}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Configuración de simulación inválida');
  const defaults={seed:1,preset:'arena',rate:400,cap:3000,seeThrough:true,airQuality:'media',airOnly:false,noGrains:false,
    slice:{mode:'ninguno',axis:1,t:.5},airModel:'calculado',massFlowKgH:0,radiusMm:0,keepFlow:true,
    emitter:{center:[0,0,60],size:[20,20,5]},wind:[0,0,0],initialFill:validateInitialFill()};
  const config={...defaults,...value,slice:{...defaults.slice,...value.slice},emitter:{...defaults.emitter,...value.emitter},initialFill:validateInitialFill(value.initialFill)};
  if(!['arena','azucar','granulado','harina','agua','aceite'].includes(config.preset)||!['baja','media','alta'].includes(config.airQuality)||!['calculado','rapido'].includes(config.airModel))throw new Error('Configuración de simulación desconocida');
  for(const [key,lo,hi] of [['seed',1,4294967295],['rate',0,20000],['cap',100,8000],['massFlowKgH',0,1e9],['radiusMm',0,60]])if(!Number.isFinite(config[key])||config[key]<lo||config[key]>hi)throw new Error(`Simulación: ${key} fuera de rango`);
  for(const key of ['seeThrough','airOnly','noGrains','keepFlow'])if(typeof config[key]!=='boolean')throw new Error('Opción de simulación inválida');
  for(const vector of [config.wind,config.emitter.center,config.emitter.size])if(!Array.isArray(vector)||vector.length!==3||!vector.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7))throw new Error('Vector de simulación inválido');
  if(config.emitter.size.some(v=>v<0))throw new Error('El tamaño del emisor no puede ser negativo');
  if(!['ninguno','presion','velocidad'].includes(config.slice.mode)||![0,1,2].includes(Number(config.slice.axis))||!Number.isFinite(config.slice.t)||config.slice.t<0||config.slice.t>1)throw new Error('Corte de aire inválido');
  return structuredClone(config);
}
