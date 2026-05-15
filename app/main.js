// SPF Explorer — main.js

const DATA_PATH     = '../data/processed/spf-data.json';
const PMTILES_PATH  = '../tiles/lsoa.pmtiles';
const UK_CENTER     = [-3.0, 55.0];
const UK_ZOOM       = 5;
const GEO_RADIUS_KM = 10;

const DECILE_COLORS = {
  1:  '#0d47a1',
  2:  '#1565c0',
  3:  '#1976d2',
  4:  '#1e88e5',
  5:  '#2196f3',
  6:  '#42a5f5',
  7:  '#64b5f6',
  8:  '#90caf9',
  9:  '#bbdefb',
  10: '#e3f2fd',
};

// ── State ─────────────────────────────────────────────────────────────────────

let spfData      = null;
let decileIndex  = {};  // { year: { decile: [code, …] } }
let currentYear  = 2025;
let selectedCode = null;
let activeDecile = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const yearDisplay   = document.getElementById('year-display');
const yearPrev      = document.getElementById('year-prev');
const yearNext      = document.getElementById('year-next');
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const geoPlaceInput = document.getElementById('geo-place-input');
const geoPlaceBtn   = document.getElementById('geo-place-btn');
const geoLocateBtn  = document.getElementById('geo-locate-btn');
const geoMsg        = document.getElementById('geo-msg');
const geoResults    = document.getElementById('geo-results'); // lives in info-geo (right panel)
const decileGrid    = document.getElementById('decile-grid');
const resetBtn      = document.getElementById('reset-btn');
const infoPanel     = document.getElementById('info-panel');
const infoArea      = document.getElementById('info-area');
const infoGeo       = document.getElementById('info-geo');
const infoName      = document.getElementById('info-name');
const infoCodeEl    = document.getElementById('info-code');
const infoValue     = document.getElementById('info-value');
const infoDecileEl  = document.getElementById('info-decile');
const infoPeersNote = document.getElementById('info-peers-note');
const infoClose     = document.getElementById('info-close');
const infoGeoTitle  = document.getElementById('info-geo-title');
const infoGeoSub    = document.getElementById('info-geo-sub');
const sidebar       = document.getElementById('sidebar');
const sidebarHandle = document.getElementById('sidebar-handle');

// ── PMTiles URL ───────────────────────────────────────────────────────────────

function resolvePmtilesUrl() {
  // Manually resolve ../tiles/lsoa.pmtiles to an absolute URL so
  // new URL() percent-encoding of the path doesn't cause issues.
  const parts = window.location.href.split('?')[0].replace(/\/[^/]*$/, '').split('/');
  for (const seg of PMTILES_PATH.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg) parts.push(seg);
  }
  return 'pmtiles://' + parts.join('/');
}

// ── PMTiles protocol ──────────────────────────────────────────────────────────

const pmtilesProtocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile.bind(pmtilesProtocol));

// ── Map ───────────────────────────────────────────────────────────────────────

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        // ESRI World Dark Gray — free, no API key, CORS enabled
        // Note: ESRI tile URLs use {z}/{y}/{x} order (row before column)
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        attribution: '© <a href="https://www.esri.com/">Esri</a>',
      },
    },
    layers: [{ id: 'carto-base', type: 'raster', source: 'carto' }],
  },
  center: UK_CENTER,
  zoom: UK_ZOOM,
  attributionControl: false,
});

map.addControl(
  new maplibregl.AttributionControl({
    customAttribution: '© Esri · ONS Open Geography · Imago UKRI',
  }),
  'bottom-right',
);
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// ── Data ──────────────────────────────────────────────────────────────────────

async function loadData() {
  const res = await fetch(DATA_PATH);
  if (!res.ok) throw new Error(`Could not load SPF data (${res.status})`);
  spfData = await res.json();

  for (const year of spfData.meta.years) {
    decileIndex[year] = {};
    for (let d = 1; d <= 10; d++) decileIndex[year][d] = [];
  }
  for (const [code, area] of Object.entries(spfData.areas)) {
    for (const year of spfData.meta.years) {
      const yd = area[year];
      if (yd) decileIndex[year][yd.decile].push(code);
    }
  }
}

