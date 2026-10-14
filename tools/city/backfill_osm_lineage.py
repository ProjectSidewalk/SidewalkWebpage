"""
Positions a live city's streets on their OpenStreetMap ways (#5741), for cities linked before the positions existed.

Step 2 of three. ``db/scripts/export-osm-lineage-input.sh`` writes every served street with the way ids it is linked
to; this fetches the OSM ways around the city, matches each street to them by geometry (``osm_lineage.py``), and
writes ``osm_lineage.csv`` beside the input for ``db/scripts/import-osm-lineage.sh`` to load, plus
``osm_lineage_review.csv`` naming each street that could not be matched along its whole length, with its line as WKT
for QGIS. Run from anywhere; files are resolved under the repo's ``db/onboarding/<city-id>/``:

    make export-osm-lineage-input          (prompts for the schema and city id)
    make osm-lineage id=seattle-wa
    make import-osm-lineage                (prompts for the schema and the CSV path)

A street's recorded way ids are tried first, so a street that still sits where OSM has it keeps the way it was built
from; where OSM has since split or redrawn a way, the matching finds the way that is there now, and the review file
lists what it could not place. The import keeps the recorded ways of an unmatched street, unpositioned, so no street
loses its link.

The pure parts (``read_input``, ``hull_of``, ``lineage_output``, ``review_output``) are unit-tested in
``test/python/test_backfill_osm_lineage.py``; the fetch is ``onboard_city.fetch_ways``, stubbed there.
"""
import argparse
import csv
import logging
import sys
from math import cos, radians
from pathlib import Path

import shapely
from shapely import wkb

sys.path.insert(0, str(Path(__file__).resolve().parent))
from onboard_city import fetch_ways, valid_city_id  # noqa: E402
from osm_lineage import compute_lineage, lineage_rows, lineage_summary  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
INPUT_NAME = 'osm_lineage_input.csv'
OUTPUT_NAME = 'osm_lineage.csv'
REVIEW_NAME = 'osm_lineage_review.csv'
INPUT_FIELDS = ('street_edge_id', 'geom_md5', 'osm_way_ids', 'geom')
OUTPUT_FIELDS = ('street_edge_id', 'osm_way_id', 'street_from_frac', 'street_to_frac', 'way_from_frac',
                 'way_to_frac', 'same_direction', 'geom_md5')
REVIEW_FIELDS = ('street_edge_id', 'status', 'coverage', 'osm_way_ids', 'geom_wkt')

logger = logging.getLogger('backfill_osm_lineage')


def read_input(path):
    """
    Reads the export: one street per row.

    Returns:
        A list of ``(street_edge_id, geom_md5, hint_way_ids, LineString)`` tuples, the way ids as ints with the Infra3d
        placeholder -1 left out.

    Raises:
        SystemExit: when the file does not have the export's columns.
    """
    with open(path, newline='') as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != list(INPUT_FIELDS):
            sys.exit(f'error: {path} does not have the columns db/scripts/export-osm-lineage-input.sh writes '
                     f'(expected {",".join(INPUT_FIELDS)}, found {",".join(reader.fieldnames or [])}).')
        streets = []
        for row in reader:
            hints = [int(way_id) for way_id in row['osm_way_ids'].split(',') if way_id and int(way_id) != -1]
            streets.append((int(row['street_edge_id']), row['geom_md5'], hints, wkb.loads(row['geom'], hex=True)))
    return streets


def hull_of(streets, buffer_m):
    """The area to fetch ways for: the streets' convex hull, widened by ``buffer_m``, in lon/lat."""
    # A hull needs no union of the lines first, which on a large city is the slow and memory-hungry step.
    hull = shapely.MultiLineString([geom for _, _, _, geom in streets]).convex_hull
    buffer_deg = buffer_m / (111_320 * cos(radians(hull.centroid.y)))
    return hull.buffer(buffer_deg)


