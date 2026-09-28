/**
 * A street as the planner sees it.
 * @typedef {object} PlannerStreet
 * @property {number} id - The street_edge_id.
 * @property {number[][]} coords - LineString [[lng, lat], …] in the street's current orientation.
 * @property {number} priority - In (0, 1]; 1 means nobody has audited it.
 * @property {number} [lengthM] - Geodesic metres; computed from coords when absent.
 * @property {boolean} [fixedDirection] - True for a resumed (part-walked) street: it may not be reversed and its walk
 *   starts at coords[0].
 */

/**
 * One step of a plan.
 * @typedef {object} PlanStep
 * @property {number} id - The street id.
 * @property {boolean} reverse - True when the street is walked from coords[last] to coords[0].
 * @property {boolean} jump - True when the street does not continue from the previous step's end (a teleport).
 * @property {number} jumpM - Metres from the previous step's end to this step's start (0 when connected).
 */

/**
 * Summary numbers for a plan, logged with it and read by the benchmark.
 * @typedef {object} PlanStats
 * @property {number} streets - Steps in the plan.
 * @property {number} totalM - Metres of street in the plan.
 * @property {number} jumps - Steps with jump === true (the first step never counts as a jump).
 * @property {number} jumpM - Sum of jumpM.
 * @property {number} medianJumpM - Median jumpM over the jumps; 0 when there are none.
 * @property {number} deadEnds - Streets whose far end had no unwalked continuation when walked (excluding the last).
 * @property {number} lowerBoundJumps - Σ over connected components of max(1, oddNodes / 2), minus 1.
 * @property {number} ms - Wall time of the plan() call.
 */

/**
 * Orders a neighborhood's remaining streets into one walk, fixed up front, so Explore can show where a mission is
 * going instead of choosing each street greedily after the last (#5526).
 *
 * The walk is built as trails: from the current node it keeps walking onto an unwalked street while one is worth
 * walking, and only jumps when none is. Fleury's rule (never take a bridge of the remaining graph while another
 * street will do) keeps a trail from stranding the rest of its component, and a jump lands on an odd-degree node
 * when it can, because a component with k odd nodes needs at least k/2 trails and starting anywhere else wastes one.
 * Streets under TINY_STREET_M (border-cut remnants, slivers; #4717, #3488) are walked as soon as they are adjacent,
 * so they ride along with the street they continue instead of becoming standalone jump targets later.
 *
 * Priority is a gate on continuing, not a veto from a coarse bucket: a connected street is walked when its priority
 * is within `priorityTolerance` of the best remaining priority, and a jump goes to the nearest street in that tier.
 * The defaults were chosen by the replay benchmark in `tools/experiments/5526-mission-walk-planner/README.md`.
 *
 * Pure and deterministic: no DOM, no map, no turf, its own haversine; every tie falls to the lower street id and the
 * input is sorted by id before the graph is built, so the same streets and start always give the same plan (a page
 * reload reproduces it). It is self-contained on purpose so it can also run in Node (the benchmark) or server-side
 * later; the node-merging mirrors RouteGraph's (#4579), and a later refactor could share one graph builder.
 *
 * Measured cost (construct + plan, Node 24): the largest Seattle dev region, 773 streets, takes ~12 ms (~20 ms cold),
 * and a 1,200-street lattice ~9 ms (~26 ms cold); see the benchmark README.
 *
 * @example
 * const planner = new WalkPlanner(streets);
 * const { steps, stats } = planner.plan({ streetId: currentTask.getStreetEdgeId() });
 */
class WalkPlanner {
  /** Endpoints within this many metres are one node (the same value as RouteGraph.NODE_TOLERANCE_M). */
  static NODE_TOLERANCE_M = 10;
  /** A street shorter than this is folded into whatever it continues (walked as soon as it is adjacent). */
  static TINY_STREET_M = 20;
  /**
   * A connected street is walked if its priority is within this of the best remaining priority. 0.15 is the widest
   * tolerance whose whole-region priority-AUC stayed within 0.03 of today's rule in every dev city; wider ones cut
   * jumps further but walk low-priority streets early (tools/experiments/5526-mission-walk-planner/README.md).
   */
  static DEFAULT_PRIORITY_TOLERANCE = 0.15;
  /**
   * Metres a jump pays for landing on an even-degree node, where starting a trail usually wastes one. 300 m cut
   * jumps 6–17% against no penalty; 1,000 m bought at most 1% more and lengthened jumps (same README).
   */
  static ODD_START_PENALTY_M = 300;
  static EARTH_RADIUS_M = 6371008.8;

