import * as store from './store.js';
import { CONDITIONS, scoreLabel } from './scoring.js';
import { getForecasts, forecastFor, clearWeatherCache, getGridForecast, classifySky, SKY_CLASSES } from './weather.js';
import { BE_OUTLINE, gridCells } from './belgium.js';
import { allOpportunities, opportunitiesForDay, sunInfo, moonPhaseName, dayNoon, ALIGN_TOLERANCE } from './planner.js';
import { distanceKm, travelMinutes, formatKm, formatMinutes, compassLabel, destination, angleDiff } from './geo.js';

// ---------- Toestand ----------
const state = {
  locations: store.getLocations(),
  settings: store.getSettings(),
  here: null,
  forecasts: new Map(),
  opps: [],
  condFilter: 'all',
  tagFilter: 'all',
  editing: null, // locatie in dialoog
  pickHome: false,
  addMode: false,
  pendingFocus: null,
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtTime = (t) => new Date(t).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (t) => {
  const d = new Date(t);
  const today = dayNoon(new Date());
  const diff = Math.round((dayNoon(d) - today) / 86400000);
  if (diff === 0) return 'Vandaag';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gisteren';
  return d.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
};
const scoreClass = (s) => (s >= 0.75 ? 's-top' : s >= 0.55 ? 's-good' : s >= 0.35 ? 's-mid' : 's-low');
const scoreColor = (s) => getComputedStyle(document.documentElement).getPropertyValue(`--${scoreClass(s)}`).trim();

function toast(msg, ms = 2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), ms);
}
function setStatus(msg) { $('#status').textContent = msg; }

// ---------- Afstand ----------
function origin() {
  const s = state.settings;
  if (s.distanceFrom === 'home' && s.home) return s.home;
  return state.here || s.home || null;
}
function distanceTo(loc) {
  const o = origin();
  if (!o) return null;
  const km = distanceKm(o, loc);
  return { km, min: travelMinutes(km, state.settings.avgSpeed, state.settings.detour) };
}
function routeUrl(loc) {
  return `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lon}`;
}

