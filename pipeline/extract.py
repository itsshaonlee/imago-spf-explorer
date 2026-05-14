"""Extract SPF values from GeoPackages to a tidy long-format CSV."""
import re
from pathlib import Path

import geopandas as gpd
import pandas as pd

DATA_DIR = Path(__file__).parent.parent / "data"
OUT_DIR = DATA_DIR / "processed"
OUT_DIR.mkdir(exist_ok=True)

GPKG_RE = re.compile(r"SPF_LSOA_(\d{4})\.gpkg$", re.IGNORECASE)

rows = []
for gpkg in sorted(DATA_DIR.glob("SPF_LSOA_*.gpkg")):
    m = GPKG_RE.search(gpkg.name)
    if not m:
        continue
    year = int(m.group(1))
    print(f"Reading {gpkg.name} …")
    gdf = gpd.read_file(
        gpkg,
        columns=["data_zone_code", "cloudprob_corrected_mean"],
    )
    df = gdf.drop(columns="geometry").copy()
    df["year"] = year
    rows.append(df)

if not rows:
    raise FileNotFoundError("No SPF_LSOA_YYYY.gpkg files found in data/")

out = pd.concat(rows, ignore_index=True)
out_path = OUT_DIR / "spf_all_years.csv"
out.to_csv(out_path, index=False)
print(f"Wrote {len(out):,} rows → {out_path}")
