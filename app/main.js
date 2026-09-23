// SPF Explorer — main.js

const DATA_PATH     = '../data/processed/spf-data.json';
const PMTILES_PATH  = '../tiles/lsoa.pmtiles';
const UK_CENTER     = [-3.0, 55.0];
const UK_ZOOM       = 5;
const GEO_RADIUS_KM = 10;

// Single hue (this app's own brand blue, #1877CF), pale/sunny (low value) to
// dark navy/cloudy (high value), in increasing-value order. Built in OKLCH
// with the hue held constant and lightness stepped evenly, so every step
// stays visually distinct end to end — the original hand-picked blue ramp
// had 5 of 9 adjacent steps below the minimum perceptible-lightness-gap.
const COLOR_STOPS = [
  '#d8eaff', '#aed4ff', '#83beff', '#52a6ff', '#398fe7',
  '#1e79ce', '#0063b3', '#004f91', '#003b70', '#002950',
];

const SUNNY_PCT_THRESHOLD = 90; // top 10% nationally across all years
const PEER_PCT_BAND = 2.5; // clicking an area highlights peers within +/- this many percentile points

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

// Maps a raw value to a colour along COLOR_STOPS, normalised against the
// dataset-wide min/max (spfData.meta), so a given value renders identically
// in every year rather than shifting with that year's own distribution.
function valueToColor(value) {
  const { value_min, value_max } = spfData.meta;
  const t = Math.min(1, Math.max(0, (value - value_min) / (value_max - value_min)));
  const idx = t * (COLOR_STOPS.length - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, COLOR_STOPS.length - 1);
  const frac = idx - i0;
  const c0 = hexToRgb(COLOR_STOPS[i0]);
  const c1 = hexToRgb(COLOR_STOPS[i1]);
  return rgbToHex(c0.map((v, i) => v + (c1[i] - v) * frac));
}

// ── State ─────────────────────────────────────────────────────────────────────

let spfData      = null;
let currentYear  = null;  // set from meta.years (latest) once data loads
let selectedCode = null;
let rangeActive  = false;
let rangeLo      = null;
let rangeHi      = null;
let geoBusy      = false; // guards against overlapping geo searches
let placeSuggestions = []; // live place-autocomplete candidates, matched by index

// ── DOM refs ──────────────────────────────────────────────────────────────────

const yearDisplay   = document.getElementById('year-display');
const yearSlider    = document.getElementById('year-slider');
const yearMin       = document.getElementById('year-min');
const yearMax       = document.getElementById('year-max');
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const geoPlaceInput   = document.getElementById('geo-place-input');
const geoPlaceBtn     = document.getElementById('geo-place-btn');
const geoPlaceResults = document.getElementById('geo-place-results');
const geoLocateBtn    = document.getElementById('geo-locate-btn');
const geoMsg          = document.getElementById('geo-msg');
const geoResults      = document.getElementById('geo-results'); // lives in info-geo (right panel)
const rangeLoInput  = document.getElementById('range-lo');
const rangeHiInput  = document.getElementById('range-hi');
const rangeReadout  = document.getElementById('range-readout');
const legendMinEl   = document.getElementById('legend-min');
const legendMaxEl   = document.getElementById('legend-max');
const resetBtn      = document.getElementById('reset-btn');
const infoPanel     = document.getElementById('info-panel');
const infoArea      = document.getElementById('info-area');
const infoGeo       = document.getElementById('info-geo');
const infoName      = document.getElementById('info-name');
const infoCodeEl    = document.getElementById('info-code');
const infoValue     = document.getElementById('info-value');
const infoPctLabel  = document.getElementById('info-pct-label');
const infoPctEl     = document.getElementById('info-pct');
const infoPeersNote = document.getElementById('info-peers-note');
const infoClose     = document.getElementById('info-close');
const infoGeoTitle  = document.getElementById('info-geo-title');
const infoGeoSub    = document.getElementById('info-geo-sub');
const sidebar       = document.getElementById('sidebar');
const sidebarHandle = document.getElementById('sidebar-handle');
const aboutToggle   = document.getElementById('about-toggle');
const aboutContent  = document.getElementById('about-content');

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
}

