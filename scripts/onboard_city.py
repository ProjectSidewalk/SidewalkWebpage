"""
Builds a new city's street + region data (the ``qgis_road`` / ``qgis_region`` staging tables) from open data sources,
replacing the manual QGIS pipeline for the repeatable parts of city onboarding (issue #4291).

This is a standalone, manually-run utility (it is not invoked by the app). It automates the deterministic ~90% of the
"Creating database for a new city" wiki workflow — data acquisition, filtering, splitting, clipping, and id assignment —
while keeping a human in the loop for visual QA: the script never writes to the database. It emits a GeoPackage to
eyeball in QGIS plus a SQL file that loads the two staging tables, and loading that SQL is a separate, deliberate step.

Workflow:

  1. Run (from anywhere — output paths are resolved relative to the repo root; in the web container or on any
     host Python that has requirements-offline-tools.txt installed):

         python3.13 scripts/onboard_city.py --place "Newport, Kentucky, USA" --city-id newport-ky

     ``--city-id`` is the id the deployment will eventually use in ``conf/cityparams.conf`` (``SIDEWALK_CITY_ID``),
     so later config steps can consume it as-is; it also names the outputs and, with hyphens swapped for
     underscores, the suggested schema (:func:`schema_name`).

     Streets always come from OSM (fetched with osmnx). Region boundaries come from the first source that works:
       * ``--regions-file <path>`` — bring your own neighborhood dataset (any OGR-readable format, any CRS; must
         carry a ``name`` column). Best quality when a municipal dataset exists.
       * OSM neighbourhood polygons (``place=neighbourhood``/``quarter``, or ``admin_level=10`` boundaries).
       * US Census tracts from the Census Bureau's TIGERweb ArcGIS REST API — the fallback we've used for cities
         without a neighborhood dataset.
       * The city boundary itself as a single region (last resort; you almost certainly want to split it).
  2. QA the GeoPackage (``<out-dir>/<city-id>_qa.gpkg``) in QGIS: region slivers/gaps, streets clipped at the city
     boundary, dropped tiny segments, oversized regions flagged in the report. Fixes have two paths:
       * **Parameter-level**: rerun with different flags — including ``--merge-regions
         "Census Tract 513:Census Tract 523.01"`` (region *names*) to fold flagged sparse regions into neighbors
         without touching polygons by hand. Structural region changes always go through a full rerun so streets
         re-split and re-heal against the final boundaries and region ids come out dense.
       * **Hand edits**: edit the ``qgis_road``/``qgis_region`` layers directly in QGIS (delete streets, reassign a
         street's ``region_id``, tweak/rename regions), then regenerate the SQL from the edited file with
         ``--from-gpkg <path>`` — it validates the layers (unique ids, region references, geometry types) and
         rewrites ``qgis_tables.sql`` so the load matches exactly what was QA'd. Never load a stale SQL file over
         hand edits.
  3. Create the schema and load the staging tables (the SQL file is under ``db/``, which is bind-mounted into the db
     container at ``/opt``; the report prints these commands with the names filled in):

         make create-new-schema name=sidewalk_newport_ky
         docker exec -i projectsidewalk-db psql -v ON_ERROR_STOP=1 -U sidewalk_newport_ky -d sidewalk \\
             -f /opt/onboarding/newport-ky/qgis_tables.sql
         make fill-new-schema

The staging tables match what ``db/scripts/fill-new-schema.sh`` consumes: ``qgis_road`` (``road_id`` int PK that
becomes ``street_edge_id``, ``geom`` LineString 4326 pre-split at intersections, ``highway`` way-type column,
``osm_id``, ``region_id``) and ``qgis_region`` (``region_id`` int PK, ``name``, ``geom`` MultiPolygon 4326). The
default column names line up with the fill script's prompt defaults.

Street semantics vs. the manual QGIS flow:

  * The highway filter is the same one the wiki prescribes (trunk/primary/secondary/tertiary/residential/unclassified/
    pedestrian/living_street, plus ``service``+``service=alley`` with ``--include-alleys``).
  * osmnx returns the graph already noded at intersections, but only at *shared OSM nodes within the filtered
    network*: excluded way types don't cause splits, and grade-separated crossings (overpasses) share no node so —
    unlike QGIS "Split with lines", which splits at any geometric crossing — they correctly stay unsplit.
  * Streets are additionally split at region boundaries by the region-assignment overlay (same as the wiki's
    "Intersection" step). A region boundary that runs *along* a street (census tract boundaries usually follow
    street centerlines) would shred it into fragments alternating between the two regions, so a healing pass
    reabsorbs fragments shorter than ``--heal-segment-m`` into their touching neighbor on the same street (which
    keeps roads from losing pieces mid-block; genuine single crossings keep their split). The same pass restores
    *gaps and truncated ends*: a street stretch that fell outside the city boundary (or through a hole in region
    coverage) is recovered from the original geometry when it's short or when it rides the boundary — lying
    entirely within ``--boundary-merge-tol-m`` of the covered area, the city-edge analog of the rider-merge rule
    below — so boundary-hugging streets stay whole and can poke outside the city polygon; stretches that pull away
    from the covered area are genuine exits and stay cut. Splits where both sides are long are also merged when the
    street runs
    *along* the boundary rather than across it — one side lying entirely within ``--boundary-merge-tol-m`` of the
    other side's region — so a boundary-running road split midway comes back as one street (genuine crossings pull
    away from the boundary and keep their split; merged junctions land in the ``rider_merges`` QA layer). Whatever
    is still shorter than ``--min-segment-m`` after healing is dropped (the wiki's manual "delete tiny segments"
    pass) — kept in the QA GeoPackage's ``dropped_segments`` layer for review.

The decision logic lives in pure, import-safe functions; network and file I/O live in the ``fetch_*``/``write_*``
wrappers and ``main``. Everything is unit-tested in ``test/python/test_onboard_city.py`` (the I/O with osmnx and the
network mocked out). osmnx is imported lazily inside the fetch functions so importing this module for tests doesn't
pay its startup cost.
"""

import argparse
import logging
import re
import sys
from collections import namedtuple
from math import cos, radians
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
import shapely
from pyproj import Geod
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import substring

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent

# The way types we audit — the same filter the manual QGIS flow applies (wiki: "Creating database for a new city").
# Every value is a label of the DB's way_type enum, so fill-new-schema.sh's ::way_type cast can't fail.
DEFAULT_WAY_TYPES = (
    'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'pedestrian', 'living_street'
)

# Current (non-ACS-group) Census Tracts layer of the TIGERweb Tracts_Blocks MapServer; supports f=geojson.
TIGERWEB_TRACTS_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query'

WGS84_GEOD = Geod(ellps='WGS84')


# ---------------------------------------------------------------------------------------------------------------------
# Pure logic (unit-tested in test/python/test_onboard_city.py).
# ---------------------------------------------------------------------------------------------------------------------

def build_osm_filters(include_alleys=False):
    """
    Builds the Overpass way filters osmnx uses to fetch the street network.

    Args:
        include_alleys: Also keep ``highway=service`` ways tagged ``service=alley`` (some cities audit alleys).

    Returns:
        A list of Overpass filter strings; osmnx ORs them together.
    """
    filters = ['["highway"~"^({})$"]'.format('|'.join(DEFAULT_WAY_TYPES))]
    if include_alleys:
        filters.append('["highway"="service"]["service"="alley"]')
    return filters


def flatten_tag(value):
    """
    Collapses an osmnx edge attribute to a single value.

    When osmnx simplifies a graph, edges merged from multiple OSM ways carry list-valued attributes (e.g. ``osmid``
    as a list of way ids). The staging tables want one value per street, so take the first — for ``osm_id`` this
    matches the manual flow, where a street keeps one of its constituent way ids.

    Args:
        value: A scalar or a non-empty list of scalars.

    Returns:
        The value itself, or its first element if it is a list.
    """
    if isinstance(value, list):
        return value[0]
    return value


