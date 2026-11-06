#!/usr/bin/env python3
"""
Changes a live city's footprint in place: new streets where the boundary grew, and a new region split (#5924).

A city build (``onboard_city.py``) numbers its streets 1..N on every run, so its output can never be loaded over a
live city without orphaning every label, task and mission on the streets already there. This tool reads a fresh
build of the *new* footprint beside an export of the *live* streets, and works out the smallest change that takes
the live city to the build's footprint:

- **New streets** are the stretches of the build's streets that no live street covers (the build street minus a
  corridor around the live network, pieces under ``--min-piece-m`` dropped). An end cut at the corridor's edge is
  snapped onto the live street it meets, so the network stays connected. New streets get explicit ids after the
  live city's highest, keep their geometry out of the build, and get their OSM way positions matched afresh.
- **Live streets keep their ids and geometry.** Each is assigned to the new region holding most of its length; none
  is cut at a region border, because ``street_edge_region`` is an assignment, not geometry
  (``docs/architecture.md`` → "Streets, regions, and routes").
- **Regions** named with ``--keep-region`` keep their ids (and so every mission, route and clustering session filed
  under them) and take the build's new name and polygon; the build's other regions are inserted with new ids.

Two subcommands, both run from the repo root in the web container (``make expand-city``):

``plan`` reads the live export and the build, and writes the workspace's ``expansion_plan.json`` (what ``emit``
turns into SQL), ``expansion_plan.gpkg`` (the same for QGIS), ``expansion_report.md``, and the two inputs the
unchanged onboarding tools take for the new streets only: ``street_edge_endpoints.csv`` for the imagery scan
(``make check-imagery id=<workspace>``) and ``street_gradient_input.csv`` for the gradient sampler
(``make street-gradient id=<workspace>``). The workspace is a ``db/onboarding/<name>/`` directory named like a city
id (``juneau-ak-expansion-2026-11``), so those tools run on it unmodified and keep their files apart from the
city's own.

``emit`` reads the plan and those two tools' outputs and writes ``expansion.sql`` and ``rollback.sql``, each one
transaction that a bare ``psql -f`` runs as a dry run (every change, every check, then ROLLBACK) and ``-v apply=1``
commits, plus ``SHA256SUMS`` so the files applied on a server are the files reviewed. The SQL asserts the live
state it was planned against before touching anything (street count and ids, a fingerprint of every street's
geometry, region names) and copies the tables it changes into a backup schema first; ``rollback.sql`` restores
from that backup and refuses once anything references a new street.

The live export is two CSVs the db container writes into the workspace (``make export-live-city``):

    \\copy (SELECT street_edge_id, status, way_type, region_id,
                   street_edge_id = (SELECT tutorial_street_edge_id FROM config) AS is_tutorial,
                   md5(ST_AsBinary(geom)) AS geom_md5, encode(ST_AsEWKB(geom), 'hex') AS geom
            FROM street_edge JOIN street_edge_region USING (street_edge_id) ORDER BY street_edge_id)
           TO 'live_streets.csv' WITH (FORMAT csv, HEADER true)
    \\copy (SELECT region_id, name, deleted FROM region ORDER BY region_id)
           TO 'live_regions.csv' WITH (FORMAT csv, HEADER true)

Runbook, and what to do after applying: ``docs/onboarding-a-city.md`` → "Changing a live city's boundary or regions".
"""
import argparse
import csv
import hashlib
import json
import logging
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.ops import nearest_points

from onboard_city import MIN_SEGMENT_M, REPO_ROOT, ewkb_hex, geodesic_length_m, valid_city_id
from osm_lineage import compute_lineage, lineage_rows, metric_projection

logger = logging.getLogger('expand_city')

PLAN_FILE = 'expansion_plan.json'
PLAN_GPKG = 'expansion_plan.gpkg'
REPORT_FILE = 'expansion_report.md'
ENDPOINTS_FILE = 'street_edge_endpoints.csv'
GRADIENT_INPUT_FILE = 'street_gradient_input.csv'
IMAGERY_SUMMARY_FILE = 'street_imagery_summary.csv'
GRADIENT_FILE = 'street_gradient.csv'
EXPANSION_SQL = 'expansion.sql'
ROLLBACK_SQL = 'rollback.sql'
SHA_FILE = 'SHA256SUMS'
LIVE_STREETS_FILE = 'live_streets.csv'
LIVE_REGIONS_FILE = 'live_regions.csv'
# The gradient sampler's output columns, in its order; the SQL inserts them as they are.
GRADIENT_COLUMNS = ('street_edge_id', 'quality', 'confidence', 'net_grade', 'mean_grade', 'max_grade',
                    'max_grade_from_m', 'max_grade_to_m', 'meters_over_5pct_grade', 'meters_over_8pct_grade',
                    'climb_m', 'descent_m', 'elev_start_m', 'elev_end_m', 'profile_cm', 'dem_source',
                    'dem_resolution_m', 'geom_md5')
# A street that lies on a structure for any part of its length is one (onboard_city.is_structure_tag).
COORD_DECIMALS = 7  # OSM's own precision: a build vertex round-trips the projection to the same value.


# ---------------------------------------------------------------------------------------------------------------------
# Reading the inputs.
# ---------------------------------------------------------------------------------------------------------------------

def read_live_streets(path):
    """
    The live city's streets, from the ``live_streets.csv`` export in the module docstring.

    Returns:
        A GeoDataFrame in lon/lat with ``street_edge_id``, ``status``, ``way_type``, ``region_id``, ``is_tutorial``,
        ``geom_md5`` and geometry, sorted by id.
    """
    frame = pd.read_csv(path, dtype={'geom_md5': str, 'geom': str})
    missing = {'street_edge_id', 'status', 'way_type', 'region_id', 'is_tutorial', 'geom_md5', 'geom'} \
        - set(frame.columns)
    if missing:
        raise ValueError(f'{path} lacks the column(s) {sorted(missing)}; export it as the module docstring says.')
    frame['is_tutorial'] = frame['is_tutorial'].map(lambda value: str(value).strip().lower() in ('t', 'true', '1'))
    geometry = [shapely.from_wkb(bytes.fromhex(hex_wkb)) for hex_wkb in frame['geom']]
    frame = gpd.GeoDataFrame(frame.drop(columns=['geom']), geometry=geometry, crs='EPSG:4326')
    return frame.sort_values('street_edge_id').reset_index(drop=True)


def read_live_regions(path):
    """The live city's regions (``region_id``, ``name``, ``deleted``), from ``live_regions.csv``."""
    frame = pd.read_csv(path, dtype={'name': str})
    frame['deleted'] = frame['deleted'].map(lambda value: str(value).strip().lower() in ('t', 'true', '1'))
    return frame.sort_values('region_id').reset_index(drop=True)


def live_fingerprint(live):
    """
    ``md5`` of every live street's ``id:geom_md5``, comma-joined in id order: what the SQL recomputes with
    ``md5(string_agg(street_edge_id || ':' || md5(ST_AsBinary(geom)), ',' ORDER BY street_edge_id))`` before it
    changes anything, so a plan is applied only to the city it was made for.
    """
    joined = ','.join(f'{row.street_edge_id}:{row.geom_md5}' for row in live.itertuples())
    return hashlib.md5(joined.encode()).hexdigest()


def read_build(gpkg_path):
    """
    The build's streets, regions and OSM ways from its QA GeoPackage, in lon/lat.

    Returns:
        ``(roads, regions, ways)`` GeoDataFrames; ``roads.osm_ids`` is a list per street.
    """
    layers = set(gpd.list_layers(gpkg_path)['name'])
    needed = {'qgis_road', 'qgis_region', 'osm_way'}
    if not needed <= layers:
        raise ValueError(f'{gpkg_path} lacks the layer(s) {sorted(needed - layers)}: it must be a fetch run of '
                         'onboard_city.py (the osm_way layer positions the new streets on their ways).')
    roads = gpd.read_file(gpkg_path, layer='qgis_road').to_crs(epsg=4326)
    roads['osm_ids'] = roads['osm_ids'].map(parse_osm_ids)
    regions = gpd.read_file(gpkg_path, layer='qgis_region').to_crs(epsg=4326)
    ways = gpd.read_file(gpkg_path, layer='osm_way').to_crs(epsg=4326)
    return roads, regions, ways


def parse_osm_ids(value):
    """A GeoPackage ``osm_ids`` cell (``{1,2}`` text, a list, or one id) as a list of ints."""
    if isinstance(value, (list, tuple)):
        return [int(way_id) for way_id in value]
    text = str(value).strip('{}[]')
    return [int(part) for part in text.replace('"', '').split(',') if part.strip()]


# ---------------------------------------------------------------------------------------------------------------------
# The delta: new streets, snapped onto the live network.
# ---------------------------------------------------------------------------------------------------------------------

def projections(geoms):
    """``(to_metres, to_lonlat)`` functions for an azimuthal-equidistant plane centred on the geometries."""
    centre = shapely.union_all(list(geoms)).centroid
    to_metres = metric_projection(centre.x, centre.y)
    back = Transformer.from_crs(f'+proj=aeqd +lat_0={centre.y} +lon_0={centre.x} +datum=WGS84 +units=m',
                                'EPSG:4326', always_xy=True)
    return to_metres, lambda geom: shapely.transform(geom, lambda coords: np.column_stack(
        back.transform(coords[:, 0], coords[:, 1])))


def round_coords(geom, decimals=COORD_DECIMALS):
    """The LineString with every coordinate rounded, so a projection round trip leaves a build vertex unchanged."""
    return LineString([(round(x, decimals), round(y, decimals)) for x, y in geom.coords])


