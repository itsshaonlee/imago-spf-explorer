// SPF Explorer — main.js

const DATA_PATH  = '../data/processed/spf-data.json';
const TILES_PATH = '../tiles/{z}/{x}/{y}.pbf';
const UK_CENTER  = [-3.0, 55.0];
const UK_ZOOM    = 5;
const GEO_RADIUS_KM = 10;

const DECILE_COLORS = {
  1:  '#24226F',
  2:  '#1877CF', 3:  '#1877CF',
  4:  '#03CEA3', 5:  '#03CEA3', 6: '#03CEA3',
  7:  '#8EC840', 8:  '#8EC840',
  9:  '#FF8F42', 10: '#FF8F42',
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
const geoBtn        = document.getElementById('geo-btn');
const geoMsg        = document.getElementById('geo-msg');
const decileGrid    = document.getElementById('decile-grid');
const resetBtn      = document.getElementById('reset-btn');
const infoPanel     = document.getElementById('info-panel');
const infoName      = document.getElementById('info-name');
const infoCodeEl    = document.getElementById('info-code');
const infoValue     = document.getElementById('info-value');
const infoDecileEl  = document.getElementById('info-decile');
const infoPeersNote = document.getElementById('info-peers-note');
const infoClose     = document.getElementById('info-close');
const sidebar       = document.getElementById('sidebar');
const sidebarHandle = document.getElementById('sidebar-handle');

// ── Map ───────────────────────────────────────────────────────────────────────

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_matter_nolabels/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/dark_matter_nolabels/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/dark_matter_nolabels/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© <a href="https://carto.com/">CARTO</a>',
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
    customAttribution: '© Carto Dark Matter · ONS Open Geography · Imago UKRI',
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

// ── Choropleth ────────────────────────────────────────────────────────────────

function buildColorExpression(year) {
  // match on data_zone_code → decile colour; falls back to neutral grey
  const expr = ['match', ['get', 'data_zone_code']];
  for (const [code, area] of Object.entries(spfData.areas)) {
    const yd = area[year];
    if (yd) expr.push(code, DECILE_COLORS[yd.decile]);
  }
  expr.push('#44445a');
  return expr;
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

function resolveTileUrl() {
  // Build absolute URL without new URL() which would percent-encode {z}/{x}/{y}
  const parts = window.location.href.replace(/\/[^/]*$/, '').split('/');
  for (const seg of TILES_PATH.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg) parts.push(seg);
  }
  return parts.join('/');
}

function setupLayers() {
  map.addSource('lsoa', {
    type: 'vector',
    tiles: [resolveTileUrl()],
    minzoom: 5,
    maxzoom: 14,
  });

  // Choropleth fill
  map.addLayer({
    id: 'lsoa-fill',
    type: 'fill',
    source: 'lsoa',
    'source-layer': 'lsoa',
    paint: {
      'fill-color': buildColorExpression(currentYear),
      'fill-opacity': 0.75,
    },
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

  // Peer highlight outlines (teal)
  map.addLayer({
    id: 'lsoa-peers',
    type: 'line',
    source: 'lsoa',
    'source-layer': 'lsoa',
    paint: {
      'line-color': '#03CEA3',
      'line-width': 1.5,
      'line-opacity': 0.9,
    },
    filter: neverFilter(),
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
}

// ── Year ──────────────────────────────────────────────────────────────────────

function applyYear(year) {
  currentYear = year;
  yearDisplay.textContent = year;
  syncYearButtons();
  if (map.getLayer('lsoa-fill')) {
    map.setPaintProperty('lsoa-fill', 'fill-color', buildColorExpression(year));
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
  map.setFilter('lsoa-peers', codesFilter(peers));
  map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.45);

  updateChips(decile);

  infoName.textContent      = area.name || code;
  infoCodeEl.textContent    = code;
  infoValue.textContent     = yd ? `${yd.value.toFixed(1)}` : '—';
  infoDecileEl.textContent  = decile ? `${decile} / 10` : '—';
  infoDecileEl.style.color  = decile ? DECILE_COLORS[decile] : 'inherit';
  infoPeersNote.textContent = decile
    ? `${count.toLocaleString()} areas share decile ${decile} nationally`
    : '';
  infoPanel.classList.remove('hidden');

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
    map.setFilter('lsoa-peers', neverFilter());
    map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.75);
  }

  updateChips(null);
  infoPanel.classList.add('hidden');
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
    btn.style.color = d <= 2 ? '#d0d0e8' : '#0e0e1a';
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
  if (map.getLayer('lsoa-peers')) {
    map.setFilter('lsoa-selected', neverFilter());
    map.setFilter('lsoa-peers', codesFilter(peers));
    map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.45);
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

// ── Geolocation ───────────────────────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    geoMsg.textContent = 'Geolocation is not supported by your browser.';
    return;
  }
  geoMsg.textContent = 'Finding your location…';

  navigator.geolocation.getCurrentPosition(
    ({ coords: { latitude: lat, longitude: lon } }) => {
      geoMsg.textContent = '';
      map.flyTo({ center: [lon, lat], zoom: 11, speed: 1.4 });

      const nearby = [];
      for (const [code, area] of Object.entries(spfData.areas)) {
        if (area.lat == null || area.lon == null) continue;
        const yd = area[currentYear];
        if (!yd || yd.decile !== 10) continue;
        if (haversineKm(lat, lon, area.lat, area.lon) <= GEO_RADIUS_KM) nearby.push(code);
      }

      if (nearby.length) {
        selectedCode = null;
        activeDecile = 10;
        map.setFilter('lsoa-selected', neverFilter());
        map.setFilter('lsoa-peers', codesFilter(nearby));
        map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.45);
        updateChips(10);
        geoMsg.textContent =
          `${nearby.length} sunniest area${nearby.length !== 1 ? 's' : ''} within ${GEO_RADIUS_KM} km`;
      } else {
        geoMsg.textContent = `No top-decile areas within ${GEO_RADIUS_KM} km of your location.`;
      }
    },
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
    if (map.getLayer('lsoa-fill')) {
      map.setPaintProperty('lsoa-fill', 'fill-color', buildColorExpression(yearParam));
    }
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

  // Resolve currentYear to a valid year from the data
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
