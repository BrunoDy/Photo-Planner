// "Ontdek": foto's met coördinaten van Wikimedia Commons (vrije licenties, openbare API).

const API = 'https://commons.wikimedia.org/w/api.php';

const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/** Bestandsnaam → leesbare titel. */
export function titleFromFile(t) {
  return String(t || '').replace(/^File:/, '').replace(/\.\w{2,5}$/, '').replace(/[_]+/g, ' ').replace(/\s*\(\d+\)$/, '').trim();
}

/**
 * Foto's rond een punt. De API staat een straal van maximaal 10 km toe.
 */
export async function photosNear(lat, lon, radiusM = 5000, limit = 80) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'geosearch', ggsnamespace: '6', ggslimit: String(limit),
    ggscoord: `${lat.toFixed(5)}|${lon.toFixed(5)}`, ggsradius: String(Math.round(Math.min(10000, Math.max(100, radiusM)))),
    prop: 'coordinates|imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '480',
    iiextmetadatafilter: 'Artist|LicenseShortName|ObjectName|ImageDescription',
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Commons gaf fout ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.info || json.error.code);
  return parseCommons(json);
}

export function parseCommons(json) {
  const pages = Object.values(json?.query?.pages || {});
  return pages.map((p) => {
    const ii = p.imageinfo?.[0];
    const c = p.coordinates?.[0];
    if (!ii || !c) return null;
    const m = ii.extmetadata || {};
    if (!/\.(jpe?g|png|webp|tiff?)$/i.test(p.title)) return null;
    return {
      id: p.pageid,
      lat: c.lat,
      lon: c.lon,
      title: stripHtml(m.ObjectName?.value) || titleFromFile(p.title),
      description: stripHtml(m.ImageDescription?.value).slice(0, 200),
      thumb: ii.thumburl || ii.url,
      page: ii.descriptionurl,
      artist: stripHtml(m.Artist?.value) || 'onbekend',
      license: stripHtml(m.LicenseShortName?.value) || '',
    };
  }).filter(Boolean);
}
