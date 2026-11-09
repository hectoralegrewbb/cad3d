import {meshAudit,meshSection} from '../core/inspection.js';
import { parseStl } from './stlReader.js';
import { internalCapacity, hopperCavity } from '../core/capacity.js';
self.onmessage = ({data}) => {
  try {
    const result = data.type === 'stl' ? parseStl(data.payload) : data.type === 'capacity' ? internalCapacity(data.payload) : data.type === 'hopper' ? hopperCavity(data.payload) : data.type==='audit' ? meshAudit(data.payload) : data.type==='section' ? meshSection(data.payload.mesh,data.payload.axis,data.payload.position) : null;
    if (!result) throw new Error('Cálculo desconocido');
    self.postMessage({result});
  } catch(error) { self.postMessage({error:error.message}); }
};
