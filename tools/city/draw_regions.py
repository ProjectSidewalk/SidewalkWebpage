"""
Draws a city's regions from hand-drawn inputs, for a city with no neighbourhood data of its own (#6013).

Some cities have no neighbourhood polygons anywhere (no OSM neighbourhoods, no open-data layer, a census tract or two),
so ``onboard_city.py`` makes the whole city one region, which is too big for missions and completion to mean much.
This draws regions a resident would recognise, from the street build ``onboard_city.py`` already wrote:

1. **Streets to regions.** A rough polygon per region (``--zones``; sloppy edges are fine) claims every street whose
   midpoint it holds; zones sharing a name are one region, so a region may be drawn as several polygons. A divide
   road (``--divide-road "Central Avenue:south"``) goes instead to the zone a short step to the named side of each of
   its pieces, so the road the regions meet along belongs to one of them per stretch rather than flipping with where
   its midpoint happens to fall.
2. **Blocks, not points.** The streets, the city edge and any ``--dividers`` lines (a freeway, a river, a road's line
   carried across open ground) cut the city into faces. Each face goes to the region owning most of the side-street
   length around and inside it; divide roads only break ties, so the block behind a row of side streets follows them.
   Then every street claims a strip along itself for its own region, divide roads last. A border therefore runs
   alongside a road, ``--strip-m`` off its centreline. Tiling by the nearest street point instead draws borders that
   zigzag between side-street ends and grow thin wedges where two regions' streets meet at a junction.
   ``--method zones`` skips the blocks: each zone, clipped to the city, is its region, and each divide road hands a
   strip along itself to the zone on its owning side. Use it where the zones' edges already lie on the arterials (a
   section-line grid like Kuna's) or where the city limits are full of holes and bays, whose faces span many zones
   and send blocks to the wrong region. It prints where each divide road's strip went.
3. **Checks.** The regions must tile the city; no street may leave its region by more than the build's 30 m heal
   (a longer piece would become a street of its own); no named street may switch region and back again; each
   ``--landmark`` must lie in the region named after it; no region may be empty, or have a piece cut off from the
   rest that the build would hand to a neighbour.

It reads ``db/onboarding/<city-id>/<city-id>_qa.gpkg`` (``qgis_road``, ``city_boundary``, and ``osm_way`` for the
street names) and writes ``regions_drawn.geojson`` beside it, the input for the next build:

    make draw-regions id=evansdale-ia args="--zones db/onboarding/evansdale-ia/inputs/draw_regions/zones.geojson \\
        --dividers db/onboarding/evansdale-ia/inputs/draw_regions/dividers.geojson \\
        --divide-road 'Gilbert Drive:south' --divide-road 'Central Avenue:south' --landmark 'Bunger=-92.2747,42.4716'"
    make build-city-data id=evansdale-ia args="--place 'Evansdale, Iowa, USA' \\
        --regions-file db/onboarding/evansdale-ia/regions_drawn.geojson --regions-source '...'"

    make draw-regions id=kuna-id args="--method zones --probe-m 120 \\
        --zones db/onboarding/kuna-id/inputs/draw_regions/zones.geojson \\
        --divide-road 'West Hubbard Road:north' --landmark 'Downtown=-116.4225,43.4910'"

Paths are from the repository root, where the make target runs.

When a check fails it writes ``regions_drawn.rejected.geojson`` instead, for a look in QGIS, and exits 1. The method,
its pitfalls and a worked example are in ``docs/onboarding-a-city.md`` → "No neighbourhood data: draw your own".
"""
import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
import networkx as nx
import shapely
from shapely.affinity import translate
from shapely.geometry import LineString, Point, Polygon, mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))
from onboard_city import polygonal_parts, valid_city_id  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_NAME = 'regions_drawn.geojson'
REJECTED_NAME = 'regions_drawn.rejected.geojson'
SIDES = {'north': (0.0, 1.0), 'south': (0.0, -1.0), 'east': (1.0, 0.0), 'west': (-1.0, 0.0)}
# A divide road counts this much per metre when a face's owner is picked: enough to settle a face no side street
# reaches, too little to outvote one.
DIVIDE_ROAD_WEIGHT = 0.01
# onboard_city.py's --heal-segment-m default: a street piece shorter than this that strays over a region edge is
# joined back to its street by the build; a longer one would be cut off as a street of its own.
HEAL_M = 30.0
# --method zones looks up a divide road's owner once per stretch this long, so a road that runs along several zones
# (Kuna's section-line arterials cross a zone edge every mile) hands each stretch to the zone beside it.
SEGMENT_M = 100.0
# Region parts smaller than this (m², or deg² after reprojection) are crumbs of strip cutting and snapping.
MIN_PART_M2 = 1.0
MIN_PART_DEG2 = 1e-10
# Zone edges get a vertex at least this often before they are reprojected (about 10 m either way).
ZONE_STEP_DEG = 0.0001
ZONE_STEP_M = 10.0
# onboard_city.py's --min-region-part-m2 default: a region part smaller than this that is cut off from the rest of its
# region is handed by the build to the neighbour it shares the longest border with. A larger one stays a part.
BUILD_MIN_PART_M2 = 10_000.0
# A cut-off piece this small or smaller is a crumb of strip cutting, not worth a message.
DETACHED_MIN_M2 = 50.0
# A gap, overlap or spill past the city edge counts only when it is wider than this (2 x area / perimeter, m) and
# larger than DEFECT_MIN_M2: the regions are snapped to 1 cm, so the city edge is off by that much all the way round.
DEFECT_MIN_WIDTH_M = 0.5
DEFECT_MIN_M2 = 5.0
# A street counts as inside its region within this much of it, so a street on a border is not a stray.
STRAY_SLACK_M = 0.5