def lineage_output(streets, lineages):
    """
    The rows ``import-osm-lineage.sh`` loads: one per street-way pair, with the street's geometry hash so the import
    can refuse a row whose street has changed since the export. Fractions are empty on an unpositioned link.
    """
    hashes = {street_edge_id: geom_md5 for street_edge_id, geom_md5, _, _ in streets}
    rows = []
    for row in lineage_rows(lineages):
        rows.append({
            'street_edge_id': row['street_id'],
            'osm_way_id': row['osm_way_id'],
            'street_from_frac': '' if row['street_from_frac'] is None else repr(row['street_from_frac']),
            'street_to_frac': '' if row['street_to_frac'] is None else repr(row['street_to_frac']),
            'way_from_frac': '' if row['way_from_frac'] is None else repr(row['way_from_frac']),
            'way_to_frac': '' if row['way_to_frac'] is None else repr(row['way_to_frac']),
            'same_direction': '' if row['same_direction'] is None else ('t' if row['same_direction'] else 'f'),
            'geom_md5': hashes[row['street_id']],
        })
    return rows


def review_output(streets, lineages):
    """The streets not matched along their whole length, with their recorded ways and line, for a look in QGIS."""
    by_id = {street_edge_id: (hints, geom) for street_edge_id, _, hints, geom in streets}
    rows = []
    for lineage in lineages:
        if lineage.status == 'matched':
            continue
        hints, geom = by_id[lineage.street_id]
        rows.append({'street_edge_id': lineage.street_id, 'status': lineage.status,
                     'coverage': f'{lineage.coverage:.3f}', 'osm_way_ids': ','.join(str(h) for h in hints),
                     'geom_wkt': geom.wkt})
    return rows


def write_csv(path, fields, rows):
    """Writes ``rows`` (dicts) under ``fields`` as a CSV."""
    with open(path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0],
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--city-id', required=True, type=valid_city_id,
                        help='The db/onboarding/<city-id> dir holding osm_lineage_input.csv (e.g. seattle-wa).')
    parser.add_argument('--fetch-buffer-m', type=float, default=100.0,
                        help='How far beyond the streets to fetch ways, in metres (default 100).')
    return parser.parse_args(argv)


def main(argv=None, fetch=fetch_ways):
    """
    Matches the exported streets to the OSM ways around them and writes the import and review files.

    Args:
        argv:  Command-line arguments; the process's when None.
        fetch: The way fetch, ``onboard_city.fetch_ways`` unless a test supplies another.

    Returns:
        The process exit code.
    """
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    args = parse_args(argv)
    city_dir = REPO_ROOT / 'db' / 'onboarding' / args.city_id
    input_path = city_dir / INPUT_NAME
    if not input_path.exists():
        logger.error('No %s: run `make export-osm-lineage-input` first.', input_path)
        return 1
    streets = read_input(input_path)
    if not streets:
        logger.error('%s holds no streets.', input_path)
        return 1
    logger.info('Read %d streets from %s', len(streets), input_path)
    ways = fetch(hull_of(streets, args.fetch_buffer_m), True, 0)
    logger.info('Fetched %d OSM ways around them', len(ways))
    lineages = compute_lineage(((street_edge_id, geom, hints) for street_edge_id, _, hints, geom in streets),
                               dict(zip(ways['osm_way_id'], ways.geometry)))
    counts = lineage_summary(lineages)
    write_csv(city_dir / OUTPUT_NAME, OUTPUT_FIELDS, lineage_output(streets, lineages))
    review = review_output(streets, lineages)
    write_csv(city_dir / REVIEW_NAME, REVIEW_FIELDS, review)
    logger.info('Matched %d streets along their whole length, %d in part, %d not at all. Wrote %s; the %d to review '
                'are in %s. Next: make import-osm-lineage', counts['matched'], counts['partial'], counts['unmatched'],
                city_dir / OUTPUT_NAME, len(review), city_dir / REVIEW_NAME)
    return 0


if __name__ == '__main__':
    sys.exit(main())
