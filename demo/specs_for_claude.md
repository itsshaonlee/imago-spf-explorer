# SPF Explorer — Technical Specification

**Imago · UKRI · Smart Data Research UK**

| | |
|---|---|
| Version | 0.2 — updated after GeoPackage inspection |
| Status | Pre-build · for handoff to Claude Code |
| Data | SPF GeoPackages 2023–2025 (Imago) · layer: SPF_LSOA_level |
| Hosting | GitHub Pages (personal repo → transfer to Imago-SDRUK) |
| Last updated | May 2026 |

---

## 1. Overview

The SPF Explorer is a public-facing interactive web map that lets anyone browse cloud probability values (Sun Probability Framework) for every small area in the UK. The core interaction is: click an LSOA or Data Zone, see its national decile, and see every other small area in the same decile highlighted on the map.

A secondary entry point — **Find sunny near me** — uses browser geolocation to fly to the user's location and highlight the highest-decile small areas within a 10 km radius.

> **Design reference:** Modelled on the Imago Embeddings UK Explorer (`Imago-SDRUK/embeddings-uk-explorer`). Carto Dark Matter (no-labels) basemap. Figtree font. SDR-UK brand palette.

---

## 2. User interactions

### 2.1 Browse and click

- On load: map centred on UK, all small areas visible as a choropleth (SPF value → colour ramp)
- Click any area: right panel populates, map highlights all peers in the same national decile
- Clicking a different area replaces selection; clicking the same area deselects
- Reset button returns to overview, clears selection and highlights

### 2.2 Search

- Sidebar text input accepts `data_zone_code` (e.g. `E01004190`) or area name (from ONS names lookup — see §3.5)
- Dropdown results; selecting one flies the map to that area and triggers click behaviour

### 2.3 Find sunny near me

- Button triggers browser Geolocation API
- On success: map flies to user location, highlights top-decile areas within 10 km
- On denial/error: polite inline message, does not block other functionality

### 2.4 Year selector

- Chevron buttons in topbar step through available years (2023, 2024, 2025 initially)
- Changing year reloads SPF values and redraws choropleth; clears selection
- Available years read from `spf-data.json` at load time — adding a new year requires no app code changes

### 2.5 Shareable URLs

- URL updates on every meaningful state change using the History API (no page reload)
- Parameters: `?area=E01004190&year=2023` — sufficient to restore full view on load
- Sharing a URL opens the map zoomed to that area, year, and decile highlight

### 2.6 Jump to decile

- 10-chip grid in sidebar: clicking a chip highlights all areas in that decile nationally
- Active chip reflects the clicked area's decile when a map selection is made

---

## 3. Data

### 3.1 Source GeoPackages

One GeoPackage per year. All have the same schema (confirmed by inspection):

```
data/raw/spf_2023.gpkg
data/raw/spf_2024.gpkg
data/raw/spf_2025.gpkg
```

> **Adding a new year:** Drop the new GeoPackage into `data/raw/` and trigger the pipeline (§6). No app code changes needed — the year is inferred from the filename.

### 3.2 GeoPackage schema (confirmed)

| | |
|---|---|
| Layer name | `SPF_LSOA_level` |
| Area code column | `data_zone_code` (string) |
| SPF value column | `cloudprob_corrected_mean` (float64) |
| Geometry type | MultiPolygon |
| CRS | **EPSG:27700 — British National Grid** |
| Feature count | 46,844 (all UK small areas) |
| Value range | 0–100 (cloud probability, annual mean — higher = more cloud) |

> ⚠️ **CRS — action required:** The GeoPackage is in EPSG:27700 (British National Grid). MapLibre and tippecanoe require EPSG:4326 (WGS84). The pipeline must reproject before tile generation. See §5.4.

### 3.3 SPF value

| | |
|---|---|
| Column | `cloudprob_corrected_mean` |
| Range | 0–100 |
| Direction | Low = more sun · High = more cloud |
| Display | Show as-is in info panel (e.g. `57.5`). No further scaling needed. |

### 3.4 Deciles

Computed nationally across all 46,844 UK small areas, per year independently. Decile 1 = highest cloud (least sun). Decile 10 = lowest cloud (most sun). Computed using `pd.qcut` with 10 equal-frequency bins.

