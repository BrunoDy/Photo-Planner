// Herkent een locatie in geplakte tekst of een gedeelde link:
// coördinaten (decimaal of graden/minuten/seconden), Google Maps, Apple Maps,
// OpenStreetMap, geo:-URI's. Lukt dat niet, dan geeft het een naam terug om te zoeken.

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

const okCoord = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

function tryDecode(s) {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

/** Coördinaten uit een URL (Google, Apple, OSM, geo:). */
function coordsFromUrl(u) {
  const s = tryDecode(u);
  const pats = [
    new RegExp(`!3d${NUM}!4d${NUM}`), // Google: exacte plaats
    new RegExp(`[?&](?:q|query|ll|sll|daddr|destination|center|coordinate|saddr)=(?:loc:)?${NUM}\\s*,\\s*${NUM}`),
    new RegExp(`@${NUM},${NUM}`), // Google: kaartcentrum
    new RegExp(`geo:${NUM},${NUM}`),
    new RegExp(`#map=\\d+(?:\\.\\d+)?/${NUM}/${NUM}`), // OpenStreetMap
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m && okCoord(+m[1], +m[2])) return { lat: +m[1], lon: +m[2] };
  }
  const mlat = s.match(/[?&]mlat=(-?\d+(?:\.\d+)?)/);
  const mlon = s.match(/[?&]mlon=(-?\d+(?:\.\d+)?)/);
  if (mlat && mlon && okCoord(+mlat[1], +mlon[1])) return { lat: +mlat[1], lon: +mlon[1] };
  return null;
}

/** Naam uit een URL (Google /place/, Apple q=, of laatste padstuk). */
function nameFromUrl(u) {
  let url;
  try { url = new URL(u); } catch { return null; }
  const place = url.pathname.match(/\/place\/([^/]+)/);
  if (place) return tryDecode(place[1]);
  const q = url.searchParams.get('q') || url.searchParams.get('name') || url.searchParams.get('query');
  if (q && !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(q.trim())) return q.trim();
  if (/goo\.gl|maps\.app/.test(url.hostname)) return null; // korte link: geen info
  const seg = url.pathname.split('/').filter(Boolean).pop();
  if (!seg) return null;
  const words = tryDecode(seg).replace(/\.\w{2,5}$/, '').replace(/^\d+[-_]?/, '').replace(/[-_]+/g, ' ').trim();
  return words.length >= 3 && /[a-z]/i.test(words) ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/** Graden/minuten/seconden, bv. 50°46'33.6"N 3°37'58.8"E (ook O/Z). */
function coordsFromDms(text) {
  const re = /(\d{1,3})[°º]\s*(\d{1,2})?['′]?\s*(\d{1,2}(?:[.,]\d+)?)?["″]?\s*([NSZEOW])/gi;
  const parts = [...text.matchAll(re)];
  if (parts.length < 2) return null;
  const val = (m) => {
    const v = +m[1] + (+(m[2] || 0)) / 60 + (+(String(m[3] || 0).replace(',', '.'))) / 3600;
    return /[SZW]/i.test(m[4]) ? -v : v;
  };
  const latM = parts.find((m) => /[NSZ]/i.test(m[4]));
  const lonM = parts.find((m) => /[EOW]/i.test(m[4]));
  if (!latM || !lonM) return null;
  const c = { lat: val(latM), lon: val(lonM) };
  return okCoord(c.lat, c.lon) ? c : null;
}

/** Decimale coördinaten, bv. "50.776, 3.633" of "50,776 3,633". */
function coordsFromDecimal(text) {
  const m = text.match(/(-?\d{1,2}[.]\d{3,})\s*[,; ]\s*(-?\d{1,3}[.]\d{3,})/) ||
            text.match(/(-?\d{1,2},\d{3,})\s*[; ]\s*(-?\d{1,3},\d{3,})/);
  if (!m) return null;
  const c = { lat: +m[1].replace(',', '.'), lon: +m[2].replace(',', '.') };
  return okCoord(c.lat, c.lon) ? c : null;
}

/**
 * @param {string} text geplakte tekst, gedeelde tekst of URL
 * @returns {{lat?: number, lon?: number, name: string|null, url: string|null}}
 */
export function parseLocationText(text) {
  const raw = String(text || '').trim();
  const urls = raw.match(/https?:\/\/[^\s<>"]+|geo:[^\s<>"]+/gi) || [];
  const url = urls.find((u) => u.startsWith('http')) || null;
  let coords = null;
  for (const u of urls) { coords = coordsFromUrl(u); if (coords) break; }
  const rest = urls.reduce((s, u) => s.replace(u, ' '), raw);
  if (!coords) coords = coordsFromDms(rest) || coordsFromDecimal(rest);

  // Naam: eerste tekstregel die geen coördinaat of link is, anders uit de URL.
  const line = rest.split(/\n/).map((l) => l.trim().replace(/^["'“]|["'”]$/g, ''))
    .find((l) => l.length >= 2 && /[a-z]/i.test(l) && !/^\d/.test(l) && !/[°′″]/.test(l));
  let name = line || null;
  if (!name) for (const u of urls) { name = nameFromUrl(u); if (name) break; }
  if (name && name.length > 80) name = name.slice(0, 80);
  return { ...(coords || {}), name, url };
}

/** Extra adresregels uit gedeelde tekst (bv. Google Maps: naam + adres + link) om op te zoeken. */
export function searchQueryFromText(text) {
  const urls = String(text || '').match(/https?:\/\/\S+/g) || [];
  const lines = urls.reduce((s, u) => s.replace(u, ' '), String(text || '')).split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) return lines.slice(0, 2).join(', ');
  for (const u of urls) { const n = nameFromUrl(u); if (n) return n; }
  return '';
}