def normalize_way_type(highway, allowed=DEFAULT_WAY_TYPES):
    """
    Collapses an edge's ``highway`` tag to a single way-type value the DB enum accepts.

    Args:
        highway: The edge's highway tag — a scalar, or a list when simplification merged differently-tagged ways.
        allowed: Way types we audit; used to prefer an auditable value from a mixed list.

    Returns:
        A single way-type string. For a list, the first value that is in ``allowed`` (falling back to the first
        element); ``service`` (alleys) is always acceptable.
    """
    if isinstance(highway, list):
        for value in highway:
            if value in allowed or value == 'service':
                return value
        return highway[0]
    return highway


def geodesic_length_m(geom):
    """
    Measures a geometry's length geodesically (repo convention: never measure through a projection).

    Args:
        geom: A shapely (Multi)LineString in lon/lat (EPSG:4326).

    Returns:
        Length in meters.
    """
    return WGS84_GEOD.geometry_length(geom)


def geodesic_area_m2(geom):
    """
    Measures a polygon's area geodesically.

    Args:
        geom: A shapely (Multi)Polygon in lon/lat (EPSG:4326).

    Returns:
        Area in square meters (always non-negative).
    """
    return abs(WGS84_GEOD.geometry_area_perimeter(geom)[0])


def drop_short_segments(roads, min_m):
    """
    Splits the street set into keepers and too-short fragments.

    Clipping streets at city/region boundaries leaves slivers the manual flow deletes by hand; anything shorter than
    ``min_m`` is separated out (and later written to the QA GeoPackage rather than silently discarded).

    Args:
        roads: GeoDataFrame of LineStrings with a ``length_m`` column.
        min_m: Minimum segment length to keep, in meters.

    Returns:
        A ``(kept, dropped)`` pair of GeoDataFrames.
    """
    too_short = roads['length_m'] < min_m
    return roads[~too_short].copy(), roads[too_short].copy()


def region_street_stats(roads, regions, max_region_street_km):
    """
    Summarizes per-region street totals and flags regions needing human judgment.

    Args:
        roads:                GeoDataFrame of streets with ``region_id`` and ``length_m`` columns.
        regions:              GeoDataFrame of regions with ``region_id`` and ``name`` columns.
        max_region_street_km: Threshold above which a region is flagged as oversized (candidate for splitting).
                              Seattle's regions run ~20–36 km of streets each (median 28, max 69).

    Returns:
        A DataFrame with one row per region: ``region_id``, ``name``, ``n_streets``, ``street_km``, ``flag``
        (empty, ``OVERSIZED — consider splitting``, ``SPARSE — consider merging into a neighbor``, or
        ``EMPTY — no streets``).
    """
    per_region = roads.groupby('region_id').agg(n_streets=('length_m', 'size'), street_m=('length_m', 'sum'))
    stats = regions[['region_id', 'name']].merge(per_region, on='region_id', how='left')
    stats[['n_streets', 'street_m']] = stats[['n_streets', 'street_m']].fillna(0)
    stats['n_streets'] = stats['n_streets'].astype(int)
    stats['street_km'] = stats['street_m'] / 1000
    stats['flag'] = ''
    stats.loc[stats['street_km'] > max_region_street_km, 'flag'] = 'OVERSIZED — consider splitting'
    # A region with almost no streets is usually a source polygon that barely crosses the city boundary (e.g. a
    # census tract across a river); a couple of streets isn't a meaningful audit neighborhood.
    stats.loc[stats['street_km'] < 2, 'flag'] = 'SPARSE — consider merging into a neighbor'
    stats.loc[stats['n_streets'] == 0, 'flag'] = 'EMPTY — no streets'
    return stats.drop(columns='street_m')


# One split-off portion of a street edge during region assignment: its region, geometry (oriented along the original
# edge), position interval along the original edge (degrees of line length), and geodesic length.
Piece = namedtuple('Piece', 'region_id geometry start_pos end_pos length_m')

# Two piece endpoints within this planar distance (degrees; ~1 cm) are the same overlay-produced vertex. Pieces of an
# edge that DON'T touch are separated by a real gap (the street left every region, e.g. exited the city) and must
# never be healed across.
CONTIGUITY_EPS_DEG = 1e-7

# What the healing pass did: fragments merged into a neighbor, out-of-region gaps bridged, street meters restored by
# that bridging, and boundary-running splits merged back together.
HealStats = namedtuple('HealStats', 'n_fragments n_bridged restored_m n_riders')


def pieces_touch(first, second):
    """
    Reports whether ``first`` ends where ``second`` begins (both oriented along their original edge).

    Args:
        first:  The earlier :data:`Piece` along the edge.
        second: The later :data:`Piece`.

    Returns:
        True when the shared endpoint matches within :data:`CONTIGUITY_EPS_DEG`.
    """
    end_x, end_y = first.geometry.coords[-1]
    start_x, start_y = second.geometry.coords[0]
    return abs(end_x - start_x) < CONTIGUITY_EPS_DEG and abs(end_y - start_y) < CONTIGUITY_EPS_DEG


def merge_linestrings(first, second):
    """
    Concatenates two consecutive oriented pieces of the same edge into one LineString.

    Args:
        first:  The earlier piece's geometry.
        second: The later piece's geometry (starting at, or within tolerance of, ``first``'s endpoint).

    Returns:
        The combined LineString (the duplicated junction vertex is kept only once).
    """
    first_coords, second_coords = list(first.coords), list(second.coords)
    if first_coords[-1] == second_coords[0]:
        second_coords = second_coords[1:]
    return LineString(first_coords + second_coords)


def merge_pieces(first, second, region_id):
    """
    Merges two consecutive pieces into one carrying the given region.

    Args:
        first:     The earlier :data:`Piece`.
        second:    The later :data:`Piece`.
        region_id: Region for the merged piece.

    Returns:
        The combined :data:`Piece`.
    """
    geometry = merge_linestrings(first.geometry, second.geometry)
    return Piece(region_id, geometry, first.start_pos, second.end_pos, geodesic_length_m(geometry))


def bridge_short_gaps(edge_geom, pieces, heal_m, buffered_coverage=None):
    """
    Restores stretches of a street that fell outside every region, welding the pieces back together.

    The overlay simply discards the parts of a street outside all regions — so a street that wobbles across the city
    boundary (or through a small hole in region coverage) comes back with a gap in the middle. A gap is restored from
    the original edge geometry when it is shorter than ``heal_m``, or — same rule as :func:`absorb_boundary_riders`,
    with outside-the-city as the "other side" — when it *rides* the boundary, lying entirely within the buffered
    coverage, however long it is. The recovered stretch attaches to the longer neighboring piece (adopting its
    region), letting the street poke slightly outside the boundary instead of losing a mid-block chunk. Gaps that
    pull away from the covered area are genuine exits and stay cut.

    Args:
        edge_geom:         The original (pre-overlay) edge LineString the pieces came from.
        pieces:            The edge's :data:`Piece` list, sorted by ``start_pos``.
        heal_m:            Gaps shorter than this (meters) are always restored.
        buffered_coverage: The union of the region polygons buffered by the boundary-merge tolerance, or None to
                           skip the rides-the-boundary rule.

    Returns:
        A ``(pieces, n_bridged, restored_m)`` tuple: the (still-sorted) piece list with gaps filled, the number of
        gaps bridged, and the total street length restored (meters).
    """
    bridged = [pieces[0]]
    n_bridged, restored_m = 0, 0.0
    for piece in pieces[1:]:
        prev = bridged[-1]
        if not pieces_touch(prev, piece) and piece.start_pos > prev.end_pos:
            gap_geom = substring(edge_geom, prev.end_pos, piece.start_pos)
            if gap_geom.geom_type == 'LineString' and not gap_geom.is_empty:
                gap_m = geodesic_length_m(gap_geom)
                if gap_m < heal_m or (buffered_coverage is not None and buffered_coverage.covers(gap_geom)):
                    n_bridged += 1
                    restored_m += gap_m
                    gap_piece = Piece(None, gap_geom, prev.end_pos, piece.start_pos, gap_m)
                    if prev.length_m >= piece.length_m:
                        bridged[-1] = merge_pieces(prev, gap_piece, prev.region_id)
                    else:
                        piece = merge_pieces(gap_piece, piece, piece.region_id)
        bridged.append(piece)
    return bridged, n_bridged, restored_m


