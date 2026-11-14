// Koppelt locaties + zonnestand (SunCalc) + weersverwachting tot concrete "kansen".

import { scoreFog, scoreSky, scoreStars, scoreSoftLight } from './scoring.js';
import { hourAt, hoursBetween } from './weather.js';
import { sunCalcAzimuthToCompass, angleDiff, compassLabel } from './geo.js';
import { milkyWayWindow } from './astro.js';

const SC = () => globalThis.SunCalc;
const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const HOUR = 3600 * 1000;
export const ALIGN_TOLERANCE = 20; // graden

/** Lokale middag van de dag `offset` dagen na `base`. */
export function dayNoon(base, offset = 0) {
  const d = new Date(base);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

/** Zon- en maaninformatie voor één dag op één locatie. */
export function sunInfo(dateNoon, loc) {
  const t = SC().getTimes(dateNoon, loc.lat, loc.lon);
  const az = (d) => (valid(d) ? sunCalcAzimuthToCompass(SC().getPosition(d, loc.lat, loc.lon).azimuth) : null);
  const moonTimes = SC().getMoonTimes(dateNoon, loc.lat, loc.lon);
  const moonIll = SC().getMoonIllumination(dateNoon);
  const moonAz = (d) => (valid(d) ? sunCalcAzimuthToCompass(SC().getMoonPosition(d, loc.lat, loc.lon).azimuth) : null);
  return {
    times: t,
    sunriseAz: az(t.sunrise),
    sunsetAz: az(t.sunset),
    moonrise: moonTimes.rise ?? null,
    moonset: moonTimes.set ?? null,
    moonriseAz: moonAz(moonTimes.rise),
    moonsetAz: moonAz(moonTimes.set),
    moonFraction: moonIll.fraction,
    moonPhase: moonIll.phase,
  };
}

export function moonPhaseName(phase) {
  if (phase < 0.03 || phase > 0.97) return 'Nieuwe maan';
  if (phase < 0.22) return 'Wassende sikkel';
  if (phase < 0.28) return 'Eerste kwartier';
  if (phase < 0.47) return 'Wassende maan';
  if (phase < 0.53) return 'Volle maan';
  if (phase < 0.72) return 'Afnemende maan';
  if (phase < 0.78) return 'Laatste kwartier';
  return 'Afnemende sikkel';
}

function alignment(loc, azimuth) {
  if (loc.direction == null || loc.direction === '' || azimuth == null) return null;
  return angleDiff(Number(loc.direction), azimuth);
}

/** Uitlijningsbonus: zon (bijna) in de kijkrichting van de locatie. */
function applyAlignment(result, loc, azimuth, label) {
  const diff = alignment(loc, azimuth);
  if (diff == null) return result;
  if (diff <= ALIGN_TOLERANCE) {
    result.reasons.unshift({ text: `${label} in je kijkrichting (${Math.round(diff)}° ernaast)`, good: true });
    result.score = Math.min(1, result.score + 0.1 * (1 - diff / ALIGN_TOLERANCE));
  } else {
    result.reasons.push({ text: `${label} ${Math.round(diff)}° naast je kijkrichting`, good: false });
  }
  result.alignDiff = diff;
  return result;
}

/**
 * Alle kansen voor één locatie op één dag.
 * @param {object} loc locatie met tags[]
 * @param {object[]} hours weersverwachting per uur
 * @param {Date} noon lokale middag van die dag
 */
export function opportunitiesForDay(loc, hours, noon) {
  const out = [];
  const info = sunInfo(noon, loc);
  const t = info.times;
  const tags = new Set(loc.tags || []);
  const push = (cond, time, res, extra = {}) => {
    out.push({ id: `${loc.id}|${cond}|${time}`, locId: loc.id, cond, time, score: res.score, reasons: res.reasons, ...extra });
  };

  if (valid(t.sunrise)) {
    const h = hourAt(hours, t.sunrise.getTime());
    if (h && tags.has('zonsopkomst')) {
      push('zonsopkomst', t.sunrise.getTime(), applyAlignment(scoreSky(h), loc, info.sunriseAz, 'Zon'), { hour: h, azimuth: info.sunriseAz, arriveBy: valid(t.dawn) ? t.dawn.getTime() : null });
    }
    if (h && tags.has('mist')) {
      const prev = SC().getTimes(new Date(noon.getTime() - 24 * HOUR), loc.lat, loc.lon);
      const from = valid(prev.sunset) ? prev.sunset.getTime() : t.sunrise.getTime() - 12 * HOUR;
      const night = hoursBetween(hours, from, t.sunrise.getTime());
      push('mist', t.sunrise.getTime(), applyAlignment(scoreFog(h, night), loc, info.sunriseAz, 'Opkomende zon'), { hour: h, azimuth: info.sunriseAz, arriveBy: valid(t.dawn) ? t.dawn.getTime() : null });
    }
  }

  if (valid(t.sunset) && tags.has('zonsondergang')) {
    const h = hourAt(hours, t.sunset.getTime());
    if (h) {
      push('zonsondergang', t.sunset.getTime(), applyAlignment(scoreSky(h), loc, info.sunsetAz, 'Zon'), { hour: h, azimuth: info.sunsetAz, arriveBy: valid(t.goldenHour) ? t.goldenHour.getTime() : t.sunset.getTime() - HOUR });
    }
  }

  if (tags.has('sterren')) {
    const next = SC().getTimes(new Date(noon.getTime() + 24 * HOUR), loc.lat, loc.lon);
    let start = t.night;
    let end = next.nightEnd;
    let partial = false;
    if (!valid(start) || !valid(end) || end <= start) {
      start = t.nauticalDusk;
      end = next.nauticalDawn;
      partial = true;
    }
    if (valid(start) && valid(end) && end > start) {
      const nightHours = hoursBetween(hours, start.getTime(), end.getTime()).map((h) => {
        const d = new Date(h.t);
        return {
          ...h,
          moonUp: SC().getMoonPosition(d, loc.lat, loc.lon).altitude > 0,
          moonFraction: SC().getMoonIllumination(d).fraction,
        };
      });
      if (nightHours.length) {
        const res = scoreStars(nightHours);
        if (partial) res.reasons.push({ text: 'Geen astronomische nacht (zomer): hemel nooit helemaal donker', good: false });
        push('sterren', res.best.t, res, { hour: res.best, nightStart: start.getTime(), nightEnd: end.getTime() });
      }
    }
  }

  if (tags.has('melkweg')) {
    const mw = milkyWayWindow(noon, loc, SC());
    if (mw) {
      // Uren in het venster (ruim genomen, zodat er altijd minstens één weeruur is).
      const nightHours = hoursBetween(hours, mw.start - 30 * 60000, mw.end + 30 * 60000).map((h) => {
        const d = new Date(h.t);
        return { ...h, moonUp: SC().getMoonPosition(d, loc.lat, loc.lon).altitude > 0, moonFraction: SC().getMoonIllumination(d).fraction };
      });
      if (nightHours.length) {
        const res = scoreStars(nightHours);
        // Lage kern: nevel en lichtkoepels aan de horizon wegen zwaarder door.
        res.score *= 0.55 + 0.45 * Math.min(1, mw.bestAlt / 10);
        res.reasons.unshift({ text: `Kern max. ${Math.round(mw.bestAlt)}° hoog richting ${Math.round(mw.bestAz)}° ${compassLabel(mw.bestAz)}`, good: mw.bestAlt >= 6 });
        if (mw.darkness === 'nautisch') res.reasons.push({ text: 'Geen volledig donkere nacht (zomer)', good: false });
        applyAlignment(res, loc, mw.bestAz, 'Melkwegkern');
        push('melkweg', mw.best, res, { hour: res.best, azimuth: mw.bestAz, arriveBy: mw.start - 30 * 60000, mw });
      }
    }
  }

  if (tags.has('zachtlicht') && valid(t.goldenHourEnd) && valid(t.goldenHour)) {
    const day = hoursBetween(hours, t.goldenHourEnd.getTime(), t.goldenHour.getTime());
    let best = null;
    for (const h of day) {
      const res = scoreSoftLight(h);
      if (!best || res.score > best.res.score) best = { h, res };
    }
    if (best) push('zachtlicht', best.h.t, best.res, { hour: best.h });
  }

  return out;
}

/** Kansen voor alle locaties over meerdere dagen, gesorteerd op score. */
export function allOpportunities(locations, forecastLookup, { days = 3, now = new Date() } = {}) {
  const res = [];
  for (const loc of locations) {
    const hours = forecastLookup(loc);
    if (!hours || !hours.length) continue;
    for (let d = 0; d < days; d++) {
      for (const o of opportunitiesForDay(loc, hours, dayNoon(now, d))) {
        if (o.time >= now.getTime() - HOUR) res.push(o);
      }
    }
  }
  return res.sort((a, b) => b.score - a.score || a.time - b.time);
}
