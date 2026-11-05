import { parseProject } from '../core/projectModel.js';
import { parseJson, validatePart } from '../core/validation.js';

// Guardado atómico local + diez revisiones como máximo (separadas 30 s).
const dbName = 'elcad3d';
const storeName = 'docs';
let lastLoadError=null;
export const localLoadError=()=>lastLoadError;
const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(dbName, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Base local bloqueada por otra pestaña'));
});
async function transaction(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('No se pudo guardar'));
      try { action(tx.objectStore(storeName), (value) => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}
export async function saveLocal(part, key = 'current') {
  try {
    const text = JSON.stringify(part);
    await transaction('readwrite', (store) => {
      store.put(text, key);
      const request = store.get(`${key}:revisions`);
      request.onsuccess = () => {
        const revisions = request.result ?? [];
        if (!revisions.length || Date.now() - revisions[0].at >= 30000) {
          store.put([{ at: Date.now(), text }, ...revisions].slice(0, 10), `${key}:revisions`);
        }
      };
    });
    return true;
  } catch { return false; }
}
export async function clearLocal(key = 'current') {
  try {
    await transaction('readwrite', (store) => { store.delete(key); store.delete(`${key}:revisions`); });
    return true;
  } catch { return false; }
}
export async function loadLocal(key = 'current') {
  lastLoadError=null;
  try {
    const text = await transaction('readonly', (store, done) => { store.get(key).onsuccess = (event) => done(event.target.result); });
    return text ? parseProject(text) : null;
  } catch (error) { lastLoadError=error;return null; }
}
export async function listRevisions(key = 'current') {
  return (await transaction('readonly', (store, done) => { store.get(`${key}:revisions`).onsuccess = (event) => done(event.target.result); })) ?? [];
}
export async function clearRevisions(key = 'current') {
  return transaction('readwrite', (store) => store.delete(`${key}:revisions`));
}
export function parsePart(text) { return validatePart(parseJson(text)); }
export const serializePart = (part) => JSON.stringify(part, null, 1);
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