def restore_boundary_tails(edge_geom, pieces, buffered_coverage):
    """
    Restores a street's leading/trailing portion when it rides the boundary of the covered area.

    A street running along the city boundary often *starts or ends* with a stretch that bulges outside the city
    polygon — the overlay truncates it, cutting the street mid-block (and sometimes leaving only an unviable sliver
    inside). When such a missing end lies entirely within the buffered coverage — the rides-the-boundary test of
    :func:`absorb_boundary_riders`, with outside-the-city as the "other side" — it is recovered from the original
    edge geometry and welded onto the adjacent piece. An end that pulls away from the covered area genuinely leaves
    the city and stays truncated. (This automates the wiki's manual advice to nudge boundary polygons outward so
    they fully capture parallel streets.)

    Args:
        edge_geom:         The original (pre-overlay) edge LineString the pieces came from.
        pieces:            The edge's :data:`Piece` list, sorted by ``start_pos``.
        buffered_coverage: The union of the region polygons buffered by the boundary-merge tolerance.

    Returns:
        A ``(pieces, n_restored, restored_m)`` tuple: the piece list with riding ends restored, the number of ends
        restored, and the total street length restored (meters).
    """
    pieces = list(pieces)
    n_restored, restored_m = 0, 0.0

    lead_geom = substring(edge_geom, 0, pieces[0].start_pos) if pieces[0].start_pos > CONTIGUITY_EPS_DEG else None
    if lead_geom is not None and lead_geom.geom_type == 'LineString' and not lead_geom.is_empty \
            and buffered_coverage.covers(lead_geom):
        lead_m = geodesic_length_m(lead_geom)
        n_restored += 1
        restored_m += lead_m
        pieces[0] = merge_pieces(Piece(None, lead_geom, 0, pieces[0].start_pos, lead_m), pieces[0],
                                 pieces[0].region_id)

    edge_end = edge_geom.length
    last = pieces[-1]
    tail_geom = substring(edge_geom, last.end_pos, edge_end) if edge_end - last.end_pos > CONTIGUITY_EPS_DEG else None
    if tail_geom is not None and tail_geom.geom_type == 'LineString' and not tail_geom.is_empty \
            and buffered_coverage.covers(tail_geom):
        tail_m = geodesic_length_m(tail_geom)
        n_restored += 1
        restored_m += tail_m
        pieces[-1] = merge_pieces(last, Piece(None, tail_geom, last.end_pos, edge_end, tail_m), last.region_id)

    return pieces, n_restored, restored_m


def heal_edge_pieces(pieces, heal_m):
    """
    Reassembles a street edge that region assignment split into fragments.

    A region boundary that runs *along* a street (census tract boundaries usually follow street centerlines) makes
    the overlay shred the street into many small pieces alternating between the two regions — and dropping the short
    ones would punch holes in the middle of a road. Instead, every piece shorter than ``heal_m`` is absorbed into its
    longer touching neighbor (adopting that neighbor's region), and touching same-region pieces are merged back into
    single LineStrings. A street that genuinely crosses into another region keeps its split: both sides of a real
    crossing are longer than ``heal_m``, so nothing is absorbed. Pieces separated by a gap (the street left every
    region) are never merged across it — short gaps are restored beforehand by :func:`bridge_short_gaps`.

    Args:
        pieces: The edge's :data:`Piece` list, sorted by ``start_pos``.
        heal_m: Pieces shorter than this (meters) are absorbed into a touching neighbor.

    Returns:
        The healed, still-sorted :data:`Piece` list.
    """
    pieces = list(pieces)

    # Absorb short pieces one at a time, shortest first, so a run of alternating fragments collapses toward whichever
    # side carries the most street.
    while True:
        candidates = [(piece.length_m, i) for i, piece in enumerate(pieces) if piece.length_m < heal_m
                      and ((i > 0 and pieces_touch(pieces[i - 1], piece))
                           or (i + 1 < len(pieces) and pieces_touch(piece, pieces[i + 1])))]
        if not candidates:
            break
        i = min(candidates)[1]
        left = pieces[i - 1] if i > 0 and pieces_touch(pieces[i - 1], pieces[i]) else None
        right = pieces[i + 1] if i + 1 < len(pieces) and pieces_touch(pieces[i], pieces[i + 1]) else None
        if left is not None and (right is None or left.length_m >= right.length_m):
            pieces[i - 1:i + 1] = [merge_pieces(left, pieces[i], left.region_id)]
        else:
            pieces[i:i + 2] = [merge_pieces(pieces[i], right, right.region_id)]

    return coalesce_pieces(pieces)


def coalesce_pieces(pieces):
    """
    Merges touching same-region neighbors (e.g. the two sides of an absorbed fragment) into single pieces.

    Args:
        pieces: A :data:`Piece` list, sorted by ``start_pos``.

    Returns:
        The coalesced, still-sorted list.
    """
    coalesced = [pieces[0]]
    for piece in pieces[1:]:
        if piece.region_id == coalesced[-1].region_id and pieces_touch(coalesced[-1], piece):
            coalesced[-1] = merge_pieces(coalesced[-1], piece, piece.region_id)
        else:
            coalesced.append(piece)
    return coalesced


def absorb_boundary_riders(pieces, buffered_regions):
    """
    Merges splits where a street runs *along* the region boundary rather than crossing it.

    Fragment healing only fixes short pieces; a boundary-running street split midway leaves two long pieces, one per
    side — still one road cut in half by an arbitrary centerline-following boundary. At each junction between
    different-region pieces of the same street, a piece "rides" the boundary when it lies **entirely** within the
    (pre-buffered) polygon of the region on the other side — i.e. the whole piece is within tolerance of the
    boundary. Both pieces ride → boundary-runner split midway: merge, keeping the longer side's region. One rides →
    the street hugs the boundary then dives into a neighborhood: the riding piece joins the interior side's region
    (the only side with a real claim to it). Neither rides → a genuine crossing; the split stays.

    Args:
        pieces:           The edge's :data:`Piece` list, sorted by ``start_pos`` (fragment-healed).
        buffered_regions: Mapping of ``region_id`` to that region's polygon buffered by the merge tolerance.

    Returns:
        A ``(pieces, junctions)`` pair: the merged (and re-coalesced) piece list, and the junction Points where a
        merge happened (for the QA layer).
    """
    pieces = list(pieces)
    junctions = []
    changed = True
    while changed:
        changed = False
        for i in range(len(pieces) - 1):
            first, second = pieces[i], pieces[i + 1]
            if first.region_id == second.region_id or not pieces_touch(first, second):
                continue
            first_rides = buffered_regions[second.region_id].covers(first.geometry)
            second_rides = buffered_regions[first.region_id].covers(second.geometry)
            if first_rides and second_rides:
                region_id = first.region_id if first.length_m >= second.length_m else second.region_id
            elif first_rides:
                region_id = second.region_id
            elif second_rides:
                region_id = first.region_id
            else:
                continue
            junctions.append(Point(first.geometry.coords[-1]))
            pieces[i:i + 2] = [merge_pieces(first, second, region_id)]
            changed = True
            break
    return coalesce_pieces(pieces), junctions


def boundary_coverage(raw_regions, boundary_poly):
    """
    Measures how much of the city boundary a candidate region set covers.

    Streets outside every region are silently trimmed during region assignment, so a region set that covers only part
    of the city (e.g. the handful of neighborhoods someone happened to map in OSM) would quietly drop most streets.

    Args:
        raw_regions:   GeoDataFrame of candidate region polygons.
        boundary_poly: Shapely (Multi)Polygon of the city, in lon/lat.

    Returns:
        Covered fraction of the boundary area, 0..1.
    """
    covered = raw_regions.union_all().intersection(boundary_poly)
    return geodesic_area_m2(covered) / geodesic_area_m2(boundary_poly)


