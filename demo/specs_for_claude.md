# SPF Explorer — Technical Specification

**Imago · UKRI · Smart Data Research UK**

| | |
|---|---|
| Version | 0.5 — 2017 dropped (unreliable data); 2018–2025 |
| Status | Live on GitHub Pages |
| Data | SPF GeoPackages 2018–2025 (Imago) · layer names vary by year (see §3.2) |
| Hosting | GitHub Pages (`itsshaonlee/imago-spf-explorer` → transfer to Imago-SDRUK) |
| Last updated | July 2026 |

---

## 1. Overview

The SPF Explorer is a public-facing interactive web map that lets anyone browse cloud probability values (Sun Probability Framework) for every small area in the UK. The core interaction is: click an LSOA or Data Zone, see its raw value and national percentile rank, and optionally drag a value-range slider to highlight every other small area nationally whose current-year value falls in that range.

A secondary entry point — **Find sunny near me** — uses browser geolocation to fly to the user's location and highlight the sunniest 10% of small areas (by percentile rank) within a 10 km radius.

> **Why not deciles?** Deciles were originally assigned per year via `pd.qcut`, independently for each year. That meant the same raw value could land in a different decile in different years purely because that year's national distribution shifted — masking real year-to-year change once the year range grew past 2 years. Percentile rank and the colour scale are now both computed once against the *entire* dataset (all years × all areas), so a given value reads identically no matter which year is selected.

> **Design reference:** Modelled on the Imago Embeddings UK Explorer (`Imago-SDRUK/embeddings-uk-explorer`). Carto Dark Matter (no-labels) basemap. Figtree font. SDR-UK brand palette.

---

## 2. User interactions

### 2.1 Browse and click

