// Live neerslagradar via RainViewer (gratis, kaarttegels, beelden om de 10 minuten).
// Documentatie: https://www.rainviewer.com/api.html

const INDEX = 'https://api.rainviewer.com/public/weather-maps.json';

/** Haalt de lijst radarbeelden op (laatste ~2 uur, plus korte vooruitblik als die beschikbaar is). */
export async function fetchRadarFrames() {
  const res = await fetch(INDEX, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Radar gaf fout ${res.status}`);
  return parseRadarIndex(await res.json());
}

export function parseRadarIndex(json) {
  const host = json?.host || 'https://tilecache.rainviewer.com';
  const past = json?.radar?.past || [];
  const now = json?.radar?.nowcast || [];
  const frames = [...past.map((f) => ({ ...f, forecast: false })), ...now.map((f) => ({ ...f, forecast: true }))]
    .filter((f) => f && f.path && f.time)
    .map((f) => ({ time: f.time * 1000, path: f.path, forecast: f.forecast }));
  return { host, frames };
}

/** Tegel-URL: kleurschema 2 (universeel blauw), afgevlakt, sneeuw apart. */
export function radarTileUrl(host, path) {
  return `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`;
}