def parse_merge_spec(spec):
    """
    Parses a ``--merge-regions`` spec like ``"Census Tract 513:Census Tract 523.01"`` (merge the first-named region
    into the second; comma-separated pairs). Regions are addressed by name, not id — names survive the dense
    region-id renumbering a merge triggers, so a spec stays valid across rerun iterations.

    Args:
        spec: Comma-separated ``source:target`` region-name pairs.

    Returns:
        A ``{source_name: target_name}`` dict.

    Raises:
        SystemExit: On a malformed pair, a self-merge, a repeated source, or a chain (a target that is itself
                    merged away — ambiguous, so spell out the final target instead).
    """
    mapping = {}
    for pair in spec.split(','):
        parts = [part.strip() for part in pair.split(':')]
        if len(parts) != 2 or not all(parts):
            sys.exit(f'error: bad --merge-regions pair "{pair.strip()}"; expected source:target region names, '
                     'e.g. "Census Tract 513:Census Tract 523.01".')
        source, target = parts
        if source == target:
            sys.exit(f'error: --merge-regions pair "{pair.strip()}" merges "{source}" into itself.')
        if source in mapping:
            sys.exit(f'error: --merge-regions lists "{source}" as a source twice.')
        mapping[source] = target
    chained = set(mapping) & set(mapping.values())
    if chained:
        sys.exit(f'error: --merge-regions target(s) {sorted(chained)} are themselves merged away; '
                 'name the final target directly.')
    return mapping


def merge_regions(regions, mapping):
    """
    Folds named regions into others and renumbers ``region_id`` densely (1..N, name-sorted like
    :func:`prepare_regions`).

    The workflow: a run's report flags SPARSE regions (e.g. a census tract that barely crosses the city boundary);
    rerun the full pipeline with ``--merge-regions``. Merges only run on fetch runs, *before* street assignment, so
    streets land in the merged regions directly and the healing passes see the final boundaries — a post-hoc relabel
    would leave streets split at what is now an interior line.

    Args:
        regions: GeoDataFrame with ``region_id``, ``name``, geometry.
        mapping: ``{source_name: target_name}`` from :func:`parse_merge_spec`.

    Returns:
        The merged, renumbered GeoDataFrame.
    """
    known = set(regions['name'])
    missing = (set(mapping) | set(mapping.values())) - known
    if missing:
        sys.exit(f'error: --merge-regions references region name(s) {sorted(missing)} that do not exist; '
                 f'known: {sorted(known)}.')
    regions = regions.copy().set_index('name')
    for source, target in mapping.items():
        merged = regions.loc[target, 'geometry'].union(regions.loc[source, 'geometry'])
        regions.loc[[target], 'geometry'] = [to_multipolygon(merged)]
    regions = regions.drop(index=list(mapping)).reset_index().sort_values('name').reset_index(drop=True)
    regions['region_id'] = regions.index + 1
    return regions[['region_id', 'name', 'geometry']]


def validate_staging(roads, regions):
    """
    Checks hand-edited (or generated) staging data against what fill-new-schema.sh and the DB schema require.

    Args:
        roads:   GeoDataFrame with ``road_id``, ``osm_id``, ``highway``, ``region_id``, geometry.
        regions: GeoDataFrame with ``region_id``, ``name``, geometry.

    Returns:
        A list of error strings; empty when the data is loadable.
    """
    errors = []
    if roads['road_id'].duplicated().any():
        errors.append(f'duplicate road_id values: {sorted(roads.loc[roads["road_id"].duplicated(), "road_id"])}')
    if regions['region_id'].duplicated().any():
        errors.append('duplicate region_id values: '
                      f'{sorted(regions.loc[regions["region_id"].duplicated(), "region_id"])}')
    dangling = set(roads['region_id']) - set(regions['region_id'])
    if dangling:
        errors.append(f'streets reference region id(s) {sorted(dangling)} that do not exist')
    bad_road_geoms = set(roads.geometry.geom_type) - {'LineString'}
    if bad_road_geoms:
        errors.append(f'street geometries must be LineString; found {sorted(bad_road_geoms)}')
    bad_region_geoms = set(regions.geometry.geom_type) - {'MultiPolygon'}
    if bad_region_geoms:
        errors.append(f'region geometries must be (promotable to) MultiPolygon; found {sorted(bad_region_geoms)}')
    if regions['name'].isna().any() or (regions['name'].astype(str).str.strip() == '').any():
        errors.append('every region needs a non-empty name')
    if roads[['osm_id', 'highway', 'region_id']].isna().any().any():
        errors.append('streets must have non-null osm_id, highway, and region_id')
    return errors


def copy_escape(value):
    """
    Escapes a string for use as a field in a psql ``COPY ... FROM stdin`` text block.

    Args:
        value: The raw field value.

    Returns:
        The value with backslashes, tabs, and newlines escaped per the COPY text format.
    """
    return str(value).replace('\\', '\\\\').replace('\t', '\\t').replace('\n', '\\n').replace('\r', '\\r')


def ewkb_hex(geom):
    """
    Serializes a geometry as hex EWKB with SRID 4326, the format PostGIS geometry columns accept in COPY input.

    Args:
        geom: A shapely geometry in lon/lat.

    Returns:
        A hex EWKB string.
    """
    return shapely.to_wkb(shapely.set_srid(geom, 4326), hex=True, include_srid=True)


def to_multipolygon(geom):
    """
    Promotes a Polygon to a single-part MultiPolygon (the ``region.geom`` column type), passing MultiPolygons through.

    Args:
        geom: A shapely Polygon or MultiPolygon.

    Returns:
        A MultiPolygon.
    """
    if isinstance(geom, Polygon):
        return MultiPolygon([geom])
    return geom


def schema_name(city_id):
    """
    The city's schema name (= its DATABASE_USER) suggested in the report: hyphens are fine in a city id but not in
    a bare SQL identifier, so they become underscores. Convention decided 2026-08-18: new cities keep the full city
    id in the schema (``sidewalk_newport_ky``), rather than the older hand-trimmed style (``sidewalk_newport``).

    Args:
        city_id: The cityparams-style city id, e.g. ``newport-ky``.

    Returns:
        The schema name, e.g. ``sidewalk_newport_ky``.
    """
    return 'sidewalk_' + city_id.replace('-', '_')


def valid_city_id(value):
    """
    argparse type for ``--city-id``: it must work both as a cityparams city-id and, via :func:`schema_name`, as a
    SQL identifier.
    """
    if not re.fullmatch(r'[a-z][a-z0-9-]*', value):
        raise argparse.ArgumentTypeError(f'"{value}" — use lowercase kebab-case, e.g. "newport-ky".')
    return value


# ---------------------------------------------------------------------------------------------------------------------
# Data acquisition (network I/O).
# ---------------------------------------------------------------------------------------------------------------------

def fetch_boundary(place):
    """
    Geocodes a place name to its OSM administrative boundary polygon.

    Args:
        place: A Nominatim-geocodable place string, e.g. ``"Newport, Kentucky, USA"``.

    Returns:
        A single-row GeoDataFrame in EPSG:4326.
    """
    import osmnx as ox
    boundary = ox.geocode_to_gdf(place)
    if boundary.geometry.iloc[0].geom_type not in ('Polygon', 'MultiPolygon'):
        sys.exit(f'error: "{place}" geocoded to a {boundary.geometry.iloc[0].geom_type}, not a boundary polygon. '
                 'Try a more specific place string, or pass --boundary-file.')
    logger.info('Boundary: %s', boundary['display_name'].iloc[0])
    return boundary[['geometry']]


def read_boundary_file(path):
    """
    Reads a city boundary from a local file and dissolves it to one polygon.

    Args:
        path: Any OGR-readable file (GeoJSON, Shapefile, GeoPackage, ...), any CRS.

    Returns:
        A single-row GeoDataFrame in EPSG:4326.
    """
    boundary = gpd.read_file(path).to_crs(epsg=4326)
    return gpd.GeoDataFrame(geometry=[boundary.union_all()], crs='EPSG:4326')


def fetch_osm_neighborhoods(boundary_poly):
    """
    Fetches neighborhood polygons from OSM within the city boundary.

    Args:
        boundary_poly: Shapely (Multi)Polygon of the city, in lon/lat.

    Returns:
        A GeoDataFrame with a ``name`` column (polygonal features only; may be empty).
    """
    import osmnx as ox
    frames = []
    # Queried separately because osmnx ORs the keys of a multi-key tags dict: a combined
    # {boundary: administrative, admin_level: 10} query would match EVERY admin boundary (city, county, state...).
    for tags, admin_only in (({'place': ['neighbourhood', 'quarter']}, False),
                             ({'boundary': 'administrative'}, True)):
        try:
            features = ox.features_from_polygon(boundary_poly, tags)
        except Exception:  # osmnx raises when a query matches nothing.
            continue
        if admin_only:
            if 'admin_level' not in features.columns:
                continue
            features = features[features['admin_level'] == '10']
        features = features[features.geometry.geom_type.isin(['Polygon', 'MultiPolygon'])]
        if not features.empty:
            if 'name' not in features.columns:
                features['name'] = None
            frames.append(features.reset_index()[['name', 'geometry']])
    if not frames:
        return gpd.GeoDataFrame(columns=['name', 'geometry'], geometry='geometry', crs='EPSG:4326')
    neighborhoods = pd.concat(frames, ignore_index=True).drop_duplicates(subset='name')
    return gpd.GeoDataFrame(neighborhoods, geometry='geometry', crs='EPSG:4326')