def snap_ends(piece_m, live_m, snap_m):
    """
    Moves each end of a piece (in metres) that lies within ``snap_m`` of the live network onto the nearest live
    street, and says which live street each end now touches.

    A piece cut at the corridor's edge ends ``corridor_m`` short of the live street it continues or meets; the
    network only stays connected if that end lands on it (on the live street's end node when the piece continues
    it, mid-block when it joins it at a junction the live build did not have).

    Args:
        piece_m: The new piece, in the metric plane.
        live_m:  ``{street_edge_id: LineString}`` of the live streets, in the same plane.
        snap_m:  How far an end may move.

    Returns:
        ``(snapped_piece, touches)``: ``touches`` is ``[start_id, end_id]``, None where an end was not snapped.
    """
    coords = list(piece_m.coords)
    touches = [None, None]
    for slot, index in ((0, 0), (1, -1)):
        end = Point(coords[index])
        nearest_id, nearest_distance = None, snap_m
        for street_id, geom in live_m.items():
            distance = geom.distance(end)
            if distance <= nearest_distance:
                nearest_id, nearest_distance = street_id, distance
        if nearest_id is not None:
            target = nearest_points(end, live_m[nearest_id])[1]
            coords[index] = (target.x, target.y)
            touches[slot] = int(nearest_id)
    return LineString(coords), touches


def share_live_vertices(geometry, touches, live_lonlat, to_metres, within_m=0.01):
    """
    The piece with each snapped end that landed on a vertex of the live street it touches set to that vertex's exact
    coordinates.

    Snapping happens in metres and the piece is then rounded to ``COORD_DECIMALS``, while a live vertex may carry more
    decimals, so a continuation put on the live street's end node could still miss it by a millimetre. The app would
    absorb that (intersections cluster endpoints within a metre), but a shared node should be the same number, as it
    is between two streets of one build.

    Args:
        geometry:    The rounded lon/lat piece.
        touches:     :func:`snap_ends`'s ``[start_id, end_id]``.
        live_lonlat: ``{street_edge_id: LineString}`` of the live streets, in lon/lat as exported.
        to_metres:   The plane :func:`projections` gave.
        within_m:    How near a live vertex the end must be to count as that vertex; anything closer is rounding.

    Returns:
        The piece, with up to two end coordinates replaced.
    """
    coords = list(geometry.coords)
    for slot, index in ((0, 0), (1, -1)):
        if touches[slot] is None:
            continue
        end_m = to_metres(Point(coords[index]))
        nearest = min(live_lonlat[touches[slot]].coords, key=lambda vertex: to_metres(Point(vertex)).distance(end_m))
        if to_metres(Point(nearest)).distance(end_m) <= within_m:
            coords[index] = tuple(nearest)
    return LineString(coords)


def new_street_pieces(live, roads, corridor_m=2.0, min_piece_m=MIN_SEGMENT_M, snap_slack_m=0.5):
    """
    The stretches of the build's streets no live street covers: the new streets.

    Each build street has a ``corridor_m`` corridor around the live network subtracted; what remains is split into
    its pieces, pieces shorter than ``min_piece_m`` (geodesic) are dropped as the build itself drops them (#4717),
    and each kept piece has its cut ends snapped onto the live street they meet (onto its exact vertex when that is
    where the end landed).

    Args:
        live:         :func:`read_live_streets` frame; the tutorial street is left out of the network.
        roads:        The build's ``qgis_road`` frame.
        corridor_m:   Half-width of the corridor a live street covers. OSM nodes the two builds share are identical,
                      so this only has to absorb an OSM edit between the builds; the delta is insensitive to it
                      between 1 and 3 m on the first city it was run for.
        min_piece_m:  Shortest piece worth a street.
        snap_slack_m: An end may move ``corridor_m + snap_slack_m`` to meet the live network.

    Returns:
        ``(pieces, dropped)``: lists of dicts with the build street's ``road_id``, ``osm_ids``, ``highway``,
        ``is_structure``, ``build_region_id``, the piece's lon/lat ``geometry``, ``length_m`` and ``touches``.
    """
    network = live[~live['is_tutorial']]
    to_metres, to_lonlat = projections(list(network.geometry) + list(roads.geometry))
    live_m = {int(row.street_edge_id): to_metres(row.geometry) for row in network.itertuples()}
    live_lonlat = {int(row.street_edge_id): row.geometry for row in network.itertuples()}
    corridor = shapely.union_all([geom.buffer(corridor_m) for geom in live_m.values()])
    pieces, dropped = [], []
    for road in roads.itertuples():
        remainder = to_metres(road.geometry).difference(corridor)
        parts = list(remainder.geoms) if remainder.geom_type == 'MultiLineString' else [remainder]
        for part in parts:
            if part.is_empty or part.geom_type != 'LineString':
                continue
            snapped, touches = snap_ends(part, live_m, corridor_m + snap_slack_m)
            geometry = round_coords(to_lonlat(snapped))
            geometry = share_live_vertices(geometry, touches, live_lonlat, to_metres)
            record = {'road_id': int(road.road_id), 'osm_ids': list(road.osm_ids), 'highway': road.highway,
                      'is_structure': bool(road.is_structure), 'build_region_id': int(road.region_id),
                      'geometry': geometry, 'length_m': geodesic_length_m(geometry), 'touches': touches}
            (pieces if record['length_m'] >= min_piece_m else dropped).append(record)
    return pieces, dropped


def uncovered_live_streets(live, roads, corridor_m=2.0, min_share=0.5):
    """
    Live streets of which the build covers less than ``min_share``: streets OSM has lost or moved since the city
    was built. They are reported, never touched (removing a street is ``remove-streets.sh``'s job).
    """
    network = live[~live['is_tutorial']]
    if network.empty or roads.empty:
        return []
    to_metres, _ = projections(list(network.geometry) + list(roads.geometry))
    corridor = shapely.union_all([to_metres(geom).buffer(corridor_m) for geom in roads.geometry])
    gone = []
    for row in network.itertuples():
        geom = to_metres(row.geometry)
        if geom.length and geom.intersection(corridor).length / geom.length < min_share:
            gone.append(int(row.street_edge_id))
    return gone


# ---------------------------------------------------------------------------------------------------------------------
# Regions: ids, names and who goes where.
# ---------------------------------------------------------------------------------------------------------------------

def parse_keep_region(values):
    """``--keep-region 1=Downtown`` pairs as ``{live_region_id: build_region_name}``."""
    mapping = {}
    for value in values or []:
        live_id, separator, name = value.partition('=')
        if not separator or not live_id.strip().isdigit() or not name.strip():
            raise ValueError(f'--keep-region takes <live region id>=<build region name>, not {value!r}')
        mapping[int(live_id)] = name.strip()
    return mapping


def map_regions(live_regions, build_regions, keep, data_source):
    """
    Decides the final region set: which live region takes which build region's name and polygon, and the ids of
    the build regions that are new.

    Every live region that is not deleted must be kept (``--keep-region``): the tool never removes a region, since
    missions, routes and clustering sessions hang off them. Build regions not named in ``keep`` are inserted with
    ids after the live city's highest, in the build's order.

    Args:
        live_regions:  :func:`read_live_regions` frame.
        build_regions: The build's ``qgis_region`` frame.
        keep:          :func:`parse_keep_region` mapping.
        data_source:   ``region.data_source`` for every region the build drew.

    Returns:
        ``(regions, build_to_final)``: ``regions`` is a list of dicts (``region_id``, ``name``, ``action`` update or
        insert, ``geometry``, ``data_source``, ``build_region_id``, and for an update the ``old_name``);
        ``build_to_final`` maps build region ids to final ones.
    """
    live_names = dict(zip(live_regions['region_id'], live_regions['name']))
    active = set(live_regions.loc[~live_regions['deleted'], 'region_id'])
    unknown = set(keep) - set(live_names)
    if unknown:
        raise ValueError(f'--keep-region names live region(s) {sorted(unknown)}, which the city does not have')
    unkept = active - set(keep)
    if unkept:
        raise ValueError(f'live region(s) {sorted(unkept)} are not kept by any --keep-region; this tool never '
                         'removes a region (hide one with make reveal-or-hide-regions instead)')
    by_name = {}
    for region in build_regions.itertuples():
        by_name.setdefault(region.name, []).append(region)
    for name in keep.values():
        if len(by_name.get(name, [])) != 1:
            raise ValueError(f'the build has {len(by_name.get(name, []))} region(s) named {name!r}; --keep-region '
                             'needs exactly one')
    taken = {name: live_id for live_id, name in keep.items()}
    if len(taken) != len(keep):
        raise ValueError('two --keep-region live regions name the same build region')
    next_id = int(max(live_regions['region_id'])) + 1 if len(live_regions) else 1
    regions, build_to_final = [], {}
    for region in build_regions.itertuples():
        if region.name in taken:
            final_id, action = taken[region.name], 'update'
        else:
            final_id, action = next_id, 'insert'
            next_id += 1
        build_to_final[int(region.region_id)] = final_id
        regions.append({'region_id': final_id, 'name': region.name, 'action': action,
                        'geometry': shapely.multipolygons([region.geometry]) if region.geometry.geom_type == 'Polygon'
                        else region.geometry,
                        'data_source': data_source, 'build_region_id': int(region.region_id),
                        'old_name': live_names.get(final_id)})
    return regions, build_to_final


def assign_by_longest_overlap(geoms, regions):
    """
    The region holding most of each geometry's length; ties go to the lowest region id. A geometry touching no
    region (a live street that pokes out of the new boundary) goes to the nearest one and is flagged.

    Args:
        geoms:   Iterable of lon/lat LineStrings.
        regions: ``[(region_id, polygon)]``.

    Returns:
        ``(region_ids, flagged)``: one id per geometry, and the positions of the geometries assigned by distance.
    """
    ordered = sorted(regions, key=lambda item: item[0])
    assigned, flagged = [], []
    for position, geom in enumerate(geoms):
        best_id, best_length = None, 0.0
        for region_id, polygon in ordered:
            length = geom.intersection(polygon).length
            if length > best_length:
                best_id, best_length = region_id, length
        if best_id is None:
            best_id = min(ordered, key=lambda item: (item[1].distance(geom), item[0]))[0]
            flagged.append(position)
        assigned.append(best_id)
    return assigned, flagged


