import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { galacticCore, coreMaxAltitude, milkyWayWindow, horizontal } from '../js/astro.js';

const require = createRequire(import.meta.url);
const SunCalc = require('../vendor/suncalc.js');
globalThis.SunCalc = SunCalc;
const brussel = { lat: 50.85, lon: 4.35 };

test('kern komt in België maximaal ~10° boven de horizon', () => {
  assert.ok(Math.abs(coreMaxAltitude(50.85) - 10.1) < 0.2);
  let max = -90;
  for (let h = 0; h < 24 * 6; h++) {
    const c = galacticCore(new Date(Date.UTC(2026, 6, 15, 0, h * 10)), brussel.lat, brussel.lon);
    max = Math.max(max, c.alt);
  }
  assert.ok(Math.abs(max - 10.1) < 0.5, `max ${max}`);
});

test('op de hoogste stand staat de kern in het zuiden', () => {
  let best = null;
  for (let m = 0; m < 24 * 60; m += 5) {
    const c = galacticCore(new Date(Date.UTC(2026, 6, 15, 0, m)), brussel.lat, brussel.lon);
    if (!best || c.alt > best.alt) best = c;
  }
  assert.ok(Math.abs(best.az - 180) < 3, `az ${best.az}`);
});

test('Vega (bijna in het zenit in België) controleert de omrekening', () => {
  // Vega: RA 279.23°, Dec +38.78°: max hoogte = 90 − (50.85 − 38.78) ≈ 77.9°
  let max = -90;
  for (let m = 0; m < 24 * 60; m += 5) max = Math.max(max, horizontal(new Date(Date.UTC(2026, 6, 15, 0, m)), 50.85, 4.35, 279.23, 38.78).alt);
  assert.ok(Math.abs(max - 77.9) < 0.5, `${max}`);
});

test('venster: zichtbaar eind augustus, niet in december', () => {
  const aug = milkyWayWindow(new Date('2026-08-20T12:00:00+02:00'), brussel, SunCalc);
  assert.ok(aug, 'augustus: kern zichtbaar');
  assert.ok(aug.bestAlt > 5 && aug.bestAlt < 11);
  assert.ok(aug.bestAz > 150 && aug.bestAz < 230);
  assert.ok(aug.end > aug.start);
  assert.equal(milkyWayWindow(new Date('2026-12-15T12:00:00+01:00'), brussel, SunCalc), null);
});

test('planner: melkwegkans met venster en richting', async () => {
  const { opportunitiesForDay, dayNoon } = await import('../js/planner.js');
  const noon = dayNoon(new Date('2026-08-20T12:00:00+02:00'));
  const hours = [];
  for (let t = noon.getTime() - 12 * 3600e3; t < noon.getTime() + 36 * 3600e3; t += 3600e3) {
    hours.push({ t, temp: 15, dew: 8, rh: 60, cc: 0, low: 0, mid: 0, high: 0, vis: 30000, wind: 5, precip: 0 });
  }
  const loc = { id: 'm', lat: 50.25, lon: 5.6, tags: ['melkweg'], direction: 185 };
  const [o] = opportunitiesForDay(loc, hours, noon);
  assert.equal(o.cond, 'melkweg');
  assert.ok(o.score > 0.5, `score ${o.score}`);
  assert.ok(o.reasons[0].text.includes('kijkrichting') || o.reasons.some((r) => r.text.startsWith('Kern max')));
  assert.ok(o.mw.start <= o.time && o.time <= o.mw.end);
});

test('vooruitzicht: eerstvolgende mist en andere condities', async () => {
  const { locationOutlook } = await import('../js/planner.js');
  const now = new Date('2026-11-14T10:00:00+01:00');
  const hours = [];
  for (let t = now.getTime() - 24 * 3600e3; t < now.getTime() + 8 * 24 * 3600e3; t += 3600e3) {
    const day = Math.floor((t - now.getTime()) / 86400e3);
    const hr = new Date(t).getUTCHours();
    const night = hr < 8 || hr > 16;
    // Dag 2 (overmorgen): windstil, verzadigd, helder → mist bij zonsopkomst.
    const foggy = day === 1 && night;
    hours.push({ t, temp: 6, dew: foggy ? 5.8 : 0, rh: foggy ? 99 : 65, cc: foggy ? 5 : 95, low: 90, mid: 90, high: 90, vis: foggy ? 300 : 20000, wind: foggy ? 2 : 25, precip: 0 });
  }
  const o = locationOutlook({ id: 'x', lat: 50.85, lon: 4.35 }, hours, { now });
  assert.equal(o.days.length, 7);
  assert.ok(o.conds.mist.next, 'mist gevonden');
  assert.ok(new Date(o.conds.mist.next.time).getDate() === 16, `mist op ${new Date(o.conds.mist.next.time)}`);
  assert.ok(o.conds.zachtlicht.next, 'bewolkte dag → zacht licht');
  assert.ok(o.conds.sterren.next && o.conds.sterren.next.hour.cc === 5, 'enkel de heldere mistnacht geeft sterren');
  assert.equal(o.conds.melkweg.next, null, 'november: geen melkweg');
});
