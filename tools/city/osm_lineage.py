"""
Where each street lies on OpenStreetMap (#5741): the ways it runs along, the stretch of the street each covers, the
stretch of the way that is, and whether the two run the same direction.

A street built by ``onboard_city.py`` is one or more consecutive OSM ways joined between intersections, so one street
can sit on several ways and one way usually holds several streets. OSM's ``sidewalk:left`` / ``sidewalk:right`` tags
follow the way's drawn direction while our street sides follow our own line, so handing street-side data back to OSM
needs all of this per street-way pair. It is found by geometry: osmnx gives the build an unordered set of way ids per
edge with no direction, and a live city has nothing but its recorded way ids. ``compute_lineage`` is the pure core;
``onboard_city.py`` calls it on a fresh build and ``backfill_osm_lineage.py`` on a live city.

How a street is matched: both lines go onto a local metric plane, the street is sampled at its vertices and every
``SAMPLE_STEP_M`` along it, and every way within ``LATERAL_TOL_M`` is tried. The samples within that distance of a way
form runs along the street; a run counts when it is at least ``MIN_RUN_M`` long and advances along the way by a
comparable distance (a cross street is near the street at the junction but goes nowhere along it). The way the street
was built from is tried first, then the others by run length, each taking only the stretch still unclaimed. A way the
build named that could not be positioned is still listed, without a position.
"""
from dataclasses import dataclass

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import LineString
from shapely.ops import transform as transform_geom
from shapely.strtree import STRtree

# How far a street may sit from a way and still lie on it. A street cut from a way has the way's own vertices, so the
# distance is zero wherever OSM has not moved the way since; the slack is for edits, and stays well under the 10 m or
# more that separates a dual carriageway's two sides.
LATERAL_TOL_M = 5.0
# The shortest stretch that counts as lying on a way: a cross street is within tolerance near the junction only.
MIN_RUN_M = 5.0
# Sampling step along the street, beside the street's own vertices, which is where one way hands over to the next.
SAMPLE_STEP_M = 5.0
# A run must advance along the way by at least this share of its own length, or it merely touches the way.
MIN_ALONG_RATIO = 0.7
# A street covered less than this is flagged for review rather than taken as matched.
MIN_COVERAGE = 0.95


@dataclass(frozen=True)
class WayLink:
    """
    One way a street lies on. The positions are fractions, 0 at a line's first coordinate and 1 at its last, in the
    line's own direction; they are all None on a way the build named but the matching could not position.

    Attributes:
        way_id:         The OSM way.
        street_from:    Where along the street this way starts covering it.
        street_to:      Where along the street the coverage ends; past ``street_from``.
        way_from:       Where along the way, in its drawn direction, the shared stretch starts.
        way_to:         Where along the way it ends; past ``way_from``.
        same_direction: Whether the street, walked from its start, runs the way from ``way_from`` toward ``way_to``.
    """
    way_id: int
    street_from: float | None = None
    street_to: float | None = None
    way_from: float | None = None
    way_to: float | None = None
    same_direction: bool | None = None

    @property
    def positioned(self):
        """Whether the matching placed this way on the street."""
        return self.street_from is not None


@dataclass(frozen=True)
class StreetLineage:
    """
    A street's ways, in street order, and how much of the street they account for.

    Attributes:
        street_id: The street's id (``road_id`` on a build, ``street_edge_id`` on a live city).
        links:     Its ways, positioned ones first in street order, then any unpositioned hint.
        coverage:  The share of the street's length some positioned way covers, 0 to 1.
    """
    street_id: int
    links: tuple
    coverage: float

    @property
    def status(self):
        """``matched``, ``partial`` (something matched but not the whole street) or ``unmatched``."""
        if self.coverage >= MIN_COVERAGE:
            return 'matched'
        return 'partial' if self.coverage > 0 else 'unmatched'


def metric_projection(lon, lat):
    """
    A function projecting lon/lat geometries onto a plane in metres centred on the given point (azimuthal
    equidistant), so distances along and between lines near the city can be read as metres.
    """
    transformer = Transformer.from_crs('EPSG:4326', f'+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m',
                                       always_xy=True)
    return lambda geom: transform_geom(transformer.transform, geom)