function locateMe({ quiet = false } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { if (!quiet) toast('GPS niet beschikbaar'); return resolve(null); }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.here = { lat: p.coords.latitude, lon: p.coords.longitude };
        resolve(state.here);
      },
      () => { if (!quiet) toast('Kon je positie niet bepalen'); resolve(null); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

// ---------- Weer & kansen ----------
async function refreshWeather(force = false) {
  const locs = state.locations.filter((l) => (l.tags || []).length);
  if (!locs.length) { state.opps = []; renderAll(); return; }
  setStatus('Weer ophalen…');
  try {
    state.forecasts = await getForecasts(locs, { days: 7, force });
    setStatus(`Bijgewerkt ${fmtTime(Date.now())}`);
  } catch (e) {
    console.error(e);
    setStatus('Offline');
    toast('Weer ophalen mislukt: ' + e.message);
  }
  computeOpps();
  renderAll();
}
function computeOpps() {
  state.opps = allOpportunities(state.locations, (l) => forecastFor(state.forecasts, l), { days: 7 });
}
function bestOppFor(locId, withinDays = 3) {
  const limit = dayNoon(new Date(), withinDays).getTime() - 12 * 3600 * 1000;
  return state.opps.find((o) => o.locId === locId && o.time < limit) || null;
}

// ---------- Weergave: Kansen ----------
function renderCondChips() {
  const items = [['all', 'Alle'], ...Object.entries(CONDITIONS).map(([k, c]) => [k, `${c.icon} ${c.label}`])];
  $('#cond-chips').innerHTML = items.map(([k, l]) => `<button class="chip ${state.condFilter === k ? 'on' : ''}" data-cond="${k}">${l}</button>`).join('');
}

function oppCard(o) {
  const loc = state.locations.find((l) => l.id === o.locId);
  if (!loc) return '';
  const c = CONDITIONS[o.cond];
  const dist = distanceTo(loc);
  const pct = Math.round(o.score * 100);
  let target = o.arriveBy ?? o.time - 30 * 60000;
  let depart = dist ? target - (dist.min + 10) * 60000 : null;
  const whenLabel = o.cond === 'sterren' ? 'beste uur' : o.cond === 'zachtlicht' ? 'beste moment' : o.cond === 'zonsondergang' ? 'zonsondergang' : 'zonsopkomst';
  const reasons = o.reasons.slice(0, 5).map((r) => `<li class="${r.good ? 'good' : 'bad'}">${esc(r.text)}</li>`).join('');
  return `
  <article class="opp">
    <div class="score ${scoreClass(o.score)}"><div>${pct}<small>${scoreLabel(o.score)}</small></div></div>
    <div>
      <h3>${c.icon} ${c.label} · ${esc(loc.name)}</h3>
      <p class="when"><strong>${fmtDay(o.time)} ${fmtTime(o.time)}</strong> <span class="muted">(${whenLabel}${o.azimuth != null ? `, zon ${Math.round(o.azimuth)}° ${compassLabel(o.azimuth)}` : ''})</span></p>
      <p class="meta">${dist ? `${formatKm(dist.km)} · ±${formatMinutes(dist.min)} rijden · <strong>vertrek ${fmtTime(depart)}</strong>` : 'Afstand onbekend (stel je thuislocatie in)'}</p>
      <ul class="reasons">${reasons}</ul>
      <div class="actions">
        <a href="${routeUrl(loc)}" target="_blank" rel="noopener">🚗 Route</a>
        <button data-open="${loc.id}" data-date="${o.time}">Details</button>
      </div>
    </div>
  </article>`;
}

function renderOpps() {
  const list = $('#opp-list');
  if (!state.locations.length) {
    list.innerHTML = `<div class="empty"><h3>Nog geen locaties</h3><p>Voeg je droomplekken toe via <strong>Kaart</strong> of <strong>Locaties</strong> en geef ze labels zoals <em>Mist</em> of <em>Zonsondergang</em>. Dan zie je hier wanneer het weer er perfect voor is.</p><button class="primary" data-goto="kaart">Naar de kaart</button></div>`;
    return;
  }
  if (!state.locations.some((l) => (l.tags || []).length)) {
    list.innerHTML = `<div class="empty"><h3>Geef je locaties labels</h3><p>Open een locatie en vink aan waarvoor ze geschikt is (mist, zonsopkomst, sterren…).</p><button class="primary" data-goto="locaties">Naar locaties</button></div>`;
    return;
  }
  const days = Number($('#day-filter').value);
  const showLow = $('#show-low').checked;
  const now = new Date();
  let from = now.getTime() - 3600000;
  let to = dayNoon(now, Math.max(days, 1)).getTime() - 12 * 3600000;
  if (days === 1) { from = dayNoon(now, 1).getTime() - 12 * 3600000; to = dayNoon(now, 2).getTime() - 12 * 3600000; }
  const min = showLow ? 0 : state.settings.minScore / 100;
  const items = state.opps.filter((o) =>
    o.time >= from && o.time < to && o.score >= min && (state.condFilter === 'all' || o.cond === state.condFilter));
  if (!state.opps.length) {
    list.innerHTML = `<div class="empty"><h3>Geen weergegevens</h3><p>Controleer je internetverbinding en tik op ⟳.</p></div>`;
    return;
  }
  list.innerHTML = items.length
    ? items.map(oppCard).join('')
    : `<div class="empty"><h3>Geen goede kansen in deze periode</h3><p>Probeer een langere periode, een andere conditie of vink "Ook lage scores" aan.</p></div>`;
}

// ---------- Weergave: Locaties ----------
function renderTagChips() {
  const items = [['all', 'Alle'], ...Object.entries(CONDITIONS).map(([k, c]) => [k, `${c.icon} ${c.label}`]), ['none', 'Zonder label']];
  $('#tag-chips').innerHTML = items.map(([k, l]) => `<button class="chip ${state.tagFilter === k ? 'on' : ''}" data-tag="${k}">${l}</button>`).join('');
}

function renderLocations() {
  const q = $('#loc-search').value.trim().toLowerCase();
  let locs = state.locations.filter((l) => {
    if (q && !(`${l.name} ${l.notes || ''}`.toLowerCase().includes(q))) return false;
    if (state.tagFilter === 'none') return !(l.tags || []).length;
    if (state.tagFilter !== 'all') return (l.tags || []).includes(state.tagFilter);
    return true;
  }).map((l) => ({ l, d: distanceTo(l), best: bestOppFor(l.id) }));
  locs.sort((a, b) => (a.d && b.d ? a.d.km - b.d.km : a.l.name.localeCompare(b.l.name)));
  const list = $('#loc-list');
  if (!state.locations.length) {
    list.innerHTML = `<div class="empty"><h3>Nog geen locaties</h3><p>Tik op <strong>＋ Nieuw</strong> om je huidige positie op te slaan, of gebruik de kaart.</p></div>`;
    return;
  }
  list.innerHTML = locs.map(({ l, d, best }) => `
    <div class="loc" data-open="${l.id}" role="button" tabindex="0">
      <span class="dot" style="background:${best ? scoreColor(best.score) : 'var(--s-low)'}"></span>
      <div class="body">
        <div class="name">${esc(l.name)}</div>
        <div class="tags">${(l.tags || []).map((t) => CONDITIONS[t]?.icon + ' ' + CONDITIONS[t]?.label).join(' · ') || 'Geen labels'}</div>
        ${best ? `<div class="small muted">Beste kans: ${CONDITIONS[best.cond].label} ${fmtDay(best.time).toLowerCase()} ${fmtTime(best.time)} (${Math.round(best.score * 100)})</div>` : ''}
      </div>
      <div class="dist">${d ? `${formatKm(d.km)}<br><span class="small">±${formatMinutes(d.min)}</span>` : ''}</div>
    </div>`).join('') || `<div class="empty">Geen locaties gevonden.</div>`;
}

// ---------- Kaart ----------
let map = null;
let markerLayer = null;
let sunLayer = null;
let hereMarker = null;
let homeMarker = null;
let selectedLoc = null;
let lightLayer = null;

function syncLight() {
  const on = map.hasLayer(lightLayer);
  $('#btn-light').setAttribute('aria-pressed', String(on));
  $('#light-legend').hidden = !on;
  if (state.settings.lightPollution !== on) {
    state.settings.lightPollution = on;
    store.saveSettings(state.settings);
  }
}

function initMap() {
  if (map) return;
  const start = origin() || state.locations[0] || { lat: 50.85, lon: 4.35 };
  map = L.map('map', { zoomControl: false }).setView([start.lat, start.lon], state.locations.length ? 10 : 8);
  const layers = {
    Kaart: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }),
    Satelliet: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }),
    Topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' }),
  };
  const chosen = layers[state.settings.mapLayer] || layers.Kaart;
  chosen.addTo(map);
  // Lichtvervuiling: NASA VIIRS Black Marble (nachtelijke lichtuitstoot), gratis via NASA GIBS.
  lightLayer = L.tileLayer(
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
    { maxNativeZoom: 8, maxZoom: 19, opacity: 0.7, attribution: 'Nachtlicht © NASA Black Marble', className: 'light-tiles' },
  );
  L.control.layers(layers, { Lichtvervuiling: lightLayer }, { position: 'topright' }).addTo(map);
  map.on('baselayerchange', (e) => { state.settings.mapLayer = e.name; store.saveSettings(state.settings); });
  map.on('overlayadd overlayremove', (e) => { if (e.layer === lightLayer) syncLight(); });
  if (state.settings.lightPollution) lightLayer.addTo(map);
  syncLight();
  markerLayer = L.layerGroup().addTo(map);
  sunLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (state.pickHome) {
      const first = !state.settings.home;
      state.pickHome = false;
      setHint('');
      finishSetup({ lat: e.latlng.lat, lon: e.latlng.lng, label: 'Gekozen op kaart' });
      if (!first) switchView('instellingen');
      return;
    }
    if (state.addMode) {
      setAddMode(false);
      openLocation({ name: '', lat: e.latlng.lat, lon: e.latlng.lng, tags: [], notes: '', direction: null });
    }
  });
  // Lang indrukken (contextmenu) voegt meteen een locatie toe.
  map.on('zoomend', () => sunCtx && drawSunLines());
  map.on('contextmenu', (e) => openLocation({ name: '', lat: e.latlng.lat, lon: e.latlng.lng, tags: [], notes: '', direction: null }));
  renderMarkers();
  if (!state.pendingFocus) fitAll();
}