// ── Feature-state choropleth ──────────────────────────────────────────────────

function applyYearStates(year) {
  for (const [code, area] of Object.entries(spfData.areas)) {
    const yd = area[year];
    map.setFeatureState(
      { source: 'lsoa', sourceLayer: 'lsoa', id: code },
      { color: yd ? valueToColor(yd.value) : null },
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

// Keeps the highlight fill and its teal outline in sync — always the same set.
function setHighlightFilter(filterExpr) {
  map.setFilter('lsoa-highlight', filterExpr);
  map.setFilter('lsoa-highlight-outline', filterExpr);
}

// ── Layer setup ───────────────────────────────────────────────────────────────

function setupLayers() {
  map.addSource('lsoa', {
    type: 'vector',
    url: resolvePmtilesUrl(),
    promoteId: { 'lsoa': 'data_zone_code' },
  });

  // Choropleth fill — colour driven by feature-state set in applyYearStates().
  // fill-antialias: false — with the ramp now spanning real lightness
  // contrast, GL's default edge antialiasing between adjacent LSOAs of
  // different colours read as a cluttered grid of seams; this removes it.
  map.addLayer({
    id: 'lsoa-fill',
    type: 'fill',
    source: 'lsoa',
    'source-layer': 'lsoa',
    paint: {
      'fill-color': ['coalesce', ['feature-state', 'color'], '#44445a'],
      'fill-opacity': 0.92,
      'fill-antialias': false,
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
      'fill-opacity': 0.97,
      'fill-antialias': false,
    },
    filter: neverFilter(),
  });

  // Teal outline on highlighted areas — a hue distinct from the whole blue
  // ramp, so "highlighted" reads clearly regardless of each area's own
  // colour, instead of relying on the fill-opacity bump alone.
  map.addLayer({
    id: 'lsoa-highlight-outline',
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

  // Apply colour states now (buffered by MapLibre) and again after first idle
  // so states are guaranteed to render even if tiles loaded before the initial call.
  applyYearStates(currentYear);
  map.once('idle', () => applyYearStates(currentYear));
}

// ── Year ──────────────────────────────────────────────────────────────────────

// Recolouring writes feature state for every area, so a fast scrub is coalesced
// to at most one repaint per frame. The label still tracks the handle exactly.
let pendingYearFrame = null;

function applyYear(year) {
  currentYear = year;
  yearDisplay.textContent = year;
  syncYearControl();
  clearSelection();

  if (!map.getLayer('lsoa-fill')) return;
  if (pendingYearFrame !== null) cancelAnimationFrame(pendingYearFrame);
  pendingYearFrame = requestAnimationFrame(() => {
    pendingYearFrame = null;
    applyYearStates(currentYear);
  });
}

function syncYearControl() {
  const i = spfData.meta.years.indexOf(currentYear);
  if (i >= 0) yearSlider.value = i;
}

yearSlider.addEventListener('input', () => {
  if (!spfData) return;  // slider is inert until meta.years has populated it
  const year = spfData.meta.years[Number(yearSlider.value)];
  if (year !== undefined && year !== currentYear) applyYear(year);
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
  rangeActive  = false;

  const yd = area[currentYear];
  let peerCount = 0;

  map.setFilter('lsoa-selected', ['==', ['get', 'data_zone_code'], code]);
  map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.35);

  if (yd) {
    const peers = [];
    for (const [otherCode, otherArea] of Object.entries(spfData.areas)) {
      const otherYd = otherArea[currentYear];
      if (otherYd && Math.abs(otherYd.pct - yd.pct) <= PEER_PCT_BAND) peers.push(otherCode);
    }
    peerCount = peers.length;
    setHighlightFilter(codesFilter(peers));
  } else {
    setHighlightFilter(neverFilter());
  }

  infoName.textContent   = area.name || code;
  infoCodeEl.textContent = code;
  infoValue.textContent  = yd ? `${yd.value.toFixed(1)}` : '—';
  infoPctEl.textContent  = yd ? `${ordinal(yd.pct)} percentile` : '—';
  infoPctEl.style.color  = yd ? valueToColor(yd.value) : 'inherit';
  infoPeersNote.textContent = yd
    ? `${peerCount.toLocaleString()} areas within ±${PEER_PCT_BAND} percentile nationally`
    : '';
  showInfoPanel('area');

  if (fly && area.lat != null && area.lon != null) {
    map.flyTo({ center: [area.lon, area.lat], zoom: Math.max(map.getZoom(), 12), speed: 1.4 });
  }

  pushURLState();
}

function clearSelection() {
  selectedCode = null;
  clearRange();

  if (map.getLayer('lsoa-selected')) {
    map.setFilter('lsoa-selected', neverFilter());
    setHighlightFilter(neverFilter());
    map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.92);
  }

  infoPanel.classList.add('hidden');
  geoResults.innerHTML = '';
  geoMsg.textContent = '';
  pushURLState();
}

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// ── Value-range slider ───────────────────────────────────────────────────────

function initRangeSlider() {
  const { value_min, value_max } = spfData.meta;
  for (const input of [rangeLoInput, rangeHiInput]) {
    input.min = value_min;
    input.max = value_max;
    input.step = 0.1;
  }
  rangeLoInput.value = value_min;
  rangeHiInput.value = value_max;
  updateRangeReadout(value_min, value_max);
}

function updateRangeReadout(lo, hi) {
  rangeReadout.textContent = `${lo.toFixed(1)} – ${hi.toFixed(1)}`;
}

function applyRange(lo, hi) {
  selectedCode = null;
  rangeActive = true;
  rangeLo = lo;
  rangeHi = hi;
  updateRangeReadout(lo, hi);

  const codes = [];
  for (const [code, area] of Object.entries(spfData.areas)) {
    const yd = area[currentYear];
    if (yd && yd.value >= lo && yd.value <= hi) codes.push(code);
  }

  map.setFilter('lsoa-selected', neverFilter());
  setHighlightFilter(codesFilter(codes));
  map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.35);

  infoPanel.classList.add('hidden');
  pushURLState();
}

function clearRange() {
  rangeActive = false;
  rangeLo = null;
  rangeHi = null;
  if (spfData) {
    const { value_min, value_max } = spfData.meta;
    rangeLoInput.value = value_min;
    rangeHiInput.value = value_max;
    updateRangeReadout(value_min, value_max);
  }
}

function onRangeInput() {
  let lo = Number(rangeLoInput.value);
  let hi = Number(rangeHiInput.value);
  if (lo > hi) {
    if (document.activeElement === rangeLoInput) hi = lo; else lo = hi;
    rangeLoInput.value = lo;
    rangeHiInput.value = hi;
  }
  applyRange(lo, hi);
}

rangeLoInput.addEventListener('input', onRangeInput);
rangeHiInput.addEventListener('input', onRangeInput);

// ── Search ────────────────────────────────────────────────────────────────────

let searchTimer = null;

searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim().toLowerCase();
  if (!q) { searchResults.style.display = 'none'; return; }
  searchTimer = setTimeout(() => runSearch(q), 180);
});

function runSearch(q) {
  if (!spfData) return; // data still loading — re-run once it's ready, see init()
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
  if (!e.target.closest('#geo-input-row')) geoPlaceResults.style.display = 'none';
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

// Returns up to 10 closest areas in the sunniest 10% nationally (across all
// years) within GEO_RADIUS_KM, sorted by distance, plus how many qualified
// in total (dense sunny regions — e.g. the south coast — routinely have
// far more than 10 within range).
function findSunnyNear(lat, lon, label = 'your location') {
  geoResults.innerHTML = '';
  const candidates = [];
  for (const [code, area] of Object.entries(spfData.areas)) {
    if (area.lat == null || area.lon == null) continue;
    const yd = area[currentYear];
    if (!yd || yd.pct < SUNNY_PCT_THRESHOLD) continue;
    const distKm = haversineKm(lat, lon, area.lat, area.lon);
    if (distKm <= GEO_RADIUS_KM) candidates.push({ code, area, distKm });
  }
  candidates.sort((a, b) => a.distKm - b.distKm);
  const nearest = candidates.slice(0, 10);
  const total = candidates.length;

  map.flyTo({ center: [lon, lat], zoom: 11, speed: 1.4 });

  if (!nearest.length) return { nearest, total };

  selectedCode = null;
  map.setFilter('lsoa-selected', neverFilter());
  setHighlightFilter(codesFilter(nearest.map(c => c.code)));
  map.setPaintProperty('lsoa-fill', 'fill-opacity', 0.35);

  geoMsg.textContent = total > nearest.length
    ? `Closest ${nearest.length} of ${total} sunniest-10% areas within ${GEO_RADIUS_KM} km of ${label} — fetching weather…`
    : `${total} sunniest-10% area${total !== 1 ? 's' : ''} within ${GEO_RADIUS_KM} km of ${label} — fetching weather…`;

  return { nearest, total };
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

// C) sunny at search point, but all sunniest-10% areas nearby are cloudy
const IRONY_QUIPS = {
  england: [
    'You\'ve got the sun — your top picks haven\'t. Swings and roundabouts.',
    'You\'re in the clear while the sunniest spots nearby are under cloud. SPF\'s just an average.',
    'Funny — you\'re sunny, they\'re not. Make of that what you will.',
  ],
  scotland: [
    'Aye, you\'re sunny but your top picks are dreich. SPF\'s just an average, mind.',
    'You\'re in the clear. The sunniest spots nearby are not. Swings and roundabouts.',
  ],
  wales: [
    'You\'ve got the sun but the sunniest spots nearby haven\'t. The valleys keep their secrets.',
    'Sunny where you are, cloudy where it counts. Very SPF.',
  ],
  northern_ireland: [
    'You\'re in the clear but your top picks aren\'t. Ach, sure.',
    'Sunny for you, cloudy up top. SPF\'s just an average after all.',
  ],
};

const NO_NEARBY_QUIPS = {
  england: [
    'No sunniest-10% spots within 10 km. You may need to relocate.',
    'Nothing in the sunniest 10% nearby. Might be time to move.',
    'Not a sunny LSOA in sight. England, innit.',
  ],
  scotland: [
    'Nae luck nearby. Try further south, maybe.',
    'Not a sunny LSOA for miles. Fairly on-brand.',
    'Aye, nothing. Classic.',
  ],
  wales: [
    'No sunny spots within 10 km. The clouds are thorough today.',
    'Nothing nearby in the sunniest 10%. Very Welsh.',
  ],
  northern_ireland: [
    'No luck nearby. Sure, what did you expect?',
    'Nowt in the sunniest 10% nearby. You\'re on your own.',
  ],
};

const SUNNY_QUIPS = {
  england: [
    'Look outside! Actual sunshine.',
    'Blimey, it\'s sunny. Get out there.',
    'Quick — before it changes.',
    'Rare sighting: sun over England. Go.',
  ],
  scotland: [
    'Look oot the windae!',
    'Aye, it\'s sunny. Dinnae waste it.',
    'Och, would ye look at that. Blue sky.',
  ],
  wales: [
    'Sunshine in Wales! Get outside.',
    'Even the valleys are bright today.',
    'Go on. Out you go.',
  ],
  northern_ireland: [
    'Catch yourself on — it\'s gorgeous out there.',
    'Wise up and get outside. It\'s sunny!',
  ],
};

const CLOUDY_QUIPS = {
  england: [
    'Not a patch of blue sky in sight. Quintessentially English.',
    'Overcast from coast to coast. England delivers.',
    'Blimey. Not exactly the Algarve, is it?',
    'Right then. Perhaps try the Canaries instead.',
    'Well. At least it\'s not raining. Probably.',
  ],
  scotland: [
    'Dreich, as they say up here.',
    'Aye, it\'s grim out there. Very Scottish.',
    'Solid grey. The Scots call this summer.',
    'Nae sun to be found. Classic.',
  ],
  wales: [
    'Solid grey from the valleys to the coast. Very Wales.',
    'Cymru am byth — and also, apparently, clouds.',
    'Typical Welsh weather, by the look of it.',
  ],
  northern_ireland: [
    'Grand soft day, as they say.',
    'Overcast from Belfast to the Glens. As expected.',
    'Classic Northern Ireland. Wouldn\'t have it any other way.',
  ],
};

function renderGeoResults(nearest, total, weatherData, label, country = 'england', searchWeather = null) {
  const n = nearest.length;
  const searchSunny = searchWeather && searchWeather.is_day && searchWeather.cloud_cover <= 30;

  infoGeoTitle.textContent = `Sunny places near ${label}`;
  geoMsg.textContent = total > n
    ? `Closest ${n} of ${total} found — see results →`
    : `${n} area${n !== 1 ? 's' : ''} found — see results →`;

  const rows = nearest.map(({ code, area, distKm }, i) => {
    const w = weatherData[i];
    const icon = w ? cloudIcon(w.cloud_cover, w.is_day) : '—';
    const meta = w
      ? `${distKm.toFixed(1)} km · ${w.cloud_cover}% cloud`
      : `${distKm.toFixed(1)} km · the meteorologist appears to have lost their way`;
    return `<div class="geo-result-item" data-code="${code}">
      <span class="geo-result-icon">${icon}</span>
      <div class="geo-result-info">
        <div class="geo-result-name">${area.name || code}</div>
        <div class="geo-result-meta">${meta}</div>
      </div>
    </div>`;
  }).join('');

  const hasData = weatherData.filter(Boolean);
  const allCloudy = hasData.length > 0 && hasData.every(w => w.is_day && w.cloud_cover >= 75);

  let subtitle;
  if (searchSunny && allCloudy) {
    // C) searcher is sunny, all sunniest-10% areas nearby are cloudy
    const pool = IRONY_QUIPS[country] || IRONY_QUIPS.england;
    subtitle = pool[Math.floor(Math.random() * pool.length)];
  } else if (searchSunny) {
    // A) searcher is sunny
    const pool = SUNNY_QUIPS[country] || SUNNY_QUIPS.england;
    subtitle = pool[Math.floor(Math.random() * pool.length)];
  } else if (allCloudy) {
    // D) all sunniest-10% areas nearby are cloudy
    const pool = CLOUDY_QUIPS[country] || CLOUDY_QUIPS.england;
    subtitle = pool[Math.floor(Math.random() * pool.length)];
  } else if (total > n) {
    subtitle = `Closest ${n} of ${total} sunniest-10% areas · live cloud cover`;
  } else {
    subtitle = `${n} closest sunniest-10% area${n !== 1 ? 's' : ''} · live cloud cover`;
  }
  infoGeoSub.textContent = subtitle;

  geoResults.innerHTML = rows;
  showInfoPanel('geo');
}

function parseCountry(addr = {}) {
  const state = (addr.state || '').toLowerCase();
  if (state.includes('scotland'))         return 'scotland';
  if (state.includes('wales') || state.includes('cymru')) return 'wales';
  if (state.includes('northern ireland')) return 'northern_ireland';
  return 'england';
}

async function geocodePlace(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=gb&addressdetails=1`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const results = await res.json();
  if (!results.length) return null;
  const r = results[0];
  return {
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    name: r.display_name.split(',')[0],
    country: parseCountry(r.address),
  };
}

// ── Live place autocomplete ──────────────────────────────────────────────────

let placeSearchTimer = null;
let placeSearchToken = 0; // discards stale responses that resolve out of order

geoPlaceInput.addEventListener('input', () => {
  clearTimeout(placeSearchTimer);
  const q = geoPlaceInput.value.trim();
  if (q.length < 3) {
    geoPlaceResults.style.display = 'none';
    geoPlaceResults.innerHTML = '';
    return;
  }
  placeSearchTimer = setTimeout(() => runPlaceAutocomplete(q), 350);
});

async function runPlaceAutocomplete(q) {
  const myToken = ++placeSearchToken;
  let results = [];
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=gb&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) results = await res.json();
  } catch {
    results = [];
  }
  if (myToken !== placeSearchToken) return; // a newer keystroke superseded this request

  placeSuggestions = results.map(r => ({
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    name: r.display_name.split(',')[0],
    detail: r.display_name.split(',').slice(1, 3).join(',').trim(),
    country: parseCountry(r.address),
  }));

  if (!placeSuggestions.length) {
    geoPlaceResults.style.display = 'none';
    geoPlaceResults.innerHTML = '';
    return;
  }

  geoPlaceResults.innerHTML = placeSuggestions.map((s, i) => `
    <div class="search-result" data-index="${i}">
      <div class="search-result-name">${s.name}</div>
      <div class="search-result-code">${s.detail}</div>
    </div>`).join('');
  geoPlaceResults.style.display = 'block';
}

geoPlaceResults.addEventListener('click', async (e) => {
  const el = e.target.closest('.search-result');
  if (!el || geoBusy) return;
  const s = placeSuggestions[Number(el.dataset.index)];
  if (!s) return;

  geoPlaceInput.value = s.name;
  geoPlaceResults.style.display = 'none';
  geoPlaceResults.innerHTML = '';

  setGeoBusy(true);
  geoMsg.textContent = 'Searching…';
  geoResults.innerHTML = '';
  try {
    await runGeoSearch(s.lat, s.lon, s.name, s.country);
  } finally {
    setGeoBusy(false);
  }
});

async function detectCountry(lat, lon) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
    { headers: { 'Accept': 'application/json' } },
  );
  if (!res.ok) return 'england';
  const data = await res.json();
  return parseCountry(data.address);
}

async function fetchSearchWeather(lat, lon) {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=cloud_cover,is_day&timezone=auto&forecast_days=1`,
  );
  return (await res.json()).current;
}

async function runGeoSearch(lat, lon, label = 'your location', country = 'england') {
  const { nearest, total } = findSunnyNear(lat, lon, label);

  // Fetch searcher's own weather in parallel with area weather
  const searchWeatherPromise = fetchSearchWeather(lat, lon).catch(() => null);

  if (!nearest.length) {
    const searchWeather = await searchWeatherPromise;
    const searchSunny = searchWeather && searchWeather.is_day && searchWeather.cloud_cover <= 30;
    geoMsg.textContent = '';
    infoGeoTitle.textContent = `No sunniest-10% areas near ${label}`;
    geoResults.innerHTML = '';

    if (searchSunny) {
      // B) sunny at search point but no sunniest-10% areas nearby
      infoGeoSub.textContent = 'No sunniest-10% LSOAs within 10 km — but look outside:';
      geoResults.innerHTML = `<div class="geo-result-item">
        <span class="geo-result-icon">${cloudIcon(searchWeather.cloud_cover, 1)}</span>
        <div class="geo-result-info">
          <div class="geo-result-name">It's actually sunny right now</div>
          <div class="geo-result-meta">${searchWeather.cloud_cover}% cloud · SPF reflects long-run probability, not today's forecast</div>
        </div>
      </div>`;
    } else {
      const pool = NO_NEARBY_QUIPS[country] || NO_NEARBY_QUIPS.england;
      infoGeoSub.textContent = pool[Math.floor(Math.random() * pool.length)];
    }
    showInfoPanel('geo');
    return;
  }

  try {
    const [weatherData, searchWeather] = await Promise.all([
      fetchWeatherForAreas(nearest),
      searchWeatherPromise,
    ]);
    renderGeoResults(nearest, total, weatherData, label, country, searchWeather);
  } catch {
    geoMsg.textContent = geoMsg.textContent.replace(' — fetching weather…', '');
  }
}

// Guards all three search entry points (go/Enter, suggestion click, use-my-
// location) against overlapping in-flight searches — each disables the
// trigger buttons for its own duration and clears them in a finally block.
function setGeoBusy(busy) {
  geoBusy = busy;
  geoPlaceBtn.disabled = busy;
  geoLocateBtn.disabled = busy;
}

async function handlePlaceSearch() {
  if (geoBusy) return;
  const q = geoPlaceInput.value.trim();
  if (!q) return;
  geoPlaceResults.style.display = 'none';
  setGeoBusy(true);
  geoMsg.textContent = 'Searching…';
  geoResults.innerHTML = '';
  try {
    const place = await geocodePlace(q);
    if (!place) {
      geoMsg.textContent = 'Place not found — try a different name or postcode.';
      return;
    }
    await runGeoSearch(place.lat, place.lon, place.name, place.country);
  } catch {
    geoMsg.textContent = 'Could not search — check your connection.';
  } finally {
    setGeoBusy(false);
  }
}

geoPlaceBtn.addEventListener('click', handlePlaceSearch);
geoPlaceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handlePlaceSearch(); });

