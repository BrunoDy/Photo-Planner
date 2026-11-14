// Opslag van locaties en instellingen in de browser (localStorage), plus import/export.

const LOC_KEY = 'psp.locations.v1';
const SET_KEY = 'psp.settings.v1';

export const DEFAULT_SETTINGS = {
  home: null, // { lat, lon, label }
  distanceFrom: 'home', // 'gps' | 'home'
  avgSpeed: 60,
  detour: 1.3,
  days: 3,
  minScore: 35,
  mapLayer: 'kaart',
  lightPollution: false,
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function getLocations() {
  return read(LOC_KEY, []);
}
export function saveLocations(list) {
  write(LOC_KEY, list);
}
export function upsertLocation(loc) {
  const list = getLocations();
  const i = list.findIndex((l) => l.id === loc.id);
  const now = Date.now();
  if (i >= 0) list[i] = { ...list[i], ...loc, updated: now };
  else list.push({ id: uid(), created: now, updated: now, tags: [], ...loc });
  saveLocations(list);
  return i >= 0 ? list[i] : list[list.length - 1];
}
export function deleteLocation(id) {
  saveLocations(getLocations().filter((l) => l.id !== id));
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SET_KEY, {}) };
}
export function saveSettings(s) {
  write(SET_KEY, s);
}

// ---------- Import / export ----------

export const STATUSES = {
  '': 'Geen status',
  wil: 'Wil ik bezoeken',
  bezocht: 'Bezocht',
};

/** Alle collectienamen die in gebruik zijn, alfabetisch. */
export function allCollections(list = getLocations()) {
  const set = new Set();
  for (const l of list) for (const c of l.collections || []) if (c) set.add(c);
  return [...set].sort((a, b) => a.localeCompare(b, 'nl'));
}

/** Back-up als JSON; `photos` = { locatieId: dataUrl } voor eigen foto's. */
export function exportJson(photos = {}) {
  return JSON.stringify({ app: 'PhotoSpotPlanner', version: 2, exported: new Date().toISOString(), locations: getLocations(), settings: getSettings(), photos }, null, 2);
}

const num = (x) => (x == null || x === '' ? NaN : Number(x));
const okCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Herkent eigen JSON-export, GeoJSON (bv. Google Takeout "Opgeslagen plaatsen") en GPX. */
export function parseImport(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) return parseGpxOrKml(trimmed);
  const data = JSON.parse(trimmed);
  if (Array.isArray(data.locations)) {
    const photos = data.photos || {};
    return data.locations.filter((l) => okCoord(num(l.lat), num(l.lon)))
      .map((l) => (photos[l.id] ? { ...l, _photoData: photos[l.id] } : l));
  }
  if (data.type === 'FeatureCollection' || data.type === 'Feature') {
    const feats = data.type === 'Feature' ? [data] : data.features;
    return feats
      .filter((f) => f.geometry?.type === 'Point')
      .map((f) => {
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties || {};
        const name = p.name || p.Title || p.title || p.location?.name || p.location?.address || 'Geïmporteerde locatie';
        return { name, lat, lon, notes: p.description || p.Comment || p.location?.address || '', tags: [] };
      })
      .filter((l) => okCoord(l.lat, l.lon) && !(l.lat === 0 && l.lon === 0));
  }
  throw new Error('Onbekend bestandsformaat');
}

function parseGpxOrKml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out = [];
  doc.querySelectorAll('wpt').forEach((w) => {
    out.push({
      name: w.querySelector('name')?.textContent?.trim() || 'Waypoint',
      lat: num(w.getAttribute('lat')),
      lon: num(w.getAttribute('lon')),
      notes: w.querySelector('desc')?.textContent?.trim() || '',
      tags: [],
    });
  });
  doc.querySelectorAll('Placemark').forEach((pm) => {
    const c = pm.querySelector('Point coordinates')?.textContent?.trim();
    if (!c) return;
    const [lon, lat] = c.split(',').map(Number);
    out.push({ name: pm.querySelector('name')?.textContent?.trim() || 'Placemark', lat, lon, notes: pm.querySelector('description')?.textContent?.trim() || '', tags: [] });
  });
  return out.filter((l) => okCoord(l.lat, l.lon));
}

/**
 * Voegt geïmporteerde locaties toe; dubbels (zelfde naam + ~50 m) worden overgeslagen.
 * @returns {{added: number, photoData: [string, string][]}} eigen foto's om nog in IndexedDB te bewaren
 */
export function mergeLocations(incoming) {
  const list = getLocations();
  let added = 0;
  const photoData = [];
  for (const l of incoming) {
    const dup = list.some((e) => e.name === l.name && Math.abs(e.lat - l.lat) < 0.0005 && Math.abs(e.lon - l.lon) < 0.0005);
    if (dup) continue;
    const { _photoData, ...rest } = l;
    const loc = { tags: [], notes: '', direction: null, collections: [], status: '', favorite: false, ...rest, id: uid(), lat: Number(l.lat), lon: Number(l.lon), created: Date.now(), updated: Date.now() };
    if (_photoData) { loc.photo = 'own'; photoData.push([loc.id, _photoData]); } else if (loc.photo === 'own') loc.photo = '';
    list.push(loc);
    added++;
  }
  saveLocations(list);
  return { added, photoData };
}
