/**
 * Tests for WalkPlanner (public/js/common/WalkPlanner.js, #5526): the planner that orders a neighborhood's remaining
 * streets into one walk up front.
 *
 * WalkPlanner is a top-level `class` written for the Grunt-concatenation world, so the source is evaled into the
 * jsdom global scope. It is pure graph logic, so every test builds a small synthetic street network. Coordinates sit
 * on the equator at 0.001° spacing, so one grid step is ~111 m in both directions and the node merge (10 m) never
 * joins two distinct grid points.
 */

/* global WalkPlanner */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public/js/common/WalkPlanner.js'), 'utf8');
window.eval(`${SRC}\nwindow.WalkPlanner = WalkPlanner;`);

const STEP = 0.001;

/**
 * The thresholds Explore ships with (walk-planner.* in application.conf). The planner has no defaults for them, so
 * every construction names them; a test that gates on tolerance spreads `{ ...SETTINGS, priorityTolerance }`.
 */
const SETTINGS = { priorityTolerance: 0.15, tinyStreetM: 20 };

/** A grid point, in grid units, as [lng, lat]. */
const P = (x, y) => [x * STEP, y * STEP];

/** A planner street from grid points; priority 1 unless given. */
function st(id, from, to, priority = 1, extra = {}) {
  return { id, coords: [P(...from), P(...to)], priority, ...extra };
}

/** Every street once, and every non-jump step starting where the previous one ended. */
function expectValidWalk(streets, steps) {
  expect(steps.map((s) => s.id).sort((a, b) => a - b)).toEqual(streets.map((s) => s.id).sort((a, b) => a - b));
  const byId = new Map(streets.map((s) => [s.id, s]));
  let prevEnd = null;
  steps.forEach((step, k) => {
    const c = byId.get(step.id).coords;
    const start = step.reverse ? c[c.length - 1] : c[0];
    if (k === 0) {
      expect(step.jump).toBe(false);
    } else if (!step.jump) {
      expect(WalkPlanner.distanceM(prevEnd, start)).toBeLessThanOrEqual(WalkPlanner.NODE_TOLERANCE_M);
      expect(step.jumpM).toBe(0);
    } else {
      expect(step.jumpM).toBeCloseTo(WalkPlanner.distanceM(prevEnd, start), 6);
    }
    prevEnd = step.reverse ? c[0] : c[c.length - 1];
  });
}

/** Streets of an n×n lattice of nodes, oriented at random from a seed, or all east/north for seed 0. */
function lattice(n, seed = 0) {
  let a = seed;
  const rand = () => {
    a = (a * 1103515245 + 12345) % 2147483648;
    return a / 2147483648;
  };
  const streets = [];
  let id = 1;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const flip = () => seed !== 0 && rand() < 0.5;
      if (x + 1 < n) streets.push(flip() ? st(id++, [x + 1, y], [x, y]) : st(id++, [x, y], [x + 1, y]));
      if (y + 1 < n) streets.push(flip() ? st(id++, [x, y + 1], [x, y]) : st(id++, [x, y], [x, y + 1]));
    }
  }
  return streets;
}

const ids = (steps) => steps.map((s) => s.id);

describe('WalkPlanner settings', () => {
  it('has no default for either threshold: a missing or non-finite one is a TypeError', () => {
    const streets = [st(1, [0, 0], [1, 0])];
    expect(() => new WalkPlanner(streets)).toThrow(TypeError);
    expect(() => new WalkPlanner(streets, { priorityTolerance: 0.15 })).toThrow(TypeError);
    expect(() => new WalkPlanner(streets, { tinyStreetM: 20 })).toThrow(TypeError);
    expect(() => new WalkPlanner(streets, { priorityTolerance: '0.15', tinyStreetM: 20 })).toThrow(TypeError);
    expect(() => new WalkPlanner(streets, { priorityTolerance: 0.15, tinyStreetM: NaN })).toThrow(TypeError);
    expect(() => new WalkPlanner(streets, SETTINGS)).not.toThrow();
  });

  it('reads what "tiny" means from tinyStreetM, strictly below it', () => {
    // A 111 m street continues from 1; the same street is tiny only when the threshold is raised above its length.
    const streets = [st(1, [0, 0], [1, 0]), st(2, [1, 0], [2, 0], 0.5), st(3, [5, 0], [6, 0])];
    const gated = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(gated.steps.map((s) => s.id)).toEqual([1, 3, 2]);
    const lengthM = WalkPlanner.distanceM(streets[1].coords[0], streets[1].coords[1]);
    const asTiny = new WalkPlanner(streets, { ...SETTINGS, tinyStreetM: lengthM + 0.01 }).plan({ streetId: 1 });
    expect(asTiny.steps.map((s) => s.id)).toEqual([1, 2, 3]);
    const atLength = new WalkPlanner(streets, { ...SETTINGS, tinyStreetM: lengthM }).plan({ streetId: 1 });
    expect(atLength.steps.map((s) => s.id)).toEqual([1, 3, 2]);
  });
});