def fetch_census_tracts(boundary_poly):
    """
    Fetches US Census tracts intersecting the city boundary from the TIGERweb ArcGIS REST API.

    Our established fallback when a city has no neighborhood dataset. The query is by bounding box, so tracts that
    only graze the box are included here and removed later when regions are clipped to the boundary.

    Args:
        boundary_poly: Shapely (Multi)Polygon of the city, in lon/lat.

    Returns:
        A GeoDataFrame with a ``name`` column (e.g. "Census Tract 501"); empty outside the US.
    """
    xmin, ymin, xmax, ymax = boundary_poly.bounds
    response = requests.get(TIGERWEB_TRACTS_URL, params={
        'geometry': f'{xmin},{ymin},{xmax},{ymax}',
        'geometryType': 'esriGeometryEnvelope',
        'inSR': '4326',
        'outSR': '4326',
        'spatialRel': 'esriSpatialRelIntersects',
        'outFields': 'GEOID,NAME',
        'returnGeometry': 'true',
        'f': 'geojson',
    }, timeout=120)
    response.raise_for_status()
    features = response.json().get('features', [])
    if not features:
        return gpd.GeoDataFrame(columns=['name', 'geometry'], geometry='geometry', crs='EPSG:4326')
    tracts = gpd.GeoDataFrame.from_features(features, crs='EPSG:4326')
    return tracts.rename(columns={'NAME': 'name'})[['name', 'geometry']]


def read_regions_file(path):
    """
    Reads a user-supplied region/neighborhood dataset.

    Args:
        path: Any OGR-readable file, any CRS. Must carry a ``name`` column — the convention everything downstream
              (validation, fill-new-schema.sh's prompt default) already assumes.

    Returns:
        A GeoDataFrame with ``name`` + geometry, in EPSG:4326.
    """
    regions = gpd.read_file(path).to_crs(epsg=4326)
    if 'name' not in regions.columns:
        sys.exit(f'error: {path} needs a "name" column holding region names (rename yours in QGIS or with ogr2ogr); '
                 f'columns: {list(regions.columns)}')
    return regions[['name', 'geometry']]


def fetch_streets(boundary_poly, include_alleys, fetch_buffer_m):
    """
    Fetches the intersection-noded, undirected street network from OSM.

    The fetch polygon is the city boundary buffered by ``fetch_buffer_m``: osmnx keeps an edge only when one of its
    endpoint *nodes* (intersections, after simplification) falls inside the polygon, so a boundary-hugging street
    whose intersections sit just outside the city would otherwise never be fetched — no matter what the healing
    passes could restore. The buffer only widens the fetch; the region-assignment overlay, not the fetch extent,
    decides what ends up in the dataset (an edge with no geometry inside any region yields no pieces and vanishes).

    ``truncate_by_edge=True`` keeps edges that cross the (buffered) boundary; ``retain_all=True`` keeps disconnected
    components (a city can legitimately have street clusters not connected to each other within the boundary).

    Args:
        boundary_poly:  Shapely (Multi)Polygon of the city, in lon/lat.
        include_alleys: Also fetch ``service=alley`` ways.
        fetch_buffer_m: How far outside the boundary to fetch, in meters.

    Returns:
        A GeoDataFrame of street edges with ``osm_id`` (int) and ``highway`` (single way-type string) columns.
    """
    import osmnx as ox
    buffer_deg = fetch_buffer_m / (111_320 * cos(radians(boundary_poly.centroid.y)))
    graph = ox.graph_from_polygon(boundary_poly.buffer(buffer_deg), custom_filter=build_osm_filters(include_alleys),
                                  simplify=True, retain_all=True, truncate_by_edge=True)
    graph = ox.convert.to_undirected(graph)
    edges = ox.convert.graph_to_gdfs(graph, nodes=False, edges=True).reset_index()
    edges['osm_id'] = edges['osmid'].map(flatten_tag).astype('int64')
    edges['highway'] = edges['highway'].map(normalize_way_type)
    return edges[['osm_id', 'highway', 'geometry']]


# ---------------------------------------------------------------------------------------------------------------------
# Assembly.
# ---------------------------------------------------------------------------------------------------------------------

def absorb_small_parts(parts, min_part_m2):
    """
    Reassigns clipped-off polygon parts smaller than ``min_part_m2`` to the neighboring region they share the
    longest border with, so a small part doesn't delete ground (and later its streets) from the city. A small part
    touching no other region — e.g. the cross-river fragment of a bbox-matched census tract — is genuine noise and
    is dropped.

    Args:
        parts:       GeoDataFrame of single-part polygons with a ``name`` column (clipped and exploded).
        min_part_m2: Parts at least this big keep their own region.

    Returns:
        The parts GeoDataFrame with small parts renamed to their absorbing region, or removed when isolated.
    """
    parts = parts.reset_index(drop=True)
    small_mask = [geodesic_area_m2(geom) < min_part_m2 for geom in parts.geometry]
    keep = parts[[not small for small in small_mask]].copy()
    small = parts[small_mask].copy()
    # Repeat so a small part whose only route to the rest of the city is another small part still finds a home
    # once that neighbor has been absorbed.
    absorbed = True
    while absorbed and not small.empty:
        absorbed = False
        for idx in list(small.index):
            best_name, best_len = None, 0.0
            for target in keep.itertuples():
                # Planar degree length is fine here: it only ranks this one part's shared borders.
                shared_len = small.geometry[idx].intersection(target.geometry).length
                if shared_len > best_len:
                    best_name, best_len = target.name, shared_len
            if best_name is not None:
                small.loc[idx, 'name'] = best_name
                keep = pd.concat([keep, small.loc[[idx]]])
                small = small.drop(index=idx)
                absorbed = True
    if not small.empty:
        logger.info('Dropped %d region part(s) < %g m² touching no other region.', len(small), min_part_m2)
    return keep


def prepare_regions(raw_regions, boundary, min_part_m2):
    """
    Clips raw region polygons to the city boundary, cleans them up, and assigns region ids.

    Args:
        raw_regions: GeoDataFrame with ``name`` + polygonal geometry, EPSG:4326.
        boundary:    Single-row GeoDataFrame of the city boundary.
        min_part_m2: Polygon parts smaller than this (m²) are absorbed into the neighbor sharing the longest border,
                     or dropped when isolated (see :func:`absorb_small_parts`). Whole regions reduced to nothing are
                     removed.

    Returns:
        A GeoDataFrame with ``region_id`` (1..N), ``name``, and MultiPolygon geometry.
    """
    regions = raw_regions.copy()
    regions['geometry'] = regions.geometry.make_valid()
    regions['name'] = regions['name'].fillna('').astype(str)
    regions.loc[regions['name'] == '', 'name'] = [
        f'Region {i}' for i in range(1, (regions['name'] == '').sum() + 1)
    ]

    clipped = gpd.overlay(regions, boundary[['geometry']], how='intersection', keep_geom_type=True)
    parts = absorb_small_parts(clipped.explode(index_parts=False), min_part_m2)
    if parts.empty:
        sys.exit('error: no region polygons survived clipping to the city boundary.')
    dissolved = parts.dissolve(by='name', as_index=False)

    dissolved = dissolved.sort_values('name').reset_index(drop=True)
    dissolved['region_id'] = dissolved.index + 1
    dissolved['geometry'] = dissolved.geometry.map(to_multipolygon)

    # Overlapping regions would silently duplicate every street in the overlap during region assignment.
    area_sum = sum(geodesic_area_m2(geom) for geom in dissolved.geometry)
    area_union = geodesic_area_m2(dissolved.union_all())
    if area_sum > area_union * 1.01:
        logger.warning('Regions overlap (%.1f%% of total area) — streets in overlaps will be DUPLICATED. '
                       'Fix the region dataset before loading.', (area_sum / area_union - 1) * 100)
    return dissolved[['region_id', 'name', 'geometry']]


