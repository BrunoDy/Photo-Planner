import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { scoreFog, scoreSky, scoreStars, scoreSoftLight } from '../js/scoring.js';
import { distanceKm, angleDiff, sunCalcAzimuthToCompass, travelMinutes } from '../js/geo.js';

const require = createRequire(import.meta.url);
globalThis.SunCalc = require('../vendor/suncalc.js');
const { opportunitiesForDay, dayNoon, sunInfo } = await import('../js/planner.js');

const base = { temp: 5, dew: 4.5, rh: 97, cc: 10, low: 10, mid: 0, high: 0, vis: 24000, wind: 3, precip: 0 };
const h = (o) => ({ ...base, ...o });

test('mist: windstil, verzadigd, heldere nacht scoort hoog', () => {
  const night = Array.from({ length: 10 }, () => h({ cc: 5 }));
  const r = scoreFog(h({ vis: 400 }), night);
  assert.ok(r.score >= 0.85, `score ${r.score}`);
});

test('mist: droge lucht en wind scoort laag', () => {
  const r = scoreFog(h({ temp: 12, dew: 3, rh: 55, wind: 25 }), [h({ cc: 90 })]);
  assert.ok(r.score < 0.2, `score ${r.score}`);
});

test('zonsondergang: hoge wolken zonder lage bewolking is beter dan bewolkt', () => {
  const good = scoreSky(h({ high: 50, mid: 30, low: 5 }));
  const clear = scoreSky(h({ high: 0, mid: 0, low: 0 }));
  const overcast = scoreSky(h({ low: 100, mid: 100, high: 100, cc: 100 }));
  assert.ok(good.score > 0.8);
  assert.ok(clear.score > overcast.score);
  assert.ok(good.score > clear.score);
  assert.ok(overcast.score < 0.1);
});

test('sterren: maan op verlaagt de score, bewolking nog meer', () => {
  const dark = scoreStars([h({ cc: 0, rh: 70, moonUp: false, moonFraction: 1 })]);
  const moon = scoreStars([h({ cc: 0, rh: 70, moonUp: true, moonFraction: 1 })]);
  const cloudy = scoreStars([h({ cc: 95, rh: 70, moonUp: false, moonFraction: 0 })]);
  assert.ok(dark.score > 0.9);
  assert.ok(moon.score < dark.score);
  assert.ok(cloudy.score < 0.05);
});

test('zacht licht: egaal bewolkt zonder regen', () => {
  assert.ok(scoreSoftLight(h({ cc: 100, wind: 5 })).score > 0.9);
  assert.ok(scoreSoftLight(h({ cc: 10 })).score === 0);
});

test('geo: afstand Gent–Brussel ±50 km, hoeken', () => {
  const d = distanceKm({ lat: 51.054, lon: 3.717 }, { lat: 50.846, lon: 4.352 });
  assert.ok(d > 45 && d < 52, `${d}`);
  assert.equal(angleDiff(350, 10), 20);
  assert.equal(sunCalcAzimuthToCompass(0), 180);
  assert.equal(travelMinutes(46, 60, 1.3), 60);
});

test('planner: maakt kansen voor gelabelde condities met zonazimut', () => {
  const loc = { id: 'x', name: 'Test', lat: 51.0, lon: 4.0, tags: ['mist', 'zonsondergang', 'sterren', 'zachtlicht'], direction: 230 };
  const noon = dayNoon(new Date('2026-11-14T12:00:00'));
  const hours = [];
  for (let t = noon.getTime() - 36 * 3600e3; t < noon.getTime() + 36 * 3600e3; t += 3600e3) hours.push(h({ t, cc: 80, high: 40 }));
  const opps = opportunitiesForDay(loc, hours, noon);
  const conds = opps.map((o) => o.cond).sort();
  assert.deepEqual(conds, ['mist', 'sterren', 'zachtlicht', 'zonsondergang']);
  const sunset = opps.find((o) => o.cond === 'zonsondergang');
  // In november gaat de zon in België onder richting zuidwest (~235°).
  assert.ok(sunset.azimuth > 220 && sunset.azimuth < 250, `${sunset.azimuth}`);
  assert.ok(sunset.reasons[0].text.includes('kijkrichting'));
});

test('weerkaart: classificatie en raster over België', async () => {
  const { classifySky } = await import('../js/weather.js');
  const { inPolygon, gridCells } = await import('../js/belgium.js');
  assert.equal(classifySky(5, 0, 0), 'helder');
  assert.equal(classifySky(40, 0, 2), 'licht');
  assert.equal(classifySky(95, 0, 3), 'zwaar');
  assert.equal(classifySky(30, 0.4, 61), 'neerslag');
  assert.ok(inPolygon(50.85, 4.35), 'Brussel ligt in België');
  assert.ok(inPolygon(51.05, 3.72), 'Gent ligt in België');
  assert.ok(inPolygon(49.68, 5.82) || inPolygon(49.7, 5.6), 'Aarlen-streek');
  assert.ok(!inPolygon(48.85, 2.35), 'Parijs niet');
  assert.ok(!inPolygon(52.37, 4.9), 'Amsterdam niet');
  const cells = gridCells();
  assert.ok(cells.length > 80 && cells.length < 250, `${cells.length} cellen`);
});

test('planner: maanrichting bij op- en ondergang', () => {
  const info = sunInfo(dayNoon(new Date('2026-11-20T12:00:00')), { lat: 50.85, lon: 4.35 });
  for (const k of ['moonrise', 'moonset']) {
    if (info[k]) assert.ok(info[k + 'Az'] > 0 && info[k + 'Az'] < 360);
  }
  assert.ok(info.moonrise || info.moonset);
});
