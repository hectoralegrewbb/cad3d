// Biblioteca de piezas de máquina: cada módulo aporta ítems { id, category, label, description?, ask?, build(args), expect? }.
import { fasteners } from './fasteners.js';
import { bearingItems } from './bearings.js';
import { transmissionItems } from './transmission.js';
import { structureItems } from './structure.js';
import { hopperItems } from './hoppers.js';
import { fluidItems } from './fluids.js';
import { machineItems } from './machines.js';
import { electricalItems } from './electrical.js';
import { mechanismItems } from './mechanisms.js';

export const libraryItems = [...fasteners, ...bearingItems, ...transmissionItems, ...structureItems, ...hopperItems, ...fluidItems, ...machineItems, ...electricalItems, ...mechanismItems];

export const libraryCategories = [...new Set(libraryItems.map((entry) => entry.category))];