# ---------------------------------------------------------------------------------------------------------------------
# Putting the plan together.
# ---------------------------------------------------------------------------------------------------------------------

def number_new_streets(pieces, first_id):
    """
    Gives the new pieces their ids, contiguous from ``first_id`` in an order that depends only on the data (region,
    lowest OSM way id, then start point), so a rerun of the plan numbers them the same way.
    """
    ordered = sorted(pieces, key=lambda piece: (piece['region_id'], min(piece['osm_ids']),
                                                piece['geometry'].coords[0][0], piece['geometry'].coords[0][1]))
    for offset, piece in enumerate(ordered):
        piece['street_edge_id'] = first_id + offset
    return ordered


def lineage_for(pieces, ways):
    """Positions each new piece on the OSM ways it lies on (#5741), hinted by the build street's way ids."""
    way_geoms = {int(way.osm_way_id): way.geometry for way in ways.itertuples()}
    lineages = compute_lineage([(piece['street_edge_id'], piece['geometry'], piece['osm_ids']) for piece in pieces],
                               way_geoms)
    rows = lineage_rows(lineages)
    by_street = {}
    for row in rows:
        by_street.setdefault(row['street_id'], []).append({key: value for key, value in row.items()
                                                           if key != 'street_id'})
    for piece in pieces:
        piece['lineage'] = by_street.get(piece['street_edge_id'], [])
    return {lineage.street_id: lineage.status for lineage in lineages}


def make_plan(live, live_regions, roads, build_regions, ways, keep, data_source, first_id=None, corridor_m=2.0,
              min_piece_m=MIN_SEGMENT_M, city_id=None):
    """
    Everything ``emit`` needs, as plain data: regions, live street reassignments, new streets with their lineage,
    the pieces dropped, and the live state the SQL must find.

    Args:
        live, live_regions:   The live export frames.
        roads, build_regions, ways: The build frames.
        keep:                 :func:`parse_keep_region` mapping.
        data_source:          Provenance for every region the build drew.
        first_id:             Id of the first new street; default one past the live city's highest.
        corridor_m, min_piece_m: See :func:`new_street_pieces`.
        city_id:              Recorded in the plan.
    """
    regions, build_to_final = map_regions(live_regions, build_regions, keep, data_source)
    polygons = [(region['region_id'], region['geometry']) for region in regions]
    network = live[~live['is_tutorial']].reset_index(drop=True)
    assigned, flagged_positions = assign_by_longest_overlap(network.geometry, polygons)
    remaps, flags = [], []
    for position, (row, region_id) in enumerate(zip(network.itertuples(), assigned)):
        if position in flagged_positions:
            flags.append(f'live street {row.street_edge_id} lies in no region; assigned to the nearest ({region_id})')
        if int(row.region_id) != region_id:
            remaps.append({'street_edge_id': int(row.street_edge_id), 'from_region_id': int(row.region_id),
                           'to_region_id': int(region_id), 'geometry': row.geometry})
    pieces, dropped = new_street_pieces(live, roads, corridor_m, min_piece_m)
    piece_regions, piece_flags = assign_by_longest_overlap([piece['geometry'] for piece in pieces], polygons)
    for piece, region_id in zip(pieces, piece_regions):
        piece['region_id'] = region_id
    flags += [f'new street from build road {pieces[position]["road_id"]} lies in no region; assigned to the '
              f'nearest ({pieces[position]["region_id"]})' for position in piece_flags]
    if first_id is None:
        first_id = int(live['street_edge_id'].max()) + 1
    if first_id <= int(live['street_edge_id'].max()):
        raise ValueError(f'--first-new-street-id {first_id} is not past the live city\'s highest street id '
                         f'{int(live["street_edge_id"].max())}')
    pieces = number_new_streets(pieces, first_id)
    statuses = lineage_for(pieces, ways)
    for piece in pieces:
        if statuses.get(piece['street_edge_id']) != 'matched':
            flags.append(f'new street {piece["street_edge_id"]} matched its OSM ways only in part '
                         f'({statuses.get(piece["street_edge_id"])}); check it in QGIS')
    overlapping = overlapping_pieces(pieces)
    flags += [f'new streets {a} and {b} lie on top of each other; fix the build and plan again'
              for a, b in overlapping]
    gone = uncovered_live_streets(live, roads, corridor_m)
    flags += [f'live street {street_id} is no longer in OSM (the build covers under half of it); left as is'
              for street_id in gone]
    tutorial = live.loc[live['is_tutorial'], 'street_edge_id']
    return {
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'),
        'city_id': city_id,
        'data_source': data_source,
        'live': {'n_streets': int(len(live)), 'max_street_id': int(live['street_edge_id'].max()),
                 'tutorial_street_id': int(tutorial.iloc[0]) if len(tutorial) else None,
                 'fingerprint': live_fingerprint(live),
                 'regions': [{'region_id': int(row.region_id), 'name': row.name, 'deleted': bool(row.deleted)}
                             for row in live_regions.itertuples()]},
        'regions': regions,
        'remaps': remaps,
        'new_streets': pieces,
        'dropped': dropped,
        'flags': flags,
        'first_new_street_id': first_id,
        'corridor_m': corridor_m,
        'min_piece_m': min_piece_m,
    }


def overlapping_pieces(pieces, tol_m=0.5, min_share=0.8):
    """Pairs of new streets one of which lies mostly inside a ``tol_m`` corridor around the other."""
    if len(pieces) < 2:
        return []
    to_metres, _ = projections([piece['geometry'] for piece in pieces])
    metres = [to_metres(piece['geometry']) for piece in pieces]
    pairs = []
    for i, a in enumerate(metres):
        for j in range(i + 1, len(metres)):
            b = metres[j]
            if a.length and b.length and (a.intersection(b.buffer(tol_m)).length / a.length >= min_share
                                          or b.intersection(a.buffer(tol_m)).length / b.length >= min_share):
                pairs.append((pieces[i]['street_edge_id'], pieces[j]['street_edge_id']))
    return pairs


def plan_to_json(plan):
    """The plan with geometries as hex EWKB, ready for ``json.dump``."""
    def convert(value):
        if isinstance(value, dict):
            return {key: convert(item) for key, item in value.items()}
        if isinstance(value, list):
            return [convert(item) for item in value]
        if isinstance(value, shapely.Geometry):
            return ewkb_hex(value)
        if isinstance(value, float) and pd.isna(value):
            return None
        return value
    return convert(plan)


def plan_from_json(data):
    """The inverse of :func:`plan_to_json`: hex EWKB back to shapely geometries."""
    def convert(value, key=None):
        if isinstance(value, dict):
            return {item_key: convert(item, item_key) for item_key, item in value.items()}
        if isinstance(value, list):
            return [convert(item, key) for item in value]
        if key == 'geometry' and isinstance(value, str):
            return shapely.from_wkb(bytes.fromhex(value))
        return value
    return convert(data)


def write_plan_files(workspace, plan, live):
    """Writes the plan JSON, the QA GeoPackage, the report, and the two onboarding-tool inputs for the new streets."""
    workspace = Path(workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / PLAN_FILE).write_text(json.dumps(plan_to_json(plan), indent=1))
    new_streets = plan['new_streets']
    frame = gpd.GeoDataFrame({'street_edge_id': [piece['street_edge_id'] for piece in new_streets],
                              'way_type': [piece['highway'] for piece in new_streets],
                              'is_structure': [piece['is_structure'] for piece in new_streets],
                              'region_id': [piece['region_id'] for piece in new_streets],
                              'length_m': [piece['length_m'] for piece in new_streets],
                              'osm_ids': [','.join(map(str, piece['osm_ids'])) for piece in new_streets],
                              'build_road_id': [piece['road_id'] for piece in new_streets],
                              'touches': [','.join('' if touch is None else str(touch) for touch in piece['touches'])
                                          for piece in new_streets]},
                             geometry=[piece['geometry'] for piece in new_streets], crs='EPSG:4326')
    gpkg = workspace / PLAN_GPKG
    gpkg.unlink(missing_ok=True)
    frame.to_file(gpkg, layer='new_streets', driver='GPKG')
    gpd.GeoDataFrame({'region_id': [region['region_id'] for region in plan['regions']],
                      'name': [region['name'] for region in plan['regions']],
                      'action': [region['action'] for region in plan['regions']]},
                     geometry=[region['geometry'] for region in plan['regions']], crs='EPSG:4326') \
        .to_file(gpkg, layer='regions', driver='GPKG')
    if plan['remaps']:
        gpd.GeoDataFrame({key: [remap[key] for remap in plan['remaps']]
                          for key in ('street_edge_id', 'from_region_id', 'to_region_id')},
                         geometry=[remap['geometry'] for remap in plan['remaps']], crs='EPSG:4326') \
            .to_file(gpkg, layer='remapped_streets', driver='GPKG')
    if plan['dropped']:
        gpd.GeoDataFrame({'build_road_id': [piece['road_id'] for piece in plan['dropped']],
                          'length_m': [piece['length_m'] for piece in plan['dropped']]},
                         geometry=[piece['geometry'] for piece in plan['dropped']], crs='EPSG:4326') \
            .to_file(gpkg, layer='dropped_pieces', driver='GPKG')
    # The imagery scan's input (check_streets_for_imagery.py) and the gradient sampler's (street_gradient.py), for
    # the new streets only; geom_md5 is md5(ST_AsBinary(geom)), which shapely's WKB reproduces byte for byte.
    pd.DataFrame({
        'street_edge_id': [piece['street_edge_id'] for piece in new_streets],
        'region_id': [piece['region_id'] for piece in new_streets],
        'x1': [piece['geometry'].coords[0][0] for piece in new_streets],
        'y1': [piece['geometry'].coords[0][1] for piece in new_streets],
        'x2': [piece['geometry'].coords[-1][0] for piece in new_streets],
        'y2': [piece['geometry'].coords[-1][1] for piece in new_streets],
        'geom': [ewkb_hex(piece['geometry']) for piece in new_streets],
    }).to_csv(workspace / ENDPOINTS_FILE, index=False)
    pd.DataFrame({
        'street_edge_id': [piece['street_edge_id'] for piece in new_streets],
        'geom_md5': [geom_md5(piece['geometry']) for piece in new_streets],
        'is_structure': ['t' if piece['is_structure'] else 'f' for piece in new_streets],
        'geom': [ewkb_hex(piece['geometry']) for piece in new_streets],
    }).to_csv(workspace / GRADIENT_INPUT_FILE, index=False)
    (workspace / REPORT_FILE).write_text(render_report(plan, live))


