/**
 * A street as the planner sees it.
 * @typedef {object} PlannerStreet
 * @property {number} id - The street_edge_id. Ids are expected to be unique; a repeated id keeps only its first
 *   occurrence in input order, because a plan names streets by id and Explore maps each step back to one task.
 * @property {number[][]} coords - LineString [[lng, lat], …] in the street's current orientation. A street with fewer
 *   than two coordinates has no ends to walk between and is dropped (also when it is the `streetId` start).
 * @property {number} priority - In (0, 1]; 1 means nobody has audited it. A missing or non-finite priority is treated
 *   as 0, so the street is still walked (every street given is planned) but never holds a tier open.
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
 * @property {number} deadEnds - Steps (excluding the last) whose far node had no unwalked street left at all. Each
 *   one forces a jump.
 * @property {number} forcedJumps - Jumps taken although an unwalked street did continue from the node, because none
 *   of them was eligible (out of the priority tier and not tiny, or a fixedDirection street entered at the wrong
 *   end). jumps === deadEnds + forcedJumps.
 * @property {number} lowerBoundJumps - Σ over connected components of max(1, oddNodes / 2), minus 1.
 * @property {number} ms - Wall time of this plan() call alone; building the graph in the constructor is not included.
 */

/**
 * Orders a neighborhood's remaining streets into one walk, fixed up front, so Explore can show where a mission is
 * going instead of choosing each street greedily after the last (#5526).
 *
 * The walk is built as trails: from the current node it keeps walking onto an unwalked street while one is eligible,
 * and only jumps when none is. Fleury's rule (never take a bridge of the remaining graph while another street will
 * do) keeps a trail from stranding the rest of its component, and a jump lands on an odd-degree node when it can,
 * because a component with k odd nodes needs at least k/2 trails and starting anywhere else wastes one.
 * Streets under `tinyStreetM` (border-cut remnants, slivers; #4717, #3488) are eligible regardless of priority, so a
 * tiny street rides along with the street it continues instead of becoming a standalone jump target later; it still
 * yields to Fleury, so a tiny dead-end spur waits until the trail would end there anyway. A tiny street is a jump
 * target only once its tier holds no other street.
 *
 * Priority is a gate on continuing, not a weight: a connected street is eligible only when its priority is within
 * `priorityTolerance` of the best remaining priority, so an out-of-tier street forces a jump rather than merely
 * ranking last; a jump goes to the nearest street in that tier. Both thresholds are domain values, so the planner has
 * no defaults for them: Explore passes the backend's (`walk-planner.*` in application.conf, via the page's
 * `mainParam.walkPlanner`), and the benchmark and tests name their own. The shipped values were chosen by the replay
 * benchmark in `tools/experiments/5526-mission-walk-planner/README.md`.
 *
 * Pure and deterministic: no DOM, no map, no turf, its own haversine. The input is sorted by id, every tie falls to
 * the lower street id, and the graph and every end choice are built from each street's canonical endpoint order
 * (lexicographic [lng, lat]) rather than its stored orientation. So the same street set, priorities and start give the
 * same plan however the streets happen to be oriented, and a replan over re-oriented geometry does not reshuffle the
 * remainder. It is self-contained on purpose so it can also run in Node (the benchmark) or server-side later; the
 * node-merging follows RouteGraph's (#4579), and a later refactor could share one graph builder.
 *
 * Measured cost (construct + plan, Node 24 in the web container on an M-series Mac; the benchmark README's "Planning
 * time"): the largest Seattle dev region (773 streets) ~9 ms warm / ~31 ms cold, a 25×25 lattice (1,200 streets)
 * ~6 / ~24 ms, and a 1,800-street comb of dead-end teeth, the worst shape found, ~41 / ~67 ms.
 *
 * @example
 * const planner = new WalkPlanner(streets, { priorityTolerance: 0.15, tinyStreetM: 20 });
 * const { steps, stats } = planner.plan({ streetId: currentTask.getStreetEdgeId() });
 */
