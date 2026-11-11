#!/usr/bin/env python3
"""Per-region imagery coverage and capture dates from Streetscape Tracker road walks.

Streetscape Tracker (github.com/makeabilitylab/streetscape-tracker) walks a city's OSM drive network at 15 m spacing
and records, for each sample point, the nearest pano each provider holds. For a city it already tracks, that answers
the onboarding preflight question (which provider, and which neighborhoods) for every street instead of the
150-street sample `make check-imagery` draws, and without spending any API quota. This script joins those sample
points to a regions file and reports coverage and capture dates per region and for the whole city.

The walk files are public. Find a city's in the manifest, then download the `.csv.gz` next to each
`coverage_filename` (same name without `_coverage.json`):

    https://makeabilitylab.cs.washington.edu/public/streetscape-tracker/data/streetwalks.json.gz

Example (Tel Aviv, 2026-11):

    python3 tools/city/tracker_coverage_by_region.py \\
        --regions db/onboarding/tel-aviv-il/source/tlv_neighborhoods_511.geojson --name-col shem_shchuna \\
        --boundary db/onboarding/tel-aviv-il/source/tlv_city_boundary_890.geojson \\
        --walk gsv=db/onboarding/tel-aviv-il/tracker/<...>_streetwalk_sp15_2026-09-28.csv.gz \\
        --walk mapillary=db/onboarding/tel-aviv-il/tracker/<...>_mapillary_streetwalk_sp15_2026-10-01.csv.gz \\
        --out-dir db/onboarding/tel-aviv-il/tracker

Caveats that belong next to any number this prints:
  * The denominator is the tracker's OSM `drive` network (motorways included, footways excluded), not the Project
    Sidewalk street build, so treat a region's km as approximate and its percentages as the signal.
  * The tracker samples a rectangle around the city center. `--boundary` reports how much of the city that rectangle
    reaches; a region the rectangle only partly covers is flagged.
  * A Mapillary `OK` sample means a 360° pano is in range; `FLAT_ONLY` means only perspective photos are, which
    Project Sidewalk cannot use.
"""

import argparse
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