geoResults.addEventListener('click', (e) => {
  const item = e.target.closest('.geo-result-item');
  if (item) selectArea(item.dataset.code, true);
});

geoLocateBtn.addEventListener('click', () => {
  if (geoBusy) return;
  if (!navigator.geolocation) {
    geoMsg.textContent = 'Geolocation is not supported by your browser.';
    return;
  }
  geoPlaceResults.style.display = 'none';
  setGeoBusy(true);
  geoMsg.textContent = 'Finding your location…';
  geoResults.innerHTML = '';
  navigator.geolocation.getCurrentPosition(
    async ({ coords: { latitude: lat, longitude: lon } }) => {
      try {
        const country = await detectCountry(lat, lon).catch(() => 'england');
        await runGeoSearch(lat, lon, 'your location', country);
      } finally {
        setGeoBusy(false);
      }
    },
    (err) => {
      const msgs = { 1: 'Location access was denied.', 2: 'Location unavailable.', 3: 'Request timed out.' };
      geoMsg.textContent = msgs[err.code] || 'Could not determine your location.';
      setGeoBusy(false);
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
  if (rangeActive) params.set('range', `${rangeLo}-${rangeHi}`);
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
    syncYearControl();
    applyYearStates(yearParam);
  }

  const area = params.get('area');
  if (area && spfData.areas[area]) { selectArea(area, true); return; }

  const rangeParam = params.get('range') || '';
  const [loStr, hiStr] = rangeParam.split('-');
  const lo = parseFloat(loStr);
  const hi = parseFloat(hiStr);
  const { value_min, value_max } = spfData.meta;
  if (!Number.isNaN(lo) && !Number.isNaN(hi) && lo <= hi && lo >= value_min && hi <= value_max) {
    rangeLoInput.value = lo;
    rangeHiInput.value = hi;
    applyRange(lo, hi);
  }
}

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────

sidebarHandle.addEventListener('click', () => sidebar.classList.toggle('expanded'));

// ── About toggle ──────────────────────────────────────────────────────────────

aboutToggle.addEventListener('click', () => {
  const expanded = aboutContent.classList.toggle('hidden') === false;
  aboutToggle.setAttribute('aria-expanded', String(expanded));
});

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  await loadData();

  // If the user typed into "Find an area" before the dataset finished
  // loading, runSearch() bailed out silently — re-run it now data is ready.
  const pendingQuery = searchInput.value.trim().toLowerCase();
  if (pendingQuery) runSearch(pendingQuery);

  if (!spfData.meta.years.includes(currentYear)) {
    currentYear = spfData.meta.years.at(-1);
  }

  const years = spfData.meta.years;
  yearSlider.max = years.length - 1;
  yearMin.textContent = years[0];
  yearMax.textContent = years.at(-1);
  yearDisplay.textContent = currentYear;
  syncYearControl();

  initRangeSlider();
  infoPctLabel.textContent = `Percentile rank (UK, ${years[0]}–${years.at(-1)})`;
  legendMinEl.textContent = spfData.meta.value_min.toFixed(1);
  legendMaxEl.textContent = spfData.meta.value_max.toFixed(1);

  if (map.isStyleLoaded()) {
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
