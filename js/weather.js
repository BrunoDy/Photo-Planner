// Weersverwachting per uur via Open-Meteo (gratis, geen API-sleutel nodig).
// Meerdere locaties worden in één verzoek opgehaald en een uur lang gecachet.

const API = 'https://api.open-meteo.com/v1/forecast';
const VARS = [
  'temperature_2m', 'dew_point_2m', 'relative_humidity_2m', 'cloud_cover', 'cloud_cover_low',
  'cloud_cover_mid', 'cloud_cover_high', 'visibility', 'wind_speed_10m', 'wind_gusts_10m',
  'precipitation', 'precipitation_probability',
];
const CACHE_KEY = 'psp.weather.v1';
const TTL_MS = 60 * 60 * 1000;
const BATCH = 40;

const key = (p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Opslag vol: cache is optioneel.
  }
}
export function clearWeatherCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

/** Zet het Open-Meteo-antwoord om naar een lijst uur-objecten. */
export function parseHourly(json) {
  const h = json.hourly;
  return h.time.map((t, i) => ({
    t: t * 1000,
    temp: h.temperature_2m[i],
    dew: h.dew_point_2m[i],
    rh: h.relative_humidity_2m[i],
    cc: h.cloud_cover[i],
    low: h.cloud_cover_low[i],
    mid: h.cloud_cover_mid[i],
    high: h.cloud_cover_high[i],
    vis: h.visibility?.[i] ?? null,
    wind: h.wind_speed_10m[i],
    gust: h.wind_gusts_10m?.[i] ?? null,
    precip: h.precipitation[i] ?? 0,
    pop: h.precipitation_probability?.[i] ?? null,
  })).filter((x) => x.temp != null && x.cc != null);
}

/**
 * Haalt de verwachting op voor een lijst punten ({lat, lon}).
 * @returns {Promise<Map<string, {hours: object[], fetched: number}>>} sleutel = key(punt)
 */
export async function getForecasts(points, { days = 7, force = false } = {}) {
  const cache = loadCache();
  const now = Date.now();
  const result = new Map();
  const missing = [];
  const seen = new Set();
  for (const p of points) {
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    const c = cache[k];
    if (!force && c && now - c.fetched < TTL_MS && c.days >= days) result.set(k, c);
    else missing.push(p);
  }

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const params = new URLSearchParams({
      latitude: batch.map((p) => p.lat.toFixed(3)).join(','),
      longitude: batch.map((p) => p.lon.toFixed(3)).join(','),
      hourly: VARS.join(','),
      timeformat: 'unixtime',
      timezone: 'UTC',
      wind_speed_unit: 'kmh',
      forecast_days: String(days),
      past_days: '1',
    });
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) throw new Error(`Weerdienst gaf fout ${res.status}`);
    let json = await res.json();
    if (!Array.isArray(json)) json = [json];
    json.forEach((j, idx) => {
      const entry = { hours: parseHourly(j), fetched: now, days };
      const k = key(batch[idx]);
      cache[k] = entry;
      result.set(k, entry);
    });
  }

  // Oude cache-items opruimen.
  for (const k of Object.keys(cache)) if (now - cache[k].fetched > 6 * TTL_MS) delete cache[k];
  saveCache(cache);
  return result;
}

export function forecastFor(map, p) {
  return map.get(key(p))?.hours ?? null;
}

/** Het uur dat het dichtst bij tijdstip t ligt (max. 90 min verschil). */
export function hourAt(hours, t) {
  let best = null;
  let bestD = Infinity;
  for (const h of hours) {
    const d = Math.abs(h.t - t);
    if (d < bestD) { bestD = d; best = h; }
  }
  return bestD <= 90 * 60 * 1000 ? best : null;
}

export function hoursBetween(hours, from, to) {
  return hours.filter((h) => h.t >= from && h.t <= to);
}
