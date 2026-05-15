"""Convert tiles/ directory (z/x/y.pbf) to a single lsoa.pmtiles file."""

import gzip
from pathlib import Path

from pmtiles.writer import write, Compression
from pmtiles.tile import zxy_to_tileid, TileType

TILES_DIR = Path("tiles")
OUTPUT = Path("tiles/lsoa.pmtiles")


def main():
    print("Scanning tile directory...")
    entries = []

    for z_dir in TILES_DIR.iterdir():
        if not z_dir.is_dir():
            continue
        try:
            z = int(z_dir.name)
        except ValueError:
            continue
        for x_dir in z_dir.iterdir():
            if not x_dir.is_dir():
                continue
            try:
                x = int(x_dir.name)
            except ValueError:
                continue
            for pbf in x_dir.glob("*.pbf"):
                try:
                    y = int(pbf.stem)
                except ValueError:
                    continue
                entries.append((zxy_to_tileid(z, x, y), pbf))

    print(f"Found {len(entries):,} tiles — sorting by Hilbert tile ID...")
    entries.sort(key=lambda e: e[0])

    total = len(entries)
    print(f"Writing {OUTPUT} ...")

    with write(str(OUTPUT)) as writer:
        for i, (tile_id, path) in enumerate(entries):
            if i % 20000 == 0:
                pct = i * 100 // total
                print(f"  {i:,} / {total:,}  ({pct}%)", end="\r", flush=True)
            writer.write_tile(tile_id, gzip.compress(path.read_bytes(), compresslevel=9))

        header = {
            "tile_type": TileType.MVT,
            "tile_compression": Compression.GZIP,
            "min_lon_e7": int(-9.0 * 1e7),
            "min_lat_e7": int(49.5 * 1e7),
            "max_lon_e7": int(2.1 * 1e7),
            "max_lat_e7": int(61.0 * 1e7),
            "center_zoom": 6,
            "center_lon_e7": int(-3.0 * 1e7),
            "center_lat_e7": int(55.0 * 1e7),
        }
        metadata = {
            "name": "SPF LSOA",
            "description": "Sun Probability Framework — UK LSOA/Data Zone boundaries",
            "format": "pbf",
            "attribution": "© Imago UKRI / ONS Open Geography",
            "vector_layers": [
                {
                    "id": "lsoa",
                    "fields": {"data_zone_code": "String"},
                    "minzoom": 5,
                    "maxzoom": 14,
                }
            ],
        }
        writer.finalize(header, metadata)

    size_mb = OUTPUT.stat().st_size / 1e6
    print(f"\nDone. {OUTPUT}  ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
