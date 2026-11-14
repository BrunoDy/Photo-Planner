import * as store from './store.js';
import { CONDITIONS, scoreLabel } from './scoring.js';
import { getForecasts, forecastFor, clearWeatherCache } from './weather.js';
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
      <p class="meta">${dist ? `${formatKm(dist.km)} · ±${formatMinutes(dist.min)} rijden · <strong>vertrek ${fmtTime(depart)}</strong>` : 'Afstand onbekend (zet GPS of vertrekpunt)'}</p>
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
  L.control.layers(layers, null, { position: 'topright' }).addTo(map);
  map.on('baselayerchange', (e) => { state.settings.mapLayer = e.name; store.saveSettings(state.settings); });
  markerLayer = L.layerGroup().addTo(map);
  sunLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (state.pickHome) {
      state.pickHome = false;
      setHome({ lat: e.latlng.lat, lon: e.latlng.lng, label: 'Gekozen op kaart' });
      $('#map-hint').hidden = true;
      switchView('instellingen');
      return;
    }
    if (state.addMode) {
      setAddMode(false);
      openLocation({ name: '', lat: e.latlng.lat, lon: e.latlng.lng, tags: [], notes: '', direction: null });
    }
  });
  // Lang indrukken (contextmenu) voegt meteen een locatie toe.
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
    }).addTo(map).bindTooltip('Vertrekpunt');
  }
  if (selectedLoc) showSunLines(state.locations.find((l) => l.id === selectedLoc.id) || null);
}

/** Tekent zon-opkomst/-ondergangsrichting voor een gekozen datum (à la PhotoPills). */
function showSunLines(loc, dateStr) {
  if (!map) return;
  sunLayer.clearLayers();
  const legend = $('#sun-legend');
  selectedLoc = loc;
  if (!loc) { legend.hidden = true; return; }
  const date = dateStr ? new Date(dateStr + 'T12:00') : new Date();
  const info = sunInfo(dayNoon(date), loc);
  const km = 8;
  const line = (az, color, dash) => {
    if (az == null) return;
    const p = destination(loc, az, km);
    L.polyline([[loc.lat, loc.lon], [p.lat, p.lon]], { color, weight: 4, opacity: 0.9, dashArray: dash }).addTo(sunLayer);
  };
  line(info.sunriseAz, '#ffd23f');
  line(info.sunsetAz, '#ff7b39');
  if (loc.direction != null && loc.direction !== '') line(Number(loc.direction), '#ffffff', '6 8');
  const t = info.times;
  const iso = date.toISOString().slice(0, 10);
  legend.innerHTML = `<strong>${esc(loc.name)}</strong>
    <div><span class="swatch" style="background:#ffd23f"></span>Opkomst ${isNaN(t.sunrise) ? '–' : fmtTime(t.sunrise)} · ${info.sunriseAz != null ? Math.round(info.sunriseAz) + '°' : '–'}</div>
    <div><span class="swatch" style="background:#ff7b39"></span>Ondergang ${isNaN(t.sunset) ? '–' : fmtTime(t.sunset)} · ${info.sunsetAz != null ? Math.round(info.sunsetAz) + '°' : '–'}</div>
    ${loc.direction != null && loc.direction !== '' ? `<div><span class="swatch" style="background:#fff"></span>Kijkrichting ${Math.round(loc.direction)}°</div>` : ''}
    <input type="date" id="sun-date" value="${iso}" aria-label="Datum voor zonstand">`;
  legend.hidden = false;
  $('#sun-date').onchange = (e) => showSunLines(loc, e.target.value);
}

function setAddMode(on) {
  state.addMode = on;
  $('#map-hint').hidden = !on;
  $('#map-hint').firstChild.textContent = 'Tik op de kaart om de locatie te plaatsen ';
  $('#btn-add-mode').classList.toggle('on', on);
  if (on) $('#sun-legend').hidden = true;
}

async function searchPlace(q) {
  const box = $('#search-results');
  box.hidden = false;
  box.innerHTML = '<div class="muted small" style="padding:10px">Zoeken…</div>';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=nl&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.length) { box.innerHTML = '<div class="muted small" style="padding:10px">Niets gevonden</div>'; return; }
    box.innerHTML = '';
    for (const r of data) {
      const b = document.createElement('button');
      b.textContent = r.display_name;
      b.onclick = () => {
        box.hidden = true;
        map.setView([+r.lat, +r.lon], 14);
        L.popup().setLatLng([+r.lat, +r.lon]).setContent((() => {
          const d = document.createElement('div');
          d.innerHTML = `${esc(r.display_name.split(',')[0])}<br><button class="primary">Opslaan als locatie</button>`;
          d.querySelector('button').onclick = () => openLocation({ name: r.display_name.split(',')[0], lat: +r.lat, lon: +r.lon, tags: [], notes: '', direction: null });
          return d;
        })()).openOn(map);
      };
      box.appendChild(b);
    }
  } catch {
    box.innerHTML = '<div class="muted small" style="padding:10px">Zoeken mislukt (offline?)</div>';
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
  $('#loc-distance').textContent = d ? `📍 ${formatKm(d.km)} hemelsbreed · ±${formatMinutes(d.min)} rijden vanaf ${state.settings.distanceFrom === 'home' && state.settings.home ? 'vertrekpunt' : 'je positie'}` : '';
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
  toast('Vertrekpunt ingesteld');
  renderAll();
}

function renderSettings() {
  const s = state.settings;
  $$('input[name="distfrom"]').forEach((r) => (r.checked = r.value === s.distanceFrom));
  $('#home-label').textContent = s.home ? `🏠 ${s.home.label || 'Vertrekpunt'}: ${s.home.lat.toFixed(4)}, ${s.home.lon.toFixed(4)}` : 'Nog geen vast vertrekpunt ingesteld.';
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
  $('#btn-cancel-add').onclick = () => { setAddMode(false); state.pickHome = false; };
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
    else if (!state.settings.home) toast('Stel eerst een vertrekpunt in');
    renderAll();
  }));
  $('#btn-home-gps').onclick = async () => {
    const p = await locateMe();
    if (p) setHome({ ...p, label: 'Thuis' });
  };
  $('#btn-home-map').onclick = () => {
    state.pickHome = true;
    switchView('kaart');
    $('#map-hint').hidden = false;
    $('#map-hint').firstChild.textContent = 'Tik op de kaart om je vertrekpunt te kiezen ';
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
  if (state.settings.distanceFrom === 'gps') locateMe({ quiet: true }).then(() => renderAll());
  await refreshWeather();
  // Elk uur opnieuw scoren (cache bepaalt of er echt opgehaald wordt).
  setInterval(() => refreshWeather(), 60 * 60 * 1000);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