// ── Feature-state choropleth ──────────────────────────────────────────────────

function applyYearStates(year) {
  for (const [code, area] of Object.entries(spfData.areas)) {
    const yd = area[year];
    map.setFeatureState(
      { source: 'lsoa', sourceLayer: 'lsoa', id: code },
      { color: yd ? DECILE_COLORS[yd.decile] : null },
    );
  }
}

// ── Filter helpers ────────────────────────────────────────────────────────────

function neverFilter() {
  return ['==', ['get', 'data_zone_code'], '__NONE__'];
}

function codesFilter(codes) {
  if (!codes || !codes.length) return neverFilter();
  return ['match', ['get', 'data_zone_code'], codes, true, false];
}

// ── Layer setup ───────────────────────────────────────────────────────────────

function setupLayers() {
  map.addSource('lsoa', {
    type: 'vector',
    url: resolvePmtilesUrl(),
    promoteId: { 'lsoa': 'data_zone_code' },
  });

  // Choropleth fill — colour driven by feature-state set in applyYearStates()
  map.addLayer({
    id: 'lsoa-fill',
    type: 'fill',
    source: 'lsoa',
    'source-layer': 'lsoa',
    paint: {
      'fill-color': ['coalesce', ['feature-state', 'color'], '#44445a'],
      'fill-opacity': 0.75,
    },
  });

  // Highlighted areas — full opacity fill on top of the dimmed base
  map.addLayer({
    id: 'lsoa-highlight',
    type: 'fill',
    source: 'lsoa',
    'source-layer': 'lsoa',
    paint: {
      'fill-color': ['coalesce', ['feature-state', 'color'], '#44445a'],
      'fill-opacity': 0.9,
    },
    filter: neverFilter(),
  });

  // Subtle boundary lines at higher zoom
  map.addLayer({
    id: 'lsoa-outline',
    type: 'line',
    source: 'lsoa',
    'source-layer': 'lsoa',
    minzoom: 9,
    paint: {
      'line-color': 'rgba(255,255,255,0.09)',
      'line-width': 0.4,
    },
  });

  // Selected area outline (white)
  map.addLayer({
    id: 'lsoa-selected',
    type: 'line',
    source: 'lsoa',
    'source-layer': 'lsoa',
    paint: {
      'line-color': '#FFFFFF',
      'line-width': 2,
    },
    filter: neverFilter(),
  });

  map.on('click', 'lsoa-fill', (e) => {
    const code = e.features[0]?.properties?.data_zone_code;
    if (!code) return;
    if (code === selectedCode) {
      clearSelection();
    } else {
      selectArea(code);
    }
  });

  map.on('mouseenter', 'lsoa-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'lsoa-fill', () => { map.getCanvas().style.cursor = ''; });

  // Apply colour states now (buffered by MapLibre) and again after first idle
  // so states are guaranteed to render even if tiles loaded before the initial call.
  applyYearStates(currentYear);
  map.once('idle', () => applyYearStates(currentYear));
}

// ── Year ──────────────────────────────────────────────────────────────────────

function applyYear(year) {
  currentYear = year;
  yearDisplay.textContent = year;
  syncYearButtons();
  if (map.getLayer('lsoa-fill')) {
    applyYearStates(year);
  }
  clearSelection();
}

function syncYearButtons() {
  const years = spfData.meta.years;
  yearPrev.disabled = currentYear <= Math.min(...years);
  yearNext.disabled = currentYear >= Math.max(...years);
}

yearPrev.addEventListener('click', () => {
  const years = spfData.meta.years;
  const i = years.indexOf(currentYear);
  if (i > 0) applyYear(years[i - 1]);
});

yearNext.addEventListener('click', () => {
  const years = spfData.meta.years;
  const i = years.indexOf(currentYear);
  if (i < years.length - 1) applyYear(years[i + 1]);
});

// ── Info panel mode ───────────────────────────────────────────────────────────

function showInfoPanel(mode) {
  infoArea.classList.toggle('hidden', mode !== 'area');
  infoGeo.classList.toggle('hidden', mode !== 'geo');
  infoPanel.classList.remove('hidden');
  sidebar.classList.remove('expanded'); // collapse sidebar on mobile so panel isn't obscured
}

// ── Selection ─────────────────────────────────────────────────────────────────

function selectArea(code, fly = false) {
  const area = spfData.areas[code];
  if (!area) return;

  selectedCode = code;
  activeDecile = null;

  const yd     = area[currentYear];
  const decile = yd?.decile ?? null;
  const peers  = decile ? decileIndex[currentYear][decile] : [];
  const count  = peers.length;

  map.setFilter('lsoa-selected', ['==', ['get', 'data_zone_code'], code]);
  map.setFilter('lsoa-highlight', codesFilter(peers));
  map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.35);

  updateChips(decile);

  infoName.textContent      = area.name || code;
  infoCodeEl.textContent    = code;
  infoValue.textContent     = yd ? `${yd.value.toFixed(1)}` : '—';
  infoDecileEl.textContent  = decile ? `${decile} / 10` : '—';
  infoDecileEl.style.color  = decile ? DECILE_COLORS[decile] : 'inherit';
  infoPeersNote.textContent = decile
    ? `${count.toLocaleString()} areas share decile ${decile} nationally`
    : '';
  showInfoPanel('area');

  if (fly && area.lat != null && area.lon != null) {
    map.flyTo({ center: [area.lon, area.lat], zoom: Math.max(map.getZoom(), 12), speed: 1.4 });
  }

  pushURLState();
}