describe('WalkPlanner', () => {
  it('plans a single street as one step', () => {
    const streets = [st(7, [0, 0], [1, 0])];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 7 });
    expect(steps).toEqual([{ id: 7, reverse: false, jump: false, jumpM: 0 }]);
    expect(stats).toMatchObject({ streets: 1, jumps: 0, jumpM: 0, medianJumpM: 0, deadEnds: 0, lowerBoundJumps: 0 });
  });

  it('returns an empty plan for no streets', () => {
    const { steps, stats } = new WalkPlanner([], SETTINGS).plan({ from: P(0, 0) });
    expect(steps).toEqual([]);
    expect(stats).toMatchObject({ streets: 0, totalM: 0, jumps: 0, lowerBoundJumps: 0 });
  });

  it('walks a path of mixed orientations without a jump, reversing where the geometry says to', () => {
    const streets = [st(1, [0, 0], [1, 0]), st(2, [2, 0], [1, 0]), st(3, [2, 0], [3, 0])];
    const { steps } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(steps).toEqual([
      { id: 1, reverse: false, jump: false, jumpM: 0 },
      { id: 2, reverse: true, jump: false, jumpM: 0 },
      { id: 3, reverse: false, jump: false, jumpM: 0 },
    ]);
  });

  it('never reverses the start street, even when its other end leads on', () => {
    const streets = [st(1, [1, 0], [0, 0]), st(2, [1, 0], [2, 0])];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(steps[0]).toEqual({ id: 1, reverse: false, jump: false, jumpM: 0 });
    expect(steps[1].jump).toBe(true);
    expect(stats.jumps).toBe(1);
  });

  it('covers an Eulerian block (a square) in one trail', () => {
    const streets = [st(1, [0, 0], [1, 0]), st(2, [1, 1], [1, 0]), st(3, [0, 1], [1, 1]), st(4, [0, 0], [0, 1])];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expectValidWalk(streets, steps);
    expect(stats.jumps).toBe(0);
    expect(stats.lowerBoundJumps).toBe(0);
  });

  it('meets the lower bound on a 3×3 grid when started from an odd node', () => {
    // Four odd nodes (the edge midpoints) make two trails necessary, so one jump.
    const streets = lattice(3);
    const planner = new WalkPlanner(streets, SETTINGS);
    const fromOdd = streets.find((s) => s.coords[0][0] === P(1, 0)[0] && s.coords[0][1] === 0
      && s.coords[1][0] === P(2, 0)[0]);
    const { steps, stats } = planner.plan({ streetId: fromOdd.id });
    expectValidWalk(streets, steps);
    expect(stats.lowerBoundJumps).toBe(1);
    expect(stats.jumps).toBe(1);
  });

  it('needs at most one jump more than the bound on a 3×3 grid started at a corner', () => {
    const streets = lattice(3);
    const fromCorner = streets.find((s) => s.coords[0][0] === 0 && s.coords[0][1] === 0);
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: fromCorner.id });
    expectValidWalk(streets, steps);
    expect(stats.jumps).toBeLessThanOrEqual(stats.lowerBoundJumps + 1);
  });

  it('defers the dead-end teeth of a cul-de-sac comb and stays within one jump of the bound', () => {
    // Spine (0,0)…(5,0), with a cul-de-sac tooth rising from each interior spine node.
    const spine = [1, 2, 3, 4, 5].map((x) => st(x, [x - 1, 0], [x, 0]));
    const teeth = [1, 2, 3, 4].map((x) => st(10 + x, [x, 0], [x, 1]));
    const streets = [...teeth, ...spine];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expectValidWalk(streets, steps);
    expect(ids(steps).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(stats.lowerBoundJumps).toBe(4);
    expect(stats.jumps).toBeLessThanOrEqual(stats.lowerBoundJumps + 1);
  });

  it('does not take a bridge while a street that keeps the rest reachable exists (Fleury)', () => {
    // A-B, then at B a bridge B-E (lower id) and a triangle B-C-D-B; E continues to F so onward degrees tie.
    const streets = [
      st(1, [0, 0], [1, 0]),
      st(2, [1, 0], [2, 0]),
      st(3, [2, 0], [3, 0]),
      st(4, [1, 0], [1, 1]),
      st(5, [1, 1], [0, 1]),
      st(6, [0, 1], [1, 0]),
    ];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(ids(steps)).toEqual([1, 4, 5, 6, 2, 3]);
    expect(stats.jumps).toBe(0);
  });

  it('jumps exactly once between two components, to the nearest end, which is an odd node', () => {
    const a = [st(1, [0, 0], [1, 0]), st(2, [1, 0], [2, 0])];
    const b = [st(3, [5, 0], [4, 0]), st(4, [5, 0], [6, 0])];
    const streets = [...a, ...b];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expectValidWalk(streets, steps);
    expect(stats.jumps).toBe(1);
    const jump = steps.find((s) => s.jump);
    expect(jump).toEqual({ id: 3, reverse: true, jump: true, jumpM: expect.any(Number) });
    expect(jump.jumpM).toBeCloseTo(WalkPlanner.distanceM(P(2, 0), P(4, 0)), 6);
  });

  it('prefers a farther odd node to a nearer even one by the odd-start penalty', () => {
    // Component B is a square (even corners) with a pendant street from its far corner (5,1) to (5,3), so the only
    // odd nodes are (5,1) and (5,3). Its near corner (3,0) is ~111 m from A's end; (5,1) is ~352 m.
    const a = [st(1, [0, 0], [2, 0])];
    const b = [
      st(2, [3, 0], [5, 0]), st(3, [5, 0], [5, 1]), st(4, [5, 1], [3, 1]), st(5, [3, 1], [3, 0]), st(6, [5, 1], [5, 3]),
    ];
    const streets = [...a, ...b];
    const withPenalty = new WalkPlanner(streets, { ...SETTINGS, oddStartPenaltyM: 1000 }).plan({ streetId: 1 });
    expect(withPenalty.steps[1]).toMatchObject({ id: 3, reverse: true, jump: true }); // Enters at odd (5,1).
    expect(withPenalty.stats.jumps).toBe(1);
    const noPenalty = new WalkPlanner(streets, { ...SETTINGS, oddStartPenaltyM: 0 }).plan({ streetId: 1 });
    expect(noPenalty.steps[1]).toMatchObject({ id: 2, reverse: false, jump: true });
    expect(noPenalty.stats.jumps).toBe(2);
  });

  it('walks a tiny sliver as soon as it is adjacent, even below the priority tier', () => {
    // An 8 m sliver merges into one node at B (it is shorter than the node tolerance), so it is a loop there.
    const sliverEnd = [P(1, 0)[0] + 8 / 111195, 0];
    const streets = [
      st(1, [0, 0], [1, 0]),
      { id: 2, coords: [P(1, 0), sliverEnd], priority: 0.1 },
      { id: 3, coords: [sliverEnd, P(2, 0)], priority: 0.1 },
      st(4, [1, 0], [1, 1]),
    ];
    const { steps } = new WalkPlanner(streets, { ...SETTINGS, priorityTolerance: 0.2 }).plan({ streetId: 1 });
    expectValidWalk(streets, steps);
    expect(steps[1]).toMatchObject({ id: 2, jump: false });
  });

  it('never jumps to a sliver while a real street in the tier remains', () => {
    // The 15 m sliver sits ~33 m from the end of street 1; the real street is ~111 m away.
    const streets = [
      st(1, [0, 0], [1, 0]),
      { id: 2, coords: [P(1, 0.3), [P(1, 0.3)[0] + 15 / 111195, P(1, 0.3)[1]]], priority: 1 },
      st(3, [2, 0], [3, 0]),
    ];
    const { steps } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(ids(steps)).toEqual([1, 3, 2]);
    expect(steps.filter((s) => s.jump).map((s) => s.id)).toEqual([3, 2]);
  });

  it('walks a connected street within the priority tolerance and jumps past one outside it', () => {
    const streets = [st(1, [0, 0], [1, 0], 1.0), st(2, [1, 0], [2, 0], 0.5), st(3, [0, 5], [1, 5], 1.0)];
    const tolerant = new WalkPlanner(streets, { ...SETTINGS, priorityTolerance: 0.5 }).plan({ streetId: 1 });
    expect(tolerant.steps[1]).toEqual({ id: 2, reverse: false, jump: false, jumpM: 0 });
    const strict = new WalkPlanner(streets, { ...SETTINGS, priorityTolerance: 0.2 }).plan({ streetId: 1 });
    expect(strict.steps[1]).toMatchObject({ id: 3, jump: true });
    expect(ids(strict.steps)).toEqual([1, 3, 2]);
  });

  it('never reverses a fixedDirection street and enters it only at coords[0]', () => {
    // Street 2 ends where street 1 ends, so continuing onto it would mean walking it backwards.
    const streets = [st(1, [0, 0], [1, 0]), st(2, [1, 2], [1, 0], 1, { fixedDirection: true })];
    const { steps } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(steps[1]).toEqual({ id: 2, reverse: false, jump: true, jumpM: expect.any(Number) });
    expect(steps[1].jumpM).toBeCloseTo(WalkPlanner.distanceM(P(1, 0), P(1, 2)), 6);
  });

  it('walks a loop street as part of the trail through its node', () => {
    const loop = { id: 2, coords: [P(1, 0), P(2, 0), P(2, 1), P(1, 1), P(1, 0)], priority: 1 };
    const streets = [st(1, [0, 0], [1, 0]), loop, st(3, [1, 0], [1, -1])];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expectValidWalk(streets, steps);
    expect(ids(steps)).toEqual([1, 2, 3]);
    expect(stats.jumps).toBe(0);
    expect(stats.lowerBoundJumps).toBe(0);
  });

  it('starts from a free point at the nearest top-tier street, entering at its nearer end', () => {
    const streets = [
      st(1, [0, 1], [0, 3], 1), // ~111 m from the point, near end (0,1).
      st(2, [5, 0], [6, 0], 1), // ~556 m.
      st(3, [0, 0.2], [1, 0.2], 0.3), // Nearest of all, but out of tier.
    ];
    const { steps } = new WalkPlanner(streets, { ...SETTINGS, priorityTolerance: 0.15 }).plan({ from: P(0, 0) });
    expect(steps[0]).toEqual({ id: 1, reverse: false, jump: false, jumpM: 0 });
    const reversed = new WalkPlanner([st(1, [0, 3], [0, 1])], SETTINGS).plan({ from: P(0, 0) });
    expect(reversed.steps[0]).toMatchObject({ id: 1, reverse: true, jump: false });
  });

  it('falls back to the highest-priority street for an unknown streetId with no point', () => {
    const streets = [st(1, [0, 0], [1, 0], 0.5), st(2, [3, 0], [4, 0], 0.9), st(3, [6, 0], [7, 0], 0.9)];
    const { steps } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 999 });
    expect(steps[0]).toEqual({ id: 2, reverse: false, jump: false, jumpM: 0 });
  });

  it('is deterministic, and independent of input order', () => {
    const streets = lattice(6, 7);
    const first = new WalkPlanner(streets, SETTINGS).plan({ streetId: 10 }).steps;
    expect(new WalkPlanner(streets, SETTINGS).plan({ streetId: 10 }).steps).toEqual(first);
    const shuffled = [...streets].sort((a, b) => ((a.id * 7919) % 97) - ((b.id * 7919) % 97));
    expect(shuffled.map((s) => s.id)).not.toEqual(streets.map((s) => s.id));
    expect(new WalkPlanner(shuffled, SETTINGS).plan({ streetId: 10 }).steps).toEqual(first);
  });

  it('sets reverse flags that make every connected step start where the previous one ended', () => {
    [2, 3, 5, 11].forEach((seed) => {
      const streets = lattice(7, seed).map((s) => ({ ...s, priority: [1, 0.67, 0.5, 0.44][s.id % 4] }));
      const { steps } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
      expectValidWalk(streets, steps);
    });
  });

  it('reports hand-checkable stats', () => {
    // A path A-B-C, then a separate street D-E one step north of C: one jump of one step, one dead end at C.
    const streets = [st(1, [0, 0], [1, 0]), st(2, [1, 0], [2, 0]), st(3, [2, 1], [3, 1])];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    const oneStep = WalkPlanner.distanceM(P(0, 0), P(1, 0));
    expect(ids(steps)).toEqual([1, 2, 3]);
    expect(stats.streets).toBe(3);
    expect(stats.totalM).toBeCloseTo(3 * oneStep, 6);
    expect(stats.jumps).toBe(1);
    expect(stats.jumpM).toBeCloseTo(WalkPlanner.distanceM(P(2, 0), P(2, 1)), 6);
    expect(stats.medianJumpM).toBeCloseTo(stats.jumpM, 6);
    expect(stats.deadEnds).toBe(1);
    expect(stats.lowerBoundJumps).toBe(1);
    expect(stats.ms).toBeGreaterThanOrEqual(0);
  });

  it('computes the jump lower bound from components and odd nodes', () => {
    const square = (dx, id0) => [
      st(id0, [dx, 0], [dx + 1, 0]), st(id0 + 1, [dx + 1, 0], [dx + 1, 1]),
      st(id0 + 2, [dx + 1, 1], [dx, 1]), st(id0 + 3, [dx, 1], [dx, 0]),
    ];
    const star = [st(20, [10, 0], [11, 0]), st(21, [10, 0], [9, 0]), st(22, [10, 0], [10, 1])];
    expect(WalkPlanner.lowerBoundJumps([])).toBe(0);
    expect(WalkPlanner.lowerBoundJumps(square(0, 1))).toBe(0);
    expect(WalkPlanner.lowerBoundJumps([...square(0, 1), ...square(3, 5)])).toBe(1);
    expect(WalkPlanner.lowerBoundJumps(star)).toBe(1); // Four odd nodes: two trails.
    // Direction and length don't enter the bound.
    expect(WalkPlanner.lowerBoundJumps(star.map((s) => ({ ...s, fixedDirection: true })))).toBe(1);
  });

  it('merges endpoints within the node tolerance', () => {
    const nearlyB = [P(1, 0)[0] + 5 / 111195, 0];
    const streets = [st(1, [0, 0], [1, 0]), { id: 2, coords: [nearlyB, P(2, 0)], priority: 1 }];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(steps[1]).toEqual({ id: 2, reverse: false, jump: false, jumpM: 0 });
    expect(stats.lowerBoundJumps).toBe(0);
  });

  it('rides a realistic 15 m sliver to its new node and on, before a real street at the same node', () => {
    // The sliver B→S is longer than the node tolerance, so S is its own node, and street 3 continues from S. Both
    // candidates at B are bridges (dead ends beyond), so tininess decides, and the trail follows the sliver onward.
    const s = [P(1, 0)[0] + 15 / 111195, 0];
    const streets = [
      st(1, [0, 0], [1, 0]),
      { id: 2, coords: [P(1, 0), s], priority: 0.1 },
      { id: 3, coords: [s, P(2, 0)], priority: 1 },
      st(4, [1, 0], [1, 1]),
    ];
    const { steps } = new WalkPlanner(streets, { ...SETTINGS, priorityTolerance: 0.2 }).plan({ streetId: 1 });
    expectValidWalk(streets, steps);
    expect(steps.map(({ id, reverse, jump }) => ({ id, reverse, jump }))).toEqual([
      { id: 1, reverse: false, jump: false },
      { id: 2, reverse: false, jump: false },
      { id: 3, reverse: false, jump: false },
      { id: 4, reverse: false, jump: true },
    ]);
  });

  it('closes a block before taking a tiny dead-end spur, meeting a lower bound of 0', () => {
    // A street E→A leads into the square A-B-C-D; a 12 m spur hangs off A. The odd nodes are E and the spur's tip, so
    // one trail covers it all, but only if the spur (a bridge) waits until the block is closed.
    const tip = [P(1, 1)[0] - 12 / 111195, P(1, 1)[1]];
    const streets = [
      st(1, [1, 2], [1, 1]), // E→A.
      { id: 2, coords: [P(1, 1), tip], priority: 1 }, // The spur, lowest id among A's streets.
      st(3, [1, 1], [2, 1]),
      st(4, [2, 1], [2, 0]),
      st(5, [2, 0], [1, 0]),
      st(6, [1, 0], [1, 1]),
    ];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expectValidWalk(streets, steps);
    expect(stats.lowerBoundJumps).toBe(0);
    expect(stats.jumps).toBe(0);
    expect(ids(steps)[ids(steps).length - 1]).toBe(2);
  });

  it('reports the median of an even number of jumps as the mean of the middle two', () => {
    const streets = [st(1, [0, 0], [1, 0]), st(2, [2, 0], [3, 0]), st(3, [5, 0], [6, 0])];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(ids(steps)).toEqual([1, 2, 3]);
    const oneStep = WalkPlanner.distanceM(P(1, 0), P(2, 0));
    const twoSteps = WalkPlanner.distanceM(P(3, 0), P(5, 0));
    expect(stats.jumps).toBe(2);
    expect(stats.medianJumpM).toBeCloseTo((oneStep + twoSteps) / 2, 6);
    expect(stats.deadEnds).toBe(2);
    expect(stats.forcedJumps).toBe(0);
  });

  it('does not treat two parallel streets between the same nodes as bridges', () => {
    // At A: a dead end A→Y (lowest id, a bridge) and two parallel streets A→B (neither is a bridge).
    const streets = [
      st(1, [0, 0], [1, 0]),
      st(2, [1, 0], [1, -1]),
      st(3, [1, 0], [2, 0]),
      { id: 4, coords: [P(1, 0), P(1.5, 0.5), P(2, 0)], priority: 1 },
    ];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expectValidWalk(streets, steps);
    expect(ids(steps)).toEqual([1, 3, 4, 2]);
    expect(stats.jumps).toBe(0);
  });

  it('drops streets with fewer than two coordinates, also as the start street', () => {
    const streets = [
      st(1, [0, 0], [1, 0], 0.5),
      { id: 2, coords: [P(3, 0)], priority: 1 },
      { id: 3, coords: [], priority: 1 },
      { id: 4, priority: 1 },
      st(5, [1, 0], [2, 0], 0.9),
    ];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 2 });
    expect(ids(steps)).toEqual([5, 1]); // Falls back to the highest-priority usable street.
    expect(stats.streets).toBe(2);
    expect(WalkPlanner.lowerBoundJumps(streets)).toBe(0);
  });

  it('keeps only the first occurrence of a repeated id', () => {
    const streets = [st(1, [0, 0], [1, 0]), st(2, [1, 0], [2, 0]), st(2, [5, 5], [6, 5])];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(steps).toEqual([
      { id: 1, reverse: false, jump: false, jumpM: 0 },
      { id: 2, reverse: false, jump: false, jumpM: 0 },
    ]);
    expect(stats.lowerBoundJumps).toBe(0);
  });

  it('treats a missing or non-finite priority as 0: still walked, last, and never holding a tier open', () => {
    const streets = [
      st(1, [0, 0], [1, 0], 1),
      st(2, [1, 0], [2, 0], NaN),
      { id: 3, coords: [P(1, 0), P(1, 1)] },
      st(4, [5, 0], [6, 0], 0.9),
    ];
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expectValidWalk(streets, steps);
    expect(ids(steps).slice(0, 2)).toEqual([1, 4]); // Both unset streets are out of tier while street 4 remains.
    expect(ids(steps).slice(2).sort()).toEqual([2, 3]);
    expect(stats.forcedJumps).toBe(1);
  });

  it('keeps exactly coincident endpoints in one node even with a rival node nearby', () => {
    // Street 2 ends exactly where street 4 starts, at X. The decoys end 8 m east (R1, created first) and 8 m west (R2)
    // of X, 16 m apart, so both are nodes within tolerance of X; X must still be one node for streets 2 and 4.
    const x = P(1, 0);
    const r1 = [x[0] + 8 / 111195, 0];
    const r2 = [x[0] - 8 / 111195, 0];
    const streets = [
      { id: 1, coords: [P(1, 1), r1], priority: 0.5 },
      { id: 2, coords: [P(0, 0), x], priority: 1 },
      { id: 3, coords: [P(1, -1), r2], priority: 0.5 },
      { id: 4, coords: [x, P(2, 0)], priority: 1 },
    ];
    const { steps } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 2 });
    expectValidWalk(streets, steps);
    expect(steps[1]).toEqual({ id: 4, reverse: false, jump: false, jumpM: 0 });
  });

  it('merges an endpoint into the nearest node within tolerance, not the first one scanned', () => {
    // Y is 9 m from R2 (west, scanned first) and 3 m from R1 (east).
    const r1 = [P(1, 0)[0] + 6 / 111195, 0];
    const r2 = [P(1, 0)[0] - 6 / 111195, 0];
    const y = [P(1, 0)[0] + 3 / 111195, 0];
    const streets = [
      { id: 1, coords: [P(1, 1), r1], priority: 1 },
      { id: 2, coords: [P(1, -1), r2], priority: 1 },
      { id: 3, coords: [y, P(2, 0)], priority: 1 },
    ];
    const { steps } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    expect(steps[1]).toEqual({ id: 3, reverse: false, jump: false, jumpM: 0 });
  });

  it('plans the same walk however the streets are oriented', () => {
    [2, 5, 11].forEach((seed) => {
      const streets = lattice(7, seed).map((s) => ({ ...s, priority: [1, 0.9, 0.8, 0.95][s.id % 4] }));
      const { steps } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
      const byId = new Map(streets.map((s) => [s.id, s]));
      // Re-orient every street the way the plan walks it, as Explore's replan sees geometry after a switch.
      const walkedOrientation = steps.map(({ id, reverse }) => {
        const s = byId.get(id);
        return reverse ? { ...s, coords: [...s.coords].reverse() } : s;
      });
      const replan = new WalkPlanner(walkedOrientation, SETTINGS).plan({ streetId: 1 }).steps;
      expect(ids(replan)).toEqual(ids(steps));
      expect(replan.every((s) => !s.reverse)).toBe(true);
      expect(replan.map((s) => [s.jump, s.jumpM])).toEqual(steps.map((s) => [s.jump, s.jumpM]));
      // And under an arbitrary flip of every street but the start, the physical walk is unchanged.
      const startOf = (list, plan) => {
        const m = new Map(list.map((s) => [s.id, s]));
        return plan.map(({ id, reverse }) => {
          const c = m.get(id).coords;
          return reverse ? c[c.length - 1] : c[0];
        });
      };
      const flipped = streets.map((s) => (s.id === 1 || s.id % 3 !== 0
        ? s
        : { ...s, coords: [...s.coords].reverse() }));
      const flippedPlan = new WalkPlanner(flipped, SETTINGS).plan({ streetId: 1 }).steps;
      expect(ids(flippedPlan)).toEqual(ids(steps));
      expect(startOf(flipped, flippedPlan)).toEqual(startOf(streets, steps));
    });
  });

  it('breaks an exact tie between a jump target\'s two ends the same way however the street is stored', () => {
    // Both ends of street 2 are odd and equally far from the end of street 1, so only a canonical rule can choose.
    const forward = [st(1, [0, 0], [1, 0]), st(2, [2, 1], [2, -1])];
    const backward = [st(1, [0, 0], [1, 0]), st(2, [2, -1], [2, 1])];
    const a = new WalkPlanner(forward, SETTINGS).plan({ streetId: 1 }).steps[1];
    const b = new WalkPlanner(backward, SETTINGS).plan({ streetId: 1 }).steps[1];
    expect(a).toMatchObject({ id: 2, reverse: true, jump: true }); // Enters at (2,-1), the canonical start.
    expect(b).toMatchObject({ id: 2, reverse: false, jump: true });
    expect(b.jumpM).toBe(a.jumpM);
  });

  it('plans a 1,200-street lattice in under 500 ms', () => {
    const streets = lattice(25, 3);
    expect(streets).toHaveLength(1200);
    const t0 = performance.now();
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    const elapsed = performance.now() - t0;
    expect(steps).toHaveLength(1200);
    expect(stats.jumps).toBeLessThanOrEqual(stats.lowerBoundJumps + 2);
    expect(elapsed).toBeLessThan(500);
  });

  it('plans a 1,800-street comb of dead-end teeth in under 500 ms', () => {
    // A 600-street spine with a dead-end tooth on each side of every spine node: every tooth is a bridge and the
    // tier is the whole region, the shape that makes bridge searches and jump scans grow with the street count.
    const streets = [];
    let id = 1;
    for (let x = 0; x < 600; x++) {
      streets.push(st(id++, [x, 0], [x + 1, 0]), st(id++, [x, 0], [x, 1]), st(id++, [x, 0], [x, -1]));
    }
    const t0 = performance.now();
    const { steps, stats } = new WalkPlanner(streets, SETTINGS).plan({ streetId: 1 });
    const elapsed = performance.now() - t0;
    expect(steps).toHaveLength(1800);
    expect(stats.jumps).toBeLessThanOrEqual(stats.lowerBoundJumps + 1);
    expect(elapsed).toBeLessThan(500);
  });
});