def parse_divide_road(value):
    """
    argparse type for ``--divide-road``: ``"<OSM street name>:<side>"``, the side being the region that owns it.

    Args:
        value: The flag's text, e.g. ``"Central Avenue:south"``.

    Returns:
        A ``(name, side)`` pair.

    Raises:
        argparse.ArgumentTypeError: when there is no ``:`` or the side is not north, south, east or west.
    """
    name, sep, side = value.rpartition(':')
    side = side.strip().lower()
    if not sep or not name.strip() or side not in SIDES:
        raise argparse.ArgumentTypeError(f'"{value}" — use "<street name>:<north|south|east|west>".')
    return name.strip(), side


def parse_landmark(value):
    """
    argparse type for ``--landmark``: ``"<region name>=<lon>,<lat>"``, a place the region is named after.

    Args:
        value: The flag's text, e.g. ``"Bunger=-92.2747,42.4716"``.

    Returns:
        A ``(region name, lon, lat)`` triple.

    Raises:
        argparse.ArgumentTypeError: when the text does not have that shape.
    """
    region, sep, where = value.partition('=')
    try:
        lon, lat = (float(part) for part in where.split(','))
    except ValueError:
        lon = None
    if not sep or not region.strip() or lon is None:
        raise argparse.ArgumentTypeError(f'"{value}" — use "<region name>=<lon>,<lat>".')
    return region.strip(), lon, lat


def street_names(osm_ids, way_names):
    """
    The OSM names a built street carries, from the ways it was cut from.

    Args:
        osm_ids:   The street's ``qgis_road.osm_ids``, comma-separated way ids.
        way_names: ``{osm_way_id: name}`` from the GeoPackage's ``osm_way`` layer; unnamed ways are absent.

    Returns:
        A frozenset of names, empty for a street on unnamed ways.
    """
    ids = (int(part) for part in str(osm_ids).split(',') if part.strip())
    return frozenset(way_names[i] for i in ids if i in way_names)


def zones_by_name(names, geometries):
    """
    The zones as one geometry per name, in the order each name first appears.

    A region drawn as several polygons (a town split by a river, a detached subdivision) is several zones with the
    same name; a dict built straight from the rows would keep only the last of them.

    Args:
        names:      Each zone's region name.
        geometries: Each zone's polygon, aligned with ``names``.

    Returns:
        ``{region name: (Multi)Polygon}``.
    """
    parts = {}
    for name, geom in zip(names, geometries):
        parts.setdefault(name, []).append(geom)
    return {name: geoms[0] if len(geoms) == 1 else shapely.union_all(geoms) for name, geoms in parts.items()}


def polygons(geom, min_area=0.0):
    """
    The polygonal part of any geometry, made valid, without parts of ``min_area`` or less.

    Cutting strips out of regions leaves stray points and lines, and parts nested in collections that
    ``onboard_city.py`` cannot clip (Kuna, #6013); a regions file must hold polygons only.

    Args:
        geom:     Any shapely geometry.
        min_area: Parts this small or smaller are dropped, in the geometry's units.

    Returns:
        A Polygon or MultiPolygon, empty when nothing is left.
    """
    parts = [part for part in shapely.get_parts(polygonal_parts(shapely.make_valid(geom))) if part.area > min_area]
    return shapely.union_all(parts) if parts else Polygon()


def zone_at(point, zones):
    """
    The zone holding a point, or the nearest one when the rough zones leave it uncovered.

    Args:
        point: A shapely Point, in the zones' CRS.
        zones: ``{region name: Polygon}``.

    Returns:
        A region name.
    """
    for name, zone in zones.items():
        if zone.contains(point):
            return name
    return min(zones, key=lambda name: zones[name].distance(point))


def assign_streets(streets, names, zones, divide_roads, offset_m=30.0):
    """
    Gives every street a region: a divide road by the zone to its owning side, any other street by its midpoint.

    Args:
        streets:      Street LineStrings in a metric CRS.
        names:        The frozenset of OSM names of each street (:func:`street_names`), aligned with ``streets``.
        zones:        ``{region name: rough Polygon}`` in the same CRS.
        divide_roads: ``[(name, side)]``; a street carrying two of the names follows the first listed.
        offset_m:     How far to the side the zone is looked up; past the road's own strip, short of the next block.

    Returns:
        A ``(regions, is_divide)`` pair of lists aligned with ``streets``.
    """
    regions, is_divide = [], []
    for line, street in zip(streets, names):
        mid = line.interpolate(0.5, normalized=True)
        side = next((side for name, side in divide_roads if name in street), None)
        if side is None:
            regions.append(zone_at(mid, zones))
        else:
            dx, dy = SIDES[side]
            regions.append(zone_at(Point(mid.x + dx * offset_m, mid.y + dy * offset_m), zones))
        is_divide.append(side is not None)
    return regions, is_divide


