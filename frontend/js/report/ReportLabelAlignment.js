/**
 * Where a street map draws its labels when a reader asks to see them lined up along the street (#5888). A label's
 * stored position scatters a few meters around the sidewalk it was labeled on, so a block's markers don't say which
 * side each is on or how they are spread along it. This puts each marker on a line beside its street's centerline, on
 * the side the database recorded for it (`label_point.street_side`, #2886), at the point along the street nearest its
 * real position. It is a way of drawing: nothing stored, scored or clustered changes.
 *
 * The side line sits a fixed number of screen pixels off the centerline, so it reads at every zoom. That is why the
 * answer is a map position plus a pixel offset rather than a second position: the marker's anchor is the foot of the
 * label on the centerline, which never moves, and the offset carries it sideways and, where markers would overlap,
 * along the line. Only the along-line part depends on the zoom, so a map recomputes offsets as it zooms and the
 * projection once.
 *
 * Markers collide only with others on the same edge and side. A street section spans several edges, so two markers
 * either side of a join can still overlap, and a run spread near an edge's end can reach past it; both are left for
 * QA to show they matter before stitching edges into one line.
 *
 * Pure functions, so the geometry can be tested without a map.
 */

/** @typedef {[number, number]} Vec - A pair: `[x, y]` meters, `[lng, lat]` degrees or `[x, y]` pixels, as named. */

/**
 * @typedef {object} AlignableLocation
 * @property {number} clusterId
 * @property {number} lat
 * @property {number} lng
 * @property {?string} [side] - `left` or `right` of its edge's digitized direction; null or absent keeps it in place,
 *   as the server sends it for a location at a crossing (`ReportRules.sideOf`).
 * @property {?number} [edgeId] - The edge whose line it is drawn beside.
 *
 * @typedef {object} AlignedLocation
 * @property {number} clusterId
 * @property {Vec} lngLat - The foot of the label on its edge's centerline: the marker's anchor.
 * @property {Vec} normal - Unit vector in local meters (x east, y north) from the centerline toward the label's side.
 * @property {Vec} tangent - Unit vector along the edge, in its digitized direction, in the same frame.
 * @property {number} along - Meters from the edge's start to the foot.
 * @property {string} line - The side line it shares with the markers it may collide with: its edge and side.
 */

const MEAN_EARTH_RADIUS_METERS = 6371008.8;

/**
 * A flat frame around a point, in meters, east and north. Over a street's few hundred meters the error against the
 * sphere is centimeters, and because both axes are scaled alike, a direction in it is the direction on a Web Mercator
 * screen (with y flipped), which is what lets a pixel offset be composed from it.
 * @param {Vec} origin - `[lng, lat]`.
 * @returns {{toMeters: (lngLat: Vec) => Vec, toLngLat: (xy: Vec) => Vec}}
 */
export function localFrame(origin) {
  const [lng0, lat0] = origin;
  const rad = Math.PI / 180;
  const metersPerDegreeLat = MEAN_EARTH_RADIUS_METERS * rad;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(lat0 * rad);
  return {
    toMeters: ([lng, lat]) => [(lng - lng0) * metersPerDegreeLng, (lat - lat0) * metersPerDegreeLat],
    toLngLat: ([x, y]) => [lng0 + x / metersPerDegreeLng, lat0 + y / metersPerDegreeLat],
  };
}

/**
 * The nearest point on a polyline to a point, both in the same flat frame.
 * @param {Vec} point
 * @param {Vec[]} line - At least two vertices.
 * @returns {?{foot: Vec, along: number, tangent: Vec, distance: number}} The foot, how far along the line it is,
 *   the line's unit direction there, and how far the point is from it; null for a line with no length.
 */
export function projectOntoPolyline(point, line) {
  /** @type {?{foot: Vec, along: number, tangent: Vec, distance: number}} */
  let best = null;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    // Clamped to the segment, so a label past the end of the street lands at its end rather than beyond it.
    const t = Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (length * length)));
    const foot = /** @type {Vec} */ ([ax + t * dx, ay + t * dy]);
    const distance = Math.hypot(point[0] - foot[0], point[1] - foot[1]);
    if (!best || distance < best.distance) {
      best = { foot, along: walked + t * length, tangent: [dx / length, dy / length], distance };
    }
    walked += length;
  }
  return best;
}

/**
 * @param {Vec} tangent - A unit direction along the edge, in a frame with x east and y north.
 * @param {string} side - `left` or `right` of that direction, as `street_side` has it.
 * @returns {Vec} The unit vector from the line toward that side.
 */
export function sideNormal(tangent, side) {
  const [tx, ty] = tangent;
  return side === 'left' ? [-ty, tx] : [ty, -tx];
}

