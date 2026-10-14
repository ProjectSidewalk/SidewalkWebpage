"""
Where each street lies on OpenStreetMap (#5741): which ways it runs along, which stretch of the street each way covers,
which stretch of the way that is, and whether the two run the same direction.

A street built by ``onboard_city.py`` is one or more consecutive OSM ways joined between intersections, cut where a
region border or a tiny-piece merge decided, so one street can sit on several ways and one way usually holds several
streets. OSM's ``sidewalk:left`` / ``sidewalk:right`` tags are relative to the direction a way was drawn, while our
street sides are relative to our own line, so handing street-side data back to OSM needs all three facts per
street-way pair. They are found by geometry, not by bookkeeping: osmnx hands the build the set of way ids an edge was
merged from with no order and no per-way direction, and a live city has nothing but its one recorded way id, so the
same matching serves both. ``compute_lineage`` is the pure core (unit-tested in ``test/python/test_osm_lineage.py``);
``onboard_city.py`` calls it on a fresh build and ``backfill_osm_lineage.py`` on a city's exported streets.

How a street is matched. Both lines are projected to a local metric plane, the street is sampled at its own vertices
and every ``SAMPLE_STEP_M`` along it, and every way within ``LATERAL_TOL_M`` of the street is tried: the samples
within that distance of the way form runs along the street, and a run is a match when it is at least ``MIN_RUN_M``
long and the sample points advance along the way by a comparable distance (a cross street is near the street for a
few metres at the junction but goes nowhere along it). The way the street was built from, when known, is tried first,
then the others by run length, each taking whatever stretch of the street is still unclaimed, so two ways never
claim the same stretch. A way that lies within tolerance but could not be positioned (a looped way whose closure
point falls inside the street, say) is still listed, without a position, when the build named it.
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
    runs = []
    for first, last in _runs(near):
        if last == first:
            continue
        run_length = positions[last] - positions[first]
        # A stretch too short to mean anything, unless it is the whole of a street that short.
        if run_length < min_run_m and run_length < street_length:
            continue
        along = shapely.line_locate_point(way, points[last]) - shapely.line_locate_point(way, points[first])
        # Near the way but not going anywhere along it: a cross street at the junction, or the far side of a loop.
        if abs(along) < min_along * run_length:
            continue
        runs.append((float(positions[first]), float(positions[last]), bool(along > 0)))
    return runs


def snap_fraction(frac):
    """
    A fraction with rounding noise taken off: a stretch reaching a line's end reads exactly 0 or 1, and the rest is
    kept to nine places, under a millimetre on any street.
    """
    if frac < 1e-5:
        return 0.0
    return 1.0 if frac > 1 - 1e-5 else round(float(frac), 9)


def locate_on_way(street, way, street_from_m, street_to_m):
    """
    Where a stretch of ``street`` falls along ``way``, as ascending fractions of the way's length.

    Returns:
        ``(way_from, way_to)``, or None when the stretch collapses to a point on the way.
    """
    ends = shapely.line_interpolate_point(street, [street_from_m, street_to_m])
    way_positions = shapely.line_locate_point(way, ends) / way.length
    way_from, way_to = snap_fraction(way_positions.min()), snap_fraction(way_positions.max())
    return None if way_to <= way_from else (way_from, way_to)


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
        ``(links, coverage)``: the :class:`WayLink` list in street order (unpositioned hints last) and the covered
        share of the street.
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
        way_span = locate_on_way(street, ways[way_id], piece_from, piece_to)
        # Too short to count, or lying wholly past the way's end so that it projects onto one point of it.
        if piece_to - piece_from < min(min_run_m, street_length) or way_span is None:
            continue
        taken.append((piece_from, piece_to))
        links.append(WayLink(way_id, snap_fraction(piece_from / street_length), snap_fraction(piece_to / street_length),
                             way_span[0], way_span[1], same_direction))
    links.sort(key=lambda link: link.street_from)
    positioned_ids = {link.way_id for link in links}
    links.extend(WayLink(way_id) for way_id in hint_ids if way_id not in positioned_ids)
    coverage = sum(piece_to - piece_from for piece_from, piece_to in taken) / street_length if street_length else 0.0
    return links, min(coverage, 1.0)


def compute_lineage(streets, ways, tol_m=LATERAL_TOL_M, min_run_m=MIN_RUN_M, step_m=SAMPLE_STEP_M):
    """
    Matches every street to the ways it lies on.

    Args:
        streets: An iterable of ``(street_id, LineString, hint_way_ids)`` in lon/lat, hint ids an iterable (empty
                 when unknown).
        ways:    ``{way_id: LineString}`` in lon/lat, each in the way's drawn direction.

    Returns:
        A list of :class:`StreetLineage`, one per street, in input order.
    """
    streets = [(street_id, geom, tuple(int(way_id) for way_id in hint_ids)) for street_id, geom, hint_ids in streets]
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