def sample_positions(line, step_m):
    """
    Distances along ``line`` (in its units) at which to sample it: every vertex, since that is where a street built
    from ways changes way, plus every ``step_m`` between them, and always both ends.

    Returns:
        A sorted numpy array of positions from 0 to the line's length.
    """
    coords = np.asarray(line.coords)
    vertex_positions = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(coords, axis=0).T))])
    # The last vertex position and the line's own length differ by rounding, and the fractions divide by the latter.
    length = line.length
    regular = np.arange(0.0, length, step_m) if step_m > 0 else np.array([])
    return np.unique(np.concatenate([np.minimum(vertex_positions, length), regular, [length]]))


def _runs(mask):
    """Index ranges ``(first, last)`` of each maximal run of True in a boolean array, inclusive at both ends."""
    runs, start = [], None
    for i, flag in enumerate(mask):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(mask) - 1))
    return runs


def candidate_runs(street, way, positions, tol_m=LATERAL_TOL_M, min_run_m=MIN_RUN_M, min_along=MIN_ALONG_RATIO):
    """
    The stretches of ``street`` that lie along ``way``, both in the same metric plane.

    Args:
        street:    The street LineString, in metres.
        way:       The way LineString, in metres, in its drawn direction.
        positions: Sample positions along the street, from :func:`sample_positions`.

    Returns:
        A list of ``(street_from_m, street_to_m, same_direction)`` tuples, in street order. The way positions are
        not returned, since a run may still be trimmed; :func:`locate_on_way` reads them off the final stretch.
    """
    points = shapely.line_interpolate_point(street, positions)
    near = shapely.distance(points, way) <= tol_m
    street_length = street.length
    # Where the way's end nodes fall along the street, for the ends that lie on it. The samples just past an end node
    # are still within tolerance of it, so a run reaches up to tol_m beyond the way; the way stops at the node.
    way_ends = shapely.points(np.asarray(way.coords)[[0, -1]])
    end_positions = shapely.line_locate_point(street, way_ends)[shapely.distance(way_ends, street) <= tol_m]
    runs = []
    for first, last in _runs(near):
        if last == first:
            continue
        run_from, run_to = positions[first], positions[last]
        # Each end of the run pulls in to the nearest end node on its own half, so a way shorter than the overhang
        # cannot have its start trimmed to its far end.
        middle = (run_from + run_to) / 2
        starts = end_positions[(run_from < end_positions) & (end_positions <= min(run_from + tol_m, middle))]
        if starts.size:
            run_from = starts.min()
        finishes = end_positions[(max(run_to - tol_m, middle) <= end_positions) & (end_positions < run_to)]
        if finishes.size:
            run_to = finishes.max()
        run_length = run_to - run_from
        # A stretch too short to mean anything, unless it is the whole of a street that short.
        if run_length < min_run_m and run_length < street_length:
            continue
        way_start_m, way_end_m = along_way(street, way, positions, run_from, run_to, tol_m)
        along = way_end_m - way_start_m
        # Near the way but not going anywhere along it: a cross street at the junction, or the far side of a loop.
        if abs(along) < min_along * run_length:
            continue
        runs.append((float(run_from), float(run_to), bool(along > 0)))
    return runs


def along_way(street, way, positions, street_from_m, street_to_m, tol_m=LATERAL_TOL_M):
    """
    Where the two ends of a stretch of ``street`` fall along ``way``, in metres from the way's start, read through
    the samples between them rather than off the ends alone: a loop street starts and ends at one point, and a closed
    way has its start node at both 0 and its full length, so the ends alone read as no progress. Each sample's
    nearest point of the way is a step from the one before. A step that leaps most of the way round a closed way went
    across its start node, and one longer than two samples that close together can be apart went between two
    branches of a way that touches itself (a cul-de-sac's stem and bulb); neither counts.

    Returns:
        ``(start_m, end_m)``: ``end_m`` is past ``start_m`` when the street runs the way's drawn direction, and lies
        beyond the way's length, or before 0, when the stretch runs across a closed way's start node.
    """
    inside = positions[(positions > street_from_m) & (positions < street_to_m)]
    stretch = np.concatenate([[street_from_m], inside, [street_to_m]])
    located = shapely.line_locate_point(way, shapely.line_interpolate_point(street, stretch))
    steps = np.diff(located)
    if way.is_closed:
        steps -= np.round(steps / way.length) * way.length
    longest_leap = np.diff(stretch).max() + 2 * tol_m
    return float(located[0]), float(located[0] + steps[np.abs(steps) <= longest_leap].sum())