function fitAll() {
  if (!map || !state.locations.length) return;
  const b = L.latLngBounds(state.locations.map((l) => [l.lat, l.lon]));
  map.fitBounds(b.pad(0.2), { maxZoom: 13 });
}

function renderMarkers() {
  if (!map) return;
  markerLayer.clearLayers();
  for (const l of state.locations) {
    const best = bestOppFor(l.id);
    const color = best ? scoreColor(best.score) : '#6b7685';
    const icon = L.divIcon({ className: '', html: `<div class="marker-dot" style="background:${color}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
    const m = L.marker([l.lat, l.lon], { icon, title: l.name }).addTo(markerLayer);
    const d = distanceTo(l);
    m.bindPopup(() => {
      const div = document.createElement('div');
      div.innerHTML = `<strong>${esc(l.name)}</strong><br>
        <span class="muted">${(l.tags || []).map((t) => CONDITIONS[t]?.icon).join(' ')} ${d ? formatKm(d.km) : ''}</span>
        ${best ? `<br>Beste: ${CONDITIONS[best.cond].label} ${fmtDay(best.time).toLowerCase()} ${fmtTime(best.time)} — <strong>${Math.round(best.score * 100)}</strong>` : ''}
        <br><button class="primary">Openen</button>`;
      div.querySelector('button').onclick = () => openLocation(l);
      return div;
    });
    m.on('click', () => showSunLines(l));
  }
  if (hereMarker) hereMarker.remove();
  if (state.here) {
    hereMarker = L.circleMarker([state.here.lat, state.here.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#3d8bfd', fillOpacity: 1 }).addTo(map).bindTooltip('Jij');
  }
  if (homeMarker) homeMarker.remove();
  if (state.settings.home) {
    homeMarker = L.marker([state.settings.home.lat, state.settings.home.lon], {
      icon: L.divIcon({ className: '', html: '<div style="font-size:20px">🏠</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(map).bindTooltip('Thuis');
  }
  if (selectedLoc) showSunLines(state.locations.find((l) => l.id === selectedLoc.id) || null);
}

// ---------- Zon- en maanlijnen ----------
let sunCtx = null; // { loc, dateStr }

/** Selecteert een locatie en tekent zon- en maanlijnen voor een datum (à la PhotoPills). */
function showSunLines(loc, dateStr) {
  if (!map) return;
  selectedLoc = loc;
  sunCtx = loc ? { loc, dateStr: dateStr || sunCtx?.dateStr || null } : null;
  drawSunLines();
}

/** Lijnlengte ≈ 40% van de kortste zijde van het kaartbeeld, zodat de lijnen op elk zoomniveau leesbaar zijn. */
function lineLengthKm() {
  const b = map.getBounds();
  const sw = { lat: b.getSouth(), lon: b.getWest() };
  const h = distanceKm(sw, { lat: b.getNorth(), lon: b.getWest() });
  const w = distanceKm(sw, { lat: b.getSouth(), lon: b.getEast() });
  return Math.max(0.2, 0.4 * Math.min(h, w));
}

function drawSunLines() {
  sunLayer.clearLayers();
  const legend = $('#sun-legend');
  if (!sunCtx) { legend.hidden = true; return; }
  const { loc } = sunCtx;
  const date = sunCtx.dateStr ? new Date(sunCtx.dateStr + 'T12:00') : new Date();
  const info = sunInfo(dayNoon(date), loc);
  const t = info.times;
  const km = lineLengthKm();
  const ok = (d) => d instanceof Date && !isNaN(d);

  const lines = [
    { icon: '🌅', label: 'Zonsopkomst', time: t.sunrise, az: info.sunriseAz, color: '#ffd23f', at: 1 },
    { icon: '🌇', label: 'Zonsondergang', time: t.sunset, az: info.sunsetAz, color: '#ff7b39', at: 1 },
    { icon: '🌕', label: 'Maanopkomst', time: info.moonrise, az: info.moonriseAz, color: '#a9d1ff', dash: '10 7', at: 0.72 },
    { icon: '🌑', label: 'Maanondergang', time: info.moonset, az: info.moonsetAz, color: '#8b8cf0', dash: '10 7', at: 0.72 },
  ];
  for (const l of lines) {
    if (l.az == null || !ok(l.time)) continue;
    const end = destination(loc, l.az, km);
    L.polyline([[loc.lat, loc.lon], [end.lat, end.lon]], { color: l.color, weight: 4, opacity: 0.95, dashArray: l.dash }).addTo(sunLayer);
    const lp = destination(loc, l.az, km * l.at);
    L.marker([lp.lat, lp.lon], {
      interactive: false,
      icon: L.divIcon({ className: 'line-label', html: `<span style="border-color:${l.color}">${l.icon} ${fmtTime(l.time)}</span>`, iconSize: [0, 0] }),
    }).addTo(sunLayer);
  }
  const hasDir = loc.direction != null && loc.direction !== '';
  if (hasDir) {
    const end = destination(loc, Number(loc.direction), km * 0.85);
    L.polyline([[loc.lat, loc.lon], [end.lat, end.lon]], { color: '#ffffff', weight: 3, opacity: 0.9, dashArray: '3 7' }).addTo(sunLayer);
  }

  const cell = (l) => `<div class="sun-cell"><span class="swatch${l.dash ? ' dash' : ''}" style="background:${l.color};color:${l.color}"></span>
    <span title="${l.label}">${l.icon}</span> <strong>${ok(l.time) ? fmtTime(l.time) : '–'}</strong>
    <span class="muted">${l.az != null && ok(l.time) ? Math.round(l.az) + '° ' + compassLabel(l.az) : 'n.v.t.'}</span></div>`;
  const d = date;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  legend.innerHTML = `<div class="panel-head"><strong class="ellipsis">${esc(loc.name || 'Locatie')}</strong>
      <input type="date" id="sun-date" value="${iso}" aria-label="Datum voor zon en maan">
      <button id="sun-close" class="link" aria-label="Lijnen verbergen">✕</button></div>
    <div class="sun-grid">${lines.map(cell).join('')}</div>
    <div class="small muted">🌙 ${moonPhaseName(info.moonPhase)} (${Math.round(info.moonFraction * 100)}%)${hasDir ? ` · 🎯 kijkrichting ${Math.round(loc.direction)}°` : ''}</div>`;
  legend.hidden = false;
  $('#sun-date').onchange = (e) => showSunLines(loc, e.target.value);
  $('#sun-close').onclick = () => showSunLines(null);
}

function setHint(text) {
  $('#map-hint-text').textContent = text;
  $('#map-hint').hidden = !text;
}

function setAddMode(on) {
  state.addMode = on;
  setHint(on ? 'Tik op de kaart om de locatie te plaatsen' : '');
  $('#btn-add-mode').classList.toggle('on', on);
}

// ---------- Weerkaart België ----------
let wxLayer = null;
let wxData = null;
let wxCells = null;
let wxOn = false;

function wxIndexToTime(i) {
  const base = new Date();
  base.setMinutes(0, 0, 0);
  return base.getTime() + i * 3600000;
}

async function toggleWeather(on = !wxOn) {
  wxOn = on;
  $('#btn-weather').setAttribute('aria-pressed', String(on));
  $('#wx-panel').hidden = !on;
  if (!on) { wxLayer?.clearLayers(); return; }
  map.closePopup();
  if (!wxLayer) wxLayer = L.layerGroup().addTo(map);
  wxCells = wxCells || gridCells();
  const be = L.latLngBounds(BE_OUTLINE);
  if (!map.getBounds().intersects(be) || map.getZoom() > 10) map.fitBounds(be, { padding: [10, 10] });
  $('#wx-legend').innerHTML = Object.values(SKY_CLASSES).map((c) => `<span style="--c:${c.color}">${c.label}</span>`).join('');
  if (!wxData || Date.now() - wxData.fetched > 3600000) {
    $('#wx-time').textContent = 'laden…';
    try {
      wxData = await getGridForecast(wxCells);
    } catch (e) {
      $('#wx-time').textContent = 'mislukt';
      toast('Weerkaart laden mislukt: ' + e.message);
      return;
    }
  }
  renderWeather();
}

function renderWeather() {
  if (!wxOn || !wxData) return;
  const target = wxIndexToTime(Number($('#wx-slider').value));
  let idx = wxData.t.findIndex((t) => t >= target);
  if (idx < 0) idx = wxData.t.length - 1;
  const t = wxData.t[idx];
  $('#wx-time').textContent = `${fmtDay(t)} ${fmtTime(t)}`;
  wxLayer.clearLayers();
  wxCells.forEach((c, i) => {
    const d = wxData.cells[i];
    if (!d) return;
    const cls = classifySky(d.cc[idx], d.pr[idx], d.wc?.[idx]);
    L.rectangle([[c.south, c.west], [c.north, c.east]], {
      stroke: false, fillColor: SKY_CLASSES[cls].color, fillOpacity: 0.5, interactive: false,
    }).addTo(wxLayer);
  });
  L.polyline(BE_OUTLINE, { color: '#ffffff', weight: 1.5, opacity: 0.8, interactive: false }).addTo(wxLayer);
}

// ---------- Adres zoeken ----------
async function geocode(q) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=nl&q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

async function showGeocodeResults(q, box, onPick) {
  box.hidden = false;
  box.innerHTML = '<div class="muted small" style="padding:10px">Zoeken…</div>';
  try {
    const data = await geocode(q);
    if (!data.length) { box.innerHTML = '<div class="muted small" style="padding:10px">Niets gevonden</div>'; return; }
    box.innerHTML = '';
    for (const r of data) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = r.display_name;
      b.onclick = () => { box.hidden = true; onPick(r); };
      box.appendChild(b);
    }
  } catch {
    box.innerHTML = '<div class="muted small" style="padding:10px">Zoeken mislukt (offline?)</div>';
  }
}

function searchPlace(q) {
  showGeocodeResults(q, $('#search-results'), (r) => {
    map.setView([+r.lat, +r.lon], 14);
    const d = document.createElement('div');
    d.innerHTML = `${esc(r.display_name.split(',')[0])}<br><button class="primary">Opslaan als locatie</button>`;
    d.querySelector('button').onclick = () => openLocation({ name: r.display_name.split(',')[0], lat: +r.lat, lon: +r.lon, tags: [], notes: '', direction: null });
    L.popup().setLatLng([+r.lat, +r.lon]).setContent(d).openOn(map);
  });
}

// ---------- Thuislocatie (eerste start) ----------
const setupDlg = () => $('#setup-dialog');

function openSetup({ required = !state.settings.home } = {}) {
  $('#setup-close').hidden = required;
  $('#setup-results').hidden = true;
  if (!setupDlg().open) setupDlg().showModal();
}

function finishSetup(home) {
  const first = !state.settings.home;
  setHome(home);
  if (setupDlg().open) setupDlg().close();
  if (first) {
    toast('Thuislocatie ingesteld. Voeg nu je fotolocaties toe.', 4000);
    switchView(state.locations.length ? 'kansen' : 'kaart');
  }
}

// ---------- Dialoog: locatie ----------
const dlg = () => $('#loc-dialog');

function openLocation(loc, dateMs) {
  state.editing = { ...loc };
  const f = $('#loc-form');
  f.name.value = loc.name || '';
  f.lat.value = loc.lat != null ? Number(loc.lat).toFixed(6) : '';
  f.lon.value = loc.lon != null ? Number(loc.lon).toFixed(6) : '';
  f.direction.value = loc.direction ?? '';
  f.notes.value = loc.notes || '';
  $('#loc-title').textContent = loc.id ? loc.name : 'Nieuwe locatie';
  $('#form-tags').innerHTML = Object.entries(CONDITIONS).map(([k, c]) =>
    `<button type="button" class="chip ${(loc.tags || []).includes(k) ? 'on' : ''}" data-ftag="${k}" title="${esc(c.hint)}">${c.icon} ${c.label}</button>`).join('');
  $('#btn-delete').hidden = !loc.id;
  const d = new Date(dateMs || Date.now());
  $('#plan-date').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  updateDialogInfo();
  if (!dlg().open) dlg().showModal();
}

function formLoc() {
  const f = $('#loc-form');
  return {
    ...state.editing,
    name: f.name.value.trim(),
    lat: parseFloat(f.lat.value),
    lon: parseFloat(f.lon.value),
    direction: f.direction.value === '' ? null : ((Number(f.direction.value) % 360) + 360) % 360,
    notes: f.notes.value.trim(),
    tags: $$('#form-tags .chip.on').map((b) => b.dataset.ftag),
  };
}

function updateDialogInfo() {
  const loc = formLoc();
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) { $('#plan-out').innerHTML = ''; return; }
  const d = distanceTo(loc);
  $('#loc-distance').textContent = d ? `📍 ${formatKm(d.km)} hemelsbreed · ±${formatMinutes(d.min)} rijden vanaf ${state.settings.distanceFrom === 'home' && state.settings.home ? 'thuis' : 'je positie'}` : '';
  renderPlanner(loc);
}

function renderPlanner(loc) {
  const v = $('#plan-date').value;
  if (!v) return;
  const noon = new Date(v + 'T12:00');
  const info = sunInfo(noon, loc);
  const t = info.times;
  const tm = (x) => (x instanceof Date && !isNaN(x) ? fmtTime(x) : '–');
  const align = (az) => {
    if (loc.direction == null || az == null) return '';
    const diff = angleDiff(loc.direction, az);
    return diff <= ALIGN_TOLERANCE ? ` · <span style="color:var(--good)">✔ in kijkrichting</span>` : ` · ${Math.round(diff)}° ernaast`;
  };
  let html = `<table class="sun-table">
    <tr><td>🌌 Astronomische schemering</td><td>${tm(t.nightEnd)}</td></tr>
    <tr><td>🔵 Blauw uur (burgerlijke schemering)</td><td>${tm(t.dawn)} – ${tm(t.sunrise)}</td></tr>
    <tr><td>🌅 Zonsopkomst</td><td>${tm(t.sunrise)} · ${info.sunriseAz != null ? Math.round(info.sunriseAz) + '° ' + compassLabel(info.sunriseAz) : ''}${align(info.sunriseAz)}</td></tr>
    <tr><td>🟠 Gouden uur ochtend</td><td>${tm(t.sunrise)} – ${tm(t.goldenHourEnd)}</td></tr>
    <tr><td>🟠 Gouden uur avond</td><td>${tm(t.goldenHour)} – ${tm(t.sunset)}</td></tr>
    <tr><td>🌇 Zonsondergang</td><td>${tm(t.sunset)} · ${info.sunsetAz != null ? Math.round(info.sunsetAz) + '° ' + compassLabel(info.sunsetAz) : ''}${align(info.sunsetAz)}</td></tr>
    <tr><td>🔵 Blauw uur avond</td><td>${tm(t.sunset)} – ${tm(t.dusk)}</td></tr>
    <tr><td>🌌 Volledig donker vanaf</td><td>${tm(t.night)}</td></tr>
    <tr><td>🌙 Maan</td><td>${moonPhaseName(info.moonPhase)} (${Math.round(info.moonFraction * 100)}%) · op ${tm(info.moonrise)} · onder ${tm(info.moonset)}</td></tr>
  </table>`;

  const hours = forecastFor(state.forecasts, loc);
  const tags = loc.tags?.length ? loc.tags : Object.keys(CONDITIONS);
  const opps = hours ? opportunitiesForDay({ ...loc, tags }, hours, noon) : [];
  if (opps.length) {
    html += `<div class="plan-scores">` + opps.map((o) => `
      <div class="plan-score">
        <div class="score ${scoreClass(o.score)}">${Math.round(o.score * 100)}</div>
        <div><strong>${CONDITIONS[o.cond].icon} ${CONDITIONS[o.cond].label}</strong> <span class="muted">${fmtTime(o.time)}</span>
          <ul class="reasons">${o.reasons.map((r) => `<li class="${r.good ? 'good' : 'bad'}">${esc(r.text)}</li>`).join('')}</ul></div>
      </div>`).join('') + `</div>`;
    if (!loc.tags?.length) html += `<p class="muted small">Geen labels gekozen: alle condities worden getoond.</p>`;
  } else {
    html += `<p class="muted small">${hours ? 'Geen weersverwachting voor deze datum (max. ~7 dagen vooruit). Zonnestand blijft wel geldig.' : 'Sla de locatie op (met labels) om de weersverwachting te zien.'}</p>`;
  }
  $('#plan-out').innerHTML = html;
}

async function measureCompass() {
  const handler = (e) => {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) heading = (360 - e.alpha) % 360;
    if (heading == null) return;
    $('#loc-form').direction.value = Math.round(heading);
    updateDialogInfo();
  };
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p !== 'granted') { toast('Geen toegang tot kompas'); return; }
    }
  } catch { /* ignore */ }
  const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(evt, handler);
  toast('Richt je toestel naar je onderwerp… (5 s)', 5000);
  setTimeout(() => window.removeEventListener(evt, handler), 5000);
}

// ---------- Instellingen ----------
function setHome(home) {
  state.settings.home = home;
  state.settings.distanceFrom = 'home';
  store.saveSettings(state.settings);
  toast('Thuislocatie ingesteld');
  renderAll();
}

function renderSettings() {
  const s = state.settings;
  $$('input[name="distfrom"]').forEach((r) => (r.checked = r.value === s.distanceFrom));
  $('#home-label').textContent = s.home ? `🏠 ${s.home.label || 'Thuis'} (${s.home.lat.toFixed(4)}, ${s.home.lon.toFixed(4)})` : 'Nog geen thuislocatie ingesteld.';
  $('#set-speed').value = s.avgSpeed;
  $('#set-detour').value = s.detour;
  $('#set-minscore').value = s.minScore;
}

// ---------- Navigatie ----------
function switchView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'kaart') {
    initMap();
    setTimeout(() => {
      map.invalidateSize();
      const f = state.pendingFocus;
      if (f) {
        state.pendingFocus = null;
        map.setView([f.loc.lat, f.loc.lon], 13, { animate: false });
        showSunLines(f.loc, f.date);
      }
    }, 50);
  }
  try { sessionStorage.setItem('psp.view', name); } catch { /* ignore */ }
}

function renderAll() {
  renderCondChips();
  renderOpps();
  renderTagChips();
  renderLocations();
  renderSettings();
  renderMarkers();
}

// ---------- Gebeurtenissen ----------
function bind() {
  $$('.tabbar button').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
  $('#btn-refresh').onclick = () => refreshWeather(true);

  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cond]');
    if (c) { state.condFilter = c.dataset.cond; renderCondChips(); renderOpps(); return; }
    const t = e.target.closest('[data-tag]');
    if (t) { state.tagFilter = t.dataset.tag; renderTagChips(); renderLocations(); return; }
    const ft = e.target.closest('[data-ftag]');
    if (ft) { ft.classList.toggle('on'); updateDialogInfo(); return; }
    const o = e.target.closest('[data-open]');
    if (o) {
      const loc = state.locations.find((l) => l.id === o.dataset.open);
      if (loc) openLocation(loc, o.dataset.date ? Number(o.dataset.date) : undefined);
      return;
    }
    const g = e.target.closest('[data-goto]');
    if (g) switchView(g.dataset.goto);
  });
  $('#loc-list').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('[data-open]')?.click(); });

  $('#day-filter').onchange = renderOpps;
  $('#show-low').onchange = renderOpps;
  $('#loc-search').oninput = renderLocations;

  $('#btn-new-loc').onclick = async () => {
    const p = (await locateMe({ quiet: true })) || (map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : origin()) || { lat: 50.85, lon: 4.35 };
    openLocation({ name: '', lat: p.lat, lon: p.lon, tags: [], notes: '', direction: null });
  };

  // Kaart
  $('#btn-add-mode').onclick = () => setAddMode(!state.addMode);
  $('#btn-cancel-add').onclick = () => {
    setAddMode(false);
    if (state.pickHome) {
      state.pickHome = false;
      if (!state.settings.home) openSetup();
    }
  };
  $('#btn-weather').onclick = () => toggleWeather();
  $('#btn-light').onclick = () => {
    if (map.hasLayer(lightLayer)) map.removeLayer(lightLayer);
    else lightLayer.addTo(map);
  };
  $('#wx-close').onclick = () => toggleWeather(false);
  $('#wx-slider').oninput = renderWeather;
  $('#btn-locate').onclick = async () => {
    const p = await locateMe();
    if (p) { map.setView([p.lat, p.lon], 13); renderAll(); }
  };
  $('#search-form').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#search-input').value.trim();
    if (q) searchPlace(q);
  };

  // Dialoog
  const f = $('#loc-form');
  ['lat', 'lon', 'direction'].forEach((n) => f[n].addEventListener('change', updateDialogInfo));
  $('#plan-date').onchange = updateDialogInfo;
  $('#btn-close-dialog').onclick = () => dlg().close();
  $('#btn-compass').onclick = measureCompass;
  $('#btn-route').onclick = () => {
    const l = formLoc();
    if (Number.isFinite(l.lat)) window.open(routeUrl(l), '_blank', 'noopener');
  };
  $('#btn-show-map').onclick = () => {
    const l = formLoc();
    dlg().close();
    state.pendingFocus = { loc: l, date: $('#plan-date').value };
    switchView('kaart');
  };
  $('#btn-delete').onclick = () => {
    if (!state.editing?.id) return;
    if (!confirm(`"${state.editing.name}" verwijderen?`)) return;
    store.deleteLocation(state.editing.id);
    state.locations = store.getLocations();
    dlg().close();
    if (selectedLoc?.id === state.editing.id) showSunLines(null);
    computeOpps();
    renderAll();
    toast('Locatie verwijderd');
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    const l = formLoc();
    if (!l.name) { f.name.focus(); return; }
    if (!Number.isFinite(l.lat) || !Number.isFinite(l.lon) || Math.abs(l.lat) > 90 || Math.abs(l.lon) > 180) { toast('Ongeldige coördinaten'); return; }
    const saved = store.upsertLocation(l);
    state.locations = store.getLocations();
    dlg().close();
    toast(`"${saved.name}" opgeslagen`);
    refreshWeather();
  };

  // Instellingen
  $$('input[name="distfrom"]').forEach((r) => (r.onchange = async () => {
    state.settings.distanceFrom = r.value;
    store.saveSettings(state.settings);
    if (r.value === 'gps') await locateMe();
    else if (!state.settings.home) openSetup();
    renderAll();
  }));
  $('#btn-home-gps').onclick = async () => {
    const p = await locateMe();
    if (p) finishSetup({ ...p, label: 'Huidige positie' });
  };
  const pickHomeOnMap = () => {
    if (setupDlg().open) setupDlg().close();
    setAddMode(false);
    state.pickHome = true;
    switchView('kaart');
    setHint('Tik op de kaart op je thuislocatie');
  };
  $('#btn-home-map').onclick = pickHomeOnMap;
  $('#btn-home-search').onclick = () => openSetup({ required: false });

  // Startvenster thuislocatie
  setupDlg().addEventListener('cancel', (e) => { if (!state.settings.home) e.preventDefault(); });
  $('#setup-close').onclick = () => setupDlg().close();
  $('#setup-map').onclick = pickHomeOnMap;
  $('#setup-gps').onclick = async () => {
    const p = await locateMe();
    if (p) finishSetup({ ...p, label: 'Huidige positie' });
  };
  $('#setup-search').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#setup-input').value.trim();
    if (q) showGeocodeResults(q, $('#setup-results'), (r) => finishSetup({ lat: +r.lat, lon: +r.lon, label: r.display_name.split(',').slice(0, 2).join(',') }));
  };
  const num = (id, key, min, max) => ($(id).onchange = (e) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) state.settings[key] = Math.min(max, Math.max(min, v));
    store.saveSettings(state.settings);
    renderAll();
  });
  num('#set-speed', 'avgSpeed', 10, 130);
  num('#set-detour', 'detour', 1, 2);
  num('#set-minscore', 'minScore', 0, 100);

  $('#btn-export').onclick = () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fotospots-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#file-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const incoming = store.parseImport(await file.text());
      const added = store.mergeLocations(incoming);
      state.locations = store.getLocations();
      toast(`${added} locatie(s) geïmporteerd${incoming.length - added ? `, ${incoming.length - added} dubbel overgeslagen` : ''}`);
      fitAll();
      refreshWeather();
    } catch (err) {
      toast('Import mislukt: ' + err.message);
    }
    e.target.value = '';
  };
  $('#btn-clear-cache').onclick = () => { clearWeatherCache(); toast('Weercache gewist'); refreshWeather(true); };
}

// ---------- Start ----------
async function start() {
  bind();
  renderAll();
  let initial = 'kansen';
  try { initial = sessionStorage.getItem('psp.view') || 'kansen'; } catch { /* ignore */ }
  switchView(initial);
  if (!state.settings.home) openSetup();
  if (state.settings.distanceFrom === 'gps') locateMe({ quiet: true }).then(() => renderAll());
  await refreshWeather();
  // Elk uur opnieuw scoren (cache bepaalt of er echt opgehaald wordt).
  setInterval(() => refreshWeather(), 60 * 60 * 1000);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