def oriented_piece(edge_geom, piece_geom):
    """
    Orients a piece to run the same direction as its original edge and locates it along that edge.

    Args:
        edge_geom:  The original (pre-overlay) edge LineString.
        piece_geom: One overlay-produced piece of that edge.

    Returns:
        A ``(geometry, start_pos, end_pos)`` tuple, with positions in the edge's line-length units.
    """
    start_pos = edge_geom.project(Point(piece_geom.coords[0]))
    end_pos = edge_geom.project(Point(piece_geom.coords[-1]))
    if start_pos > end_pos:
        return shapely.reverse(piece_geom), end_pos, start_pos
    return piece_geom, start_pos, end_pos


def assign_regions(streets, regions, min_segment_m, heal_m, boundary_merge_tol_m):
    """
    Splits streets at region boundaries, tags each piece with its ``region_id``, and assigns road ids.

    This is the wiki's "Intersection" geoprocessing step (pieces outside every region are trimmed away) followed by a
    healing pass: out-of-region gaps and truncated ends are restored from the original street geometry when short or
    riding the boundary of the covered area (:func:`bridge_short_gaps` / :func:`restore_boundary_tails` — a street
    hugging the city boundary stays whole rather than losing mid-block chunks or its ends), and fragments shorter
    than ``heal_m`` are reabsorbed into their touching neighbor on the same street (see :func:`heal_edge_pieces` —
    this is what keeps boundary-running streets from being shredded). Splits that remain because both sides are long
    are then merged when the street runs entirely along the boundary rather than crossing it
    (:func:`absorb_boundary_riders`). Whatever is still shorter than ``min_segment_m`` after healing — isolated
    slivers with nothing to merge into — is separated out for QA review.

    Args:
        streets:              GeoDataFrame of street edges (``osm_id``, ``highway``, geometry).
        regions:              GeoDataFrame from :func:`prepare_regions`.
        min_segment_m:        Minimum street-piece length to keep, in meters.
        heal_m:               Pieces shorter than this are absorbed into a touching neighbor piece of the same
                              street; out-of-region gaps shorter than this are restored.
        boundary_merge_tol_m: A split street merges back together when one side lies entirely within this distance
                              (meters) of the other side's region.

    Returns:
        A ``(roads, dropped, heal_stats, rider_junctions)`` tuple: ``roads`` has ``road_id`` (1..N), ``osm_id``,
        ``highway``, ``region_id``, ``length_m``; ``dropped`` holds the too-short fragments; ``heal_stats`` is a
        :data:`HealStats`; ``rider_junctions`` is a GeoDataFrame of the junction points where boundary-running
        splits were merged (for the QA layer).
    """
    streets = streets.reset_index(drop=True)
    streets['edge_id'] = streets.index
    pieces = gpd.overlay(streets, regions[['region_id', 'geometry']], how='intersection', keep_geom_type=True)
    pieces = pieces.explode(index_parts=False).reset_index(drop=True)
    pieces = pieces[pieces.geometry.geom_type == 'LineString']

    # The tolerance is applied by buffering each region polygon once, in degrees. The per-degree scale is taken at
    # the city's mid-latitude and in the (smaller) east-west direction, so the buffer slightly over-covers
    # north-south — acceptable for a ~15 m rides-the-boundary heuristic.
    mid_lat = (regions.total_bounds[1] + regions.total_bounds[3]) / 2
    tol_deg = boundary_merge_tol_m / (111_320 * cos(radians(mid_lat)))
    buffered_regions = {region.region_id: region.geometry.buffer(tol_deg) for region in regions.itertuples()}
    # For the city-boundary analog of rider merging: a missing street stretch entirely inside this rides the edge of
    # the covered area and is restored rather than cut.
    buffered_coverage = shapely.union_all(list(buffered_regions.values()))

    healed_rows, junction_rows = [], []
    n_raw_pieces = len(pieces)
    n_bridged_total, restored_m_total = 0, 0.0
    for edge_id, edge_pieces in pieces.groupby('edge_id'):
        edge = streets.iloc[edge_id]
        located = []
        for piece_geom in edge_pieces.geometry:
            geometry, start_pos, end_pos = oriented_piece(edge.geometry, piece_geom)
            located.append(Piece(None, geometry, start_pos, end_pos, geodesic_length_m(geometry)))
        located = [piece._replace(region_id=region_id)
                   for piece, region_id in zip(located, edge_pieces['region_id'])]
        located.sort(key=lambda piece: piece.start_pos)
        located, n_bridged, restored_m = bridge_short_gaps(edge.geometry, located, heal_m, buffered_coverage)
        located, n_tails, tails_m = restore_boundary_tails(edge.geometry, located, buffered_coverage)
        n_bridged_total += n_bridged + n_tails
        restored_m_total += restored_m + tails_m
        healed_pieces = heal_edge_pieces(located, heal_m)
        healed_pieces, junctions = absorb_boundary_riders(healed_pieces, buffered_regions)
        junction_rows += [{'osm_id': edge['osm_id'], 'geometry': junction} for junction in junctions]
        for piece in healed_pieces:
            healed_rows.append({'osm_id': edge['osm_id'], 'highway': edge['highway'],
                                'region_id': piece.region_id, 'length_m': piece.length_m,
                                'geometry': piece.geometry})
    healed = gpd.GeoDataFrame(healed_rows, geometry='geometry', crs=streets.crs)
    rider_junctions = gpd.GeoDataFrame(junction_rows, geometry='geometry', crs=streets.crs,
                                       columns=['osm_id', 'geometry'])

    roads, dropped = drop_short_segments(healed, min_segment_m)
    roads = roads.sort_values(['region_id', 'osm_id']).reset_index(drop=True)
    roads['road_id'] = roads.index + 1
    heal_stats = HealStats(n_raw_pieces - len(healed) - len(rider_junctions), n_bridged_total, restored_m_total,
                           len(rider_junctions))
    return (roads[['road_id', 'osm_id', 'highway', 'region_id', 'length_m', 'geometry']], dropped, heal_stats,
            rider_junctions)


# ---------------------------------------------------------------------------------------------------------------------
# Outputs.
# ---------------------------------------------------------------------------------------------------------------------

def write_gpkg(path, roads, regions, boundary, dropped, rider_junctions):
    """
    Writes the QA GeoPackage: the two staging layers plus context layers for eyeballing in QGIS.

    Args:
        path:            Output ``.gpkg`` path.
        roads:           Final street GeoDataFrame.
        regions:         Final region GeoDataFrame.
        boundary:        City boundary GeoDataFrame.
        dropped:         Too-short street fragments that were removed.
        rider_junctions: Junction points where boundary-running splits were merged.
    """
    roads.to_file(path, layer='qgis_road', driver='GPKG')
    regions.to_file(path, layer='qgis_region', driver='GPKG')
    boundary.to_file(path, layer='city_boundary', driver='GPKG')
    if not dropped.empty:
        dropped.to_file(path, layer='dropped_segments', driver='GPKG')
    if not rider_junctions.empty:
        rider_junctions.to_file(path, layer='rider_merges', driver='GPKG')


