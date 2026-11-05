// Exportación 3MF (Bambu Studio / Orca / PrusaSlicer): ZIP sin compresión con un objeto de malla por pieza, en milímetros.
import { meshShape } from './batchMesh.js';
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ZIP "store" mínimo. files: [{ name, data: Uint8Array }]
export function zipStore(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (view, at, value) => view.setUint16(at, value, true);
  const u32 = (view, at, value) => view.setUint32(at, value, true);
  files.forEach((file) => {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    u32(view, 0, 0x04034b50);
    u16(view, 4, 20);
    u16(view, 6, 0x0800);
    u16(view, 8, 0);
    u16(view, 10, 0);
    u16(view, 12, 0x21);
    u32(view, 14, crc);
    u32(view, 18, file.data.length);
    u32(view, 22, file.data.length);
    u16(view, 26, name.length);
    local.set(name, 30);
    chunks.push(local, file.data);
    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0x0800);
    u16(cv, 12, 0);
    u16(cv, 14, 0x21);
    u32(cv, 16, crc);
    u32(cv, 20, file.data.length);
    u32(cv, 24, file.data.length);
    u16(cv, 28, name.length);
    u32(cv, 42, offset);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + file.data.length;
  });
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, files.length);
  u16(ev, 10, files.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, offset);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (value) => String(Math.round(value * 10000) / 10000);

// items: [{ name, shape, matrix? }] con matrix = 12 números de la transformación 3MF (3x3 por filas + traslación)
export function exportThreeMf(items, { tolerance = 0.02, angularTolerance = 0.1 } = {}) {
  const objects = [];
  const build = [];
  items.forEach((item, index) => {
    const mesh = item.mesh ?? meshShape(item.shape, { tolerance, angularTolerance });
    const vertices = [];
    for (let i = 0; i < mesh.vertices.length; i += 3) vertices.push(`<vertex x="${fmt(mesh.vertices[i])}" y="${fmt(mesh.vertices[i + 1])}" z="${fmt(mesh.vertices[i + 2])}"/>`);
    const triangles = [];
    for (let i = 0; i < mesh.triangles.length; i += 3) triangles.push(`<triangle v1="${mesh.triangles[i]}" v2="${mesh.triangles[i + 1]}" v3="${mesh.triangles[i + 2]}"/>`);
    const id = index + 1;
    objects.push(`<object id="${id}" name="${esc(item.name ?? `Pieza ${id}`)}" type="model"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`);
    build.push(`<item objectid="${id}"${item.matrix ? ` transform="${item.matrix.map(fmt).join(' ')}"` : ''}/>`);
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="es-AR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">ElCad 3D</metadata><resources>${objects.join('')}</resources><build>${build.join('')}</build></model>`;
  const encoder = new TextEncoder();
  return zipStore([
    { name: '[Content_Types].xml', data: encoder.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', data: encoder.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', data: encoder.encode(model) },
  ]);
}