def geom_md5(geom):
    """``md5(ST_AsBinary(geom))`` as PostGIS computes it: plain little-endian WKB, no SRID."""
    return hashlib.md5(geom.wkb).hexdigest()


def render_report(plan, live):
    """The Markdown report a reviewer reads before anything is emitted."""
    new_streets = plan['new_streets']
    names = {region['region_id']: region['name'] for region in plan['regions']}
    network = live[~live['is_tutorial']]
    final_region = dict(zip(network['street_edge_id'], network['region_id']))
    final_region.update({remap['street_edge_id']: remap['to_region_id'] for remap in plan['remaps']})
    per_region = {}
    for row in network.itertuples():
        counts = per_region.setdefault(final_region[row.street_edge_id], [0, 0.0, 0, 0.0])
        counts[0] += 1
        counts[1] += geodesic_length_m(row.geometry)
    for piece in new_streets:
        counts = per_region.setdefault(piece['region_id'], [0, 0.0, 0, 0.0])
        counts[2] += 1
        counts[3] += piece['length_m']
    lines = [
        f'# City expansion plan — {plan["city_id"]}',
        '',
        f'- Generated: {plan["generated"]} by `tools/city/expand_city.py plan`',
        f'- Live city: **{plan["live"]["n_streets"]}** streets (highest id {plan["live"]["max_street_id"]}, tutorial '
        f'street {plan["live"]["tutorial_street_id"]}), regions '
        + ', '.join(f'{r["region_id"]} "{r["name"]}"' + (' (hidden)' if r['deleted'] else '')
                    for r in plan['live']['regions']),
        f'- Live fingerprint (the SQL checks it first): `{plan["live"]["fingerprint"]}`',
        f'- New streets: **{len(new_streets)}**, **{sum(p["length_m"] for p in new_streets) / 1000:.2f} km**, ids '
        f'**{plan["first_new_street_id"]}–{plan["first_new_street_id"] + len(new_streets) - 1}**'
        if new_streets else '- New streets: **none**',
        f'- Live streets moving to another region: **{len(plan["remaps"])}**',
        f'- Pieces under {plan["min_piece_m"]:g} m dropped: **{len(plan["dropped"])}**',
        f'- Corridor around a live street: {plan["corridor_m"]:g} m',
        '',
        '## Regions',
        '',
        '| region_id | name | action | live streets | live km | new streets | new km |',
        '|---|---|---|---|---|---|---|',
    ]
    for region in plan['regions']:
        counts = per_region.get(region['region_id'], [0, 0.0, 0, 0.0])
        action = region['action'] if region['action'] == 'insert' else f'update (was "{region["old_name"]}")'
        lines.append(f'| {region["region_id"]} | {region["name"]} | {action} | {counts[0]} | {counts[1] / 1000:.2f} '
                     f'| {counts[2]} | {counts[3] / 1000:.2f} |')
    lines += ['', '## New streets', '']
    if new_streets:
        lines += ['| street_edge_id | way_type | length m | region | OSM ways | structure | joins live street |',
                  '|---|---|---|---|---|---|---|']
        for piece in new_streets:
            joins = ' / '.join('—' if touch is None else str(touch) for touch in piece['touches'])
            lines.append(f'| {piece["street_edge_id"]} | {piece["highway"]} | {piece["length_m"]:.0f} | '
                         f'{names[piece["region_id"]]} | {", ".join(map(str, piece["osm_ids"]))} | '
                         f'{"yes" if piece["is_structure"] else ""} | {joins} |')
        lines += ['', 'A dash means that end meets no live street: the far end of an extension, or a junction with '
                  'another new street.']
    else:
        lines.append('None: every build street is already in the city.')
    if plan['remaps']:
        lines += ['', '## Live streets moving to another region', '']
        moves = {}
        for remap in plan['remaps']:
            moves.setdefault((remap['from_region_id'], remap['to_region_id']), []).append(remap['street_edge_id'])
        for (source, target), ids in sorted(moves.items()):
            lines.append(f'- {names.get(source, source)} ({source}) → {names[target]} ({target}): {len(ids)} streets '
                         f'({", ".join(map(str, ids))})')
    if plan['dropped']:
        lines += ['', '## Dropped pieces', '']
        lines += [f'- build road {piece["road_id"]}: {piece["length_m"]:.1f} m' for piece in plan['dropped']]
    lines += ['', f'## Flags ({len(plan["flags"])})', '']
    lines += [f'- {flag}' for flag in plan['flags']] or ['None.']
    lines += ['', '## Next steps', '',
              '1. Look at `expansion_plan.gpkg` in QGIS (layers `new_streets`, `regions`, `remapped_streets`).',
              '2. Scan the new streets for imagery and sample their gradient, with the workspace as the city id:',
              '   `make check-imagery id=<workspace> args="--mapillary"` (or `--gsv`), then',
              '   `make street-gradient id=<workspace> args="--source usgs-3dep-10m"` (or the city\'s DEM).',
              '3. `make expand-city args="emit --workspace <workspace> --schema <schema>"`, then read '
              '`expansion.sql` and run it as a dry run before `-v apply=1` (docs/onboarding-a-city.md).',
              '']
    return '\n'.join(lines)


# ---------------------------------------------------------------------------------------------------------------------
# Emitting the SQL.
# ---------------------------------------------------------------------------------------------------------------------

def sql_text(value):
    """A SQL string literal, or NULL."""
    if value is None:
        return 'NULL'
    return "'" + str(value).replace("'", "''") + "'"


def sql_number(value):
    """A SQL numeric literal, or NULL for None/NaN/empty."""
    if value is None or value == '' or (isinstance(value, float) and pd.isna(value)):
        return 'NULL'
    return repr(float(value)) if isinstance(value, float) else str(value)


def sql_bool(value):
    """A SQL boolean literal, or NULL."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return 'NULL'
    return 'TRUE' if value else 'FALSE'


def sql_geom(geom):
    """A geometry literal: hex EWKB with SRID 4326, which PostGIS reads back byte for byte."""
    return f"'{ewkb_hex(geom)}'::geometry"


def values_list(rows):
    """``(a, b), (c, d)`` for a VALUES clause, one row per line."""
    return ',\n'.join('        (' + ', '.join(row) + ')' for row in rows)


def read_imagery_summary(path, street_ids):
    """
    The imagery scan's per-street verdicts for the new streets: ``{street_edge_id: (has_imagery, oldest, newest,
    n_panos)}``. Every new street must have one; the scan was run on exactly these streets.
    """
    verdicts = {}
    with open(path, newline='') as handle:
        for row in csv.DictReader(handle):
            verdicts[int(row['street_edge_id'])] = (row['has_imagery'] == 'True', row['oldest_capture'] or None,
                                                    row['newest_capture'] or None, int(row['n_panos']))
    missing = sorted(set(street_ids) - set(verdicts))
    if missing:
        raise ValueError(f'{path} has no verdict for new street(s) {missing}: run the imagery scan on the workspace '
                         'first (make check-imagery)')
    return verdicts


def read_gradient_rows(path, expected_md5):
    """
    The gradient sampler's rows for the new streets, each checked against the geometry it was sampled on.

    Args:
        path:         ``street_gradient.csv`` in the workspace.
        expected_md5: ``{street_edge_id: geom_md5}`` of the new streets.
    """
    rows = {}
    with open(path, newline='') as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != GRADIENT_COLUMNS:
            raise ValueError(f'{path} has columns {reader.fieldnames}, not the gradient sampler\'s '
                             f'{list(GRADIENT_COLUMNS)}')
        for row in reader:
            street_id = int(row['street_edge_id'])
            if street_id in expected_md5 and row['geom_md5'] != expected_md5[street_id]:
                raise ValueError(f'{path}: street {street_id} was sampled on a different geometry (md5 '
                                 f'{row["geom_md5"]}, plan {expected_md5[street_id]}); run the sampler again')
            rows[street_id] = row
    missing = sorted(set(expected_md5) - set(rows))
    if missing:
        raise ValueError(f'{path} has no row for new street(s) {missing}: run the gradient sampler on the workspace '
                         'first (make street-gradient)')
    return rows


def psql_gate_header(title, workspace_name, plan_sha):
    """The psql preamble shared by both files: variables, the apply gate, and the transaction start."""
    return f"""-- {title}
-- Generated by tools/city/expand_city.py emit from {workspace_name}/{PLAN_FILE} (sha256 {plan_sha}).
--
-- A bare run is a DRY RUN: every statement and every check runs inside one transaction and is then rolled back,
-- so read the output first. Pass -v apply=1 to commit:
--
--     psql -X -v ON_ERROR_STOP=1 -d <db> -p <port> -f {workspace_name}/<this file>              # dry run
--     psql -X -v ON_ERROR_STOP=1 -d <db> -p <port> -v apply=1 -f {workspace_name}/<this file>   # apply
--
-- lock_timeout makes the run fail rather than stall the app if a long query holds a lock; run it again at a quiet
-- moment. Everything is schema-qualified through search_path, which the first check confirms.
\\set ON_ERROR_STOP on
\\if :{{?apply}}
\\else
  \\set apply 0
