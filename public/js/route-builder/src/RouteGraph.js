/**
 * Client-side street-network graph for auto-routing (#4579): builds an adjacency graph from the city's street
 * GeoJSON (endpoints within ~10 m are merged into one node, the same connectivity tolerance the builder's
 * contiguous-section logic uses) and answers shortest-walking-path queries with A*.
 *
 * All geometry math is self-contained (haversine / equirectangular approximations) so the class stays fast and
 * unit-testable without the map or turf. Routing is restricted to a single region, matching the current
 * one-neighborhood-per-route constraint (#3488 tracks lifting it).
 */
class RouteGraph {
  // Endpoints within this distance are considered the same intersection (mirrors #computeContiguousRoutes).
  static NODE_TOLERANCE_M = 10;
  static EARTH_RADIUS_M = 6371008.8;

  #nodes = new Map(); // key -> { lng, lat, edges: [{ streetId, regionId, weightM, otherKey }] }
  #features = new Map(); // streetId -> live GeoJSON feature (geometry may be reversed in place by editing)
  #featureLengths = new Map(); // streetId -> geometry length in meters (for the snap prefilter)

  /**
   * @param {Array<Object>} streetFeatures - GeoJSON LineString features with street_edge_id + region_id properties.
   */
  constructor(streetFeatures) {
    streetFeatures.forEach((feature) => {
      const coords = feature.geometry.coordinates;
      if (!coords || coords.length < 2) return;
      const streetId = feature.properties.street_edge_id;
      this.#features.set(streetId, feature);
      const lengthM = RouteGraph.lineLengthM(coords);
      this.#featureLengths.set(streetId, lengthM);

      const keyA = this.#nodeKeyFor(coords[0]);
      const keyB = this.#nodeKeyFor(coords[coords.length - 1]);
      if (keyA === keyB) return; // Degenerate loop/stub: no usable connectivity.
      const edge = {
        streetId,
        regionId: feature.properties.region_id,
        weightM: lengthM,
      };
      this.#nodes.get(keyA).edges.push({ ...edge, otherKey: keyB });
      this.#nodes.get(keyB).edges.push({ ...edge, otherKey: keyA });
    });
  }

  /**
   * The source GeoJSON feature for a street id, so callers don't rescan the city's street array to find one.
   *
   * @param {number} streetId
   * @returns {?Object} The feature, or undefined if the id isn't in the loaded street data.
   */
  getFeature(streetId) {
    return this.#features.get(streetId);
  }

  /**
   * A street's length in meters, measured once when the graph was built.
   *
   * @param {number} streetId
   * @returns {number} 0 if the id isn't in the loaded street data.
   */
  getLengthM(streetId) {
    return this.#featureLengths.get(streetId) ?? 0;
  }

  /**
   * Great-circle distance between two [lng, lat] points in meters.
   */
  static distanceM(a, b) {
    const toRad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toRad;
    const dLng = (b[0] - a[0]) * toRad;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * sinLng * sinLng;
    return 2 * RouteGraph.EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  }

