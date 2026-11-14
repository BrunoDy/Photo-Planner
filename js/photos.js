// Eigen voorbeeldfoto's per locatie, verkleind en bewaard in IndexedDB
// (localStorage is daarvoor te klein).

const DB = 'psp-photos';
const STORE = 'photos';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export const putPhoto = (id, dataUrl) => tx('readwrite', (s) => s.put(dataUrl, id));
export const getPhoto = (id) => tx('readonly', (s) => s.get(id)).catch(() => null);
export const deletePhoto = (id) => tx('readwrite', (s) => s.delete(id)).catch(() => {});

export async function allPhotos() {
  const d = await db();
  return new Promise((resolve) => {
    const out = {};
    const req = d.transaction(STORE).objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out[c.key] = c.value; c.continue(); } else resolve(out);
    };
    req.onerror = () => resolve(out);
  });
}

/** Verkleint een afbeeldingsbestand tot max. `max` px (JPEG). */
export function resizeImage(file, max = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Geen geldige afbeelding')); };
    img.src = url;
  });
}