\\endif
\\set QUIET off
\\timing off
"""


def expansion_sql(plan, schema, backup_schema, imagery, gradient, expected_label_count=None, workspace_name='',
                  plan_sha=''):
    """
    The one-transaction script that applies the plan to the live schema.

    Steps, each a numbered block in the output: preflight asserts the live state the plan was made against, the
    changed tables are copied into ``backup_schema``, regions are updated and inserted, live streets reassigned,
    new streets inserted with their region, OSM way positions, priority, imagery and gradient rows (and hidden as
    ``no_imagery`` where the scan found none, exactly as the onboarding scan does), missions and users' current
    regions re-derived from the streets they worked on, the caches the app re-derives cleared or recomputed, the
    sequences moved past the new ids, invariants asserted, and a summary printed before the gate.

    Args:
        plan:                 :func:`plan_from_json` plan.
        schema:               The city's schema (also its role name).
        backup_schema:        Where the pre-change copies go; must not exist yet.
        imagery:              :func:`read_imagery_summary` verdicts.
        gradient:             :func:`read_gradient_rows` rows.
        expected_label_count: If given, a different live label count is a WARNING in the output (the plan was made
                              against a copy; labels landing since are fine, a wildly different count is not the
                              same city).
    """
    live = plan['live']
    new_streets = plan['new_streets']
    new_ids = [piece['street_edge_id'] for piece in new_streets]
    first_new = plan['first_new_street_id']
    updates = [region for region in plan['regions'] if region['action'] == 'update']
    inserts = [region for region in plan['regions'] if region['action'] == 'insert']
    live_region_names = [(region['region_id'], region['name']) for region in live['regions']]
    no_imagery_ids = [street_id for street_id in new_ids if not imagery[street_id][0]]
    out = [psql_gate_header(f'Expansion of {schema}: {len(new_streets)} new street(s), {len(inserts)} new '
                            f'region(s), {len(plan["remaps"])} street(s) reassigned', workspace_name, plan_sha)]
    out.append(f"""SET search_path TO {schema}, public;
SET lock_timeout = '10s';
SET statement_timeout = '10min';
BEGIN;
LOCK TABLE street_edge, street_edge_region, region IN SHARE ROW EXCLUSIVE MODE;

\\echo '== 1. Preflight: is this the city the plan was made for?'
DO $$
DECLARE
    n_streets integer;
    max_id integer;
    tutorial integer;
    fingerprint text;
    region_names text;
    n_labels bigint;
BEGIN
    IF current_schema() <> {sql_text(schema)} THEN
        RAISE EXCEPTION 'search_path resolves to %, not {schema}', current_schema();
    END IF;
    SELECT count(*), max(street_edge_id) INTO n_streets, max_id FROM street_edge;
    IF n_streets <> {live['n_streets']} OR max_id <> {live['max_street_id']} THEN
        RAISE EXCEPTION 'street_edge has % rows (max id %), the plan expects {live['n_streets']} (max '
                        '{live['max_street_id']})', n_streets, max_id;
    END IF;
    SELECT tutorial_street_edge_id INTO tutorial FROM config;
    IF tutorial IS DISTINCT FROM {sql_number(live['tutorial_street_id'])} THEN
        RAISE EXCEPTION 'tutorial street is %, the plan expects {live['tutorial_street_id']}', tutorial;
    END IF;
    IF EXISTS (SELECT 1 FROM street_edge WHERE street_edge_id >= {first_new}) THEN
        RAISE EXCEPTION 'street ids from {first_new} are not free';
    END IF;
    SELECT md5(string_agg(street_edge_id || ':' || md5(ST_AsBinary(geom)), ',' ORDER BY street_edge_id))
    INTO fingerprint FROM street_edge;
    IF fingerprint <> {sql_text(live['fingerprint'])} THEN
        RAISE EXCEPTION 'street geometry fingerprint is %, the plan was made against {live['fingerprint']}: '
                        'export live_streets.csv again and plan again', fingerprint;
    END IF;
    SELECT string_agg(region_id || ':' || name, ',' ORDER BY region_id) INTO region_names FROM region;
    IF region_names IS DISTINCT FROM {sql_text(','.join(f'{rid}:{name}' for rid, name in live_region_names))} THEN
        RAISE EXCEPTION 'regions are [%], the plan expects [{','.join(f'{rid}:{name}' for rid, name in live_region_names)}]',
                        region_names;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = {sql_text(backup_schema)}) THEN
        RAISE EXCEPTION 'backup schema {backup_schema} already exists: a previous apply? Roll it back or drop it first';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
                   WHERE pg_type.typname = 'street_edge_status_change_source'
                     AND pg_enum.enumlabel = 'hide_streets_without_imagery') THEN
        RAISE EXCEPTION 'street_edge_status_change_source lacks hide_streets_without_imagery';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'osm_way_street_edge'::regclass AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'osm_way_street_edge has no is_primary trigger (evolution 417 not applied?)';
    END IF;
    SELECT count(*) INTO n_labels FROM label;
    RAISE NOTICE 'label rows: %', n_labels;
""")
    if expected_label_count is not None:
        out.append(f"""    IF n_labels <> {int(expected_label_count)} THEN
        RAISE WARNING 'label count % differs from the {int(expected_label_count)} the plan was reviewed against', n_labels;
    END IF;
""")
    out.append(f"""END $$;

\\echo '== 2. Backup copies of every table this script changes, in {backup_schema}'
CREATE SCHEMA {backup_schema};
CREATE TABLE {backup_schema}.region AS TABLE region;
CREATE TABLE {backup_schema}.street_edge_region AS TABLE street_edge_region;
CREATE TABLE {backup_schema}.street_edge_priority AS TABLE street_edge_priority;
CREATE TABLE {backup_schema}.mission AS TABLE mission;
CREATE TABLE {backup_schema}.user_current_region AS TABLE user_current_region;
CREATE TABLE {backup_schema}.route AS TABLE route;
CREATE TABLE {backup_schema}.intersection AS TABLE intersection;
CREATE TABLE {backup_schema}.place AS TABLE place;
CREATE TABLE {backup_schema}.config AS TABLE config;
CREATE TABLE {backup_schema}.region_completion AS TABLE region_completion;
CREATE TABLE {backup_schema}.expansion_meta AS
    SELECT {sql_text(plan_sha)} AS plan_sha256, {sql_text(plan['generated'])} AS plan_generated,
           {sql_text(live['fingerprint'])} AS live_fingerprint, {first_new} AS first_new_street_id,
           {first_new + len(new_ids) - 1 if new_ids else first_new - 1} AS last_new_street_id,
           ARRAY[{', '.join(str(region['region_id']) for region in inserts)}]::integer[] AS new_region_ids,
           now() AS applied_at;

\\echo '== 3. Regions: {len(updates)} renamed and redrawn, {len(inserts)} new'
""")
    for region in updates:
        out.append(f"""UPDATE region
SET name = {sql_text(region['name'])}, data_source = {sql_text(region['data_source'])},
    geom = ST_Multi({sql_geom(region['geometry'])})
WHERE region_id = {region['region_id']};
""")
    if inserts:
        rows = [(str(region['region_id']), sql_text(region['data_source']), sql_text(region['name']),
                 f"ST_Multi({sql_geom(region['geometry'])})", 'FALSE') for region in inserts]
        out.append(f"""INSERT INTO region (region_id, data_source, name, geom, deleted) VALUES
{values_list(rows)};
""")
    out.append(f"""
\\echo '== 4. Live streets whose region changes: {len(plan['remaps'])}'
""")
    if plan['remaps']:
        rows = [(str(remap['street_edge_id']), str(remap['from_region_id']), str(remap['to_region_id']))
                for remap in plan['remaps']]
        out.append(f"""UPDATE street_edge_region
SET region_id = moves.to_region_id
FROM (VALUES
{values_list(rows)}
) AS moves(street_edge_id, from_region_id, to_region_id)
WHERE street_edge_region.street_edge_id = moves.street_edge_id
  AND street_edge_region.region_id = moves.from_region_id;
""")
    out.append(f"""
\\echo '== 5. New streets: {len(new_streets)}'
""")
    if new_streets:
        rows = []
        for piece in new_streets:
            geom = piece['geometry']
            (x1, y1), (x2, y2) = geom.coords[0], geom.coords[-1]
            rows.append((str(piece['street_edge_id']), sql_geom(geom), repr(x1), repr(y1), repr(x2), repr(y2),
                         f"{sql_text(piece['highway'])}::way_type", "'open'::street_edge_status"))
        out.append(f"""INSERT INTO street_edge (street_edge_id, geom, x1, y1, x2, y2, way_type, status) VALUES
{values_list(rows)};
-- The geometry PostGIS stored must hash to what the scan and the gradient sampler were given.
DO $$
DECLARE
    bad text;
BEGIN
    SELECT string_agg(street_edge.street_edge_id::text, ', ') INTO bad
    FROM street_edge
    JOIN (VALUES
{values_list([(str(piece['street_edge_id']), sql_text(geom_md5(piece['geometry']))) for piece in new_streets])}
    ) AS expected(street_edge_id, geom_md5) ON expected.street_edge_id = street_edge.street_edge_id
    WHERE md5(ST_AsBinary(street_edge.geom)) <> expected.geom_md5;
    IF bad IS NOT NULL THEN
        RAISE EXCEPTION 'new street(s) % stored with a different geometry than planned', bad;
    END IF;
END $$;

\\echo '== 6. Their regions'
INSERT INTO street_edge_region (street_edge_id, region_id) VALUES
{values_list([(str(piece['street_edge_id']), str(piece['region_id'])) for piece in new_streets])};

\\echo '== 7. Their OSM ways (#5741)'
""")
        lineage = [(str(row['osm_way_id']), str(piece['street_edge_id']), sql_number(row['street_from_frac']),
                    sql_number(row['street_to_frac']), sql_number(row['way_from_frac']), sql_number(row['way_to_frac']),
                    sql_bool(row['same_direction']),
                    'now()' if row['street_from_frac'] is not None else 'NULL')
                   for piece in new_streets for row in piece['lineage']]
        if lineage:
            out.append(f"""INSERT INTO osm_way_street_edge (osm_way_id, street_edge_id, street_from_frac, street_to_frac, way_from_frac,
                                 way_to_frac, same_direction, matched_at) VALUES
{values_list(lineage)};
""")
        out.append(f"""