def snap_fraction(frac):
    """
    A fraction with rounding noise taken off: a stretch reaching a line's end reads exactly 0 or 1, and the rest is
    kept to nine places, under a millimetre on any street.
    """
    if frac < 1e-5:
        return 0.0
    return 1.0 if frac > 1 - 1e-5 else round(float(frac), 9)


def locate_on_way(street, way, positions, street_from_m, street_to_m, tol_m=LATERAL_TOL_M):
    """
    Where a stretch of ``street`` falls along ``way``, as ascending fractions of the way's length.

    Returns:
        A list of ``(street_from_m, street_to_m, way_from, way_to)``: one entry, or two when the stretch runs across
        a closed way's start node, where the way's fractions start over. Empty when the stretch collapses to a point
        on the way.
    """
    start_m, end_m = along_way(street, way, positions, street_from_m, street_to_m, tol_m)
    way_length = way.length
    pieces = [(street_from_m, street_to_m, min(start_m, end_m), max(start_m, end_m))]
    if end_m > way_length or end_m < 0:
        # The way position runs past its end (or back past its start) at a point of the stretch found by sharing it
        # out evenly, which holds to within the sampling step.
        crossed_at = way_length if end_m > way_length else 0.0
        split_m = street_from_m + (street_to_m - street_from_m) * (crossed_at - start_m) / (end_m - start_m)
        wrapped = end_m - way_length if end_m > way_length else end_m + way_length
        pieces = [(street_from_m, split_m, min(start_m, crossed_at), max(start_m, crossed_at)),
                  (split_m, street_to_m, min(wrapped, way_length - crossed_at), max(wrapped, way_length - crossed_at))]
    located = []
    for piece_from, piece_to, way_from_m, way_to_m in pieces:
        way_from, way_to = snap_fraction(way_from_m / way_length), snap_fraction(way_to_m / way_length)
        if way_to > way_from:
            located.append((piece_from, piece_to, way_from, way_to))
    return located


def _subtract(interval, taken):
    """The pieces of ``interval`` not inside any of the ``taken`` intervals, as a list of ``(from, to)`` pairs."""
    pieces = [interval]
    for t_from, t_to in taken:
        remaining = []
        for p_from, p_to in pieces:
            if t_to <= p_from or t_from >= p_to:
                remaining.append((p_from, p_to))
                continue
            if t_from > p_from:
                remaining.append((p_from, t_from))
            if t_to < p_to:
                remaining.append((t_to, p_to))
        pieces = remaining
    return pieces


def match_street(street, ways, hint_ids=(), tol_m=LATERAL_TOL_M, min_run_m=MIN_RUN_M, step_m=SAMPLE_STEP_M):
    """
    Matches one street to the ways it lies on.

    Args:
        street:   The street LineString, in metres.
        ways:     ``{way_id: LineString}`` of the candidate ways, in the same plane, each in its drawn direction.
        hint_ids: Way ids the street is known to have been built from; tried first and listed even when unpositioned.

    Returns:
        ``(links, coverage)``: the :class:`WayLink` list in street order, unpositioned hints last, and the share
        of the street they cover.
    """
    positions = sample_positions(street, step_m)
    street_length = street.length
    candidates = []
    for way_id, way in ways.items():
        for street_from_m, street_to_m, same_direction in candidate_runs(street, way, positions, tol_m, min_run_m):
            candidates.append((way_id not in hint_ids, -(street_to_m - street_from_m), way_id, street_from_m,
                               street_to_m, same_direction))
    # The way the street was built from first, then the longest run, so a parallel way only gets what is left.
    candidates.sort()
    taken, links = [], []
    for _, _, way_id, street_from_m, street_to_m, same_direction in candidates:
        free = _subtract((street_from_m, street_to_m), taken)
        if not free:
            continue
        piece_from, piece_to = max(free, key=lambda piece: piece[1] - piece[0])
        # Too short to count.
        if piece_to - piece_from < min(min_run_m, street_length):
            continue
        # Nothing is claimed for a piece that projects onto one point of the way.
        spans = locate_on_way(street, ways[way_id], positions, piece_from, piece_to, tol_m)
        taken.extend((span_from, span_to) for span_from, span_to, _, _ in spans)
        links.extend(WayLink(way_id, snap_fraction(span_from / street_length), snap_fraction(span_to / street_length),
                             way_from, way_to, same_direction)
                     for span_from, span_to, way_from, way_to in spans)
    links.sort(key=lambda link: link.street_from)
    positioned_ids = {link.way_id for link in links}
    links.extend(WayLink(way_id) for way_id in hint_ids if way_id not in positioned_ids)
    coverage = sum(piece_to - piece_from for piece_from, piece_to in taken) / street_length if street_length else 0.0
    return links, min(coverage, 1.0)