def absorb_fragments(geoms, keep_m2=None):
    """
    Keeps each region's largest piece and hands every other piece to the neighbour it shares the longest edge with.

    Clipping to a concave city edge, or a strip cutting a corner, can leave a region in pieces.

    Args:
        geoms:   ``{region name: (Multi)Polygon}``; an empty region stays empty.
        keep_m2: Pieces at least this large stay with their region too (a part the build would keep); by default
                 only the largest does.

    Returns:
        ``{region name: (Multi)Polygon}``; a piece that touches no other region (an island of the city) joins the
        nearest.
    """
    main, orphans = {}, []
    for name, geom in geoms.items():
        parts = sorted(shapely.get_parts(geom), key=lambda part: -part.area)
        stays = [i == 0 or (keep_m2 is not None and part.area >= keep_m2) for i, part in enumerate(parts)]
        main[name] = shapely.union_all([part for part, stay in zip(parts, stays) if stay]) if parts else Polygon()
        orphans += [part for part, stay in zip(parts, stays) if not stay]
    reach = {name: geom.buffer(0.05) for name, geom in main.items()}
    stalled = 0
    while orphans:
        piece = orphans.pop(0)
        shared = {name: piece.boundary.intersection(near).length for name, near in reach.items()}
        best = max(shared, key=shared.get)
        if shared[best] == 0 and stalled <= len(orphans):
            orphans.append(piece)   # Touches only another orphan for now; retry once that one is absorbed.
            stalled += 1
            continue
        if shared[best] == 0:
            best = min((name for name in main if not main[name].is_empty), key=lambda name: main[name].distance(piece))
        main[best] = shapely.union_all([main[best], piece])
        reach[best] = main[best].buffer(0.05)
        stalled = 0
    return main


def trim_slivers(geoms, width=2.0):
    """
    Hands every part of a region narrower than ``width`` to the neighbour it shares the longest edge with.

    A strip is cut square where a street's run ends: where a street changes region or name at a junction, or meets
    another region's arterial at a slight bend. That leaves wedges a few tenths of a metre wide, which a map draws as
    ticks across the border (Evansdale, 2026-11-18). An opening with mitred joins finds them without rounding off
    corners.

    Args:
        geoms: ``{region name: (Multi)Polygon}`` in a metric CRS.
        width: Parts narrower than this, in metres, move.

    Returns:
        ``{region name: (Multi)Polygon}``.
    """
    geoms = dict(geoms)
    reach = {name: geom.buffer(0.05) for name, geom in geoms.items()}
    for name in list(geoms):
        geom = geoms[name]
        kept = geom.buffer(-width / 2, join_style='mitre').buffer(width / 2, join_style='mitre').intersection(geom)
        for piece in shapely.get_parts(geom.difference(kept)):
            shared = {other: piece.boundary.intersection(near).length for other, near in reach.items() if other != name}
            best = max(shared, key=shared.get, default=None)
            if piece.area < 0.01 or best is None or shared[best] == 0:
                continue   # A city-edge sliver, or a rounding crumb: no other region borders it.
            geoms[name] = geoms[name].difference(piece)
            geoms[best] = shapely.union_all([geoms[best], piece])
            reach[name], reach[best] = geoms[name].buffer(0.05), geoms[best].buffer(0.05)
    return geoms