function clearSelection() {
  selectedCode = null;
  activeDecile = null;

  if (map.getLayer('lsoa-selected')) {
    map.setFilter('lsoa-selected', neverFilter());
    map.setFilter('lsoa-highlight', neverFilter());
    map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.75);
  }

  updateChips(null);
  infoPanel.classList.add('hidden');
  geoResults.innerHTML = '';
  geoMsg.textContent = '';
  pushURLState();
}

// ── Decile chips ──────────────────────────────────────────────────────────────

function buildDecileChips() {
  decileGrid.innerHTML = '';
  for (let d = 1; d <= 10; d++) {
    const btn = document.createElement('button');
    btn.className = 'decile-chip';
    btn.dataset.decile = d;
    btn.textContent = d;
    btn.style.background = DECILE_COLORS[d];
    btn.style.color = d <= 6 ? '#ffffff' : '#0e0e1a';
    btn.title = d === 1 ? 'Most cloud' : d === 10 ? 'Most sun' : `Decile ${d}`;
    btn.addEventListener('click', () => highlightDecile(d));
    decileGrid.appendChild(btn);
  }
}

function updateChips(activeD) {
  for (const chip of decileGrid.querySelectorAll('.decile-chip')) {
    chip.classList.toggle('active', Number(chip.dataset.decile) === activeD);
  }
}

function highlightDecile(decile) {
  selectedCode = null;
  activeDecile = decile;

  const peers = decileIndex[currentYear][decile] || [];
  if (map.getLayer('lsoa-highlight')) {
    map.setFilter('lsoa-selected', neverFilter());
    map.setFilter('lsoa-highlight', codesFilter(peers));
    map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.35);
  }

  updateChips(decile);
  infoPanel.classList.add('hidden');
  pushURLState();
}

// ── Search ────────────────────────────────────────────────────────────────────

let searchTimer = null;

searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim().toLowerCase();
  if (!q) { searchResults.style.display = 'none'; return; }
  searchTimer = setTimeout(() => runSearch(q), 180);
});