  /** @type {{id: number, coords: number[][], priority: number, lengthM: number, fixed: boolean}[]} */
  #streets;
  /** @type {number[][]} Per street, the [coords[0] node, coords[last] node] indices. */
  #ends;
  /** @type {number[][]} Per node, its [lng, lat]. */
  #nodePos;
  /** @type {number[][]} Per node, the indices of the streets touching it (a loop is listed once). */
  #incident;
  /** @type {Int32Array} Per node, its degree (a loop counts twice). */
  #degree;
  /** @type {number[]} Street indices, highest priority first, ties by id. */
  #byPriority;
  #lowerBound;
  #priorityTolerance;
  #oddStartPenaltyM;

  /**
   * @param {PlannerStreet[]} streets - The streets still to be walked (already filtered: not complete, not given up).
   * @param {{priorityTolerance?: number, oddStartPenaltyM?: number}} [options] - The penalty is exposed for the
   *   benchmark's sweep; callers normally leave both at their defaults.
   */
  constructor(streets, options = {}) {
    this.#priorityTolerance = options.priorityTolerance ?? WalkPlanner.DEFAULT_PRIORITY_TOLERANCE;
    this.#oddStartPenaltyM = options.oddStartPenaltyM ?? WalkPlanner.ODD_START_PENALTY_M;

    // A street without two coordinates has no ends to walk between, so it can't take part in a walk.
    this.#streets = streets
      .filter((s) => Array.isArray(s.coords) && s.coords.length >= 2)
      .map((s) => ({
        id: s.id,
        coords: s.coords,
        priority: s.priority,
        lengthM: s.lengthM ?? WalkPlanner.lineLengthM(s.coords),
        fixed: s.fixedDirection === true,
      }))
      .sort((a, b) => a.id - b.id);

    const graph = WalkPlanner.#buildGraph(this.#streets);
    this.#ends = graph.ends;
    this.#nodePos = graph.nodePos;
    this.#incident = this.#nodePos.map(() => []);
    this.#degree = new Int32Array(this.#nodePos.length);
    this.#ends.forEach(([a, b], i) => {
      this.#incident[a].push(i);
      if (b !== a) this.#incident[b].push(i);
      this.#degree[a]++;
      this.#degree[b]++;
    });
    const ss = this.#streets;
    this.#byPriority = ss.map((_, i) => i).sort((i, j) => ss[j].priority - ss[i].priority || ss[i].id - ss[j].id);
    this.#lowerBound = WalkPlanner.#lowerBoundOf(this.#nodePos.length, this.#ends);
  }

  /**
   * Plans a walk over every street given to the constructor.
   *
   * With no usable start (an unknown streetId and no `from`), step 0 is the highest-priority street in its given
   * orientation, the same street the server would pick absent randomness.
   *
   * @param {{streetId?: number, from?: number[]}} [start] - `streetId`: the street the user is on; it becomes step 0
   *   (never a jump, never reversed, since its orientation is the caller's) and the walk continues from its far end.
   *   `from`: a free [lng, lat] when the user is on no street; step 0 is then the nearest top-tier street.
   * @returns {{steps: PlanStep[], stats: PlanStats}} The ordered walk and its summary.
   */
  plan(start = {}) {
    const t0 = WalkPlanner.#now();
    const streets = this.#streets;
    const n = streets.length;
    const walked = new Uint8Array(n);
    const remDeg = Int32Array.from(this.#degree);
    /** @type {PlanStep[]} */
    const steps = [];
    let remaining = n;
    let priorityPtr = 0;
    let node = -1;
    /** @type {number[]} */
    let pos = [0, 0];
    let deadEnds = 0;

    const bestRemaining = () => {
      while (priorityPtr < n && walked[this.#byPriority[priorityPtr]]) priorityPtr++;
      return priorityPtr < n ? streets[this.#byPriority[priorityPtr]].priority : -Infinity;
    };
    const take = (i, reverse, jump, jumpM) => {
      const [a, b] = this.#ends[i];
      const coords = streets[i].coords;
      walked[i] = 1;
      remaining--;
      remDeg[a]--;
      remDeg[b]--;
      steps.push({ id: streets[i].id, reverse, jump, jumpM });
      node = reverse ? a : b;
      pos = reverse ? coords[0] : coords[coords.length - 1];
    };

    if (n > 0) {
      const startIndex = start.streetId === undefined ? -1 : this.#indexOfId(start.streetId);
      if (startIndex >= 0) {
        take(startIndex, false, false, 0);
      } else if (start.from) {
        // "Nearest" is literal here: a user standing still should start at the street in front of them, so the
        // odd-node preference that shapes later jumps doesn't apply.
        const pick = this.#chooseJump(start.from, bestRemaining() - this.#priorityTolerance, remDeg, walked, 0);
        take(pick.index, pick.reverse, false, 0);
      } else {
        take(this.#byPriority[0], false, false, 0);
      }
    }

    while (remaining > 0) {
      if (remDeg[node] === 0) deadEnds++;
      const cutoff = bestRemaining() - this.#priorityTolerance;
      const next = this.#chooseContinuation(node, cutoff, remDeg, walked);
      if (next) {
        take(next.index, next.reverse, false, 0);
      } else {
        const pick = this.#chooseJump(pos, cutoff, remDeg, walked, this.#oddStartPenaltyM);
        take(pick.index, pick.reverse, true, pick.distanceM);
      }
    }

    const jumpDistances = steps.filter((s) => s.jump).map((s) => s.jumpM).sort((a, b) => a - b);
    const mid = jumpDistances.length >> 1;
    let medianJumpM = 0;
    if (jumpDistances.length % 2 === 1) medianJumpM = jumpDistances[mid];
    else if (jumpDistances.length > 0) medianJumpM = (jumpDistances[mid - 1] + jumpDistances[mid]) / 2;
    return {
      steps,
      stats: {
        streets: steps.length,
        totalM: streets.reduce((sum, s) => sum + s.lengthM, 0),
        jumps: jumpDistances.length,
        jumpM: jumpDistances.reduce((sum, d) => sum + d, 0),
        medianJumpM,
        deadEnds,
        lowerBoundJumps: this.#lowerBound,
        ms: WalkPlanner.#now() - t0,
      },
    };
  }

  /**
   * Picks the street to walk next from a node, or null when the walk should jump.
   *
   * Only tiny streets and streets within the priority tolerance are eligible; anything else is left for a later
   * visit, which is what lets priority shape the walk. Among the eligible, the ranking is: tiny first, in-tier first,
   * non-bridge first (Fleury), higher priority, more onward streets at the far node, lower id.
   *
   * @param {number} node - The node the walk stands on.
   * @param {number} cutoff - The lowest priority still in tier.
   * @param {Int32Array} remDeg - Per node, the degree in the unwalked graph.
   * @param {Uint8Array} walked - Per street, 1 once walked.
   * @returns {?{index: number, reverse: boolean}} The street and direction, or null when nothing is eligible.
   */
  #chooseContinuation(node, cutoff, remDeg, walked) {
    const candidates = [];
    for (const i of this.#incident[node]) {
      if (walked[i]) continue;
      const s = this.#streets[i];
      const [a, b] = this.#ends[i];
      let reverse;
      if (a === node) reverse = false;
      else if (!s.fixed) reverse = true;
      else continue; // A resumed street can only be entered at the end its walked metres are measured from.
      const tiny = s.lengthM < WalkPlanner.TINY_STREET_M;
      const inTier = s.priority >= cutoff - 1e-9;
      if (!tiny && !inTier) continue;
      const far = reverse ? a : b;
      const onward = remDeg[far] - (a === b ? 2 : 1);
      candidates.push({ index: i, reverse, far, tiny, inTier, onward, bridge: false });
    }
    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
      for (const c of candidates) c.bridge = this.#isBridge(c.index, node, c.far, walked);
    }
    candidates.sort((x, y) => {
      const sx = this.#streets[x.index];
      const sy = this.#streets[y.index];
      return (Number(y.tiny) - Number(x.tiny))
        || (Number(y.inTier) - Number(x.inTier))
        || (Number(x.bridge) - Number(y.bridge))
        || (sy.priority - sx.priority)
        || (y.onward - x.onward)
        || (sx.id - sy.id);
    });
    return candidates[0];
  }

  /**
   * Whether walking a street would cut its far node off from the node the walk is on, in the unwalked graph.
   *
   * A search per candidate per step keeps this correct without maintaining a bridge index as streets are removed;
   * it stops as soon as it reaches the near node, which in a street grid is within a block or two.
   *
   * @param {number} index - The street.
   * @param {number} from - The node the walk stands on.
   * @param {number} to - The street's far node.
   * @param {Uint8Array} walked - Per street, 1 once walked.
   * @returns {boolean} True when the street is a bridge of the unwalked graph.
   */
  #isBridge(index, from, to, walked) {
    if (from === to) return false;
    walked[index] = 1;
    const seen = new Uint8Array(this.#nodePos.length);
    const queue = [to];
    seen[to] = 1;
    let found = false;
    for (let q = 0; q < queue.length && !found; q++) {
      for (const i of this.#incident[queue[q]]) {
        if (walked[i]) continue;
        const [a, b] = this.#ends[i];
        const other = a === queue[q] ? b : a;
        if (other === from) {
          found = true;
          break;
        }
        if (!seen[other]) {
          seen[other] = 1;
          queue.push(other);
        }
      }
    }
    walked[index] = 0;
    return !found;
  }

  /**
   * Picks where to jump to: the nearest enterable end of a tier street, where an even-degree end costs extra.
   *
   * Tiny streets are only targets when the tier holds nothing else, so a sliver is never the place a walk resumes
   * while a real street is waiting (#3682).
   *
   * @param {number[]} pos - The [lng, lat] the jump leaves from.
   * @param {number} cutoff - The lowest priority still in tier.
   * @param {Int32Array} remDeg - Per node, the degree in the unwalked graph.
   * @param {Uint8Array} walked - Per street, 1 once walked.
   * @param {number} evenPenaltyM - Metres added to an end whose node has even degree.
   * @returns {{index: number, reverse: boolean, distanceM: number}} The street, its direction, and the jump length.
   */
  #chooseJump(pos, cutoff, remDeg, walked, evenPenaltyM) {
    let best = null;
    let bestTiny = null;
    for (let i = 0; i < this.#streets.length; i++) {
      const s = this.#streets[i];
      if (walked[i] || s.priority < cutoff - 1e-9) continue;
      const tiny = s.lengthM < WalkPlanner.TINY_STREET_M;
      if (tiny && best !== null) continue;
      const entries = s.fixed ? [false] : [false, true];
      for (const reverse of entries) {
        const endNode = this.#ends[i][reverse ? 1 : 0];
        const distanceM = WalkPlanner.distanceM(pos, s.coords[reverse ? s.coords.length - 1 : 0]);
        const cost = distanceM + (remDeg[endNode] % 2 === 1 ? 0 : evenPenaltyM);
        const pick = { index: i, reverse, distanceM, cost };
        if (tiny) {
          if (bestTiny === null || cost < bestTiny.cost) bestTiny = pick;
        } else if (best === null || cost < best.cost) {
          best = pick;
        }
      }
    }
    return best ?? bestTiny;
  }

  /**
   * Finds a street's index by id.
   *
   * @param {number} id - The street id.
   * @returns {number} The index, or -1 when the planner wasn't given that street.
   */
  #indexOfId(id) {
    let lo = 0;
    let hi = this.#streets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const midId = this.#streets[mid].id;
      if (midId === id) return mid;
      if (midId < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  /**
   * Haversine metres between two points.
   *
   * @param {number[]} a - [lng, lat].
   * @param {number[]} b - [lng, lat].
   * @returns {number} Metres.
   */
  static distanceM(a, b) {
    const toRad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toRad;
    const dLng = (b[0] - a[0]) * toRad;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * sinLng * sinLng;
    return 2 * WalkPlanner.EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  }

  /**
   * Geodesic metres of a coordinate list.
   *
   * @param {number[][]} coords - [[lng, lat], …].
   * @returns {number} Metres.
   */
  static lineLengthM(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) total += WalkPlanner.distanceM(coords[i - 1], coords[i]);
    return total;
  }

  /**
   * The fewest jumps any walk over these streets can make.
   *
   * A connected component with k odd-degree nodes needs max(1, k / 2) trails, and every trail after the first
   * starts with a jump. Neither fixedDirection nor the tiny-street rule changes this bound: both only restrict the
   * order within the same trails.
   *
   * @param {PlannerStreet[]} streets - The streets to cover.
   * @returns {number} Σ over components of max(1, oddNodes / 2), minus 1; 0 for no streets.
   */
  static lowerBoundJumps(streets) {
    const usable = streets.filter((s) => Array.isArray(s.coords) && s.coords.length >= 2)
      .slice()
      .sort((a, b) => a.id - b.id);
    const graph = WalkPlanner.#buildGraph(usable);
    return WalkPlanner.#lowerBoundOf(graph.nodePos.length, graph.ends);
  }

  /**
   * Merges street endpoints within NODE_TOLERANCE_M into nodes.
   *
   * The same cell-grid idiom as RouteGraph#nodeKeyFor: a ~11 m cell holds a list of nodes, because two endpoints
   * 10–13 m apart can share a cell without merging and one must not replace the other.
   *
   * @param {{coords: number[][]}[]} streets - Streets in id order (merging is order-dependent, so the order is fixed).
   * @returns {{ends: number[][], nodePos: number[][]}} Per street its two node indices, and per node its [lng, lat].
   */
  static #buildGraph(streets) {
    /** @type {Map<string, number[]>} */
    const cells = new Map();
    /** @type {number[][]} */
    const nodePos = [];
    const nodeFor = (coord) => {
      const cellLng = Math.round(coord[0] * 10000);
      const cellLat = Math.round(coord[1] * 10000);
      // Longitude cells narrow with latitude (~7.6 m at 47°N), so the scan reaches ±2 cells east-west.
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const k of cells.get(`${cellLng + dx},${cellLat + dy}`) ?? []) {
            if (WalkPlanner.distanceM(coord, nodePos[k]) < WalkPlanner.NODE_TOLERANCE_M) return k;
          }
        }
      }
      const key = `${cellLng},${cellLat}`;
      const cell = cells.get(key) ?? [];
      cell.push(nodePos.length);
      cells.set(key, cell);
      nodePos.push(coord);
      return nodePos.length - 1;
    };
    const ends = streets.map((s) => [nodeFor(s.coords[0]), nodeFor(s.coords[s.coords.length - 1])]);
    return { ends, nodePos };
  }

  /**
   * The jump lower bound of a built graph.
   *
   * @param {number} nodeCount - Number of nodes.
   * @param {number[][]} ends - Per street, its two node indices.
   * @returns {number} Σ over components of max(1, oddNodes / 2), minus 1; 0 for no streets.
   */
  static #lowerBoundOf(nodeCount, ends) {
    if (ends.length === 0) return 0;
    const parent = Int32Array.from({ length: nodeCount }, (_, i) => i);
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const degree = new Int32Array(nodeCount);
    for (const [a, b] of ends) {
      degree[a]++;
      degree[b]++;
      parent[find(a)] = find(b);
    }
    /** @type {Map<number, number>} */
    const oddByComponent = new Map();
    for (let v = 0; v < nodeCount; v++) {
      const root = find(v);
      oddByComponent.set(root, (oddByComponent.get(root) ?? 0) + (degree[v] % 2));
    }
    let trails = 0;
    for (const odd of oddByComponent.values()) trails += Math.max(1, odd / 2);
    return trails - 1;
  }

  /**
   * A millisecond clock that works in the browser and in Node.
   *
   * @returns {number} Milliseconds.
   */
  static #now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }
}