def block_regions(streets, regions, is_divide, boundary, dividers=(), strip_m=15.0, names=None, order=None):
    """
    Tiles the city from its blocks, so every border runs along a street (step 2 of the module docstring).

    Args:
        streets:   Street LineStrings in a metric CRS.
        regions:   Each street's region name, aligned with ``streets``.
        is_divide: Whether each street is a divide road, aligned with ``streets``.
        boundary:  The city (Multi)Polygon, same CRS.
        dividers:  Lines that cut faces but belong to no region.
        strip_m:   Half-width of the strip each street claims for its own region.
        names:     Each street's frozenset of OSM names; a named street's strip is buffered as one run per region.
                   Without names every street is a run of its own.
        order:     Every region name, including any no street went to (it comes back empty, for the check to
                   report); by default the regions in ``regions``.

    Returns:
        ``{region name: Polygon}`` for every region in ``order``, tiling ``boundary``.
    """
    order = list(dict.fromkeys([*(order or []), *regions]))
    # Snap-rounded to 1 cm: noded in floating point, a street lying along the city edge or a divider is noded
    # differently on two machines (93 faces on one, 94 on another for Evansdale; 111 snapped, on both), and a face
    # that fails to close merges with its neighbour and can change owner.
    lines = shapely.union_all([line.intersection(boundary) for line in streets]
                              + [boundary.boundary] + [line.intersection(boundary) for line in dividers],
                              grid_size=0.01)
    # The city edge's hole rings are polygonized too, so a county enclave would come back as a face of its own.
    faces = [face for face in shapely.get_parts(shapely.polygonize(shapely.get_parts(lines)))
             if face.area > 1 and boundary.contains(face.representative_point())]
    tree = shapely.STRtree(streets)
    geoms = {name: [] for name in order}
    unowned = []
    for face in faces:
        reach = face.buffer(1.0)
        weight = {}
        for i in tree.query(reach, predicate='intersects'):
            share = streets[i].intersection(reach).length * (DIVIDE_ROAD_WEIGHT if is_divide[i] else 1.0)
            weight[regions[i]] = weight.get(regions[i], 0.0) + share
        if weight:
            geoms[max(weight, key=weight.get)].append(face)
        else:
            unowned.append(face)
    geoms = {name: shapely.union_all(parts) for name, parts in geoms.items()}
    for face in unowned:   # Ground no street reaches: the neighbour it shares most edge with.
        best = max(order, key=lambda name: 0.0 if geoms[name].is_empty else
                   face.boundary.intersection(geoms[name].buffer(0.5)).length)
        geoms[best] = shapely.union_all([geoms[best], face])
    for divide_pass in (False, True):
        # Each street's whole run in its region is buffered as one line, not segment by segment: flat caps at every
        # junction leave a thin wedge wherever the road bends there, and the cross street's strip shows through it as
        # a tick across the border (Evansdale, 2026-11-18).
        runs = {}
        for i, (line, region, divide) in enumerate(zip(streets, regions, is_divide)):
            if divide == divide_pass:
                street = names[i] if names is not None and names[i] else i
                runs.setdefault((region, street), []).append(line)
        for (region, _), lines in runs.items():
            run = shapely.line_merge(shapely.union_all(lines))
            strip = run.buffer(strip_m, cap_style='flat').intersection(boundary)
            for name in order:
                geoms[name] = geoms[name].union(strip) if name == region else geoms[name].difference(strip)
    return absorb_fragments({name: geom.buffer(0) for name, geom in trim_slivers(geoms).items()})


def zone_regions(zones, boundary, divide_ways, strip_m=15.0, probe_m=30.0):
    """
    Regions straight from the zones (``--method zones``): each zone clipped to the city, plus a strip along each
    divide road for the zone on its owning side.

    The block method fails where faces span many zones. Kuna's city limits have 43 county enclaves and long bays, so
    its faces reached across several mile-square zones and went to the wrong region wholesale (163 problems). Where
    the zones' edges already sit on the arterials, a zone is the region; only the arterial itself needs a side.

    Each road is looked at in stretches of ``SEGMENT_M``, since one road can run along several zones; consecutive
    stretches with the same owner are buffered as one line, because flat caps at every stretch leave crumbs of the
    other region on the inside of each bend. A stretch whose owner has no ground in the city within ``probe_m`` keeps
    no strip: its probe crossed a bay or enclave to a zone the city does not reach there, and the strip would be a
    ribbon cut off from the rest of its region (Kuna's Columbia Road gave Stroebel one 700 m from Stroebel). Pieces
    a strip cuts off from the rest of a region, too small for the build to keep as parts of their own, go to the
    neighbour they share the longest border with, as the build would hand them.

    Args:
        zones:       ``{region name: Polygon}``, unclipped, in a metric CRS. A divide road's owner is looked up in
                     these, not in the clipped regions: a probe that lands in an enclave or bay outside the city would
                     otherwise find no region.
        boundary:    The city (Multi)Polygon, same CRS.
        divide_ways: ``[(LineString, side, road name)]``: each divide road's OSM ways with the side that owns them,
                     in the order the roads were given (a later strip wins where two cross).
        strip_m:     Half-width of the strip a divide road claims for its owner.
        probe_m:     How far to the owning side the owner is looked up. It must clear the road's offset from the zone
                     edge: Kuna's East Kuna Road runs 70 m off its section line and needed 120.

    Returns:
        A ``(geoms, report)`` pair. ``geoms`` is ``{region name: (Multi)Polygon}`` in the zones' order, tiling the
        part of ``boundary`` the zones cover. ``report`` is ``{road name: {key: metres inside the city}}``, the
        keys being the regions its strips went to, ``'no zone'`` (the probe left every zone), ``'out of reach'``
        (the owner has no ground nearby), and ``('inside', zone)`` for stretches more than ``probe_m`` inside one
        zone, which stay in it: right where the road runs on past the border, wrong where the border is just farther
        off the road than ``probe_m``.
    """
    # Polygons only: a zone that merely touches the city edge clips to a line, which is no ground to attach to.
    clipped = {name: polygons(zone.intersection(boundary)) for name, zone in zones.items()}
    geoms = dict(clipped)
    report = {}

    def zone_of(point):
        return next((name for name, zone in zones.items() if zone.contains(point)), None)

    for way, side, road in divide_ways:
        dx, dy = SIDES[side]
        tally = report.setdefault(road, {})
        coords = list(shapely.segmentize(way, SEGMENT_M).coords)
        runs = []   # [(owner or None, [coords])], consecutive stretches with one owner merged.
        for start, end in zip(coords[:-1], coords[1:]):
            piece = LineString([start, end])
            mid = piece.interpolate(0.5, normalized=True)
            owner = zone_of(translate(mid, dx * probe_m, dy * probe_m))
            if owner is None:
                key = 'no zone'
            elif clipped[owner].is_empty or clipped[owner].distance(piece) > probe_m:
                key, owner = 'out of reach', None
            elif owner == zone_of(mid) == zone_of(translate(mid, -dx * probe_m, -dy * probe_m)):
                key = ('inside', owner)
            else:
                key = owner
            inside = piece.intersection(boundary).length   # Ways run on past the city edge; only the city counts.
            if inside:
                tally[key] = tally.get(key, 0.0) + inside
            if runs and runs[-1][0] == owner:
                runs[-1][1].append(end)
            else:
                runs.append((owner, [start, end]))
        for owner, run in runs:
            if owner is None:
                continue
            strip = LineString(run).buffer(strip_m, cap_style='flat').intersection(boundary)
            for name in geoms:
                geoms[name] = geoms[name].union(strip) if name == owner else geoms[name].difference(strip)
    geoms = absorb_fragments({name: polygons(geom, MIN_PART_M2) for name, geom in geoms.items()}, BUILD_MIN_PART_M2)
    return {name: polygons(geom, MIN_PART_M2) for name, geom in geoms.items()}, report