function runSearch(q) {
  const hits = [];
  for (const [code, area] of Object.entries(spfData.areas)) {
    if (code.toLowerCase().includes(q) || (area.name && area.name.toLowerCase().includes(q))) {
      hits.push({ code, name: area.name });
      if (hits.length >= 8) break;
    }
  }
  if (!hits.length) { searchResults.style.display = 'none'; return; }
  searchResults.innerHTML = hits.map(h => `
    <div class="search-result" data-code="${h.code}">
      <div class="search-result-name">${h.name || h.code}</div>
      <div class="search-result-code">${h.code}</div>
    </div>`).join('');
  searchResults.style.display = 'block';
}

searchResults.addEventListener('click', (e) => {
  const el = e.target.closest('.search-result');
  if (!el) return;
  const code = el.dataset.code;
  searchInput.value = spfData.areas[code]?.name || code;
  searchResults.style.display = 'none';
  selectArea(code, true);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-container')) searchResults.style.display = 'none';
});

// ── Geo helpers ───────────────────────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Returns up to 10 closest top-decile areas within GEO_RADIUS_KM, sorted by distance.
function findSunnyNear(lat, lon, label = 'your location') {
  geoResults.innerHTML = '';
  const candidates = [];
  for (const [code, area] of Object.entries(spfData.areas)) {
    if (area.lat == null || area.lon == null) continue;
    const yd = area[currentYear];
    if (!yd || yd.decile !== 10) continue;
    const distKm = haversineKm(lat, lon, area.lat, area.lon);
    if (distKm <= GEO_RADIUS_KM) candidates.push({ code, area, distKm });
  }
  candidates.sort((a, b) => a.distKm - b.distKm);
  const nearest = candidates.slice(0, 10);

  map.flyTo({ center: [lon, lat], zoom: 11, speed: 1.4 });

  if (!nearest.length) {
    geoMsg.textContent = `No top-decile areas within ${GEO_RADIUS_KM} km of ${label}.`;
    return [];
  }

  selectedCode = null;
  activeDecile = 10;
  map.setFilter('lsoa-selected', neverFilter());
  map.setFilter('lsoa-highlight', codesFilter(nearest.map(c => c.code)));
  map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.35);
  updateChips(10);

  const total = candidates.length;
  geoMsg.textContent =
    `${total} top-decile area${total !== 1 ? 's' : ''} within ${GEO_RADIUS_KM} km of ${label} — fetching weather…`;

  return nearest;
}

function cloudIcon(cloud, isDay) {
  if (!isDay) return '🌙';
  if (cloud <= 20) return '☀️';
  if (cloud <= 50) return '⛅';
  if (cloud <= 80) return '🌥️';
  return '☁️';
}

async function fetchWeatherForAreas(areas) {
  return Promise.all(
    areas.map(({ area }) =>
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${area.lat}&longitude=${area.lon}` +
        `&current=cloud_cover,is_day&timezone=auto&forecast_days=1`,
      )
        .then(r => r.json())
        .then(d => d.current)
        .catch(() => null),
    ),
  );
}

function renderGeoResults(nearest, weatherData, label) {
  const n = nearest.length;
  infoGeoTitle.textContent = `Sunny places near ${label}`;
  infoGeoSub.textContent = `${n} closest top-decile area${n !== 1 ? 's' : ''} · live cloud cover`;
  geoMsg.textContent = `${n} area${n !== 1 ? 's' : ''} found — see results →`;

  geoResults.innerHTML = nearest.map(({ code, area, distKm }, i) => {
    const w = weatherData[i];
    const icon = w ? cloudIcon(w.cloud_cover, w.is_day) : '—';
    const meta = w
      ? `${distKm.toFixed(1)} km · ${w.cloud_cover}% cloud`
      : `${distKm.toFixed(1)} km · weather unavailable`;
    return `<div class="geo-result-item" data-code="${code}">
      <span class="geo-result-icon">${icon}</span>
      <div class="geo-result-info">
        <div class="geo-result-name">${area.name || code}</div>
        <div class="geo-result-meta">${meta}</div>
      </div>
    </div>`;
  }).join('');

  showInfoPanel('geo');
}

async function geocodePlace(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=gb`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const results = await res.json();
  if (!results.length) return null;
  return {
    lat: parseFloat(results[0].lat),
    lon: parseFloat(results[0].lon),
    name: results[0].display_name.split(',')[0],
  };
}

async function runGeoSearch(lat, lon, label = 'your location') {
  const nearest = findSunnyNear(lat, lon, label);
  if (!nearest.length) return;
  try {
    const weatherData = await fetchWeatherForAreas(nearest);
    renderGeoResults(nearest, weatherData, label);
  } catch {
    geoMsg.textContent = geoMsg.textContent.replace(' — fetching weather…', '');
  }
}

async function handlePlaceSearch() {
  const q = geoPlaceInput.value.trim();
  if (!q) return;
  geoMsg.textContent = 'Searching…';
  geoResults.innerHTML = '';
  try {
    const place = await geocodePlace(q);
    if (!place) {
      geoMsg.textContent = 'Place not found — try a different name or postcode.';
      return;
    }
    await runGeoSearch(place.lat, place.lon, place.name);
  } catch {
    geoMsg.textContent = 'Could not search — check your connection.';
  }
}

geoPlaceBtn.addEventListener('click', handlePlaceSearch);
geoPlaceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handlePlaceSearch(); });