def write_sql(path, roads, regions):
    """
    Writes the SQL file that loads ``qgis_road`` and ``qgis_region`` into a city schema.

    Runs as the city role (whose search_path is its schema), inside one transaction. Column names and types match
    what fill-new-schema.sh consumes — its way-type and region-name prompts can be answered with their defaults
    (``highway``, ``name``).

    Args:
        path:    Output ``.sql`` path.
        roads:   Final street GeoDataFrame.
        regions: Final region GeoDataFrame.
    """
    lines = [
        '-- Generated by scripts/onboard_city.py — staging tables consumed by db/scripts/fill-new-schema.sh.',
        '-- Load as the city role after `make create-new-schema`:',
        '--   docker exec -i projectsidewalk-db psql -v ON_ERROR_STOP=1 -U <schema> -d sidewalk -f <this file>',
        'BEGIN;',
        'DROP TABLE IF EXISTS qgis_road;',
        'DROP TABLE IF EXISTS qgis_region;',
        'CREATE TABLE qgis_region (',
        '  region_id integer PRIMARY KEY,',
        '  name text NOT NULL,',
        '  geom geometry(MultiPolygon, 4326) NOT NULL',
        ');',
        'CREATE TABLE qgis_road (',
        '  road_id integer PRIMARY KEY,',
        '  osm_id bigint NOT NULL,',
        '  highway text NOT NULL,',
        '  region_id integer NOT NULL REFERENCES qgis_region (region_id),',
        '  geom geometry(LineString, 4326) NOT NULL',
        ');',
        'COPY qgis_region (region_id, name, geom) FROM stdin;',
    ]
    for region in regions.itertuples():
        lines.append(f'{region.region_id}\t{copy_escape(region.name)}\t{ewkb_hex(region.geometry)}')
    lines.append('\\.')
    lines.append('COPY qgis_road (road_id, osm_id, highway, region_id, geom) FROM stdin;')
    for road in roads.itertuples():
        lines.append(f'{road.road_id}\t{road.osm_id}\t{copy_escape(road.highway)}\t{road.region_id}'
                     f'\t{ewkb_hex(road.geometry)}')
    lines.append('\\.')
    lines.append('COMMIT;')
    Path(path).write_text('\n'.join(lines) + '\n')


def write_report(path, args, region_source, roads, regions, dropped, stats, coverage, heal_stats):
    """
    Writes a Markdown run report: sources, counts, per-region stats with flags, and the next manual steps.

    Args:
        path:          Output ``.md`` path.
        args:          The parsed CLI args (recorded for reproducibility).
        region_source: Human-readable description of where the regions came from.
        roads:         Final street GeoDataFrame.
        regions:       Final region GeoDataFrame.
        dropped:       Removed too-short fragments.
        stats:         Per-region stats DataFrame from :func:`region_street_stats`.
        coverage:      Fraction (0..1) of the city boundary the final regions cover, or None when unknown (a
                       ``--from-gpkg`` re-export without a ``city_boundary`` layer).
        heal_stats:    :data:`HealStats` from :func:`assign_regions`, or None on a ``--from-gpkg`` re-export
                       (healing already happened on the original run).
    """
    way_type_counts = roads['highway'].value_counts()
    total_km = roads['length_m'].sum() / 1000
    flagged = stats[stats['flag'] != '']
    dropped_note = ' (see the `dropped_segments` QA layer)' if not dropped.empty else ''
    coverage_note = f', covering **{coverage:.1%}** of the city boundary ' \
                    '(streets outside every region are trimmed)' if coverage is not None else ''
    lines = [
        f'# City onboarding report — {args.city_id}',
        '',
        f'- Generated: {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")} by `scripts/onboard_city.py`',
        f'- Source: {args.place or args.boundary_file or args.from_gpkg}',
        f'- Region source: {region_source}',
        f'- Streets: **{len(roads)}** segments, **{total_km:.1f} km** total (geodesic)',
        f'- Regions: **{len(regions)}**{coverage_note}',
    ]
    if heal_stats is not None:
        lines += [
            f'- Healed region-boundary fragments < {args.heal_segment_m:g} m: **{heal_stats.n_fragments}** '
            '(reabsorbed into a neighboring piece of the same street; the street adopts that piece\'s region)',
            f'- Restored out-of-coverage stretches: **{heal_stats.n_bridged}**, totaling '
            f'**{heal_stats.restored_m:.0f} m** of street — gaps < {args.heal_segment_m:g} m, plus gaps and '
            f'truncated ends of any length riding within {args.boundary_merge_tol_m:g} m of the covered area '
            '(streets may poke outside the city boundary instead of losing mid-block chunks or their ends)',
            f'- Merged boundary-running splits: **{heal_stats.n_riders}** (one side ran entirely within '
            f'{args.boundary_merge_tol_m:g} m of the other side\'s region — along the boundary, not across it; '
            'see the `rider_merges` QA layer for the merged junctions)',
            f'- Dropped segments < {args.min_segment_m:g} m: **{len(dropped)}**{dropped_note}',
        ]
    lines += [
        '',
        '## Way types',
        '',
        '| way_type | streets |',
        '|---|---|',
    ]
    lines += [f'| {way_type} | {count} |' for way_type, count in way_type_counts.items()]
    lines += [
        '',
        f'## Regions ({len(flagged)} flagged)',
        '',
        'Seattle reference: regions carry ~20–36 km of streets (median 28, max 69).',
        '',
        '| region_id | name | streets | street km | flag |',
        '|---|---|---|---|---|',
    ]
    lines += [f'| {s.region_id} | {s.name} | {s.n_streets} | {s.street_km:.1f} | {s.flag} |'
              for s in stats.itertuples()]
    lines += [
        '',
        '## Next steps',
        '',
        '1. QA the GeoPackage in QGIS (regions: slivers/gaps/overlaps; streets: boundary clipping, dropped segments).',
        '2. Rerun with tweaked flags (or hand-edit + re-export) until it looks right.',
        f'3. `make onboard-city id={args.city_id}` — chains the remaining setup: configs, GA properties, schema, '
        'evolutions, the staging load + fill, and the imagery scan.',
        '',
    ]
    Path(path).write_text('\n'.join(lines))


# ---------------------------------------------------------------------------------------------------------------------
# CLI.
# ---------------------------------------------------------------------------------------------------------------------

def parse_args(argv=None):
    """
    Parses command-line arguments.

    Args:
        argv: Argument list (defaults to ``sys.argv``).

    Returns:
        The parsed namespace.
    """
    parser = argparse.ArgumentParser(description='Build qgis_road/qgis_region staging data for a new city (#4291).')
    parser.add_argument('--city-id', required=True, type=valid_city_id,
                        help='The city id this deployment will use in cityparams.conf (SIDEWALK_CITY_ID) — lowercase '
                             'kebab-case with the state/country qualifier, e.g. "newport-ky". Also names the outputs '
                             'and (hyphens becoming underscores) the suggested schema / DATABASE_USER.')
    boundary = parser.add_mutually_exclusive_group(required=False)
    boundary.add_argument('--place', help='Nominatim-geocodable city name, e.g. "Newport, Kentucky, USA".')
    boundary.add_argument('--boundary-file', help='Local city-boundary file (any OGR-readable format/CRS).')
    parser.add_argument('--from-gpkg', help='Re-export mode: skip all fetching and rebuild the SQL load file (and '
                                            'report) from a hand-edited QA GeoPackage\'s qgis_road/qgis_region '
                                            'layers, after validating them.')
    parser.add_argument('--merge-regions', help='Fold regions into others, as comma-separated source:target NAME '
                                                'pairs (e.g. "Census Tract 513:Census Tract 523.01"). Fetch runs '
                                                'only: merging happens before street assignment, so streets '
                                                're-split and re-heal against the merged boundaries and region ids '
                                                'come out dense.')
    parser.add_argument('--regions-file', help='Neighborhood boundary dataset to use instead of OSM/census sources '
                                               '(must carry a "name" column).')
    parser.add_argument('--include-alleys', action='store_true', help='Also include service=alley ways.')
    parser.add_argument('--fetch-buffer-m', type=float, default=50,
                        help='Fetch streets from the boundary buffered by this many meters, so boundary-hugging '
                             'streets whose intersections sit just outside the city still get fetched (default: 50).')
    parser.add_argument('--heal-segment-m', type=float, default=30,
                        help='Reabsorb region-boundary fragments shorter than this into their neighboring piece of '
                             'the same street, and restore out-of-coverage gaps shorter than this (default: 30 m).')
    parser.add_argument('--boundary-merge-tol-m', type=float, default=15,
                        help='Merge a split street back together when one side runs entirely within this distance of '
                             'the other side\'s region, i.e. along the boundary instead of across it (default: 15 m).')
    parser.add_argument('--min-segment-m', type=float, default=15,
                        help='Drop street fragments shorter than this after clipping and healing (default: 15 m).')
    parser.add_argument('--min-region-part-m2', type=float, default=10000,
                        help='Region polygon parts smaller than this after clipping are merged into the neighboring '
                             'region sharing the longest border, or dropped when they touch no other region '
                             '(default: 10000 m² = 1 ha).')
    parser.add_argument('--max-region-street-km', type=float, default=60,
                        help='Flag regions with more street-km than this as oversized (default: 60).')
    parser.add_argument('--out-dir', help='Output directory (default: db/onboarding/<city-id>/, so the SQL file is '
                                          'visible inside the db container under /opt; with --from-gpkg, the '
                                          'GeoPackage\'s own directory).')
    args = parser.parse_args(argv)
    if bool(args.from_gpkg) == bool(args.place or args.boundary_file):
        parser.error('provide either --place/--boundary-file (fetch run) or --from-gpkg (re-export run).')
    if args.from_gpkg and args.merge_regions:
        parser.error('--merge-regions needs a fetch run (--place/--boundary-file): streets must be re-assigned and '
                     're-healed against the merged boundaries, which a re-export cannot do.')
    return args