def majority_regions(streets, geoms):
    """
    Gives each street the region holding most of its length, which is the one the build will give it.

    Args:
        streets: Street LineStrings in a metric CRS.
        geoms:   ``{region name: (Multi)Polygon}``.

    Returns:
        A list of region names aligned with ``streets``; a street outside every region takes the nearest.
    """
    tree_names = list(geoms)
    tree = shapely.STRtree([geoms[name] for name in tree_names])
    regions = []
    for line in streets:
        inside = {tree_names[i]: geoms[tree_names[i]].intersection(line).length
                  for i in tree.query(line, predicate='intersects')}
        best = max(inside, key=inside.get, default=None)
        if best is None or inside[best] == 0:
            best = min(tree_names, key=lambda name: geoms[name].distance(line))
        regions.append(best)
    return regions


def stray_pieces(streets, regions, geoms, boundary):
    """
    How far each street strays out of its own region, inside the city.

    Args:
        streets:  Street LineStrings in a metric CRS.
        regions:  Each street's region name.
        geoms:    ``{region name: Polygon}``.
        boundary: The city (Multi)Polygon.

    Returns:
        A list aligned with ``streets``: the length of the longest piece more than ``STRAY_SLACK_M`` outside the
        street's region, 0 when none.
    """
    near = {name: geom.buffer(STRAY_SLACK_M) for name, geom in geoms.items()}
    out = []
    for line, region in zip(streets, regions):
        # Merged, because the overlay can split one stretch at its vertices, and the build heals a stretch as a whole.
        stray = shapely.line_merge(line.intersection(boundary).difference(near[region]))
        out.append(max((part.length for part in shapely.get_parts(stray)), default=0.0))
    return out


def weaving_streets(streets, names, regions):
    """
    Named streets that leave a region and come back to it, which reads as a border weaving across the road.

    A street is checked one connected run at a time (two separate "2nd Avenue"s are two runs): a run weaves when one
    region's pieces of it fall into more than one stretch.

    Args:
        streets: Street LineStrings in a metric CRS.
        names:   Each street's frozenset of OSM names.
        regions: Each street's region name.

    Returns:
        A sorted list of the names that weave.
    """
    graphs = {}
    for line, street, region in zip(streets, names, regions):
        ends = [tuple(round(v) for v in line.coords[i]) for i in (0, -1)]
        for name in street:
            graphs.setdefault(name, nx.MultiGraph()).add_edge(*ends, region=region)
    weave = set()
    for name, graph in graphs.items():
        for run in nx.connected_components(graph):
            edges = list(graph.subgraph(run).edges(keys=True, data='region'))
            for region in {data for *_, data in edges}:
                stretch = graph.edge_subgraph([(u, v, k) for u, v, k, data in edges if data == region])
                if nx.number_connected_components(stretch) > 1:
                    weave.add(name)
    return sorted(weave)


def where(geom, crs):
    """
    A place to look in QGIS, for a message: `` near <lat>, <lon>``, or nothing without a CRS.

    Args:
        geom: Any non-empty shapely geometry.
        crs:  Its CRS, or None.

    Returns:
        The text.
    """
    if crs is None:
        return ''
    point = gpd.GeoSeries([geom.representative_point()], crs=crs).to_crs(4326).iloc[0]
    return f' near {point.y:.5f}, {point.x:.5f}'


