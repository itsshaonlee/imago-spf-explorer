#!/usr/bin/env bash
set -e

REPO="/mnt/c/Users/spspa/OneDrive - The University of Liverpool/imago-spf-explorer"
GPKG="$REPO/data/SPF_LSOA_2023.gpkg"
OUT="$REPO/tiles/lsoa.pmtiles"

TMP="/tmp/lsoa_boundaries.geojson"

echo "Source: $GPKG"
echo "Output: $OUT"
echo ""

rm -f "$OUT" "$TMP"

echo "Step 1: Reprojecting to WGS84..."
ogr2ogr -f GeoJSON "$TMP" "$GPKG" \
  -t_srs EPSG:4326 \
  -select data_zone_code \
  -nln lsoa

echo "Step 2: Building PMTiles with tippecanoe..."
tippecanoe \
  -o "$OUT" \
  -l lsoa \
  --maximum-zoom=14 \
  --coalesce-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --detect-shared-borders \
  --simplification=10 \
  --include=data_zone_code \
  --force \
  "$TMP"

rm -f "$TMP"
echo ""
echo "Done: $OUT"
ls -lh "$OUT"
