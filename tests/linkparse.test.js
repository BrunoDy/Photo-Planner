import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocationText, searchQueryFromText } from '../js/linkparse.js';

const near = (a, b) => Math.abs(a - b) < 1e-4;

test('decimale coördinaten', () => {
  const r = parseLocationText('50.776123, 3.633456');
  assert.ok(near(r.lat, 50.776123) && near(r.lon, 3.633456));
  const r2 = parseLocationText('50,7761 3,6334');
  assert.ok(near(r2.lat, 50.7761) && near(r2.lon, 3.6334));
});

test('graden-minuten-seconden, ook O en Z', () => {
  const r = parseLocationText(`50°46'33.6"N 3°37'58.8"E`);
  assert.ok(near(r.lat, 50.776) && Math.abs(r.lon - 3.633) < 1e-3);
  const r2 = parseLocationText(`50°46'33"N 3°37'58"O`);
  assert.ok(r2.lon > 3.6);
});

test('Google Maps-links', () => {
  const r = parseLocationText('https://www.google.com/maps/place/Kluisbos/@50.7700,3.6200,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d50.776!4d3.633');
  assert.equal(r.name, 'Kluisbos');
  assert.ok(near(r.lat, 50.776) && near(r.lon, 3.633), 'gebruikt !3d!4d i.p.v. kaartcentrum');
  const r2 = parseLocationText('https://maps.google.com/?q=51.0543,3.7174');
  assert.ok(near(r2.lat, 51.0543));
  const r3 = parseLocationText('https://www.google.com/maps/search/?api=1&query=50.85%2C4.35');
  assert.ok(near(r3.lon, 4.35));
});

test('Apple Maps, OSM, geo:', () => {
  assert.ok(near(parseLocationText('https://maps.apple.com/?ll=50.5,6.09&q=Signal%20de%20Botrange').lat, 50.5));
  assert.equal(parseLocationText('https://maps.apple.com/?ll=50.5,6.09&q=Signal%20de%20Botrange').name, 'Signal de Botrange');
  assert.ok(near(parseLocationText('https://www.openstreetmap.org/?mlat=50.67&mlon=4.27#map=15/50.67/4.27').lon, 4.27));
  assert.ok(near(parseLocationText('https://www.openstreetmap.org/#map=14/50.8500/4.3500').lat, 50.85));
  assert.ok(near(parseLocationText('geo:50.1,5.2?q=x').lat, 50.1));
});

test('gedeelde tekst zonder coördinaten geeft naam en zoekterm', () => {
  const text = 'Hallerbos\nVlaams-Brabant, België\nhttps://maps.app.goo.gl/AbCdEf123';
  const r = parseLocationText(text);
  assert.equal(r.lat, undefined);
  assert.equal(r.name, 'Hallerbos');
  assert.equal(r.url, 'https://maps.app.goo.gl/AbCdEf123');
  assert.equal(searchQueryFromText(text), 'Hallerbos, Vlaams-Brabant, België');
});

test('naam uit URL-pad (bv. fotolocatiesite)', () => {
  const r = parseLocationText('https://www.locationscout.net/belgium/12345-castle-of-vianden-viewpoint');
  assert.equal(r.name, 'Castle of vianden viewpoint');
  assert.equal(r.lat, undefined);
});

test('Commons-antwoord omzetten', async () => {
  const { parseCommons, titleFromFile } = await import('../js/commons.js');
  assert.equal(titleFromFile('File:Hallerbos_in_bloom_(2).jpg'), 'Hallerbos in bloom');
  const r = parseCommons({ query: { pages: {
    1: { pageid: 1, title: 'File:Kluisbos_mist.jpg', coordinates: [{ lat: 50.77, lon: 3.63 }],
      imageinfo: [{ thumburl: 'https://x/t.jpg', descriptionurl: 'https://c/File:K', extmetadata: { Artist: { value: '<a href="x">Jan</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
    2: { pageid: 2, title: 'File:Map.svg', coordinates: [{ lat: 1, lon: 1 }], imageinfo: [{ url: 'u' }] },
    3: { pageid: 3, title: 'File:Nocoord.jpg', imageinfo: [{ url: 'u' }] },
  } } });
  assert.equal(r.length, 1);
  assert.equal(r[0].artist, 'Jan');
  assert.equal(r[0].title, 'Kluisbos mist');
});
