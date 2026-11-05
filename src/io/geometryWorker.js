import { parseStl } from './stlReader.js';
import { internalCapacity, hopperCavity } from '../core/capacity.js';
self.onmessage = ({data}) => {
  try {
    const result = data.type === 'stl' ? parseStl(data.payload) : data.type === 'capacity' ? internalCapacity(data.payload) : data.type === 'hopper' ? hopperCavity(data.payload) : null;
    if (!result) throw new Error('Cálculo desconocido');
    self.postMessage({result});
  } catch(error) { self.postMessage({error:error.message}); }
};