# The tracker counts a sample as covered only when the pano is this close to the street point; Google's search
# radius is a hint, so the CSV can name a pano much farther away.
MATCH_DIST_M = 25.0
EARTH_RADIUS_M = 6371008.8


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in meters between two arrays of WGS84 points.

    @return numpy array of distances; NaN where either point is missing.
    """
    lat1, lon1, lat2, lon2 = (np.radians(np.asarray(v, dtype=float)) for v in (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(a))


def load_walk(provider, path):
    """Read one tracker road-walk CSV into a GeoDataFrame of sample points.

    Adds `covered` (a usable 360° pano within MATCH_DIST_M), `official` (GSV only: Google's own imagery rather than
    a user upload), `flat_only` (Mapillary only) and a parsed `capture`.

    @return GeoDataFrame in EPSG:4326, one row per street sample.
    """
    df = pd.read_csv(path, dtype={"pano_id": str}, low_memory=False)
    dist = haversine_m(df["query_lat"], df["query_lon"], df["pano_lat"], df["pano_lon"])
    df["covered"] = (df["status"] == "OK") & (dist <= MATCH_DIST_M)
    df["official"] = df["covered"] & (df["copyright_info"] == "© Google") if provider == "gsv" else df["covered"]
    df["flat_only"] = df["status"] == "FLAT_ONLY"
    df["capture"] = pd.to_datetime(df["capture_date"], errors="coerce", format="ISO8601").where(df["covered"])
    df["provider"] = provider
    points = gpd.points_from_xy(df["query_lon"], df["query_lat"], crs="EPSG:4326")
    return gpd.GeoDataFrame(df, geometry=points)


def summarize(samples, spacing_m):
    """Coverage and capture-date figures for one group of samples (a region, or the whole city).

    @return dict of the columns the report prints.
    """
    n = len(samples)
    dates = samples["capture"].dropna()
    return {
        "samples": n,
        "approx_km": round(n * spacing_m / 1000, 1),
        "covered_pct": round(100 * samples["covered"].mean(), 1) if n else np.nan,
        "official_pct": round(100 * samples["official"].mean(), 1) if n else np.nan,
        "flat_only_pct": round(100 * samples["flat_only"].mean(), 1) if n else np.nan,
        "median_capture": dates.median().strftime("%Y-%m") if len(dates) else "",
        "newest_capture": dates.max().strftime("%Y-%m") if len(dates) else "",
        "since_2022_pct": round(100 * float((dates.dt.year >= 2022).sum()) / n, 1) if n else np.nan,
    }


def markdown_table(frame):
    """Render a DataFrame as a GitHub Markdown table (pandas' own `to_markdown` needs a library we don't install).

    @return the table as one string, without a trailing newline.
    """
    header = "| " + " | ".join(frame.columns) + " |"
    rule = "|" + "---|" * len(frame.columns)
    body = ["| " + " | ".join("" if pd.isna(v) else str(v) for v in row) + " |" for row in frame.itertuples(index=False)]
    return "\n".join([header, rule, *body])


def main(argv=None):
    """Parse arguments, join each walk to the regions, and write the per-region CSV and Markdown report.

    @param argv: argument list for tests; None reads sys.argv.
    @return process exit code.
    """
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--regions", required=True, help="Regions file (any OGR format).")
    parser.add_argument("--name-col", required=True, help="Column in --regions holding the region name.")
    parser.add_argument("--boundary", help="City boundary file; samples outside it are dropped from the city row.")
    parser.add_argument("--walk", action="append", required=True, metavar="PROVIDER=PATH",
                        help="A tracker road-walk CSV, e.g. gsv=path.csv.gz. Repeat per provider.")
    parser.add_argument("--spacing-m", type=float, default=15.0, help="The walk's sample spacing (default 15).")
    parser.add_argument("--out-dir", required=True, help="Where coverage_by_region.csv and .md are written.")
    args = parser.parse_args(argv)

    regions = gpd.read_file(args.regions).to_crs("EPSG:4326")[[args.name_col, "geometry"]]
    regions = regions.rename(columns={args.name_col: "region"})
    boundary = gpd.read_file(args.boundary).to_crs("EPSG:4326").union_all() if args.boundary else None

    rows, city_rows, notes = [], [], []
    for spec in args.walk:
        provider, _, path = spec.partition("=")
        walk = load_walk(provider, path)
        rectangle = walk.total_bounds
        if boundary is not None:
            box = gpd.GeoSeries.from_xy([rectangle[0], rectangle[2]], [rectangle[1], rectangle[3]]).union_all().envelope
            reached = boundary.intersection(box).area / boundary.area
            notes.append(f"{provider}: the walk's sample extent reaches {100 * reached:.0f}% of the city boundary's area.")
            in_city = walk[walk.within(boundary)]
            city_rows.append({"provider": provider, "region": "WHOLE CITY (inside boundary)",
                              **summarize(in_city, args.spacing_m)})
        city_rows.append({"provider": provider, "region": "tracker rectangle (all samples)",
                          **summarize(walk, args.spacing_m)})
        joined = gpd.sjoin(walk, regions, predicate="within", how="inner")
        for region, samples in joined.groupby("region"):
            rows.append({"provider": provider, "region": region, **summarize(samples, args.spacing_m)})

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    table = pd.DataFrame(city_rows + rows)
    table.to_csv(out_dir / "coverage_by_region.csv", index=False)

    lines = ["# Imagery coverage by region (Streetscape Tracker road walks)", ""]
    lines += [f"- {note}" for note in notes]
    lines += [f"- Covered = a 360° pano within {MATCH_DIST_M:.0f} m of the street sample. Denominator: the tracker's "
              "OSM drive network.", ""]
    for provider, group in table.groupby("provider", sort=False):
        lines += [f"## {provider}", "", markdown_table(group.drop(columns="provider")), ""]
    (out_dir / "coverage_by_region.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