def compute_lineage(streets, ways, tol_m=LATERAL_TOL_M, min_run_m=MIN_RUN_M, step_m=SAMPLE_STEP_M):
    """
    Matches every street to the ways it lies on.

    Args:
        streets: An iterable of ``(street_id, LineString, hint_way_ids)`` in lon/lat; the hints may be empty.
        ways:    ``{way_id: LineString}`` in lon/lat, each in the way's drawn direction.

    Returns:
        A list of :class:`StreetLineage`, one per street, in input order.
    """
    # Hints deduplicated: a street that returns to a way is exported with that way twice, and an unpositioned link
    # can be stored only once.
    streets = [(street_id, geom, tuple(dict.fromkeys(int(way_id) for way_id in hint_ids)))
               for street_id, geom, hint_ids in streets]
    if not streets:
        return []
    bounds = shapely.total_bounds([geom for _, geom, _ in streets])
    project = metric_projection((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2)
    way_ids = list(ways)
    projected = {way_id: project(ways[way_id]) for way_id in way_ids}
    tree = STRtree([projected[way_id] for way_id in way_ids])
    lineages = []
    for street_id, geom, hint_ids in streets:
        street = project(geom)
        nearby = {way_ids[i] for i in tree.query(street, predicate='dwithin', distance=tol_m)}
        nearby.update(way_id for way_id in hint_ids if way_id in ways)
        candidates = {way_id: projected[way_id] for way_id in nearby}
        links, coverage = match_street(street, candidates, hint_ids, tol_m, min_run_m, step_m)
        lineages.append(StreetLineage(street_id, tuple(links), coverage))
    return lineages


def lineage_rows(lineages):
    """
    Flattens lineages to one dict per street-way pair, the shape the staging table and the backfill CSV take, with
    the fraction columns None on an unpositioned link.
    """
    return [{'street_id': lineage.street_id, 'osm_way_id': link.way_id, 'street_from_frac': link.street_from,
             'street_to_frac': link.street_to, 'way_from_frac': link.way_from, 'way_to_frac': link.way_to,
             'same_direction': link.same_direction}
            for lineage in lineages for link in lineage.links]


def lineage_summary(lineages):
    """Counts of streets by status, for a report line."""
    counts = {'matched': 0, 'partial': 0, 'unmatched': 0}
    for lineage in lineages:
        counts[lineage.status] += 1
    return counts


def ways_from_features(features):
    """
    The way LineStrings in an osmnx ``features_from_polygon`` result, keyed by way id.

    Only LineString ways are roads one walks along: a closed ``highway=pedestrian`` plaza comes back as a Polygon and
    is skipped, as the street build skips it.

    Args:
        features: A GeoDataFrame indexed by ``(element_type, osmid)``.

    Returns:
        ``{way_id: LineString}`` in lon/lat, each in the way's drawn direction.
    """
    ways = {}
    for (element_type, way_id), geom in features.geometry.items():
        if element_type == 'way' and isinstance(geom, LineString):
            ways[int(way_id)] = geom
    return ways