\\echo '== 8. Priority rows, so Explore can hand the new streets out (#3888)'
INSERT INTO street_edge_priority (street_edge_id, priority)
SELECT street_edge_id, 1 FROM street_edge WHERE street_edge_id IN ({', '.join(map(str, new_ids))});

\\echo '== 9. Streets the imagery scan found no 360° imagery on: {len(no_imagery_ids)} (hidden as the onboarding scan hides them)'
""")
        if no_imagery_ids:
            id_list = ', '.join(map(str, no_imagery_ids))
            out.append(f"""WITH changed AS (
    UPDATE street_edge SET status = 'no_imagery'
    WHERE street_edge_id IN ({id_list}) AND status = 'open'
    RETURNING street_edge_id
)
INSERT INTO street_edge_status_change (street_edge_id, old_status, new_status, source)
SELECT street_edge_id, 'open'::street_edge_status, 'no_imagery'::street_edge_status,
       'hide_streets_without_imagery'::street_edge_status_change_source
FROM changed;
DELETE FROM street_edge_priority WHERE street_edge_id IN ({id_list});
""")
        with_imagery = [(str(sid), sql_text(verdict[1]) + '::date', sql_text(verdict[2]) + '::date', str(verdict[3]))
                        for sid, verdict in sorted(imagery.items()) if sid in new_ids and verdict[0]]
        out.append(f"""
\\echo '== 10. Imagery scan results: {len(with_imagery)} street(s) with imagery'
""")
        if with_imagery:
            out.append(f"""INSERT INTO street_imagery (street_edge_id, oldest_capture, newest_capture, n_panos, data_source, updated_at)
SELECT street_edge_id, oldest_capture, newest_capture, n_panos, 'imagery_scan', now()
FROM (VALUES
{values_list(with_imagery)}
) AS scanned(street_edge_id, oldest_capture, newest_capture, n_panos);
""")
        gradient_rows = []
        for street_id in new_ids:
            row = gradient[street_id]
            gradient_rows.append((str(street_id), f"{sql_text(row['quality'])}::street_gradient_quality",
                                  f"{sql_text(row['confidence'])}::street_gradient_confidence")
                                 + tuple(sql_number(row[col]) for col in GRADIENT_COLUMNS[3:14])
                                 + (f"{sql_text(row['profile_cm'] or None)}::integer[]", sql_text(row['dem_source']),
                                    sql_number(row['dem_resolution_m']), sql_text(row['geom_md5'])))
        out.append(f"""
\\echo '== 11. Street gradient (#5223)'
INSERT INTO street_gradient ({', '.join(GRADIENT_COLUMNS)}, sampled_at)
SELECT {', '.join(GRADIENT_COLUMNS)}, now()
FROM (VALUES
{values_list(gradient_rows)}
) AS sampled({', '.join(GRADIENT_COLUMNS)});
""")
    out.append(f"""
\\echo '== 12. Missions follow the streets their labels are on'
-- An audit mission is filed under one region. With the regions redrawn, each goes where most of its labels'
-- streets now are; a mission with no labels yet goes with its current task's street; one with neither stays.
UPDATE mission
SET region_id = COALESCE(
    (SELECT mode() WITHIN GROUP (ORDER BY street_edge_region.region_id)
     FROM label JOIN street_edge_region ON street_edge_region.street_edge_id = label.street_edge_id
     WHERE label.mission_id = mission.mission_id AND NOT label.tutorial),
    (SELECT street_edge_region.region_id
     FROM audit_task JOIN street_edge_region ON street_edge_region.street_edge_id = audit_task.street_edge_id
     WHERE audit_task.audit_task_id = mission.current_audit_task_id),
    (SELECT street_edge_region.region_id
     FROM audit_task JOIN street_edge_region ON street_edge_region.street_edge_id = audit_task.street_edge_id
     WHERE audit_task.current_mission_id = mission.mission_id
     ORDER BY audit_task.task_start DESC LIMIT 1),
    mission.region_id)
WHERE mission.region_id IS NOT NULL;

\\echo '== 13. Each user''s current region is where they last explored; a route starts where its first street is'
UPDATE user_current_region
SET region_id = latest.region_id
FROM (SELECT DISTINCT ON (audit_task.user_id) audit_task.user_id, street_edge_region.region_id
      FROM audit_task JOIN street_edge_region ON street_edge_region.street_edge_id = audit_task.street_edge_id
      ORDER BY audit_task.user_id, audit_task.task_start DESC) AS latest
WHERE user_current_region.user_id = latest.user_id AND user_current_region.region_id <> latest.region_id;
UPDATE route
SET region_id = (SELECT street_edge_region.region_id
                 FROM route_street JOIN street_edge_region ON street_edge_region.street_edge_id = route_street.street_edge_id
                 WHERE route_street.route_id = route.route_id
                 ORDER BY route_street.position LIMIT 1)
WHERE EXISTS (SELECT 1 FROM route_street WHERE route_street.route_id = route.route_id);

\\echo '== 14. Caches the app derives from streets and regions'
-- region_completion re-initialises itself only when empty, and a region without a row breaks progress updates.
TRUNCATE region_completion;
-- Intersections and places carry a region for filtering; the nightly jobs rebuild both, this keeps them right
-- until then.
UPDATE intersection
SET region_id = member.region_id
FROM (SELECT intersection_street_edge.intersection_id,
             mode() WITHIN GROUP (ORDER BY street_edge_region.region_id) AS region_id
      FROM intersection_street_edge
      JOIN street_edge_region ON street_edge_region.street_edge_id = intersection_street_edge.street_edge_id
      GROUP BY intersection_street_edge.intersection_id) AS member
WHERE intersection.intersection_id = member.intersection_id AND intersection.region_id <> member.region_id;
UPDATE place
SET region_id = inside.region_id
FROM (SELECT place.place_id, min(region.region_id) AS region_id
      FROM place JOIN region ON ST_Intersects(region.geom, place.geom) AND NOT region.deleted
      GROUP BY place.place_id) AS inside
WHERE place.place_id = inside.place_id AND place.region_id IS DISTINCT FROM inside.region_id;

\\echo '== 15. Map centre, bounds and zoom from the regions'' new extent (as fill-new-schema.sh sets them)'
UPDATE config
SET city_center_lat = (lat_min + lat_max) / 2,
    city_center_lng = (lng_min + lng_max) / 2,
    southwest_boundary_lat = lat_min - 0.5,
    southwest_boundary_lng = lng_min - 0.5,
    northeast_boundary_lat = lat_max + 0.5,
    northeast_boundary_lng = lng_max + 0.5,
    default_map_zoom = least(14, greatest(9,
        round(log(2, (360 / greatest(lat_max - lat_min,
            (lng_max - lng_min) * cos(radians((lat_min + lat_max) / 2))))::numeric) * 4) / 4))
FROM (
    SELECT ST_YMin(ST_Extent(geom)) AS lat_min, ST_YMax(ST_Extent(geom)) AS lat_max,
           ST_XMin(ST_Extent(geom)) AS lng_min, ST_XMax(ST_Extent(geom)) AS lng_max
    FROM region
    WHERE deleted = FALSE
) AS extent;

\\echo '== 16. Sequences past the explicit ids'
{setval_block()}
\\echo '== 17. Invariants'
DO $$
DECLARE
    problem text;
BEGIN
    SELECT string_agg(street_edge_id::text, ', ') INTO problem
    FROM street_edge WHERE NOT EXISTS (SELECT 1 FROM street_edge_region
                                        WHERE street_edge_region.street_edge_id = street_edge.street_edge_id);
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'streets without a region: %', problem; END IF;
    SELECT string_agg(region_id::text, ', ') INTO problem
    FROM region WHERE NOT deleted AND NOT EXISTS (SELECT 1 FROM street_edge_region
                                                  WHERE street_edge_region.region_id = region.region_id);
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'regions without a street: %', problem; END IF;
    IF (SELECT count(*) FROM street_edge) <> {live['n_streets'] + len(new_ids)}
       OR (SELECT count(*) FROM street_edge_region) <> {live['n_streets'] + len(new_ids)} THEN
        RAISE EXCEPTION 'expected {live['n_streets'] + len(new_ids)} streets and as many region rows, found % and %',
                        (SELECT count(*) FROM street_edge), (SELECT count(*) FROM street_edge_region);
    END IF;
    SELECT string_agg(street_edge.street_edge_id::text, ', ') INTO problem
    FROM street_edge LEFT JOIN street_edge_priority ON street_edge_priority.street_edge_id = street_edge.street_edge_id
    WHERE (street_edge.status = 'open') <> (street_edge_priority.street_edge_id IS NOT NULL)
      AND street_edge.street_edge_id >= {first_new};
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'new streets whose priority row disagrees with their status: %', problem; END IF;
    SELECT string_agg(street_edge_id::text, ', ') INTO problem
    FROM street_edge WHERE street_edge_id >= {first_new} AND ST_Length(geom::geography) < {plan['min_piece_m']};
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'new streets shorter than {plan['min_piece_m']} m: %', problem; END IF;
    SELECT string_agg(mission_id::text, ', ') INTO problem
    FROM mission WHERE region_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM region WHERE region.region_id = mission.region_id);
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'missions in a missing region: %', problem; END IF;
    SELECT string_agg(street_edge_id::text, ', ') INTO problem
    FROM street_edge WHERE street_edge_id >= {first_new}
      AND EXISTS (SELECT 1 FROM osm_way_street_edge WHERE osm_way_street_edge.street_edge_id = street_edge.street_edge_id)
      AND NOT EXISTS (SELECT 1 FROM osm_way_street_edge
                      WHERE osm_way_street_edge.street_edge_id = street_edge.street_edge_id AND is_primary);
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'new streets with OSM ways but no primary: %', problem; END IF;
    SELECT string_agg(street_edge_id::text, ', ') INTO problem
    FROM street_edge WHERE street_edge_id >= {first_new}
      AND NOT EXISTS (SELECT 1 FROM street_gradient WHERE street_gradient.street_edge_id = street_edge.street_edge_id);
    IF problem IS NOT NULL THEN RAISE EXCEPTION 'new streets without a gradient row: %', problem; END IF;
    IF (SELECT count(*) FROM region_completion) <> 0 THEN RAISE EXCEPTION 'region_completion not empty'; END IF;