def defects(geom):
    """
    The pieces of a gap, overlap or spill worth reporting: larger than ``DEFECT_MIN_M2`` and wider than
    ``DEFECT_MIN_WIDTH_M``.

    Measured piece by piece, by width, because the total of 1 cm snapping noise grows with the length of the city
    edge (Kuna's 45 km edge totals about 70 m²) while a real gap between two zones can be thin and still matter.

    Args:
        geom: Any geometry; only its polygons count.

    Returns:
        A list of Polygons.
    """
    return [part for part in shapely.get_parts(polygons(geom))
            if part.area > DEFECT_MIN_M2 and 2 * part.area / part.length > DEFECT_MIN_WIDTH_M]


def tiling_problems(geoms, boundary, crs=None):
    """
    Where the regions fail to tile the city: gaps inside it, ground outside it, and overlaps between two regions.

    Args:
        geoms:    ``{region name: (Multi)Polygon}`` in a metric CRS.
        boundary: The city (Multi)Polygon.
        crs:      The CRS, to give each problem a lat/lon; omitted, the messages carry none.

    Returns:
        A list of messages.
    """
    union = shapely.union_all(list(geoms.values()))
    problems = [f'the regions leave a gap of {gap.area:.0f} m² inside the city{where(gap, crs)}'
                for gap in defects(boundary.difference(union))]
    for name, geom in geoms.items():
        problems += [f'region "{name}" reaches {spill.area:.0f} m² outside the city{where(spill, crs)}'
                     for spill in defects(geom.difference(boundary))]
    names = list(geoms)
    for i, first in enumerate(names):
        for second in names[i + 1:]:
            problems += [f'regions "{first}" and "{second}" overlap by {lap.area:.0f} m²{where(lap, crs)}'
                         for lap in defects(geoms[first].intersection(geoms[second]))]
    return problems


def detached_pieces(geoms):
    """
    Region pieces cut off from the rest of their region that the build would hand to a neighbour.

    A piece at least ``BUILD_MIN_PART_M2`` large is a part the build keeps (a region drawn as several polygons, or
    split by a bay); a smaller one touching none of those goes to the neighbour sharing its longest border, taking any
    street on it along. Crumbs of ``DETACHED_MIN_M2`` or less are ignored.

    Args:
        geoms: ``{region name: (Multi)Polygon}`` in a metric CRS.

    Returns:
        ``[(region name, Polygon)]``.
    """
    out = []
    for name, geom in geoms.items():
        parts = sorted(shapely.get_parts(geom), key=lambda part: -part.area)
        anchors = [part for i, part in enumerate(parts) if i == 0 or part.area >= BUILD_MIN_PART_M2]
        out += [(name, part) for part in parts
                if DETACHED_MIN_M2 < part.area < BUILD_MIN_PART_M2 and part not in anchors
                and all(part.distance(anchor) > 0.01 for anchor in anchors)]
    return out


def check_regions(streets, names, regions, geoms, boundary, landmarks, heal_m=HEAL_M, crs=None):
    """
    Every check of step 3 of the module docstring, as messages.

    Args:
        streets:   Street LineStrings in a metric CRS.
        names:     Each street's frozenset of OSM names.
        regions:   Each street's region name.
        geoms:     ``{region name: Polygon}``.
        boundary:  The city (Multi)Polygon.
        landmarks: ``[(region name, Point)]`` in the same CRS.
        heal_m:    The longest stray piece the build reattaches to its street.
        crs:       The CRS, to give tiling and detached-piece problems a lat/lon.

    Returns:
        A list of problems, empty when the regions are fit to build with.
    """
    problems = tiling_problems(geoms, boundary, crs)
    for name in geoms:
        if name not in regions:
            problems.append(f'region "{name}" holds no street: fold its zone into a neighbour')
    for name, piece in detached_pieces(geoms):
        problems.append(f'region "{name}" has a {piece.area:.0f} m² piece cut off from the rest{where(piece, crs)}; '
                        f'the build would hand it to a neighbour')
    # A stray is measured STRAY_SLACK_M clear of its region, so it is that much short at the end where it leaves.
    for line, street, stray in zip(streets, names, stray_pieces(streets, regions, geoms, boundary)):
        if stray >= heal_m - STRAY_SLACK_M:
            label = ' / '.join(sorted(street)) or 'an unnamed street'
            problems.append(f'{label} leaves its region for {stray:.0f} m; the build would cut it into a street of '
                            f'its own (move a zone edge or a divider off it)')
    for name in weaving_streets(streets, names, regions):
        problems.append(f'{name} switches region and back again: give it a --divide-road side, or redraw the zones')
    for region, point in landmarks:
        inside = [name for name, geom in geoms.items() if geom.contains(point)]
        if inside != [region]:
            problems.append(f'landmark for "{region}" lies in {inside or "no region"}')
    return problems


