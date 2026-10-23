"""
Positions a live city's streets on their OpenStreetMap ways (#5741), for cities linked before the positions existed.

Step 2 of three: ``db/scripts/export-osm-lineage-input.sh`` writes every served street with its way ids, this fetches
the OSM ways around the city and matches each street to them by geometry (``osm_lineage.py``), and
``db/scripts/import-osm-lineage.sh`` loads the result. Files live under the repo's ``db/onboarding/<city-id>/``:

    make export-osm-lineage-input          (prompts for the schema and city id)
    make osm-lineage id=seattle-wa
    make import-osm-lineage                (prompts for the schema and the CSV path)

A street's recorded ways are tried first; where OSM has since split or redrawn a way, the matching finds what is there
now. ``osm_lineage_review.csv`` lists every street not matched along its whole length, with its line as WKT for QGIS,
and the import keeps such a street's recorded ways without positions.

The ways come from the public Overpass server in small, well-spaced requests (``overpass.py`` says why): the ground
the streets stand on is cut into tiles of at most ``--tile-km2``, each fetched on its own, so a sprawling city asks
for its towns and not the countryside between them. ``--dry-run`` prints the request count and area and fetches
nothing. When Overpass keeps refusing, the exit code is 75 and nothing is written: stop and resume later rather than
send more.
"""
import argparse
import csv
import logging
import sys
from dataclasses import dataclass
from math import cos, floor, radians, sqrt
from pathlib import Path

import shapely
from shapely import wkb

sys.path.insert(0, str(Path(__file__).resolve().parent))
from onboard_city import fetch_ways, valid_city_id  # noqa: E402
from osm_lineage import compute_lineage, lineage_rows, lineage_summary  # noqa: E402
from overpass import (EXIT_UNAVAILABLE, OVERPASS_URL, OverpassUnavailable, RetryPolicy,  # noqa: E402
                      wait_until_answering)

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
        A list of ``(street_edge_id, geom_md5, hint_way_ids, LineString)`` tuples; the Infra3d placeholder way -1
        is dropped from the hints.

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


@dataclass(frozen=True)
class Tiling:
    """
    The fetch areas for a set of streets: one Overpass request each, in lon/lat.

    ``polygons`` are the convex hulls of each group of occupied cells, widened by the buffer; ``cells_km2`` is the
    ground the streets occupy, ``hull_km2`` what one hull around all of them would have asked for.
    """
    polygons: list
    cells_km2: float
    area_km2: float
    hull_km2: float

    def __str__(self):
        return (f'{len(self.polygons)} Overpass request(s) over {self.area_km2:,.0f} km² (streets occupy '
                f'{self.cells_km2:,.0f} km²; one hull around them would be {self.hull_km2:,.0f} km²)')


def tiles_for(lines, buffer_m, tile_km2=300.0, cell_m=1000.0):
    """
    Cuts the ground the streets stand on into fetch areas of at most about ``tile_km2`` each.

    The streets are laid on a grid of ``cell_m`` squares, and the occupied squares are grouped by a coarser grid of
    ``tile_km2``, so a city that is really a few towns far apart (a validation study, a county) fetches the towns and
    not the countryside between them, and a big city becomes many small requests a busy server still admits rather
    than a few huge ones. Each group goes to the server as its convex hull, since osmnx sends a hull anyway (and hulls
    the whole input first when it is over 2,500 km², which is why one tight polygon per city would not have helped),
    widened by ``buffer_m`` so a way just outside a cell still comes back.

    Args:
        lines:    Shapely LineStrings in lon/lat.
        buffer_m: How far beyond the streets to fetch, in metres.
        tile_km2: The area of one group of cells at most, in km²; the request count follows from it.
        cell_m:   The grid spacing, in metres.

    Returns:
        A :class:`Tiling`; an empty one for no lines.
    """
    if not lines:
        return Tiling([], 0.0, 0.0, 0.0)
    # One flat metre frame around the city, as the matcher measures, so the cells are square.
    _, miny, _, maxy = shapely.total_bounds(lines)
    scale = [111_320 * cos(radians((miny + maxy) / 2)), 111_320]
    lines_m = [shapely.transform(line, lambda coords: coords * scale) for line in lines]
    cells = set()
    for line in lines_m:
        # A vertex every half cell, so a long straight street marks every cell it crosses, not just its ends.
        for x, y in shapely.get_coordinates(shapely.segmentize(line, cell_m / 2)):
            cells.add((floor(x / cell_m), floor(y / cell_m)))
    per_side = max(1, floor(sqrt(tile_km2 * 1e6) / cell_m))
    groups = {}
    for cx, cy in cells:
        groups.setdefault((cx // per_side, cy // per_side), []).append((cx, cy))
    polygons, area_m2 = [], 0.0
    for key in sorted(groups):
        boxes = [shapely.box(cx * cell_m, cy * cell_m, (cx + 1) * cell_m, (cy + 1) * cell_m) for cx, cy in groups[key]]
        hull = shapely.union_all(boxes).convex_hull.buffer(buffer_m)
        area_m2 += hull.area
        polygons.append(shapely.transform(hull, lambda coords: coords / scale))
    hull_km2 = shapely.MultiLineString(lines_m).convex_hull.buffer(buffer_m).area / 1e6
    return Tiling(polygons, len(cells) * cell_m ** 2 / 1e6, area_m2 / 1e6, hull_km2)


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
    parser.add_argument('--tile-km2', type=float, default=300.0,
                        help='The ground one Overpass request covers at most, in km² (default 300).')
    parser.add_argument('--request-timeout-s', type=int, default=60,
                        help='The server time each request declares and is allowed, in seconds (default 60; raise '
                             'it for a city whose tiles are dense).')
    parser.add_argument('--request-memory-mb', type=int, default=256,
                        help='The server memory each request declares, in MB (default 256).')
    parser.add_argument('--pause-s', type=float, default=7.0,
                        help='The rest between two requests, in seconds (default 7).')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print the request count and area for the city and fetch nothing.')
    parser.add_argument('--overpass-url', default=OVERPASS_URL,
                        help=f'The Overpass instance to ask, without /interpreter (default {OVERPASS_URL}); read its '
                             'usage policy first, and never switch because the default refused you.')
    return parser.parse_args(argv)


def main(argv=None, fetch=fetch_ways, probe=wait_until_answering):
    """
    Matches the exported streets to the OSM ways around them and writes the import and review files.

    Args:
        argv:  Command-line arguments; the process's when None.
        fetch: The way fetch, ``onboard_city.fetch_ways`` unless a test supplies another.
        probe: Waits for Overpass to answer a tiny query first, so a run that has been refused is found out before
               it asks for anything heavy; ``overpass.wait_until_answering`` unless a test supplies another.

    Returns:
        The process exit code: 0, 1 on bad input, 75 when Overpass would not answer (nothing written).
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
    tiling = tiles_for([geom for _, _, _, geom in streets], args.fetch_buffer_m, args.tile_km2)
    logger.info('%s', tiling)
    if args.dry_run:
        return 0
    policy = RetryPolicy()
    try:
        probe(policy, url=args.overpass_url)
        ways = fetch(tiling.polygons, 'any', request_timeout_s=args.request_timeout_s,
                     memory_mb=args.request_memory_mb, pause_s=args.pause_s, policy=policy, one_request_each=True,
                     overpass_url=args.overpass_url)
    except OverpassUnavailable as exc:
        logger.error('%s. Nothing was written for %s.', exc, args.city_id)
        return EXIT_UNAVAILABLE
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