END $$;

\\echo '== 18. Summary'
SELECT region.region_id, region.name, region.deleted, count(street_edge_region.street_edge_id) AS streets,
       round(sum(ST_Length(street_edge.geom::geography))::numeric / 1000, 2) AS km,
       count(*) FILTER (WHERE street_edge.status = 'open') AS open_streets
FROM region
LEFT JOIN street_edge_region ON street_edge_region.region_id = region.region_id
LEFT JOIN street_edge ON street_edge.street_edge_id = street_edge_region.street_edge_id
GROUP BY region.region_id, region.name, region.deleted
ORDER BY region.region_id;
SELECT street_edge_id, status, way_type, round(ST_Length(geom::geography)::numeric) AS m
FROM street_edge WHERE street_edge_id >= {first_new} ORDER BY street_edge_id;
SELECT mission_id, mission_type, region_id, completed FROM mission WHERE region_id IS NOT NULL ORDER BY mission_id;
SELECT user_id, region_id FROM user_current_region ORDER BY user_id;
SELECT city_center_lat, city_center_lng, southwest_boundary_lat, southwest_boundary_lng, northeast_boundary_lat,
       northeast_boundary_lng, default_map_zoom FROM config;
SELECT (SELECT count(*) FROM label) AS labels, (SELECT count(*) FROM audit_task) AS audit_tasks,
       (SELECT count(*) FROM street_edge) AS streets, (SELECT count(*) FROM street_edge_priority) AS priorities,
       (SELECT count(*) FROM region) AS regions;

\\if :apply
  \\echo 'COMMITTING.'
  COMMIT;
  \\echo 'Applied. Now: PUT /adminapi/clearPlayCache (Admin > Management), then run Rebuild minimap basemap there.'
\\else
  \\echo 'DRY RUN: rolling back. Pass -v apply=1 to commit.'
  ROLLBACK;
\\endif
""")
    return ''.join(out)


def setval_block():
    """fill-new-schema.sh's sequence catch-up, verbatim: the sequence is read off each column's DEFAULT."""
    return """DO $$
DECLARE
    col record;
    sequence_name text;
BEGIN
    FOR col IN SELECT * FROM (VALUES ('street_edge', 'street_edge_id'), ('region', 'region_id'))
                             AS serial_columns(table_name, column_name)
    LOOP
        SELECT substring(pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid) FROM 'nextval\\(''([^'']+)''')
        INTO sequence_name
        FROM pg_attrdef
        JOIN pg_attribute ON pg_attribute.attrelid = pg_attrdef.adrelid AND pg_attribute.attnum = pg_attrdef.adnum
        WHERE pg_attrdef.adrelid = col.table_name::regclass AND pg_attribute.attname = col.column_name;
        IF sequence_name IS NOT NULL THEN
            EXECUTE format('SELECT setval(%L, (SELECT max(%I) FROM %I))',
                           sequence_name, col.column_name, col.table_name);
        END IF;
    END LOOP;
END $$;
"""


def rollback_sql(plan, schema, backup_schema, workspace_name='', plan_sha=''):
    """
    The one-transaction script that undoes :func:`expansion_sql` from its backup schema.

    It refuses once anything a person or the app made references a new street (a label, task, route, issue or
    comment), since deleting those is a decision, not a rollback. Cache rows the nightly jobs rebuild (intersections,
    sidewalk presence, AccessScore snapshots, reopen candidates) cascade or are deleted; ``osm_way`` rows the nightly
    refresh fetched for the new ways are left, harmless.
    """
    live = plan['live']
    first_new = plan['first_new_street_id']
    inserts = [region['region_id'] for region in plan['regions'] if region['action'] == 'insert']
    kept = [region['region_id'] for region in plan['regions'] if region['action'] == 'update']
    fallback = min(kept) if kept else 1
    out = [psql_gate_header(f'Rollback of the expansion of {schema}', workspace_name, plan_sha)]
    out.append(f"""SET search_path TO {schema}, public;
SET lock_timeout = '10s';
SET statement_timeout = '10min';
BEGIN;
LOCK TABLE street_edge, street_edge_region, region IN SHARE ROW EXCLUSIVE MODE;

\\echo '== 1. Preflight: was this expansion applied here, and is nothing built on it yet?'
DO $$
DECLARE
    meta record;
    problem text;
BEGIN
    IF current_schema() <> {sql_text(schema)} THEN
        RAISE EXCEPTION 'search_path resolves to %, not {schema}', current_schema();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = {sql_text(backup_schema)}) THEN
        RAISE EXCEPTION 'backup schema {backup_schema} does not exist: nothing to roll back to';
    END IF;
    SELECT * INTO meta FROM {backup_schema}.expansion_meta;
    IF meta.plan_sha256 <> {sql_text(plan_sha)} THEN
        RAISE EXCEPTION 'the backup was made by plan %, this rollback is for plan {plan_sha}', meta.plan_sha256;
    END IF;
    IF (SELECT max(street_edge_id) FROM street_edge) <> meta.last_new_street_id
       AND meta.last_new_street_id >= meta.first_new_street_id THEN
        RAISE EXCEPTION 'streets were added after the expansion (max id %, expansion ended at %)',
                        (SELECT max(street_edge_id) FROM street_edge), meta.last_new_street_id;
    END IF;
    SELECT string_agg(what, '; ') INTO problem FROM (
        SELECT 'label ' || string_agg(label_id::text, ',') AS what FROM label WHERE street_edge_id >= {first_new}
        UNION ALL
        SELECT 'audit_task ' || string_agg(audit_task_id::text, ',') FROM audit_task WHERE street_edge_id >= {first_new}
        UNION ALL
        SELECT 'cluster ' || string_agg(cluster_id::text, ',') FROM cluster WHERE street_edge_id >= {first_new}
        UNION ALL
        SELECT 'route_street ' || string_agg(route_street_id::text, ',') FROM route_street WHERE street_edge_id >= {first_new}
        UNION ALL
        SELECT 'street_edge_issue ' || string_agg(street_edge_issue_id::text, ',') FROM street_edge_issue
        WHERE street_edge_id >= {first_new}
        UNION ALL
        SELECT 'audit_task_comment ' || string_agg(audit_task_comment_id::text, ',') FROM audit_task_comment
        WHERE edge_id >= {first_new}
        UNION ALL
        SELECT 'old_label_point_coords ' || count(*)::text FROM old_label_point_coords WHERE street_edge_id >= {first_new}
        HAVING count(*) > 0
        UNION ALL
        SELECT 'old_label_point_position ' || count(*)::text FROM old_label_point_position
        WHERE street_edge_id >= {first_new} HAVING count(*) > 0
    ) AS references_to_new_streets WHERE what NOT LIKE '% ' AND what IS NOT NULL;
    IF problem IS NOT NULL THEN
        RAISE EXCEPTION 'rows reference the new streets, so this is no longer a plain rollback: %', problem;
    END IF;
END $$;

\\echo '== 2. New streets and everything hanging off them'
UPDATE place SET nearest_street_edge_id = NULL, nearest_street_distance_m = NULL
WHERE nearest_street_edge_id >= {first_new};
DELETE FROM street_imagery WHERE street_edge_id >= {first_new};
DELETE FROM street_edge_priority WHERE street_edge_id >= {first_new};
DELETE FROM osm_way_street_edge WHERE street_edge_id >= {first_new};
-- street_edge_region, street_edge_status_change, street_gradient, sidewalk_presence, intersection_street_edge,
-- street_access_score and street_reopen_candidate cascade.
DELETE FROM street_edge WHERE street_edge_id >= {first_new};

\\echo '== 3. Live streets back to their regions; missions, users and routes back as they were'
UPDATE street_edge_region
SET region_id = before.region_id
FROM {backup_schema}.street_edge_region AS before
WHERE street_edge_region.street_edge_id = before.street_edge_id AND street_edge_region.region_id <> before.region_id;
UPDATE mission
SET region_id = before.region_id
FROM {backup_schema}.mission AS before
WHERE mission.mission_id = before.mission_id AND mission.region_id IS DISTINCT FROM before.region_id;
UPDATE user_current_region
SET region_id = before.region_id
FROM {backup_schema}.user_current_region AS before
WHERE user_current_region.user_current_region_id = before.user_current_region_id
  AND user_current_region.region_id <> before.region_id;
UPDATE route
SET region_id = before.region_id
FROM {backup_schema}.route AS before
WHERE route.route_id = before.route_id AND route.region_id IS DISTINCT FROM before.region_id;

\\echo '== 4. Regions: the new ones go, the kept ones get their old name and polygon back'
UPDATE intersection SET region_id = {fallback} WHERE region_id IN ({', '.join(map(str, inserts)) or 'NULL'});
UPDATE place SET region_id = {fallback} WHERE region_id IN ({', '.join(map(str, inserts)) or 'NULL'});
DELETE FROM clustering_session WHERE region_id IN ({', '.join(map(str, inserts)) or 'NULL'});
UPDATE mission SET region_id = {fallback} WHERE region_id IN ({', '.join(map(str, inserts)) or 'NULL'});
UPDATE route SET region_id = {fallback} WHERE region_id IN ({', '.join(map(str, inserts)) or 'NULL'});
-- region_completion, user_current_region, region_access_score and street_access_score cascade.
DELETE FROM region WHERE region_id IN ({', '.join(map(str, inserts)) or 'NULL'});
UPDATE region
SET name = before.name, data_source = before.data_source, geom = before.geom, deleted = before.deleted
FROM {backup_schema}.region AS before
WHERE region.region_id = before.region_id;

