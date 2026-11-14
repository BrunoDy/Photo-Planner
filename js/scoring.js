// Scoremodellen: hoe goed passen de weersomstandigheden bij een fotoconditie?
// Alle functies zijn puur (geen DOM, geen netwerk) zodat ze los te testen zijn.
//
// Een "uur" (hour) heeft de vorm:
// { t, temp, dew, rh, cc, low, mid, high, vis, wind, gust, precip, pop }
// temp/dew in °C, rh/cc/low/mid/high/pop in %, vis in m, wind/gust in km/u, precip in mm.
// Elke functie geeft { score: 0..1, reasons: [{ text, good }] }.

export const CONDITIONS = {
  mist: { label: 'Mist', icon: '🌫️', hint: 'Bossen, rivieren, velden, vallei' },
  zonsopkomst: { label: 'Zonsopkomst', icon: '🌅', hint: 'Open horizon naar het oosten' },
  zonsondergang: { label: 'Zonsondergang', icon: '🌇', hint: 'Open horizon naar het westen' },
  sterren: { label: 'Sterren', icon: '✨', hint: 'Donkere plek zonder lichtvervuiling' },
  zachtlicht: { label: 'Zacht licht', icon: '☁️', hint: 'Bos, watervallen, portret: bewolkt is ideaal' },
};

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** 0 bij x<=a, 1 bij x>=b, lineair ertussen. */
export const ramp = (x, a, b) => clamp01((x - a) / (b - a));
const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
const r1 = (x) => Math.round(x * 10) / 10;

function rainFactor(h, start = 0.2, end = 2) {
  return 1 - ramp(h.precip ?? 0, start, end) * 0.8;
}

/**
 * Mist bij zonsopkomst. Stralingsmist ontstaat bij: kleine dauwpuntspreiding,
 * weinig wind en een heldere nacht (afkoeling). Lage zichtwaarden bevestigen het.
 * @param {object} h uur rond zonsopkomst
 * @param {object[]} night uren van de voorafgaande nacht
 */
export function scoreFog(h, night = []) {
  const reasons = [];
  const spread = h.temp - h.dew;
  const sSpread = 1 - ramp(spread, 0.5, 4);
  reasons.push({ text: `Dauwpuntspreiding ${r1(spread)} °C`, good: spread <= 1.5 });

  const sWind = 1 - ramp(h.wind, 4, 15);
  reasons.push({ text: h.wind <= 6 ? `Windstil (${Math.round(h.wind)} km/u)` : `Wind ${Math.round(h.wind)} km/u`, good: h.wind <= 8 });

  const nightCloud = avg(night.map((n) => n.cc));
  const sClear = nightCloud == null ? 0.5 : 1 - ramp(nightCloud, 20, 90);
  if (nightCloud != null) {
    reasons.push({ text: nightCloud < 40 ? `Heldere nacht (${Math.round(nightCloud)}% bewolking)` : `Bewolkte nacht (${Math.round(nightCloud)}%)`, good: nightCloud < 40 });
  }

  let sVis = 0.4;
  if (h.vis != null) {
    sVis = 1 - ramp(h.vis, 1000, 15000);
    reasons.push({ text: `Zicht ${h.vis < 1000 ? Math.round(h.vis) + ' m' : r1(h.vis / 1000) + ' km'}`, good: h.vis < 5000 });
  }

  let score = 0.35 * sSpread + 0.25 * sWind + 0.2 * sClear + 0.2 * sVis;
  if (h.vis != null && h.vis < 1000) score = Math.max(score, 0.85);
  score *= rainFactor(h);
  if ((h.precip ?? 0) > 0.2) reasons.push({ text: `Neerslag ${r1(h.precip)} mm`, good: false });
  return { score: clamp01(score), reasons };
}

/**
 * Kleurrijke lucht bij zonsopkomst/-ondergang: middelhoge en hoge bewolking
 * (30–70%) vangt het licht, lage bewolking blokkeert de zon aan de horizon.
 */
export function scoreSky(h) {
  const reasons = [];
  const upper = Math.max(h.mid ?? 0, h.high ?? 0);
  let sUpper;
  if (upper <= 40) sUpper = 0.45 + 0.55 * ramp(upper, 10, 40);
  else if (upper <= 70) sUpper = 1;
  else sUpper = 1 - 0.85 * ramp(upper, 70, 100);
  reasons.push({
    text: upper < 15 ? 'Strakblauwe lucht (mooi licht, weinig kleur)' : upper <= 75 ? `Hoge/middelhoge wolken ${Math.round(upper)}% — kans op kleur` : `Dichte hoge bewolking ${Math.round(upper)}%`,
    good: upper >= 20 && upper <= 75,
  });

  const low = h.low ?? 0;
  const sLow = 1 - ramp(low, 20, 85);
  reasons.push({ text: low < 30 ? `Weinig lage bewolking (${Math.round(low)}%)` : `Lage bewolking ${Math.round(low)}% kan de zon blokkeren`, good: low < 30 });

  const score = sUpper * (0.25 + 0.75 * sLow) * rainFactor(h, 0.1, 1.5);
  if ((h.precip ?? 0) > 0.1) reasons.push({ text: `Neerslag ${r1(h.precip)} mm`, good: false });
  return { score: clamp01(score), reasons };
}

/**
 * Sterrenhemel: per nachtuur (enkel echt donkere uren) een score op basis van
 * bewolking, maan en vochtigheid. Geeft het beste uur terug.
 * @param {object[]} hours nachturen met extra velden moonUp (bool) en moonFraction (0..1)
 */
export function scoreStars(hours) {
  if (!hours.length) return { score: 0, reasons: [{ text: 'Geen echt donkere uren', good: false }], best: null };
  let best = null;
  for (const h of hours) {
    const sCloud = (1 - h.cc / 100) ** 1.5;
    const sMoon = h.moonUp ? 1 - 0.8 * h.moonFraction : 1;
    const sHum = 1 - 0.3 * ramp(h.rh, 85, 100);
    const s = sCloud * sMoon * sHum;
    if (!best || s > best.s) best = { s, h };
  }
  const h = best.h;
  const reasons = [
    { text: `Bewolking ${Math.round(h.cc)}%`, good: h.cc < 25 },
    h.moonUp
      ? { text: `Maan op (${Math.round(h.moonFraction * 100)}% verlicht)`, good: h.moonFraction < 0.3 }
      : { text: 'Maan onder de horizon', good: true },
  ];
  if (h.rh >= 90) reasons.push({ text: `Hoge vochtigheid ${Math.round(h.rh)}% (dauw op lens!)`, good: false });
  return { score: clamp01(best.s), reasons, best: h };
}

/** Zacht, diffuus licht: egale bewolking zonder (veel) regen. */
export function scoreSoftLight(h) {
  const reasons = [];
  const sCover = ramp(h.cc, 55, 95);
  reasons.push({ text: `Bewolking ${Math.round(h.cc)}%`, good: h.cc >= 75 });
  const score = sCover * rainFactor(h, 0.3, 2.5) * (1 - 0.4 * ramp(h.wind, 20, 45));
  if ((h.precip ?? 0) > 0.3) reasons.push({ text: `Neerslag ${r1(h.precip)} mm`, good: false });
  if (h.wind > 20) reasons.push({ text: `Wind ${Math.round(h.wind)} km/u (bewegende bladeren)`, good: false });
  return { score: clamp01(score), reasons };
}

export function scoreLabel(score) {
  if (score >= 0.75) return 'Top';
  if (score >= 0.55) return 'Goed';
  if (score >= 0.35) return 'Matig';
  return 'Slecht';
}