- On load: map centred on UK, all small areas visible as a choropleth (SPF value → continuous colour, scaled against the whole dataset's min/max)
- Click any area: right panel populates with raw value and national percentile rank; map highlights all peers nationally within ±2.5 percentile points (current year) — the equivalent of the old same-decile highlight, at percentile-rank granularity instead of a 10-way bucket
- Clicking a different area replaces selection; clicking the same area deselects
- Reset button returns to overview, clears selection, range highlight, and geo results

### 2.2 Search

- Sidebar text input accepts `data_zone_code` (e.g. `E01004190`) or area name
- Dropdown results (max 8); selecting one flies the map to that area and triggers click behaviour

### 2.3 Find sunny near me

- Button triggers browser Geolocation API
- On success: map flies to user location, highlights areas at or above the 90th percentile (sunniest 10% nationally, computed across all years) within 10 km
- On denial/error: polite inline message, does not block other functionality

### 2.4 Year selector

- Chevron buttons in topbar step through available years (2023, 2024, 2025)
- Changing year updates choropleth via `setFeatureState` (no tile reload, instant)
- Available years read from `spf-data.json` at load time — adding a new year requires no app code changes

### 2.5 Shareable URLs

- URL updates on every meaningful state change using the History API (no page reload)
- Parameters: `?area=E01004190`, `?year=2023`, `?range=50.6-70.2` — sufficient to restore full view
- Sharing a URL opens the map zoomed to that area, year, and range highlight

### 2.6 Value-range slider

- Dual-thumb range slider in sidebar, bounded by the dataset-wide min/max value
- Dragging either thumb highlights all areas nationally whose *current year* value falls within `[lo, hi]`
- Selecting an area or hitting Reset clears the range back to full bounds (inactive state)

---

## 3. Data

### 3.1 Source GeoPackages

One GeoPackage per year, stored in `data/raw/` (gitignored):

```
data/raw/SPF_LSOA_2023.gpkg
data/raw/SPF_LSOA_2024.gpkg
data/raw/SPF_LSOA_2025.gpkg
```

> **Adding a new year:** Drop the new GeoPackage into `data/raw/` and re-run the pipeline (§6). No app code changes needed — the year is inferred from the filename.

### 3.2 GeoPackage schema

| | |
|---|---|
| Area code column | `data_zone_code` (string) |
| SPF value column | `cloudprob_corrected_mean` (float64) |
| Geometry type | MultiPolygon |
| CRS | **EPSG:27700 — British National Grid** |
| Feature count | 46,844 (all UK small areas) |
| Value range | 0–100 (cloud probability, annual mean — higher = more cloud) |

> ⚠️ **Layer names differ by year.** Unlike the original spec, the layer name is not consistent:
> - 2023: `SPF_LSOA_2023`
> - 2024: `SPF_LSOA_level`
> - 2025: `SPF_LSOA_2025`
>
> `extract.py` does **not** pass a `layer=` argument to `gpd.read_file()` — geopandas reads the first layer automatically. Do not add `layer=` unless confirmed for a new file.

### 3.3 SPF value

| | |
|---|---|
| Column | `cloudprob_corrected_mean` |
| Range | 0–100 |
| Direction | Low = more sun · High = more cloud |
| Display | Show as-is in info panel (e.g. `57.5`). No further scaling needed. |

### 3.4 Value range and percentile rank

Computed once across the **entire** dataset — all years × all 46,844 UK small areas — not per year:

- `value_min` / `value_max`: the raw `cloudprob_corrected_mean` min/max across every row. Drives the continuous colour scale (`valueToColor` in `main.js`) so a given value renders identically in every year.
- `pct`: a sun-adjusted percentile rank per area/year, `0`–`100`. Computed as `(1 - rank(value, pct=True)) * 100` over the full dataset, so `100` = sunniest 1% of all area-years, `0` = cloudiest. Direction matches the old decile-10-is-sunniest convention. Shown in the info panel as "Percentile rank (UK, `{minYear}`–`{maxYear}`)".

> **Rationale:** per-year deciles (`pd.qcut(q=10, ...)` recomputed each year) meant the same raw value could land in a different bucket in different years purely because that year's distribution shifted. A single global min/max and percentile avoids that.

### 3.5 Area names and centroids

Area names and centroids are sourced from a separate GeoPackage `UK_LSOA_DZ.gpkg` (gitignored, stored in `data/raw/`). `deciles.py` reads this file and extracts nation-specific name columns:

- **England/Wales LSOAs:** `LSOA21NM`
- **Scotland Data Zones:** `DataZone` (or equivalent — check column names on the file)
- **NI Super Output Areas:** `SOA_LABEL` (or equivalent)

Centroids are computed in projected CRS (EPSG:27700) then reprojected:

```python
gdf.geometry.centroid.to_crs("EPSG:4326")
```

The resulting `lat` and `lon` are stored in `spf-data.json` for the map's `flyTo` and geolocation features.

### 3.6 spf-data.json schema

Output of the build pipeline. Committed to `data/processed/spf-data.json`. Loaded once on startup, held in memory (~15 MB raw / ~2.3 MB gzipped over the wire, for 46,844 areas × 8 years).

```json
{
  "meta": {
    "years": [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
    "generated": "2026-07-23",
    "value_col": "cloudprob_corrected_mean",
    "code_col": "data_zone_code",
    "value_min": 52.62,
    "value_max": 89.06
  },
  "areas": {
    "E01000001": {
      "name": "City of London 001A",
      "lat": 51.514,
      "lon": -0.092,
      "2023": { "value": 57.54, "pct": 62 },
      "2024": { "value": 55.12, "pct": 71 },
      "2025": { "value": 56.80, "pct": 65 }
    }
  }
}
```

---

## 4. Architecture

### 4.1 Separation of concerns

Tiles (geometry) and data (SPF values) are kept strictly separate. Tiles are built once — boundaries do not change year to year. Only `spf-data.json` changes when a new year ships.

### 4.2 Vector tiles — PMTiles

| | |
|---|---|
| Format | **PMTiles v3** — single file, HTTP range requests |
| Tool | GDAL MVT driver (`ogr2ogr -f MVT`) on Windows via OSGeo4W |
| Intermediate | `tiles/` directory (z5–z14 .pbf pyramid, 171k files, gitignored) |
| Final output | `tiles/lsoa.pmtiles` — **committed to repo** (95 MiB, brotli-compressed) |
| Zoom range | z5 (UK overview) to z14 (LSOA detail) |
| Compression | Brotli quality=9 applied per tile in `build_pmtiles.py` |
| Hosting | GitHub Pages — served via HTTP range requests |
| Update frequency | One-time. Rebuild only if ONS releases new boundaries. |

> **Why PMTiles?** The original spec used a .pbf directory (171k files = 171k HTTP requests on first load). PMTiles consolidates this into 2–5 range requests per viewport, matching the load-time smoothness of the reference `embeddings-uk-explorer`.

> **GitHub file size:** 95 MiB (95.35 MiB) is under GitHub's 100 MiB hard limit. GitHub warns at 50 MiB — the warning is cosmetic and does not affect serving.

### 4.3 Browser client

| | |
|---|---|
| Map library | MapLibre GL JS v4 |
| Basemap | Carto Dark Matter no-labels (`dark_matter_nolabels/{z}/{x}/{y}.png`) — no `@2x` suffix |
| Attribution | `© Carto Dark Matter · ONS Open Geography · Imago UKRI` |
| Tile source | `pmtiles://` protocol — MapLibre fetches byte ranges from `lsoa.pmtiles` |
| Choropleth | `setFeatureState` per area → `['coalesce', ['feature-state', 'color'], '#44445a']` in paint |
| `promoteId` | `{ 'lsoa': 'data_zone_code' }` — uses the area code as MapLibre feature ID |
| Data join | JS object built at startup: `code → { name, lat, lon, year → { value, pct } }` |
| Click handler | Reads `data_zone_code` from clicked feature → shows raw value + percentile in info panel → filters `lsoa-highlight` to peers within ±2.5 percentile points nationally (current year) |
| Range slider | Two `<input type=range>` bounded by `meta.value_min`/`value_max` → filters current year's areas to `[lo, hi]` → highlight layer |
| Geolocation | Browser Geolocation API → `flyTo` → haversine filter for nearby areas with `pct >= 90` |
| URL state | History API `replaceState` on click/year change; parsed on load to restore state |
| Font | Figtree via Google Fonts |
| Default view | UK centred: `[-3.0, 55.0]`, zoom 5 |

### 4.4 Colour ramp

Continuous, not discrete. `COLOR_STOPS` in `main.js` holds 10 hex values, one hue (this app's brand blue, `#1877CF`), pale/sunniest → dark navy/cloudiest; `valueToColor(value)` normalises the value against `meta.value_min`/`value_max` and linearly interpolates the RGB channels between the two nearest stops. Identical across years since the min/max are fixed once, globally.

> **Why not the original hand-picked blue ramp?** It measured badly: 5 of its 9 adjacent steps fell below the minimum perceptible-lightness-gap (OKLCH ΔL ≥ 0.06), concentrated in the value range most UK areas actually occupy — areas that were meaningfully different in cloud probability looked nearly identical on the map. A two-hue warm/cool version was tried and rejected in favour of staying single-hue; the fix that shipped holds the brand blue's hue constant and steps OKLCH lightness evenly across all 10 stops, so every step stays visually distinct end to end without introducing a second hue.

| State | Style |
|---|---|
| Selected area | White `#FFFFFF` outline, 2px, full opacity |
| Highlighted areas (click-a-area peers within ±2.5 percentile, value-range slider, or "find sunny near me") | Teal `#03CEA3` outline, 1.5px, opacity 0.9 — `lsoa-highlight-outline` layer, filter always kept in sync with the `lsoa-highlight` fill via `setHighlightFilter()` |
| Non-highlighted / background | fill-opacity 0.35 when any selection/range is active; 0.92 otherwise |

---

## 5. Build pipeline

### 5.1 Directory structure

```
imago-spf-explorer/
  data/
    raw/                        # gitignored — store locally
      SPF_LSOA_2023.gpkg
      SPF_LSOA_2024.gpkg
      SPF_LSOA_2025.gpkg
      UK_LSOA_DZ.gpkg           # area names + geometry (all nations)
    processed/
      spf-data.json             # committed — pipeline output
      spf_all_years.csv         # gitignored — intermediate
  tiles/                        # directory tree gitignored
    lsoa.pmtiles                # committed — 95 MiB, brotli
  pipeline/
    extract.py                  # GeoPackages → tidy CSV
    deciles.py                  # global value stats + percentile, merge names, build JSON
    build_tiles.ps1             # one-time: GDAL MVT tile pyramid (Windows)
    build_pmtiles.py            # one-time: tiles/ → lsoa.pmtiles
    requirements.txt            # geopandas, pandas, numpy, pyogrio, pmtiles, brotli
  app/
    index.html
    main.js
    style.css
  assets/
    Imago-logo.png
  .github/workflows/
    deploy.yml                  # deploy-only — no CI data pipeline
  index.html                    # root redirect to app/
```

### 5.2 extract.py

Loops over all `.gpkg` files in `data/raw/` matching `SPF_LSOA_*.gpkg`. For each:

- Opens with geopandas — **no `layer=` argument** (layer names differ per year)
- Reads `data_zone_code` and `cloudprob_corrected_mean`
- Infers year from filename pattern `SPF_LSOA_YYYY.gpkg`
- Drops geometry
- Appends to a tidy long-format dataframe

Output: `data/processed/spf_all_years.csv` — columns: `data_zone_code, year, cloudprob_corrected_mean`

### 5.3 deciles.py

- Reads `spf_all_years.csv`
- Reads `data/raw/UK_LSOA_DZ.gpkg` for area names and centroids (no `layer=` arg)
- Computes centroids in EPSG:27700, reprojects to EPSG:4326 for `lat`/`lon`
- Extracts nation-appropriate name column per area
- Computes `value_min`/`value_max` once across the whole dataset (all years, all areas) and a sun-adjusted percentile rank (`pct`) per row, also computed against the whole dataset (see §3.4) — no more per-year `pd.qcut`
- Builds nested JSON (see §3.6 schema)
- Writes `data/processed/spf-data.json`

### 5.4 build_tiles.ps1 (one-time, Windows)

Run once to generate the intermediate .pbf tile pyramid in `tiles/`. Requires OSGeo4W.

> ⚠️ **PROJ/GDAL version conflict:** OSGeo4W ships an older `proj.db`. Override with the conda environment's newer databases before running:

```powershell
$env:PROJ_DATA = "C:\Users\spspa\anaconda3\envs\raster_env\Library\share\proj"
$env:GDAL_DATA = "C:\Users\spspa\anaconda3\envs\raster_env\Library\share\gdal"

& "C:\OSGeo4W\bin\ogr2ogr.exe" `
  -f MVT tiles `
  data\SPF_LSOA_2023.gpkg `
  -t_srs EPSG:4326 `
  -select data_zone_code `
  -nln lsoa `
  -dsco MINZOOM=5 `
  -dsco MAXZOOM=14 `
  -dsco COMPRESS=NO `
  -dsco MAX_SIZE=500000
```

Result: 171k `.pbf` files in `tiles/` (~142 MB uncompressed). These are **not committed** — they serve as input to `build_pmtiles.py`.

### 5.5 build_pmtiles.py (one-time)

Converts the `tiles/` directory into a single `tiles/lsoa.pmtiles` file:

- Scans all `.pbf` files, converts `(z, x, y)` to PMTiles tile ID (Hilbert curve ordering)
- Sorts by tile ID for clustered, spatially coherent range requests
- Brotli-compresses each tile at quality=9 before writing
- Calls `Writer.finalize()` with tile type MVT and compression BROTLI

Run with the `raster_env` conda environment:

```powershell
C:\Users\spspa\anaconda3\envs\raster_env\python.exe pipeline\build_pmtiles.py
```

Output: `tiles/lsoa.pmtiles` — **committed to repo**.

### 5.6 GitHub Actions — deploy.yml

**Deploy-only** workflow. The data pipeline (extract.py, deciles.py) runs locally; only outputs are committed. Steps:

1. Checkout repo
2. Upload entire repo root as GitHub Pages artifact (so `../tiles/lsoa.pmtiles` resolves from `app/`)
3. Deploy to GitHub Pages

> **No CI data pipeline.** GeoPackages are too large (multi-GB) for CI. Run the pipeline locally, commit `spf-data.json`, and push.

---

## 6. Running the pipeline (local)

Full rebuild from scratch (new year or boundary update):

```powershell
# 1. Activate environment
conda activate raster_env

# 2. Extract values from all GeoPackages
python pipeline\extract.py

# 3. Compute global value stats + percentile, build JSON
python pipeline\deciles.py

# 4. (Boundaries only — skip if already built) Build tile pyramid
.\pipeline\build_tiles.ps1

# 5. (Boundaries only) Convert to PMTiles
python pipeline\build_pmtiles.py

# 6. Commit outputs
git add data/processed/spf-data.json tiles/lsoa.pmtiles
git commit -m "update SPF data YYYY"
git push
```

New-year-only update (no boundary change): steps 2, 3, 6 only.

---

## 7. Mobile layout

The three-panel desktop layout collapses at viewports below 768px into a full-screen map with overlaid panels:

- **Sidebar** → bottom sheet, collapsed by default, drag handle to expand
- **Info panel** → slides up from bottom on area tap, overlays lower half of map
- **Year selector** and **Find sunny near me** → inside bottom sheet
- **Zoom controls** and **Reset** → remain as floating map buttons
- URL sharing works identically on mobile

> **Implementation:** Single `max-width: 768px` media query. MapLibre handles touch and pinch-zoom natively.

---

## 8. Brand and design tokens

| Token | Value |
|---|---|
| Font | Figtree (Google Fonts) — Bold for headings/labels, Regular for body |
| Navy | `#24226F` — topbar, headings |
| Teal | `#03CEA3` — highlights, active states |
| Blue | `#1877CF` — links |
| Orange | `#FF8F42` — logo accent |
| Grey | `#8C91A8` — secondary text, muted labels |
| Light grey | `#E2E5F3` — subtle backgrounds |
| Imago accent | `#4A4A49` — neutral dark |
| Basemap | Carto Dark Matter no-labels — use `{z}/{x}/{y}.png` (no `@2x` suffix) |
| Attribution | `© Carto Dark Matter · ONS Open Geography · Imago UKRI` |

---

## 9. Resolved decisions

| Question | Decision |
|---|---|
| GeoPackage storage | Local only — gitignored. Too large for LFS. Pipeline runs locally. |
| Area names source | `UK_LSOA_DZ.gpkg` — single file covering all three nations. |
| Tile format | PMTiles (single file, range requests) — not a .pbf directory. |
| Tile toolchain | GDAL MVT driver (`ogr2ogr -f MVT`) on Windows — no tippecanoe/WSL needed. |
| Tile compression | Brotli quality=9 in `build_pmtiles.py` — tiles within PMTiles file compressed individually. |
| Choropleth method | `setFeatureState` + `promoteId` — not a match expression. Year change is instant. |
| Find sunny radius | 10 km — confirmed. |
| ONS profile links | Removed — added little value, URL patterns differ by nation. |
| Default year on load | 2025 (most recent). |
| GitHub file size | `lsoa.pmtiles` is 95.35 MiB — under the 100 MiB hard limit. Warning at 50 MiB is cosmetic. |