class WalkPlanner {
  /** Endpoints within this many metres are one node (the same value as RouteGraph.NODE_TOLERANCE_M). */
  static NODE_TOLERANCE_M = 10;
  /**
   * Metres a jump pays for landing on an even-degree node, where starting a trail usually wastes one. 300 m cut
   * jumps 6–11% against no penalty across the dev cities; 1,000 m bought under 1% more and lengthened jumps (same
   * README).
   */
  static ODD_START_PENALTY_M = 300;
  static EARTH_RADIUS_M = 6371008.8;

  /**
   * @type {{id: number, coords: number[][], priority: number, lengthM: number, fixed: boolean,
   *   canonFirst: boolean}[]}
   */
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
  /** @type {number} */
  #lowerBound;
  /**
   * @type {number} A connected street is eligible if its priority is within this of the best remaining priority. The
   *   unit is the server's reciprocal-normalized priority (`StreetEdgePriorityTable`: `priority = 1 / (1 + goodAudits
   *   + …)`), so a change to that formula silently re-tunes the tolerance.
   */
  #priorityTolerance;
  /**
   * @type {number} A street is tiny when `lengthM < tinyStreetM` (strictly less). Explore's tiny-street auto-complete
   * reads the same setting with the same comparison, so the two can't drift apart.
   */
  #tinyStreetM;
  /** @type {number} */
  #oddStartPenaltyM;
  /** @type {Uint32Array} Per node, the stamp of the last bridge search that reached it (reused across searches). */
  #seen;
  /** @type {number} The last stamp handed out; each bridge search takes two, one per side. */
  #epoch = 0;
  /** @type {Int32Array} Bridge-search queue for the near side, preallocated to the node count. */
  #queueNear;
  /** @type {Int32Array} Bridge-search queue for the far side, preallocated to the node count. */
  #queueFar;

