# SPF Explorer — Technical Specification

**Imago · UKRI · Smart Data Research UK**

| | |
|---|---|
| Version | 0.3 — updated to reflect built implementation |
| Status | Live on GitHub Pages |
| Data | SPF GeoPackages 2023–2025 (Imago) · layer names vary by year (see §3.2) |
| Hosting | GitHub Pages (`itsshaonlee/imago-spf-explorer` → transfer to Imago-SDRUK) |
| Last updated | May 2026 |

---

## 1. Overview

The SPF Explorer is a public-facing interactive web map that lets anyone browse cloud probability values (Sun Probability Framework) for every small area in the UK. The core interaction is: click an LSOA or Data Zone, see its national decile, and see every other small area in the same decile highlighted on the map.

A secondary entry point — **Find sunny near me** — uses browser geolocation to fly to the user's location and highlight the highest-decile small areas within a 10 km radius.

> **Design reference:** Modelled on the Imago Embeddings UK Explorer (`Imago-SDRUK/embeddings-uk-explorer`). Carto Dark Matter (no-labels) basemap. Figtree font. SDR-UK brand palette.

---

## 2. User interactions

### 2.1 Browse and click

- On load: map centred on UK, all small areas visible as a choropleth (SPF decile → colour)
- Click any area: right panel populates, map highlights all peers in the same national decile
- Clicking a different area replaces selection; clicking the same area deselects
- Reset button returns to overview, clears selection and highlights

### 2.2 Search

- Sidebar text input accepts `data_zone_code` (e.g. `E01004190`) or area name
- Dropdown results (max 8); selecting one flies the map to that area and triggers click behaviour

### 2.3 Find sunny near me

- Button triggers browser Geolocation API
- On success: map flies to user location, highlights top-decile (decile 10) areas within 10 km
- On denial/error: polite inline message, does not block other functionality

### 2.4 Year selector

- Chevron buttons in topbar step through available years (2023, 2024, 2025)
- Changing year updates choropleth via `setFeatureState` (no tile reload, instant)
- Available years read from `spf-data.json` at load time — adding a new year requires no app code changes

### 2.5 Shareable URLs

- URL updates on every meaningful state change using the History API (no page reload)
- Parameters: `?area=E01004190`, `?year=2023`, `?decile=5` — sufficient to restore full view
- Sharing a URL opens the map zoomed to that area, year, and decile highlight

### 2.6 Jump to decile

- 10-chip grid in sidebar: clicking a chip highlights all areas in that decile nationally
- Active chip reflects the clicked area's decile when a map selection is made

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

### 3.4 Deciles

Computed nationally across all 46,844 UK small areas, per year independently. Decile 1 = highest cloud (least sun). Decile 10 = lowest cloud (most sun). Computed using `pd.qcut(q=10, labels=range(10,0,-1))`.

> **Rationale:** National deciles are simpler to communicate than regional. A user seeing "decile 3" understands they are in the cloudier third of the UK.

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

Output of the build pipeline. Committed to `data/processed/spf-data.json`. Loaded once on startup, held in memory (~6–8 MB for 46,844 areas × 3 years).

```json
{
  "meta": {
    "years": [2023, 2024, 2025],
    "generated": "2026-05-01",
    "value_col": "cloudprob_corrected_mean",
    "code_col": "data_zone_code"
  },
  "areas": {
    "E01000001": {
      "name": "City of London 001A",
      "lat": 51.514,
      "lon": -0.092,
      "2023": { "value": 57.54, "decile": 3 },
      "2024": { "value": 55.12, "decile": 4 },
      "2025": { "value": 56.80, "decile": 3 }
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
| Data join | JS object built at startup: `code → { name, lat, lon, year → { value, decile } }` |
| Click handler | Reads `data_zone_code` from clicked feature → decile lookup → filter for peer outlines |
| Geolocation | Browser Geolocation API → `flyTo` → haversine filter for nearby top-decile areas |
| URL state | History API `replaceState` on click/year change; parsed on load to restore state |
| Font | Figtree via Google Fonts |
| Default view | UK centred: `[-3.0, 55.0]`, zoom 5 |

### 4.4 Colour ramp

| Decile | Colour |
|---|---|
| 1 — most cloud | `#24226F` — SDR-UK Navy |
| 2–3 | `#1877CF` — SDR-UK Blue |
| 4–6 | `#03CEA3` — SDR-UK Green/Teal |
| 7–8 | `#8EC840` — yellow-green |
| 9–10 — most sun | `#FF8F42` — SDR-UK Orange |

| State | Style |
|---|---|
| Selected area | White `#FFFFFF` outline, 2px, full opacity |
| Peer areas (same decile) | Teal `#03CEA3` outline, 1.5px, opacity 0.9 |
| Non-peer / background | fill-opacity 0.45 when any selection is active; 0.75 otherwise |

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
    deciles.py                  # assign deciles, merge names, build JSON
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
- For each year: assigns decile 1–10 using `pd.qcut(q=10, labels=range(10,0,-1))`
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

# 3. Assign deciles, build JSON
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
| Navy | `#24226F` — topbar, headings, decile 1 fill |
| Teal | `#03CEA3` — highlights, active states, decile 5 fill |
| Blue | `#1877CF` — links, decile 3 fill |
| Orange | `#FF8F42` — decile 10 fill, logo accent |
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
