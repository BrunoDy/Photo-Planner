// Positie van de melkwegkern (het galactisch centrum, bij Sagittarius A*)
// en het venster waarin je hem kunt fotograferen.

const RA_GC = 266.405; // rechte klimming in graden (17u 45m 37s)
const DEC_GC = -29.008; // declinatie in graden
const rad = Math.PI / 180;

/** Greenwich Mean Sidereal Time in graden. */
function gmst(date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  return ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360;
}

/** Hoogte (°) en kompasrichting (°, 0 = noord) van een hemelobject. */
export function horizontal(date, lat, lon, raDeg = RA_GC, decDeg = DEC_GC) {
  const H = (gmst(date) + lon - raDeg) * rad;
  const phi = lat * rad;
  const dec = decDeg * rad;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { alt: alt / rad, az: ((az / rad) + 180 + 360) % 360 };
}

export const galacticCore = (date, lat, lon) => horizontal(date, lat, lon);

/** Hoogst mogelijke stand van de kern op deze breedte. */
export const coreMaxAltitude = (lat) => 90 - Math.abs(lat - DEC_GC);

/**
 * Venster in de nacht na `noon` waarin de kern boven `minAlt` staat terwijl het donker is.
 * @param {Date} noon lokale middag
 * @param {{lat:number, lon:number}} loc
 * @param {object} SunCalc
 * @returns {null | {start:number, end:number, best:number, bestAlt:number, bestAz:number,
 *   startAz:number, endAz:number, darkness:'astronomisch'|'nautisch', moonUp:boolean, moonFraction:number}}
 */
export function milkyWayWindow(noon, loc, SunCalc, { minAlt = 3, step = 10 } = {}) {
  const from = noon.getTime();
  const to = from + 24 * 3600000;
  const scan = (sunLimit) => {
    let win = null;
    for (let t = from; t <= to; t += step * 60000) {
      const d = new Date(t);
      const sunAlt = SunCalc.getPosition(d, loc.lat, loc.lon).altitude / rad;
      const core = galacticCore(d, loc.lat, loc.lon);
      if (sunAlt < sunLimit && core.alt > minAlt) {
        if (!win) win = { start: t, end: t, best: t, bestAlt: core.alt, bestAz: core.az, startAz: core.az, endAz: core.az };
        win.end = t;
        win.endAz = core.az;
        if (core.alt > win.bestAlt) Object.assign(win, { best: t, bestAlt: core.alt, bestAz: core.az });
      } else if (win) break; // één aaneengesloten venster per nacht
    }
    return win;
  };
  let win = scan(-18);
  let darkness = 'astronomisch';
  if (!win) { win = scan(-12); darkness = 'nautisch'; }
  if (!win) return null;
  const bd = new Date(win.best);
  const moonUp = SunCalc.getMoonPosition(bd, loc.lat, loc.lon).altitude > 0;
  const moonFraction = SunCalc.getMoonIllumination(bd).fraction;
  return { ...win, darkness, moonUp, moonFraction };
}
