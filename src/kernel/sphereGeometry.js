import {evaluate} from '../core/expression.js';

export const defaultSphereFeature=()=>({diameter:20,x:0,y:0,z:0,mode:'add'});
export function sphereSpec(feature,params={}) {
  const diameter=evaluate(feature.diameter??20,params),center=['x','y','z'].map(key=>evaluate(feature[key]??0,params));
  if(!Number.isFinite(diameter)||diameter<=0||diameter>1e7||!center.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7))throw new Error('Esfera: diámetro positivo y centro finito, hasta 10.000.000 mm.');
  if(!['add','cut'].includes(feature.mode??'add'))throw new Error('Operación de esfera inválida.');
  return {diameter,radius:diameter/2,center};
}