/**
 * Pushes markers on one line apart until none overlap, moving each as little as possible. Markers that would overlap
 * form a run, placed shoulder to shoulder and centered on where its members would have been, so the run as a whole
 * stays where the labels are and a marker with room around it doesn't move at all. The result is stable in the input
 * order and independent of which marker is considered first.
 * @param {number[]} positions - Each marker's natural position along the line, in one unit (pixels here).
 * @param {number} width - A marker's width in that unit: the least two centers may be apart.
 * @returns {number[]} How far to move each marker along the line, in input order; 0 where it needn't move.
 */
export function spreadAlong(positions, width) {
  const order = positions.map((_, i) => i).sort((a, b) => positions[a] - positions[b] || a - b);
  /** @type {{members: number[], sum: number, start: number}[]} Placed runs in order; `start` is the run's left edge. */
  const runs = [];
  for (const i of order) {
    let run = { members: [i], sum: positions[i], start: positions[i] - width / 2 };
    // A merged run recenters and may now reach back into the run before it, so this keeps merging until it doesn't.
    while (runs.length && runs.at(-1).start + runs.at(-1).members.length * width > run.start) {
      const previous = runs.pop();
      const members = [...previous.members, ...run.members];
      const sum = previous.sum + run.sum;
      run = { members, sum, start: sum / members.length - (members.length * width) / 2 };
    }
    runs.push(run);
  }
  const moves = new Array(positions.length).fill(0);
  for (const run of runs) {
    run.members.forEach((i, k) => {
      moves[i] = run.start + width * (k + 0.5) - positions[i];
    });
  }
  return moves;
}

/**
 * Works out, once, where each location sits along its edge and which way its side lies. A location without a side, one
 * at a crossing, or one whose edge isn't given is left out and keeps its true position.
 * @param {AlignableLocation[]} locations
 * @param {Map<number, number[][]>} edges - Each edge's `[lng, lat]` vertices in digitized order, by edge id, which is
 *   the order `street_side` is relative to.
 * @returns {AlignedLocation[]} One per location that can be aligned, in input order.
 */
export function alignLocations(locations, edges) {
  /** @type {AlignedLocation[]} */
  const aligned = [];
  for (const location of locations) {
    const { clusterId, lat, lng, side, edgeId } = location;
    if ((side !== 'left' && side !== 'right') || edgeId === null || edgeId === undefined) continue;
    const coordinates = edges.get(edgeId);
    if (!coordinates || coordinates.length < 2) continue;
    const frame = localFrame(/** @type {Vec} */ (coordinates[0]));
    const line = coordinates.map((c) => frame.toMeters(/** @type {Vec} */ (c)));
    const projection = projectOntoPolyline(frame.toMeters([lng, lat]), line);
    if (!projection) continue;
    aligned.push({
      clusterId,
      lngLat: frame.toLngLat(projection.foot),
      normal: sideNormal(projection.tangent, side),
      tangent: projection.tangent,
      along: projection.along,
      line: `${edgeId}:${side}`,
    });
  }
  return aligned;
}

/**
 * Each aligned marker's screen offset from its anchor at one zoom: sideways by the side line's distance, and along the
 * line by whatever keeps it clear of its neighbors on that line.
 * @param {AlignedLocation[]} aligned - From `alignLocations`.
 * @param {object} scale
 * @param {number} scale.offsetPx - How far the side line sits from the centerline, on screen.
 * @param {number} scale.markerPx - A marker's width on screen, which is how far apart two on one line must be.
 * @param {number} scale.metersPerPixel - The map's scale now.
 * @returns {Map<number, Vec>} By cluster id, in screen pixels: x to the right, y down, as a MapLibre marker offset.
 */
export function markerOffsets(aligned, { offsetPx, markerPx, metersPerPixel }) {
  /** @type {Map<string, AlignedLocation[]>} */
  const lines = new Map();
  for (const a of aligned) {
    if (!lines.has(a.line)) lines.set(a.line, []);
    lines.get(a.line).push(a);
  }
  /** @type {Map<number, Vec>} */
  const offsets = new Map();
  for (const members of lines.values()) {
    const moves = spreadAlong(members.map((a) => a.along / metersPerPixel), markerPx);
    members.forEach((a, i) => {
      const [nx, ny] = a.normal;
      const [tx, ty] = a.tangent;
      const x = nx * offsetPx + tx * moves[i];
      const y = ny * offsetPx + ty * moves[i];
      // The frame's y is north; a screen's is down.
      offsets.set(a.clusterId, [x, -y]);
    });
  }
  return offsets;
}