geoResults.addEventListener('click', (e) => {
  const item = e.target.closest('.geo-result-item');
  if (item) selectArea(item.dataset.code, true);
});

geoLocateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    geoMsg.textContent = 'Geolocation is not supported by your browser.';
    return;
  }
  geoMsg.textContent = 'Finding your location…';
  geoResults.innerHTML = '';
  navigator.geolocation.getCurrentPosition(
    ({ coords: { latitude: lat, longitude: lon } }) => runGeoSearch(lat, lon),
    (err) => {
      const msgs = { 1: 'Location access was denied.', 2: 'Location unavailable.', 3: 'Request timed out.' };
      geoMsg.textContent = msgs[err.code] || 'Could not determine your location.';
    },
    { timeout: 10000 },
  );
});

// ── Reset ─────────────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  map.flyTo({ center: UK_CENTER, zoom: UK_ZOOM, speed: 1.2 });
  clearSelection();
  geoMsg.textContent = '';
});

// ── Info panel ────────────────────────────────────────────────────────────────

infoClose.addEventListener('click', () => clearSelection());

// ── URL state ─────────────────────────────────────────────────────────────────

function pushURLState() {
  const params = new URLSearchParams();
  if (selectedCode) params.set('area', selectedCode);
  if (activeDecile) params.set('decile', activeDecile);
  if (currentYear !== spfData?.meta.years.at(-1)) params.set('year', currentYear);
  const qs = params.toString();
  history.replaceState({}, '', qs ? `?${qs}` : window.location.pathname);
}

function restoreURLState() {
  const params = new URLSearchParams(window.location.search);
  const yearParam = parseInt(params.get('year') || '');
  if (yearParam && spfData.meta.years.includes(yearParam)) {
    currentYear = yearParam;
    yearDisplay.textContent = yearParam;
    syncYearButtons();
    applyYearStates(yearParam);
  }

  const area = params.get('area');
  if (area && spfData.areas[area]) { selectArea(area, true); return; }

  const decile = parseInt(params.get('decile') || '');
  if (decile >= 1 && decile <= 10) highlightDecile(decile);
}

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────

sidebarHandle.addEventListener('click', () => sidebar.classList.toggle('expanded'));

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await loadData();

  if (!spfData.meta.years.includes(currentYear)) {
    currentYear = spfData.meta.years.at(-1);
  }
  yearDisplay.textContent = currentYear;
  buildDecileChips();

  if (map.loaded()) {
    setupLayers();
    restoreURLState();
  } else {
    map.on('load', () => {
      setupLayers();
      restoreURLState();
    });
  }
}

init().catch((err) => {
  console.error('SPF Explorer failed to initialise:', err);
});
