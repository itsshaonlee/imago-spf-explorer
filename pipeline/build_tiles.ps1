# build_tiles.ps1 — one-time tile build using GDAL MVT driver (Windows / OSGeo4W)
# Run from the repo root: .\pipeline\build_tiles.ps1
#
# Requires ogr2ogr from OSGeo4W (already at C:\OSGeo4W\bin\ogr2ogr.exe)
# No WSL, tippecanoe, or Docker needed.
#
# Note: GDAL MVT generation at z5-z14 for 46,844 features takes ~30-60 min.
# If you want a quick test first, change MAXZOOM=12 and re-run with MAXZOOM=14 later.

$OGR = "C:\OSGeo4W\bin\ogr2ogr.exe"
$GPKG = "data\SPF_LSOA_2023.gpkg"
$TILES = "tiles"

# Fix PROJ/GDAL conflict between OSGeo4W and conda — point to conda's newer databases
$env:PROJ_DATA = "C:\Users\spspa\anaconda3\envs\raster_env\Library\share\proj"
$env:GDAL_DATA = "C:\Users\spspa\anaconda3\envs\raster_env\Library\share\gdal"

if (Test-Path $TILES) {
    Write-Host "Removing existing tiles/ directory..."
    Remove-Item -Recurse -Force $TILES
}

Write-Host "Building vector tiles (z5-z14) — this will take a while..."
Write-Host "Source: $GPKG"
Write-Host ""

& $OGR `
  -f MVT $TILES `
  $GPKG `
  -t_srs EPSG:4326 `
  -select data_zone_code `
  -nln lsoa `
  -dsco MINZOOM=5 `
  -dsco MAXZOOM=14 `
  -dsco COMPRESS=NO `
  -dsco MAX_SIZE=500000

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Done. Tile pyramid written to tiles/"
    $size = (Get-ChildItem -Recurse $TILES | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host ("Total size: {0:N0} MB" -f $size)
    Write-Host "If >500 MB, re-run with -dsco MAXZOOM=13"
} else {
    Write-Host "ogr2ogr failed with exit code $LASTEXITCODE"
}