def summary_rows(regions, lengths_m, order):
    """
    The per-region street count and km, in the zones' order.

    Args:
        regions:   Each street's region name.
        lengths_m: Each street's geodesic length (``qgis_road.length_m``).
        order:     Region names in output order.

    Returns:
        ``[(name, streets, km)]``.
    """
    rows = []
    for name in order:
        picked = [length for region, length in zip(regions, lengths_m) if region == name]
        rows.append((name, len(picked), round(sum(picked) / 1000, 2)))
    return rows


def feature_collection(geoms, rows, crs):
    """
    The regions as GeoJSON in lon/lat, each with its street count and km, for ``onboard_city.py --regions-file``.

    Args:
        geoms: ``{region name: Polygon}`` in ``crs``.
        rows:  :func:`summary_rows` output.
        crs:   The CRS of ``geoms``.

    Returns:
        A GeoJSON FeatureCollection dict.

    Raises:
        ValueError: when a region would still not be a valid polygon, which ``onboard_city.py`` would fail on.
    """
    features = []
    for name, streets, km in rows:
        geom = gpd.GeoSeries([shapely.set_precision(geoms[name], 0.01)], crs=crs).to_crs(4326).iloc[0]
        # Reprojected, a border cut by strips can cross itself by a hair; snapping to a 1e-7 degree (1 cm) grid
        # rebuilds each polygon valid, and what it leaves under about 1 m² is snapping debris (Kuna, #6013).
        geom = polygons(shapely.set_precision(polygons(geom), 1e-7), MIN_PART_DEG2)
        if not geom.is_valid or geom.geom_type not in ('Polygon', 'MultiPolygon'):
            raise ValueError(f'region "{name}" is not a valid polygon ({shapely.is_valid_reason(geom)})')
        features.append({'type': 'Feature', 'properties': {'name': name, 'streets': streets, 'km': km},
                         'geometry': mapping(geom)})
    return {'type': 'FeatureCollection', 'features': features}


def parse_args(argv=None):
    """Parses the command line (the module docstring describes each input)."""
    parser = argparse.ArgumentParser(description='Draw regions for a city with no neighbourhood data (#6013).')
    parser.add_argument('--city-id', required=True, type=valid_city_id,
                        help='Reads db/onboarding/<city-id>/<city-id>_qa.gpkg and writes regions_drawn.geojson there.')
    parser.add_argument('--zones', required=True, type=Path,
                        help='Rough region polygons with a name column (any OGR format); their order is the output '
                             'order.')
    parser.add_argument('--zone-name-col', default='name', help='The zones\' name column (default: name).')
    parser.add_argument('--divide-road', action='append', default=[], type=parse_divide_road,
                        help='"<OSM street name>:<north|south|east|west>": the road belongs to the region on that '
                             'side. Repeatable.')
    parser.add_argument('--dividers', type=Path,
                        help='Lines that divide regions where no street does: a freeway, a river, a road\'s line '
                             'carried across open ground.')
    parser.add_argument('--landmark', action='append', default=[], type=parse_landmark,
                        help='"<region name>=<lon>,<lat>": the place a region is named after must lie in it. '
                             'Repeatable.')
    parser.add_argument('--method', choices=('blocks', 'zones'), default='blocks',
                        help='blocks (default): borders follow the streets, block by block. zones: each zone '
                             'clipped to the city is a region, for zones drawn on the arterials or city limits full '
                             'of holes.')
    parser.add_argument('--strip-m', type=float, default=15.0,
                        help='How far a border sits from the road it runs along (default 15). Wider swallows a '
                             'frontage street running beside an arterial.')
    parser.add_argument('--probe-m', type=float, default=30.0,
                        help='How far to its owning side a divide road\'s region is looked up (default 30). It must '
                             'clear the road\'s offset from the zone edge (Kuna needed 120).')
    args = parser.parse_args(argv)
    if args.method == 'zones' and args.dividers:
        parser.error('--dividers cuts blocks, so it does nothing with --method zones; draw that line as a zone edge.')
    if args.probe_m <= args.strip_m:
        parser.error('--probe-m must be longer than --strip-m, or the probe lands in the road\'s own strip.')
    return args


def read_zones(path, name_col, crs):
    """
    Reads the zones file, densified and reprojected, one geometry per name (:func:`zones_by_name`).

    Densified before reprojecting: a zone edge drawn as two lon/lat corners kilometres apart reprojects as a straight
    UTM chord, which a neighbour with different corners on the same latitude does not follow. Kuna's mile-grid zones
    left a gap up to 46 m wide along Columbia Road that way, and overlaps along Deer Flat Road.

    Args:
        path:     The zones file (any OGR format).
        name_col: Its name column.
        crs:      The metric CRS to reproject to.

    Returns:
        ``{region name: (Multi)Polygon}``.

    Raises:
        ValueError: when the file has no CRS or no ``name_col`` column.
    """
    frame = gpd.read_file(path)
    if frame.crs is None:
        raise ValueError(f'{path} has no CRS; save it with one (EPSG:4326 when drawn over a web map).')
    if name_col not in frame.columns:
        columns = ', '.join(str(c) for c in frame.columns if c != 'geometry')
        raise ValueError(f'{path} has no "{name_col}" column (it has: {columns}); pass --zone-name-col.')
    frame['geometry'] = shapely.segmentize(frame.geometry.values,
                                           ZONE_STEP_DEG if frame.crs.is_geographic else ZONE_STEP_M)
    frame = frame.to_crs(crs)
    return zones_by_name(frame[name_col].astype(str), frame.geometry)


