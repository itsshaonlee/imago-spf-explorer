"""Assign national deciles, merge area names + centroids, write spf-data.json."""
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


def assign_deciles(df: pd.DataFrame) -> pd.DataFrame:
    """Decile 1 = most cloud (highest cloudprob), 10 = most sun (lowest cloudprob)."""
    df = df.copy()
    df["decile"] = pd.qcut(
        df["cloudprob_corrected_mean"],
        q=10,
        labels=range(10, 0, -1),
        duplicates="drop",
    ).astype(int)
    return df


meta = load_names_and_centroids()

print("Reading spf_all_years.csv ...")
df = pd.read_csv(SPF_CSV)

years = sorted(df["year"].unique().tolist())
print(f"Years: {years}")

areas: dict = {}
for year, group in df.groupby("year"):
    print(f"  Assigning deciles for {year} ...")
    group = assign_deciles(group)
    for row in group.itertuples(index=False):
        code = row.data_zone_code
        if code not in areas:
            m = meta.get(code, {})
            areas[code] = {
                "name": m.get("area_name", code),
                "lat": m.get("lat"),
                "lon": m.get("lon"),
            }
        areas[code][str(year)] = {
            "value": round(float(row.cloudprob_corrected_mean), 2),
            "decile": int(row.decile),
        }

payload = {
    "meta": {
        "years": years,
        "generated": date.today().isoformat(),
        "value_col": "cloudprob_corrected_mean",
        "code_col": "data_zone_code",
    },
    "areas": areas,
}

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(payload, f, separators=(",", ":"))

print(f"Wrote {len(areas):,} areas -> {OUT_JSON}")