def run_from_gpkg(args):
    """
    Re-export mode: rebuilds the SQL load file and report from a hand-edited QA GeoPackage.

    The GeoPackage's ``qgis_road``/``qgis_region`` layers are the staging data, so after hand edits in QGIS
    (deleting streets, reassigning a street's ``region_id``, tweaking polygons, renaming regions) this validates the
    result and regenerates ``qgis_tables.sql`` so the load matches what was QA'd. Street lengths are recomputed from
    the (possibly edited) geometry. Structural changes to the region set belong on a fetch rerun
    (``--merge-regions``), not here — see :func:`merge_regions`.

    Args:
        args: The parsed CLI args.
    """
    gpkg_path = Path(args.from_gpkg)
    out_dir = Path(args.out_dir) if args.out_dir else gpkg_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    layers = set(gpd.list_layers(gpkg_path)['name'])
    roads = gpd.read_file(gpkg_path, layer='qgis_road')
    regions = gpd.read_file(gpkg_path, layer='qgis_region')
    logger.info('Read %d streets and %d regions from %s', len(roads), len(regions), gpkg_path)
    # QGIS edits can demote a region to a plain Polygon; promote before validating.
    regions['geometry'] = regions.geometry.map(to_multipolygon)
    roads['length_m'] = [geodesic_length_m(geom) for geom in roads.geometry]

    errors = validate_staging(roads, regions)
    if errors:
        sys.exit('error: edited staging data is not loadable:\n  - ' + '\n  - '.join(errors))

    stats = region_street_stats(roads, regions, args.max_region_street_km)
    for stat in stats[stats['flag'] != ''].itertuples():
        logger.warning('Region %d (%s): %s', stat.region_id, stat.name, stat.flag)
    if 'city_boundary' in layers:
        boundary = gpd.read_file(gpkg_path, layer='city_boundary')
        coverage = boundary_coverage(regions, boundary.geometry.iloc[0])
    else:  # A hand-built GeoPackage may not carry the boundary layer.
        coverage = None

    sql_path = out_dir / 'qgis_tables.sql'
    report_path = out_dir / 'report.md'
    write_sql(sql_path, roads, regions)
    write_report(report_path, args, f'edited GeoPackage ({gpkg_path.name})', roads, regions, roads.iloc[0:0],
                 stats, coverage, None)
    logger.info('\nWrote:\n  %s\n  %s\nThe SQL now matches the edited GeoPackage.', sql_path, report_path)


def main(argv=None):
    """
    Runs the pipeline: fetch boundary → regions → streets, assemble, and write the QA + load artifacts — or, with
    ``--from-gpkg``, re-exports the SQL from a hand-edited QA GeoPackage.

    Args:
        argv: Argument list (defaults to ``sys.argv``).
    """
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    args = parse_args(argv)
    if args.from_gpkg:
        run_from_gpkg(args)
        return
    merge_mapping = parse_merge_spec(args.merge_regions) if args.merge_regions else {}
    out_dir = Path(args.out_dir) if args.out_dir else REPO_ROOT / 'db' / 'onboarding' / args.city_id
    out_dir.mkdir(parents=True, exist_ok=True)

    boundary = fetch_boundary(args.place) if args.place else read_boundary_file(args.boundary_file)
    boundary_poly = boundary.geometry.iloc[0]

    # Region sources, best first: bring-your-own file, OSM neighborhoods, US census tracts, whole city as one region.
    # An automatic source must actually cover the city — otherwise streets outside its polygons would be silently
    # trimmed — so a sparse OSM neighborhood set falls through to census tracts.
    if args.regions_file:
        raw_regions = read_regions_file(args.regions_file)
        region_source = Path(args.regions_file).name
    else:
        raw_regions = fetch_osm_neighborhoods(boundary_poly)
        region_source = 'OpenStreetMap'
        if not raw_regions.empty:
            coverage = boundary_coverage(raw_regions, boundary_poly)
            if coverage < 0.75:
                logger.info('OSM neighborhoods cover only %.0f%% of the city; not using them.', coverage * 100)
                raw_regions = raw_regions.iloc[0:0]
        if raw_regions.empty:
            logger.info('No usable OSM neighborhood polygons; falling back to US census tracts.')
            raw_regions = fetch_census_tracts(boundary_poly)
            region_source = 'US Census tracts (TIGERweb)'
        if raw_regions.empty:
            logger.warning('No census tracts found either; using the city boundary as a single region.')
            raw_regions = gpd.GeoDataFrame({'name': [args.city_id.title()]}, geometry=[boundary_poly],
                                           crs='EPSG:4326')
            region_source = 'city boundary'
    logger.info('Region source: %s (%d raw polygons)', region_source, len(raw_regions))

    regions = prepare_regions(raw_regions, boundary, args.min_region_part_m2)
    logger.info('Regions after clipping/cleanup: %d', len(regions))
    if merge_mapping:
        # Merging before street assignment means streets land in the merged regions directly, and the healing
        # passes see the final boundaries.
        regions = merge_regions(regions, merge_mapping)
        logger.info('Merged regions: %s', ', '.join(f'"{s}" into "{t}"' for s, t in merge_mapping.items()))

    streets = fetch_streets(boundary_poly, args.include_alleys, args.fetch_buffer_m)
    logger.info('OSM street edges fetched: %d', len(streets))

    roads, dropped, heal_stats, rider_junctions = assign_regions(streets, regions, args.min_segment_m,
                                                                 args.heal_segment_m, args.boundary_merge_tol_m)
    errors = validate_staging(roads, regions)
    if errors:  # A pipeline-invariant safety net; any hit here is a bug in the steps above.
        sys.exit('error: generated staging data failed validation:\n  - ' + '\n  - '.join(errors))
    stats = region_street_stats(roads, regions, args.max_region_street_km)
    coverage = boundary_coverage(regions, boundary_poly)
    if coverage < 0.95:
        logger.warning('Final regions cover only %.1f%% of the city boundary — check for gaps in QGIS.',
                       coverage * 100)
    logger.info('Healed %d boundary fragments < %g m back into their street; restored %d out-of-coverage '
                'gaps/ends (%.0f m of street); merged %d boundary-running splits',
                heal_stats.n_fragments, args.heal_segment_m, heal_stats.n_bridged, heal_stats.restored_m,
                heal_stats.n_riders)
    logger.info('Final streets: %d (%.1f km); dropped %d fragments < %g m',
                len(roads), roads['length_m'].sum() / 1000, len(dropped), args.min_segment_m)
    for stat in stats[stats['flag'] != ''].itertuples():
        logger.warning('Region %d (%s): %s', stat.region_id, stat.name, stat.flag)

    gpkg_path = out_dir / f'{args.city_id}_qa.gpkg'
    sql_path = out_dir / 'qgis_tables.sql'
    report_path = out_dir / 'report.md'
    write_gpkg(gpkg_path, roads, regions, boundary, dropped, rider_junctions)
    write_sql(sql_path, roads, regions)
    write_report(report_path, args, region_source, roads, regions, dropped, stats, coverage, heal_stats)
    logger.info('\nWrote:\n  %s\n  %s\n  %s\nQA the GeoPackage in QGIS before loading the SQL (see the report).',
                gpkg_path, sql_path, report_path)


if __name__ == '__main__':
    main()