> **Rationale:** National deciles are simpler to communicate than regional. A user seeing "decile 3" understands they are in the cloudier third of the UK.

### 3.5 Area names lookup

The GeoPackage contains only `data_zone_code` — no human-readable name. A separate names CSV must be joined at build time to populate the info panel and search.

- **England/Wales LSOAs:** LSOA names from ONS (`LSOA11CD` → `LSOA11NM`)
- **Scotland Data Zones:** Data Zone names from Scottish Government open data
- **NI Super Output Areas:** SOA names from NISRA

The pipeline merges these into a single names lookup keyed by `data_zone_code` before building `spf-data.json`.

```
data/reference/area_names.csv   # columns: data_zone_code, area_name — committed to repo
```

### 3.6 spf-data.json schema

Output of the build pipeline. Loaded once on startup, held in memory. Estimated size: ~8–12 MB for 46,844 areas × 3 years.

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

### 4.2 Vector tiles

| | |
|---|---|
| Tool | tippecanoe |
| Input | `boundaries.geojson` (reprojected from GeoPackage — see §5.4) |
| Output | `tiles/{z}/{x}/{y}.pbf` — static tile pyramid committed to repo |
| Zoom range | z5 (UK overview) to z14 (LSOA detail) |
| tippecanoe flags | `--drop-densest-as-needed -z14 -Z5 --no-tile-compression` |
| Hosting | GitHub Pages — no tile server needed |
| Update frequency | One-time. Rebuild only if ONS releases new boundaries. |

> **Tile size:** Test the tippecanoe output size before committing. UK LSOAs at z5–z14 may produce a large directory. If >500 MB, reduce max zoom to 13 or increase simplification.

### 4.3 Browser client

| | |
|---|---|
| Map library | MapLibre GL JS |
| Basemap | Carto Dark Matter no-labels: `https://{s}.basemaps.cartocdn.com/dark_matter_nolabels/{z}/{x}/{y}{r}.png` |
| Attribution | `© Carto Dark Matter · ONS Open Geography · Imago UKRI` — required in map corner |
| Tile source | `tiles/{z}/{x}/{y}.pbf` via MapLibre `addSource` |
| Data join | JS `Map` built at startup: `data_zone_code → { name, year → { value, decile } }` |
| Click handler | Reads clicked feature's `data_zone_code` → decile lookup → MapLibre filter for peers |
| Geolocation | Browser Geolocation API → `flyTo` → spatial filter for nearby top-decile areas |
| URL state | History API `pushState` on click/year change; parsed on load to restore state |
| Font | Figtree via Google Fonts (`preconnect` in `<head>`) |
| Default view | UK centred: `centre [-3.0, 55.0]`, zoom 5 |

### 4.4 Colour ramp

Running through the SDR-UK brand palette. Low `cloudprob_corrected_mean` = more sun = warm. High = more cloud = cool.

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
| Non-peer areas | No highlight, opacity 0.65 |

---

## 5. Build pipeline

### 5.1 Directory structure

```
spf-explorer/
  data/
    raw/                  # .gpkg files — gitignored (1.7 GB each)
    reference/
      area_names.csv      # data_zone_code, area_name — committed
    processed/
      spf-data.json       # built output — committed
  tiles/                  # .pbf tile pyramid — committed (one-time build)
  pipeline/
    extract.py            # GeoPackages → tidy CSV
    deciles.py            # assign deciles, merge names, build JSON
    build_tiles.sh        # one-time: ogr2ogr reproject + tippecanoe + mb-util
    requirements.txt      # geopandas, pandas, numpy, pyogrio
  app/
    index.html
    main.js
    style.css
  .github/workflows/
    update-data.yml
  README.md
```

### 5.2 extract.py

Loops over all `.gpkg` files in `data/raw/`. For each:

- Opens with geopandas (`layer='SPF_LSOA_level'`)
- Reads `data_zone_code` and `cloudprob_corrected_mean`
- Infers year from filename pattern `spf_YYYY.gpkg`
- Drops geometry (not needed at this stage)
- Appends to a tidy long-format dataframe

Output: `data/processed/spf_all_years.csv` with columns: `data_zone_code, year, cloudprob_corrected_mean`

### 5.3 deciles.py

