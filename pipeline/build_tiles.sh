#!/usr/bin/env bash
# One-time tile build. Run from the repo root.
# Requires: ogr2ogr (GDAL), tippecanoe, mb-util
#
# Windows: run this in WSL. ogr2ogr is already at C:\OSGeo4W\bin\ogr2ogr.exe
# but tippecanoe is Linux-only. In WSL, install both via:
#   sudo apt install gdal-bin
#   sudo apt install tippecanoe   (Ubuntu 23.04+) or build from source
#   pip install mbutil
#
# Then run: bash pipeline/build_tiles.sh

set -euo pipefail

GPKG="data/SPF_LSOA_2023.gpkg"
GEOJSON="data/processed/boundaries.geojson"
MBTILES="data/processed/tiles.mbtiles"
TILES_DIR="tiles"

echo "▶ Step 1: Reproject EPSG:27700 → EPSG:4326"
ogr2ogr \
  -f GeoJSON \
  -t_srs EPSG:4326 \
  -select data_zone_code \
  "$GEOJSON" \
  "$GPKG" \
  SPF_LSOA_level

echo "▶ Step 2: Build vector tiles (z5–z14)"
tippecanoe \
  -o "$MBTILES" \
  -Z5 -z14 \
  --drop-densest-as-needed \
  --no-tile-compression \
  --include=data_zone_code \
  --layer=lsoa \
  --force \
  "$GEOJSON"

echo "▶ Step 3: Explode .mbtiles → directory"
rm -rf "$TILES_DIR"
mb-util "$MBTILES" "$TILES_DIR" --image-format=pbf

echo "✓ Done. Tile pyramid at $TILES_DIR/"
du -sh "$TILES_DIR/"
echo "If >500 MB, re-run tippecanoe with -z13 instead of -z14."