  /**
   * @param {PlannerStreet[]} streets - The streets still to be walked (already filtered: not complete, not given up).
   * @param {{priorityTolerance: number, tinyStreetM: number, oddStartPenaltyM?: number}} options - The two thresholds
   *   are required (see the class doc); the penalty is a planner heuristic, exposed for the benchmark's sweep, and
   *   normally left at its default.
   * @throws {TypeError} When either threshold is missing or not a finite number, so a page that failed to hand them
   *   over falls back to the greedy rule (TaskContainer.planWalk) instead of planning with a silent default.
   */
  constructor(streets, options) {
    const { priorityTolerance, tinyStreetM, oddStartPenaltyM } = options ?? {};
    if (!Number.isFinite(priorityTolerance) || !Number.isFinite(tinyStreetM)) {
      throw new TypeError('WalkPlanner needs finite priorityTolerance and tinyStreetM settings');
    }
    this.#priorityTolerance = priorityTolerance;
    this.#tinyStreetM = tinyStreetM;
    this.#oddStartPenaltyM = oddStartPenaltyM ?? WalkPlanner.ODD_START_PENALTY_M;

    this.#streets = WalkPlanner.#usableStreets(streets).map((s) => ({
      id: s.id,
      coords: s.coords,
      priority: WalkPlanner.#priorityOf(s),
      lengthM: s.lengthM ?? WalkPlanner.lineLengthM(s.coords),
      fixed: s.fixedDirection === true,
      canonFirst: WalkPlanner.#isCanonicalForward(s.coords),
    }));

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
    this.#seen = new Uint32Array(this.#nodePos.length);
    this.#queueNear = new Int32Array(this.#nodePos.length);
    this.#queueFar = new Int32Array(this.#nodePos.length);
  }

  /**
   * Plans a walk over every street given to the constructor.
   *
   * With no usable start (an unknown or dropped streetId and no `from`), step 0 is the highest-priority street in its
   * given orientation, the same street the server would pick absent randomness.
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
    // The jump scan's candidates, highest priority first; walked entries are compacted away in batches.
    const live = { order: this.#byPriority.slice(), walkedSinceCompact: 0 };
    /** @type {PlanStep[]} */
    const steps = [];
    let remaining = n;
    let priorityPtr = 0;
    let node = -1;
    /** @type {number[]} */
    let pos = [0, 0];
    let deadEnds = 0;
    let forcedJumps = 0;

    const bestRemaining = () => {
      while (priorityPtr < n && walked[this.#byPriority[priorityPtr]]) priorityPtr++;
      return priorityPtr < n ? streets[this.#byPriority[priorityPtr]].priority : -Infinity;
    };
    const take = (i, reverse, jump, jumpM) => {
      const [a, b] = this.#ends[i];
      const coords = streets[i].coords;
      walked[i] = 1;
      live.walkedSinceCompact++;
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
        const pick = this.#chooseJump(start.from, bestRemaining() - this.#priorityTolerance, remDeg, walked, 0, live);
        take(pick.index, pick.reverse, false, 0);
      } else {
        take(this.#byPriority[0], false, false, 0);
      }
    }

    while (remaining > 0) {
      const cutoff = bestRemaining() - this.#priorityTolerance;
      const next = this.#chooseContinuation(node, cutoff, remDeg, walked);
      if (next) {
        take(next.index, next.reverse, false, 0);
      } else {
        if (remDeg[node] === 0) deadEnds++;
        else forcedJumps++;
        const pick = this.#chooseJump(pos, cutoff, remDeg, walked, this.#oddStartPenaltyM, live);
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
        forcedJumps,
        lowerBoundJumps: this.#lowerBound,
        ms: WalkPlanner.#now() - t0,
      },
    };
  }

  /**
   * Picks the street to walk next from a node, or null when the walk should jump.
   *
   * Only eligible streets count: tiny ones and those within the priority tolerance; anything else is left for a later
   * visit, which is what lets priority gate the walk. Among the eligible the ranking is: non-bridge first (Fleury),
   * then tiny, then higher priority, then more eligible streets onward from the far node, then lower id. Putting the
   * bridge test above tininess is what keeps a tiny dead-end spur from ending a trail that still had a loop to close.
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
      if (walked[i] || !this.#isEligible(i, cutoff)) continue;
      const [a, b] = this.#ends[i];
      const reverse = this.#entryAt(i, node);
      if (reverse === null) continue;
      const far = reverse ? a : b;
      candidates.push({ index: i, reverse, far, onward: 0, bridge: false });
    }
    if (candidates.length === 0) return null;
    if (candidates.length > 1) {
      // Counted once per far node: real data has hubs (318 street ends at one node in a Seattle region) where a
      // count per candidate would make every step there quadratic in the hub's degree.
      /** @type {Map<number, number>} */
      const eligibleAt = new Map();
      for (const c of candidates) {
        c.bridge = this.#isBridge(c.index, node, c.far, walked, remDeg);
        if (!eligibleAt.has(c.far)) eligibleAt.set(c.far, this.#eligibleCount(c.far, cutoff, walked));
        c.onward = eligibleAt.get(c.far) - (this.#entryAt(c.index, c.far) === null ? 0 : 1);
      }
    }
    candidates.sort((x, y) => {
      const sx = this.#streets[x.index];
      const sy = this.#streets[y.index];
      return (Number(x.bridge) - Number(y.bridge))
        || (Number(this.#isTiny(y.index)) - Number(this.#isTiny(x.index)))
        || (sy.priority - sx.priority)
        || (y.onward - x.onward)
        || (sx.id - sy.id);
    });
    return candidates[0];
  }

  /**
   * Whether a street may be walked next from an adjacent node: tiny, or within the priority tolerance.
   *
   * @param {number} index - The street.
   * @param {number} cutoff - The lowest priority still in tier.
   * @returns {boolean} True when the gate lets the walk continue onto it.
   */
  #isEligible(index, cutoff) {
    return this.#isTiny(index) || this.#streets[index].priority >= cutoff - 1e-9;
  }

  /**
   * Whether a street is tiny (see #tinyStreetM for the boundary).
   *
   * @param {number} index - The street.
   * @returns {boolean} True when it is strictly shorter than the tiny-street threshold.
   */
  #isTiny(index) {
    return this.#streets[index].lengthM < this.#tinyStreetM;
  }

  /**
   * How a street is entered from one of its end nodes.
   *
   * A loop has both ends at the node, so its direction comes from its canonical order rather than its stored one; a
   * resumed street can only be entered at the end its walked metres are measured from.
   *
   * @param {number} index - The street.
   * @param {number} node - One of its end nodes.
   * @returns {?boolean} The step's reverse flag, or null when the street can't be entered there.
   */
  #entryAt(index, node) {
    const s = this.#streets[index];
    const [a, b] = this.#ends[index];
    if (s.fixed) return a === node ? false : null;
    if (a === b) return !s.canonFirst;
    return a !== node;
  }

  /**
   * Counts the eligible streets a walk could enter from a node.
   *
   * Only eligible, enterable streets count, because an out-of-tier street at a node does not keep the trail going;
   * it forces a jump just as an empty node does. The caller subtracts the candidate itself, which is always counted
   * at its far node when it could be entered there (a loop, or an unfixed street).
   *
   * @param {number} node - The node.
   * @param {number} cutoff - The lowest priority still in tier.
   * @param {Uint8Array} walked - Per street, 1 once walked.
   * @returns {number} The number of unwalked, eligible streets enterable at the node.
   */
  #eligibleCount(node, cutoff, walked) {
    let count = 0;
    for (const j of this.#incident[node]) {
      if (!walked[j] && this.#isEligible(j, cutoff) && this.#entryAt(j, node) !== null) count++;
    }
    return count;
  }

  /**
   * Whether walking a street would cut its far node off from the node the walk is on, in the unwalked graph.
   *
   * Two searches run in lockstep, one from each end with the street removed; they are connected the moment one
   * reaches a node the other has stamped, and it is a bridge the moment either side runs out. So the cost is bounded
   * by the smaller side, which keeps a long dead-end spine (the comb case) from making every step search all of it.
   * The stamp array and queues are reused across calls (an epoch per search) rather than allocated each time.
   *
   * @param {number} index - The street.
   * @param {number} from - The node the walk stands on.
   * @param {number} to - The street's far node.
   * @param {Uint8Array} walked - Per street, 1 once walked.
   * @param {Int32Array} remDeg - Per node, the degree in the unwalked graph.
   * @returns {boolean} True when the street is a bridge of the unwalked graph.
   */
  #isBridge(index, from, to, walked, remDeg) {
    if (from === to) return false;
    // A far node with no other street is a dead end: always a bridge, and the common case, so skip the search.
    if (remDeg[to] === 1) return true;
    if (this.#epoch >= 0xfffffff0) {
      this.#seen.fill(0);
      this.#epoch = 0;
    }
    const nearStamp = ++this.#epoch;
    const farStamp = ++this.#epoch;
    const seen = this.#seen;
    const near = this.#queueNear;
    const far = this.#queueFar;
    seen[from] = nearStamp;
    seen[to] = farStamp;
    near[0] = from;
    far[0] = to;
    let nearHead = 0;
    let nearTail = 1;
    let farHead = 0;
    let farTail = 1;
    walked[index] = 1;
    let connected = false;
    // Expands one node of a side; returns the new tail, or -1 once the two sides have met.
    const expand = (queue, head, tail, mine, theirs) => {
      const v = queue[head];
      let t = tail;
      for (const i of this.#incident[v]) {
        if (walked[i]) continue;
        const [a, b] = this.#ends[i];
        const other = a === v ? b : a;
        if (seen[other] === theirs) return -1;
        if (seen[other] !== mine) {
          seen[other] = mine;
          queue[t++] = other;
        }
      }
      return t;
    };
    while (nearHead < nearTail && farHead < farTail) {
      nearTail = expand(near, nearHead++, nearTail, nearStamp, farStamp);
      if (nearTail < 0) {
        connected = true;
        break;
      }
      farTail = expand(far, farHead++, farTail, farStamp, nearStamp);
      if (farTail < 0) {
        connected = true;
        break;
      }
    }
    walked[index] = 0;
    return !connected;
  }

  /**
   * Picks where to jump to: the nearest enterable end of a tier street, where an even-degree end costs extra.
   *
   * Tiny streets are only targets when the tier holds nothing else, so a sliver is not the place a walk resumes while
   * a real street is waiting (#3682). The scan walks the priority-ordered live list and stops at the cutoff, so a
   * narrow tier costs only its own size; walked entries are compacted out once they make up half the list. Ties go to
   * the lower id, then to the street's canonical start, so the stored orientation never decides.
   *
   * @param {number[]} pos - The [lng, lat] the jump leaves from.
   * @param {number} cutoff - The lowest priority still in tier.
   * @param {Int32Array} remDeg - Per node, the degree in the unwalked graph.
   * @param {Uint8Array} walked - Per street, 1 once walked.
   * @param {number} evenPenaltyM - Metres added to an end whose node has even degree.
   * @param {{order: number[], walkedSinceCompact: number}} live - Unwalked street indices by priority (may hold
   *   walked ones until the next compaction).
   * @returns {{index: number, reverse: boolean, distanceM: number}} The street, its direction, and the jump length.
   */
  #chooseJump(pos, cutoff, remDeg, walked, evenPenaltyM, live) {
    if (live.walkedSinceCompact * 2 > live.order.length) {
      live.order = live.order.filter((i) => !walked[i]);
      live.walkedSinceCompact = 0;
    }
    let best = null;
    let bestTiny = null;
    const better = (cost, index, incumbent) => incumbent === null || cost < incumbent.cost
      || (cost === incumbent.cost && this.#streets[index].id < this.#streets[incumbent.index].id);
    for (const i of live.order) {
      const s = this.#streets[i];
      if (s.priority < cutoff - 1e-9) break;
      if (walked[i]) continue;
      const tiny = this.#isTiny(i);
      if (tiny && best !== null) continue;
      // The canonical start is tried first, so on an exact tie the stored orientation never decides.
      for (let k = 0; k < (s.fixed ? 1 : 2); k++) {
        const reverse = s.fixed ? false : (k === 0) !== s.canonFirst;
        const endNode = this.#ends[i][reverse ? 1 : 0];
        const distanceM = WalkPlanner.distanceM(pos, s.coords[reverse ? s.coords.length - 1 : 0]);
        const cost = distanceM + (remDeg[endNode] % 2 === 1 ? 0 : evenPenaltyM);
        if (tiny) {
          if (better(cost, i, bestTiny)) bestTiny = { index: i, reverse, distanceM, cost };
        } else if (better(cost, i, best)) {
          best = { index: i, reverse, distanceM, cost };
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
    // One lookup of Math per call: the jump scan calls this per candidate, and in a sandboxed global (jest's vm
    // context) every global lookup is slow enough to dominate the arithmetic.
    const { sin, cos, asin, sqrt, PI } = Math;
    const toRad = PI / 180;
    const dLat = (b[1] - a[1]) * toRad;
    const dLng = (b[0] - a[0]) * toRad;
    const sinLat = sin(dLat / 2);
    const sinLng = sin(dLng / 2);
    const h = sinLat * sinLat + cos(a[1] * toRad) * cos(b[1] * toRad) * sinLng * sinLng;
    return 2 * WalkPlanner.EARTH_RADIUS_M * asin(sqrt(h));
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
    const graph = WalkPlanner.#buildGraph(WalkPlanner.#usableStreets(streets));
    return WalkPlanner.#lowerBoundOf(graph.nodePos.length, graph.ends);
  }

  /**
   * The streets a plan can use, in id order: at least two coordinates, first occurrence of each id.
   *
   * @param {PlannerStreet[]} streets - As given by the caller.
   * @returns {PlannerStreet[]} A new array, sorted by id (stable, so the first occurrence of a repeated id wins).
   */
  static #usableStreets(streets) {
    const seenIds = new Set();
    return streets
      .filter((s) => Array.isArray(s.coords) && s.coords.length >= 2)
      .sort((a, b) => a.id - b.id)
      .filter((s) => {
        if (seenIds.has(s.id)) return false;
        seenIds.add(s.id);
        return true;
      });
  }

  /**
   * A street's priority as the planner uses it.
   *
   * @param {PlannerStreet} street - As given by the caller.
   * @returns {number} Its priority, or 0 when that is missing or not finite (a NaN would poison every sort).
   */
  static #priorityOf(street) {
    return Number.isFinite(street.priority) ? street.priority : 0;
  }

  /**
   * Whether a street's stored orientation is its canonical one.
   *
   * Canonical means the lexicographically smaller [lng, lat] end comes first; for a loop, whose ends coincide, the
   * smaller of its second and second-to-last points decides. Every choice between a street's two ends is keyed on
   * this, so it never depends on which way the street happens to be stored.
   *
   * @param {number[][]} coords - [[lng, lat], …].
   * @returns {boolean} True when coords[0] is the canonical start.
   */
  static #isCanonicalForward(coords) {
    const cmp = (p, q) => (p[0] - q[0]) || (p[1] - q[1]);
    const ends = cmp(coords[0], coords[coords.length - 1]);
    if (ends !== 0) return ends < 0;
    return cmp(coords[1], coords[coords.length - 2]) <= 0;
  }

  /**
   * Merges street endpoints within NODE_TOLERANCE_M into nodes.
   *
   * The same cell-grid idiom as RouteGraph#nodeKeyFor: a ~11 m cell holds a list of nodes, because two endpoints
   * 10–13 m apart can share a cell without merging and one must not replace the other. Two rules keep the result
   * independent of scan order and orientation: an exact coordinate seen before always maps to the node it mapped to
   * (so endpoints that coincide exactly are always one node, even with a rival node nearby), and otherwise the
   * *nearest* node within tolerance wins, not the first one scanned. Each street's two ends are merged in canonical
   * order, so reversing a street's stored geometry cannot change which nodes exist.
   *
   * @param {{coords: number[][]}[]} streets - Streets in id order (merging is order-dependent, so the order is fixed).
   * @returns {{ends: number[][], nodePos: number[][]}} Per street its [coords[0], coords[last]] node indices, and per
   *   node its [lng, lat].
   */
  static #buildGraph(streets) {
    /** @type {Map<string, number[]>} */
    const cells = new Map();
    /** @type {Map<string, number>} */
    const exact = new Map();
    /** @type {number[][]} */
    const nodePos = [];
    const nodeFor = (coord) => {
      const exactKey = `${coord[0]},${coord[1]}`;
      const known = exact.get(exactKey);
      if (known !== undefined) return known;
      const cellLng = Math.round(coord[0] * 10000);
      const cellLat = Math.round(coord[1] * 10000);
      let nearest = -1;
      let nearestM = WalkPlanner.NODE_TOLERANCE_M;
      // Longitude cells narrow with latitude (~7.6 m at 47°N), so the scan reaches ±2 cells east-west.
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const k of cells.get(`${cellLng + dx},${cellLat + dy}`) ?? []) {
            const d = WalkPlanner.distanceM(coord, nodePos[k]);
            if (d < nearestM || (d === nearestM && nearest >= 0 && k < nearest)) {
              nearest = k;
              nearestM = d;
            }
          }
        }
      }
      if (nearest < 0) {
        const key = `${cellLng},${cellLat}`;
        const cell = cells.get(key) ?? [];
        cell.push(nodePos.length);
        cells.set(key, cell);
        nodePos.push(coord);
        nearest = nodePos.length - 1;
      }
      exact.set(exactKey, nearest);
      return nearest;
    };
    const ends = streets.map((s) => {
      const head = s.coords[0];
      const tail = s.coords[s.coords.length - 1];
      if (WalkPlanner.#isCanonicalForward(s.coords)) {
        const a = nodeFor(head);
        return [a, nodeFor(tail)];
      }
      const b = nodeFor(tail);
      return [nodeFor(head), b];
    });
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