- Reads `spf_all_years.csv`
- Reads `data/reference/area_names.csv` and joins on `data_zone_code`
- For each year: ranks all 46,844 areas by `cloudprob_corrected_mean`, assigns decile 1–10 using `pd.qcut(q=10, labels=False) + 1`
- Builds nested JSON (see §3.6 schema)
- Writes `data/processed/spf-data.json`

### 5.4 build_tiles.sh (one-time only)

Run once to generate the tile pyramid. Not part of the annual update cycle.

> ⚠️ **Reproject required:** GeoPackage is EPSG:27700. Must convert to EPSG:4326 before tippecanoe.

```bash
# Step 1: reproject from BNG to WGS84
ogr2ogr -f GeoJSON \
  -t_srs EPSG:4326 \
  data/processed/boundaries.geojson \
  data/raw/spf_2023.gpkg \
  SPF_LSOA_level

# Step 2: build tiles
tippecanoe \
  -o data/processed/tiles.mbtiles \
  -z14 -Z5 \
  --drop-densest-as-needed \
  --no-tile-compression \
  --include=data_zone_code \
  --layer=lsoa \
  data/processed/boundaries.geojson

# Step 3: explode to directory structure for GitHub Pages
mb-util data/processed/tiles.mbtiles tiles --image-format=pbf
```

> **`--no-tile-compression`:** Required for GitHub Pages static serving. MapLibre expects uncompressed `.pbf` when served without a tile server handling `Content-Encoding`.

> **`--include=data_zone_code`:** Each tile feature carries only the area code. SPF values come from the JS lookup, not the tile. Keeps tile size small.

### 5.5 GitHub Actions — update-data.yml

Triggered on push when any file matching `data/raw/*.gpkg` is added or modified. Steps:

1. Checkout repo
2. Set up Python with geopandas, pandas, pyogrio
3. Run `pipeline/extract.py`
4. Run `pipeline/deciles.py`
5. Commit updated `data/processed/spf-data.json` with message `chore: update SPF data [skip ci]`
6. Deploy `app/` and `tiles/` to GitHub Pages via `actions/deploy-pages`

> **Raw GeoPackages:** `.gpkg` files are gitignored (1.7 GB each). Decide on storage before first push: Git LFS (simplest) or store externally and pull in CI via a download step.

---

## 6. Mobile layout

The three-panel desktop layout collapses at viewports below 768px into a full-screen map with overlaid panels:

- **Sidebar** → bottom sheet, collapsed by default, drag handle to expand
- **Info panel** → slides up from bottom on area tap, overlays lower half of map
- **Year selector** and **Find sunny near me** → inside bottom sheet
- **Zoom controls** and **Reset** → remain as floating map buttons
- URL sharing works identically on mobile

> **Implementation:** Single `max-width: 768px` media query. MapLibre handles touch and pinch-zoom natively — no extra config needed.

---

## 7. Brand and design tokens

| Token | Value |
|---|---|
| Font | Figtree (Google Fonts) — Bold for headings/labels, Regular for body |
| Navy | `#24226F` — topbar, headings, decile 1 fill |
| Teal | `#03CEA3` — highlights, active states, decile 5 fill |
| Blue | `#1877CF` — links, ONS button, decile 3 fill |
| Orange | `#FF8F42` — decile 10 fill, logo accent |
| Grey | `#8C91A8` — secondary text, muted labels |
| Light grey | `#E2E5F3` — subtle backgrounds |
| Imago accent | `#4A4A49` — Imago service colour, neutral dark |
| Basemap | Carto Dark Matter no-labels |
| Attribution | `© Carto Dark Matter · ONS Open Geography · Imago UKRI` |

---

## 8. Open questions

Confirm these before or at the start of the build:

| Question | Notes |
|---|---|
| GeoPackage storage | Git LFS or external download in CI? Must decide before first push — hard to change later. |
| `area_names.csv` source | Confirm download URLs for ONS LSOA names (England/Wales), Scottish Government Data Zone names, and NISRA SOA names. |
| Tile directory size | Test tippecanoe output before committing `tiles/`. If >500 MB consider reducing `z-max` to 13. |
| Find sunny radius | 10 km default — confirm this is appropriate. |
| ONS profile URL pattern | Confirm the ONS area profile URL structure for the info panel external link. |
| Default year on load | Most recent (2025) or earliest (2023)? |