\\echo '== 5. Config, caches and sequences'
UPDATE config
SET city_center_lat = before.city_center_lat, city_center_lng = before.city_center_lng,
    southwest_boundary_lat = before.southwest_boundary_lat, southwest_boundary_lng = before.southwest_boundary_lng,
    northeast_boundary_lat = before.northeast_boundary_lat, northeast_boundary_lng = before.northeast_boundary_lng,
    default_map_zoom = before.default_map_zoom
FROM {backup_schema}.config AS before;
UPDATE intersection
SET region_id = before.region_id
FROM {backup_schema}.intersection AS before
WHERE intersection.intersection_id = before.intersection_id AND intersection.region_id <> before.region_id;
TRUNCATE region_completion;
{setval_block()}
\\echo '== 6. Invariants: back to the planned-against state'
DO $$
DECLARE
    fingerprint text;
    region_names text;
BEGIN
    SELECT md5(string_agg(street_edge_id || ':' || md5(ST_AsBinary(geom)), ',' ORDER BY street_edge_id))
    INTO fingerprint FROM street_edge;
    IF fingerprint <> {sql_text(live['fingerprint'])} THEN
        RAISE EXCEPTION 'street fingerprint after rollback is %, not the original {live['fingerprint']}', fingerprint;
    END IF;
    SELECT string_agg(region_id || ':' || name, ',' ORDER BY region_id) INTO region_names FROM region;
    IF region_names IS DISTINCT FROM {sql_text(','.join(f'{r["region_id"]}:{r["name"]}' for r in live['regions']))} THEN
        RAISE EXCEPTION 'regions after rollback are [%]', region_names;
    END IF;
    IF (SELECT count(*) FROM street_edge_region WHERE street_edge_id < {first_new}) <> {live['n_streets']} THEN
        RAISE EXCEPTION 'street_edge_region has % rows, expected {live['n_streets']}',
                        (SELECT count(*) FROM street_edge_region);
    END IF;
    IF EXISTS (SELECT 1 FROM street_edge_region AS now_rows
               JOIN {backup_schema}.street_edge_region AS before ON before.street_edge_id = now_rows.street_edge_id
               WHERE before.region_id <> now_rows.region_id) THEN
        RAISE EXCEPTION 'some street is not back in its original region';
    END IF;
END $$;

\\echo '== 7. Summary'
SELECT region_id, name, deleted FROM region ORDER BY region_id;
SELECT (SELECT count(*) FROM street_edge) AS streets, (SELECT count(*) FROM street_edge_region) AS region_rows,
       (SELECT count(*) FROM street_edge_priority) AS priorities, (SELECT count(*) FROM label) AS labels;

\\if :apply
  DROP SCHEMA {backup_schema} CASCADE;
  \\echo 'COMMITTING (and dropping {backup_schema}).'
  COMMIT;
  \\echo 'Rolled back. Now: PUT /adminapi/clearPlayCache (Admin > Management), then run Rebuild minimap basemap there.'
\\else
  \\echo 'DRY RUN: rolling back the rollback. Pass -v apply=1 to commit.'
  ROLLBACK;
\\endif
""")
    return ''.join(out)


def sha256_of(path):
    """Hex sha256 of a file."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# ---------------------------------------------------------------------------------------------------------------------
# CLI.
# ---------------------------------------------------------------------------------------------------------------------

def valid_schema(value):
    """argparse type for ``--schema``: a plain lowercase identifier, since it lands unquoted in the SQL."""
    if not value.isidentifier() or value != value.lower():
        raise argparse.ArgumentTypeError(f'"{value}" is not a plain lowercase SQL identifier')
    return value


def parse_args(argv=None):
    """Parses the command line: ``plan`` or ``emit`` and their options."""
    parser = argparse.ArgumentParser(description='Expand a live city in place: new streets and regions (#5924).')
    commands = parser.add_subparsers(dest='command', required=True)
    plan = commands.add_parser('plan', help='Work out the delta between the live city and a fresh build.')
    plan.add_argument('--city-id', required=True, type=valid_city_id, help='The live city\'s id, e.g. juneau-ak.')
    plan.add_argument('--workspace', required=True, type=valid_city_id,
                      help='Name of the db/onboarding/<workspace>/ directory the plan and the scan/gradient files '
                           'go in. Kebab-case like a city id, since check-imagery and street-gradient take it as '
                           'one; name it after the city and the change, e.g. juneau-ak-expansion-2026-11.')
    plan.add_argument('--build', required=True, help='The fresh build\'s QA GeoPackage (a fetch run of '
                                                     'onboard_city.py over the new boundary and regions).')
    plan.add_argument('--keep-region', action='append', default=[], metavar='ID=NAME',
                      help='A live region that keeps its id and takes the named build region\'s name and polygon. '
                           'Repeat per live region; every live region must be kept.')
    plan.add_argument('--data-source', required=True,
                      help='region.data_source for every region the build drew: who drew them, when, and from what.')
    plan.add_argument('--first-new-street-id', type=int,
                      help='Id of the first new street (default: one past the live city\'s highest).')
    plan.add_argument('--corridor-m', type=float, default=2.0,
                      help='Half-width of the corridor a live street covers when looking for new stretches '
                           '(default: 2).')
    plan.add_argument('--min-piece-m', type=float, default=MIN_SEGMENT_M,
                      help=f'Shortest new stretch that becomes a street (default: {MIN_SEGMENT_M}, as the build).')
    emit = commands.add_parser('emit', help='Write expansion.sql and rollback.sql from a plan.')
    emit.add_argument('--workspace', required=True, type=valid_city_id, help='The plan\'s workspace.')
    emit.add_argument('--schema', required=True, type=valid_schema, help='The city\'s schema, e.g. sidewalk_juneau_ak.')
    emit.add_argument('--backup-schema', type=valid_schema,
                      help='Schema the pre-change copies go in (default: <schema>_bak_<year>_<month>).')
    emit.add_argument('--expect-label-count', type=int,
                      help='Label count the plan was reviewed against; a different live count is a WARNING.')
    args = parser.parse_args(argv)
    if args.command == 'plan':
        args.keep_region = parse_keep_region(args.keep_region)
    elif not args.backup_schema:
        args.backup_schema = f'{args.schema}_bak_{date.today():%Y_%m}'
    return args


def run_plan(args):
    """The ``plan`` subcommand."""
    workspace = REPO_ROOT / 'db' / 'onboarding' / args.workspace
    live = read_live_streets(workspace / LIVE_STREETS_FILE)
    live_regions = read_live_regions(workspace / LIVE_REGIONS_FILE)
    roads, build_regions, ways = read_build(args.build)
    logger.info('Live: %d streets, %d regions. Build: %d streets, %d regions, %d ways.', len(live), len(live_regions),
                len(roads), len(build_regions), len(ways))
    plan = make_plan(live, live_regions, roads, build_regions, ways, args.keep_region, args.data_source,
                     args.first_new_street_id, args.corridor_m, args.min_piece_m, args.city_id)
    write_plan_files(workspace, plan, live)
    for flag in plan['flags']:
        logger.warning('%s', flag)
    logger.info('New streets: %d (%.2f km); live streets changing region: %d; regions: %s\nWrote %s, %s, %s, %s, '
                '%s. Read the report, then scan and sample the new streets (see its next steps).',
                len(plan['new_streets']), sum(piece['length_m'] for piece in plan['new_streets']) / 1000,
                len(plan['remaps']), ', '.join(f'{r["region_id"]} {r["name"]} ({r["action"]})' for r in plan['regions']),
                workspace / PLAN_FILE, workspace / PLAN_GPKG, workspace / REPORT_FILE, workspace / ENDPOINTS_FILE,
                workspace / GRADIENT_INPUT_FILE)


def run_emit(args):
    """The ``emit`` subcommand."""
    workspace = REPO_ROOT / 'db' / 'onboarding' / args.workspace
    plan_path = workspace / PLAN_FILE
    plan = plan_from_json(json.loads(plan_path.read_text()))
    plan_sha = sha256_of(plan_path)
    new_ids = [piece['street_edge_id'] for piece in plan['new_streets']]
    if new_ids:
        imagery = read_imagery_summary(workspace / IMAGERY_SUMMARY_FILE, new_ids)
        gradient = read_gradient_rows(workspace / GRADIENT_FILE,
                                      {piece['street_edge_id']: geom_md5(piece['geometry'])
                                       for piece in plan['new_streets']})
    else:
        imagery, gradient = {}, {}
    (workspace / EXPANSION_SQL).write_text(expansion_sql(plan, args.schema, args.backup_schema, imagery, gradient,
                                                         args.expect_label_count, args.workspace, plan_sha))
    (workspace / ROLLBACK_SQL).write_text(rollback_sql(plan, args.schema, args.backup_schema, args.workspace,
                                                       plan_sha))
    (workspace / SHA_FILE).write_text(''.join(f'{sha256_of(workspace / name)}  {name}\n'
                                              for name in (PLAN_FILE, EXPANSION_SQL, ROLLBACK_SQL)))
    logger.info('Wrote %s, %s and %s. Dry-run expansion.sql, read its output, then apply with -v apply=1 '
                '(docs/onboarding-a-city.md).', workspace / EXPANSION_SQL, workspace / ROLLBACK_SQL,
                workspace / SHA_FILE)


def main(argv=None):
    """Entry point."""
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    args = parse_args(argv)
    try:
        (run_plan if args.command == 'plan' else run_emit)(args)
    except (ValueError, FileNotFoundError) as exc:
        sys.exit(f'error: {exc}')


if __name__ == '__main__':
    main()
