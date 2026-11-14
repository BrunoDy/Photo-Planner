// Vereenvoudigde omtrek van België en een raster van punten erbinnen
// (voor de weerkaart). Nauwkeurigheid ±2 km, ruim voldoende voor een weeroverzicht.

/** [lat, lon] in volgorde rond de grens. */
export const BE_OUTLINE = [
  [51.09, 2.54], [51.20, 2.85], [51.30, 3.10], [51.37, 3.37], [51.27, 3.53], [51.22, 3.78],
  [51.21, 3.98], [51.28, 4.10], [51.35, 4.24], [51.37, 4.40], [51.43, 4.54], [51.48, 4.77],
  [51.50, 4.85], [51.44, 4.92], [51.48, 5.04], [51.43, 5.10], [51.32, 5.14], [51.26, 5.24],
  [51.27, 5.42], [51.26, 5.56], [51.16, 5.80], [51.10, 5.85], [51.05, 5.80], [50.95, 5.73],
  [50.86, 5.64], [50.80, 5.68], [50.76, 5.90], [50.75, 6.02], [50.72, 6.12], [50.62, 6.27],
  [50.52, 6.17], [50.49, 6.34], [50.37, 6.40], [50.32, 6.32], [50.13, 6.13], [50.17, 6.03],
  [50.05, 5.86], [49.90, 5.76], [49.80, 5.75], [49.69, 5.90], [49.55, 5.82], [49.50, 5.47],
  [49.62, 5.31], [49.69, 5.08], [49.80, 4.87], [49.95, 4.85], [50.10, 4.88], [50.15, 4.82],
  [50.08, 4.70], [49.99, 4.70], [49.95, 4.43], [49.98, 4.15], [50.13, 4.13], [50.27, 4.22],
  [50.35, 4.02], [50.30, 3.71], [50.45, 3.67], [50.50, 3.60], [50.53, 3.29], [50.70, 3.17],
  [50.78, 3.02], [50.77, 2.87], [50.72, 2.84], [50.81, 2.63], [50.95, 2.60], [51.09, 2.54],
];

/** Ray casting: ligt punt (lat, lon) binnen de polygoon? */
export function inPolygon(lat, lon, poly = BE_OUTLINE) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Rastercellen over België. Een cel wordt meegenomen als haar midden of een
 * hoekpunt binnen de grens ligt, zodat ook de randen gedekt zijn.
 */
export function gridCells(dLat = 0.15, dLon = 0.22) {
  const cells = [];
  for (let lat = 49.45; lat <= 51.55; lat += dLat) {
    for (let lon = 2.5; lon <= 6.45; lon += dLon) {
      const s = lat - dLat / 2, n = lat + dLat / 2, w = lon - dLon / 2, e = lon + dLon / 2;
      const pts = [[lat, lon], [s, w], [s, e], [n, w], [n, e]];
      if (pts.some(([a, b]) => inPolygon(a, b))) {
        cells.push({ lat: +lat.toFixed(3), lon: +lon.toFixed(3), south: s, north: n, west: w, east: e });
      }
    }
  }
  return cells;
}

/** Rechthoekig raster over (en net rond) België, rij voor rij van zuid naar noord. */
export function gridRect(dLat = 0.15, dLon = 0.2) {
  const lats = [];
  const lons = [];
  for (let lat = 49.4; lat <= 51.62; lat += dLat) lats.push(+lat.toFixed(3));
  for (let lon = 2.45; lon <= 6.5; lon += dLon) lons.push(+lon.toFixed(3));
  const points = [];
  for (const lat of lats) for (const lon of lons) points.push({ lat, lon });
  return { lats, lons, dLat, dLon, points };
}
