// Geografische hulpfuncties: afstand, richting, reistijd.

const R = 6371; // aardstraal in km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Afstand in km tussen twee punten (haversine). */
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kompasrichting (0 = noord, 90 = oost) van a naar b. */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Punt op afstand km in kompasrichting vanaf p. */
export function destination(p, bearingDeg, km) {
  const d = km / R;
  const b = rad(bearingDeg);
  const lat1 = rad(p.lat);
  const lon1 = rad(p.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/** Kleinste hoekverschil tussen twee kompasrichtingen (0..180). */
export function angleDiff(a, b) {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** SunCalc-azimut (radialen, vanaf zuid, west positief) naar kompasgraden. */
export function sunCalcAzimuthToCompass(azRad) {
  return (deg(azRad) + 180 + 360) % 360;
}

const COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO', 'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW'];
export function compassLabel(degrees) {
  return COMPASS[Math.round(degrees / 22.5) % 16];
}

/**
 * Geschatte rijtijd in minuten. Hemelsbrede afstand x omrijfactor / gemiddelde snelheid.
 */
export function travelMinutes(km, avgSpeedKmh = 60, detourFactor = 1.3) {
  return Math.round(((km * detourFactor) / avgSpeedKmh) * 60);
}

export function formatKm(km) {
  if (km == null || Number.isNaN(km)) return '–';
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function formatMinutes(min) {
  if (min == null) return '–';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} u ${m} min` : `${h} u`;
}
