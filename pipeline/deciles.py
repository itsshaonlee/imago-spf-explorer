"""Merge area names + centroids, add global stats, write spf-data.json."""
import json
from datetime import date
from pathlib import Path

import geopandas as gpd
import pandas as pd

DATA_DIR = Path(__file__).parent.parent / "data"
PROCESSED = DATA_DIR / "processed"

NAMES_GPKG = DATA_DIR / "UK_LSOA_DZ.gpkg"
SPF_CSV = PROCESSED / "spf_all_years.csv"
OUT_JSON = PROCESSED / "spf-data.json"


def load_names_and_centroids() -> dict:
    """Return {data_zone_code: {name, lat, lon}} from the lookup GeoPackage."""
    print("Loading area names and computing centroids ...")
    gdf = gpd.read_file(NAMES_GPKG)
    # Compute centroids in the projected CRS (EPSG:27700), then convert to WGS84
    centroids_wgs = gdf.geometry.centroid.to_crs("EPSG:4326")
    gdf["lat"] = centroids_wgs.y.round(5)
    gdf["lon"] = centroids_wgs.x.round(5)

    def pick_name(row):
        if row["country"] == "Scotland":
            return row["dzname"] or row["data_zone_code"]
        if row["country"] == "Northern Ireland":
            return row["DZ2021_nm"] or row["data_zone_code"]
        return row["LSOA21NM"] or row["data_zone_code"]

    gdf["area_name"] = gdf.apply(pick_name, axis=1)
    return (
        gdf.set_index("data_zone_code")[["area_name", "lat", "lon"]]
        .to_dict("index")
    )


meta = load_names_and_centroids()

print("Reading spf_all_years.csv ...")
df = pd.read_csv(SPF_CSV)

years = sorted(df["year"].unique().tolist())
print(f"Years: {years}")

# Stats are computed once across the whole dataset (every year, every area) so
# a given value renders as the same colour/percentile no matter which year is
# selected - deciles recomputed per year would mask real year-to-year change.
value_min = float(df["cloudprob_corrected_mean"].min())
value_max = float(df["cloudprob_corrected_mean"].max())
print(f"Global value range: {value_min:.2f} - {value_max:.2f}")

# Ascending rank on cloud probability (1.0 = cloudiest); invert so higher
# percentile means sunnier, matching the old decile-10-is-sunniest direction.
cloud_pct_rank = df["cloudprob_corrected_mean"].rank(pct=True)
df["pct"] = ((1 - cloud_pct_rank) * 100).round().astype(int)

areas: dict = {}
for row in df.itertuples(index=False):
    code = row.data_zone_code
    if code not in areas:
        m = meta.get(code, {})
        areas[code] = {
            "name": m.get("area_name", code),
            "lat": m.get("lat"),
            "lon": m.get("lon"),
        }
    areas[code][str(row.year)] = {
        "value": round(float(row.cloudprob_corrected_mean), 2),
        "pct": int(row.pct),
    }

payload = {
    "meta": {
        "years": years,
        "generated": date.today().isoformat(),
        "value_col": "cloudprob_corrected_mean",
        "code_col": "data_zone_code",
        "value_min": round(value_min, 2),
        "value_max": round(value_max, 2),
    },
    "areas": areas,
}

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(payload, f, separators=(",", ":"))

print(f"Wrote {len(areas):,} areas -> {OUT_JSON}")