  /**
   * Length of a LineString's coordinates in meters.
   */
  static lineLengthM(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      total += RouteGraph.distanceM(coords[i - 1], coords[i]);
    }
    return total;
  }

  /**
   * Returns the node key for a coordinate, merging with any existing node within NODE_TOLERANCE_M
   * (scans the neighboring quantized cells so near-boundary endpoints still merge).
   *
   * @param {Array<number>} coord - [lng, lat].
   * @returns {string} The (possibly newly created) node's key.
   */
  #nodeKeyFor(coord) {
    // Cells are ~11 m N-S, but longitude cells shrink with latitude (~7.6 m at 47°N), so the scan reaches
    // ±2 cells east-west to keep covering the 10 m tolerance away from the equator.
    const cellLng = Math.round(coord[0] * 10000);
    const cellLat = Math.round(coord[1] * 10000);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${cellLng + dx},${cellLat + dy}`;
        const node = this.#nodes.get(key);
        if (node && RouteGraph.distanceM(coord, [node.lng, node.lat]) < RouteGraph.NODE_TOLERANCE_M) {
          return key;
        }
      }
    }
    const key = `${cellLng},${cellLat}`;
    this.#nodes.set(key, { lng: coord[0], lat: coord[1], edges: [] });
    return key;
  }

  /**
   * Finds the street nearest to a point, and which of its endpoint nodes is closer.
   *
   * @param {Object} point - {lng, lat}.
   * @param {number} [regionId] - When given, only streets in this region are considered (e.g. so the start-point
   *   preview near a boundary can't snap into a neighboring region).
   * @param {number} [maxDistanceM] - When given, a point further than this from every candidate snaps to none.
   *   Without it a far-away point still snaps to *something*, however distant.
   * @returns {Object|null} {streetId, regionId, nodeKey, nodeLngLat, distanceM} or null when there are no streets
   *                        (or none within maxDistanceM). nodeLngLat is the [lng, lat] of the snapped endpoint
   *                        node (where a route starts/joins).
   */
  snapToStreet(point, regionId = null, maxDistanceM = Infinity) {
    const p = [point.lng, point.lat];
    let best = null;
    this.#features.forEach((feature, streetId) => {
      if (regionId !== null && feature.properties.region_id !== regionId) return;
      const coords = feature.geometry.coordinates;
      // Prefilter: no vertex can be closer than (distance to the first vertex - geometry length), so the
      // per-vertex scan is skipped for the vast majority of streets that are nowhere near the point.
      if (best !== null
        && RouteGraph.distanceM(p, coords[0]) - this.#featureLengths.get(streetId) > best.distanceM) {
        return;
      }
      // Nearest vertex is a good-enough proxy for nearest point on the line at street-segment scale.
      let minD = Infinity;
      for (const c of coords) {
        const d = RouteGraph.distanceM(p, c);
        if (d < minD) minD = d;
      }
      if (best === null || minD < best.distanceM) {
        const dStart = RouteGraph.distanceM(p, coords[0]);
        const dEnd = RouteGraph.distanceM(p, coords[coords.length - 1]);
        const nearerEnd = dStart <= dEnd ? coords[0] : coords[coords.length - 1];
        best = {
          streetId,
          regionId: feature.properties.region_id,
          nodeKey: this.#findExistingNodeKey(nearerEnd),
          nodeLngLat: nearerEnd,
          distanceM: minD,
        };
      }
    });
    return best !== null && best.distanceM <= maxDistanceM ? best : null;
  }

  /** Returns the existing node key for a coordinate (which was inserted during construction). */
  #findExistingNodeKey(coord) {
    return this.#nodeKeyFor(coord); // Always merges with the node created at build time.
  }

  /**
   * Computes the shortest walking path between two points along the street network.
   *
   * @param {Object} start - {lng, lat}.
   * @param {Object} end - {lng, lat}.
   * @param {?number} [snapRegionId=null] - When set, both endpoints snap only to streets in this region. A route is
   *   locked to one neighborhood, so passing its region keeps the snap deterministic at a boundary node where streets
   *   from two neighborhoods share the exact same endpoint (0 m). Without it, the unfiltered nearest-street tie can
   *   resolve to the other neighborhood, making an already-placed start read as a different region than every end.
   * @returns {Object} One of:
   *   {streets: [{streetId, flip}]} — the ordered streets; flip means "traverse against the feature's current
   *     coordinate order" so the caller can orient each street for the route;
   *   {error: 'different-region'} — the pins snap to streets in different neighborhoods;
   *   {error: 'no-path'} — no connected path exists (or a pin found no street).
   */
  route(start, end, snapRegionId = null) {
    const from = this.snapToStreet(start, snapRegionId);
    const to = this.snapToStreet(end, snapRegionId);
    if (!from || !to) return { error: 'no-path' };
    if (from.regionId !== to.regionId) return { error: 'different-region' };
    const regionId = from.regionId;

    if (from.nodeKey === to.nodeKey) return { error: 'no-path' }; // Start and end at the same intersection.

    // A* over the region's subgraph: g = meters walked, h = straight-line meters to the goal.
    const goal = this.#nodes.get(to.nodeKey);
    const goalCoord = [goal.lng, goal.lat];
    const g = new Map([[from.nodeKey, 0]]);
    const cameFrom = new Map(); // nodeKey -> { prevKey, streetId }
    const open = new Map(); // nodeKey -> f score
    const startNode = this.#nodes.get(from.nodeKey);
    open.set(from.nodeKey, RouteGraph.distanceM([startNode.lng, startNode.lat], goalCoord));
    const closed = new Set();

    while (open.size > 0) {
      // Extract the open node with the lowest f. Linear scan is fine at region scale (hundreds of nodes).
      let currentKey = null;
      let bestF = Infinity;
      open.forEach((f, key) => {
        if (f < bestF) {
          bestF = f;
          currentKey = key;
        }
      });
      open.delete(currentKey);
      if (currentKey === to.nodeKey) return { streets: this.#reconstructPath(cameFrom, from.nodeKey, to.nodeKey) };
      closed.add(currentKey);

      const current = this.#nodes.get(currentKey);
      for (const edge of current.edges) {
        if (edge.regionId !== regionId || closed.has(edge.otherKey)) continue;
        const tentativeG = g.get(currentKey) + edge.weightM;
        if (tentativeG < (g.get(edge.otherKey) ?? Infinity)) {
          g.set(edge.otherKey, tentativeG);
          cameFrom.set(edge.otherKey, { prevKey: currentKey, streetId: edge.streetId });
          const other = this.#nodes.get(edge.otherKey);
          open.set(edge.otherKey, tentativeG + RouteGraph.distanceM([other.lng, other.lat], goalCoord));
        }
      }
    }
    return { error: 'no-path' };
  }

  /**
   * Walks cameFrom back from the goal, emitting streets in start-to-end order with their traversal direction.
   */
  #reconstructPath(cameFrom, startKey, endKey) {
    const streets = [];
    let key = endKey;
    while (key !== startKey) {
      const step = cameFrom.get(key);
      const feature = this.#features.get(step.streetId);
      const coords = feature.geometry.coordinates;
      const entryNode = this.#nodes.get(step.prevKey);
      // Entered at the geometry's first coordinate -> walked in coordinate order; otherwise it must be flipped.
      // Which end is nearer decides, rather than an absolute distance: on a street whose two endpoints are
      // themselves close together (a hook or crescent can have them 10-15 m apart and still be long), both ends
      // sit inside any fixed tolerance, and the entry point would read as "first" whichever end it really was.
      const entry = [entryNode.lng, entryNode.lat];
      const enteredAtFirst
        = RouteGraph.distanceM(entry, coords[0]) <= RouteGraph.distanceM(entry, coords[coords.length - 1]);
      streets.unshift({ streetId: step.streetId, flip: !enteredAtFirst });
      key = step.prevKey;
    }
    return streets;
  }
}