def print_divide_report(report, sides):
    """
    Prints where each divide road's strips went (``--method zones``), and the stretches worth a look.

    Args:
        report: :func:`zone_regions`'s ``{road name: {key: metres}}``.
        sides:  ``{road name: side}`` from ``--divide-road``.
    """
    print('\ndivide road strips (km inside the city):')
    for road, tally in report.items():
        went = ', '.join(f'{key} {metres / 1000:.2f}' for key, metres in tally.items() if isinstance(key, str)
                         and key not in ('no zone', 'out of reach'))
        print(f'  {road}:{sides[road]} -> {went or "no region"}')
        inside = ', '.join(f'{key[1]} {metres / 1000:.2f}' for key, metres in tally.items() if isinstance(key, tuple))
        if inside:
            print(f'    runs through the middle of {inside}: right where it runs on past a border; where a border '
                  f'lies farther off it than --probe-m, raise --probe-m')
        for key, why in (('no zone', 'the probe left every zone'),
                         ('out of reach', f'the zone to its {sides[road]} has no ground nearby in the city')):
            if tally.get(key):
                print(f'    {tally[key] / 1000:.2f} kept no strip: {why}')


def main(argv=None):
    """
    Reads the build and the hand-drawn inputs, draws and checks the regions, and writes them.

    Returns:
        0 when the regions pass every check, 1 when one fails (the problems are printed).
    """
    args = parse_args(argv)
    city_dir = REPO_ROOT / 'db' / 'onboarding' / args.city_id
    # Whatever an earlier run left is stale now: a run that stops before writing must not leave it to be built with.
    for stale in (OUTPUT_NAME, REJECTED_NAME):
        (city_dir / stale).unlink(missing_ok=True)
    gpkg = city_dir / f'{args.city_id}_qa.gpkg'
    roads = gpd.read_file(gpkg, layer='qgis_road')
    crs = roads.estimate_utm_crs()
    roads = roads.to_crs(crs)
    boundary = gpd.read_file(gpkg, layer='city_boundary').to_crs(crs).geometry.union_all()
    ways = gpd.read_file(gpkg, layer='osm_way')
    if 'name' not in ways.columns:
        print(f'error: {gpkg.name} has no street names on its osm_way layer; rebuild it with this checkout\'s '
              f'onboard_city.py.')
        return 1
    way_names = {int(i): name for i, name in zip(ways['osm_way_id'], ways['name']) if isinstance(name, str)}
    try:
        zones = read_zones(args.zones, args.zone_name_col, crs)
    except ValueError as error:
        print(f'error: {error}')
        return 1
    dividers = list(gpd.read_file(args.dividers).to_crs(crs).geometry) if args.dividers else []
    streets = list(roads.geometry)
    names = [street_names(ids, way_names) for ids in roads['osm_ids']]
    # Against the built streets, not every OSM way: a road outside the build would be accepted and do nothing.
    unknown = sorted({name for name, _ in args.divide_road} - set().union(*names))
    if unknown:   # A misspelt divide road would otherwise be zoned by its midpoint without a word.
        print(f'error: no built street is named {", ".join(unknown)}; names must match OSM exactly.')
        return 1
    if args.method == 'zones':
        ways = ways.to_crs(crs)
        divide_ways = [(part, side, name) for name, side in args.divide_road
                       for way in ways.geometry[ways['name'] == name] for part in shapely.get_parts(way)]
        geoms, report = zone_regions(zones, boundary, divide_ways, args.strip_m, args.probe_m)
        regions = majority_regions(streets, geoms)
    else:
        report = None
        regions, is_divide = assign_streets(streets, names, zones, args.divide_road, args.probe_m)
        geoms = block_regions(streets, regions, is_divide, boundary, dividers, args.strip_m, names, list(zones))
    landmarks = [(region, gpd.GeoSeries([Point(lon, lat)], crs=4326).to_crs(crs).iloc[0])
                 for region, lon, lat in args.landmark]
    problems = check_regions(streets, names, regions, geoms, boundary, landmarks, crs=crs)
    rows = summary_rows(regions, roads['length_m'], list(zones))
    collection = feature_collection(geoms, rows, crs)
    print(f'{"region":<24} {"streets":>7} {"km":>6}')
    for name, count, km in rows:
        print(f'{name:<24} {count:>7} {km:>6.2f}')
    if report is not None:
        print_divide_report(report, dict(args.divide_road))
    out = city_dir / (REJECTED_NAME if problems else OUTPUT_NAME)
    out.write_text(json.dumps(collection))
    if problems:
        print(f'\n{len(problems)} problem(s); wrote {out.name} for a look in QGIS, not for a build:')
        for problem in problems:
            print(f'  - {problem}')
        return 1
    print(f'\nWrote {out}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
