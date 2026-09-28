#!/usr/bin/env node
// Replays next-street policies over every region of the exported dev cities and compares their walks (#5526).
// Definitions of every metric are in README.md; run export.sh first.
//
// Usage: node tools/experiments/5526-mission-walk-planner/replay.mjs [--seeds 5] [--city seattle] [--region 16]
//                                                                    [--out results.md]

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
// The real module, not a copy: the benchmark is only evidence for the code that ships if it runs that code.
const WalkPlanner = vm.runInThisContext(
  `${fs.readFileSync(path.join(ROOT, 'public/js/common/WalkPlanner.js'), 'utf8')}\nWalkPlanner;`
);

// Explore's own thresholds (Main.js): connected within 25 m, "near the route" within 1.5 × 50 m.
const CONNECTED_M = 25;
const NEARBY_LINE_M = 75;
const CONNECT_RADII_M = [5, 10, 25];
// The yardstick for every policy: a step whose start is more than this from the previous end is a jump. It is the
// planner's node tolerance, so the jump lower bound (computed on that node graph) is comparable.
const JUMP_GAP_M = WalkPlanner.NODE_TOLERANCE_M;

const args = parseArgs(process.argv.slice(2));
const SEEDS = Number(args.seeds ?? 5);
const CITIES = args.city ? [args.city] : ['seattle', 'teaneck', 'richmond'];
const OUT = args.out ?? path.join(HERE, 'results.md');

const POLICIES = [
  { name: 'current', run: (r, s) => runCurrent(r, s, { filter: 'bucket', jump: 'first' }) },
  { name: 'current+nearest', run: (r, s) => runCurrent(r, s, { filter: 'bucket', jump: 'nearest' }) },
  ...[0.25, 0.5, 1.0].map((tol) => ({
    name: `tolerant tol=${tol}`,
    run: (r, s) => runCurrent(r, s, { filter: 'tolerance', tol, jump: 'first' }),
  })),
  ...[0.05, 0.1, 0.15, 0.2, 0.25, 0.5, 1.0].flatMap((tol) => [0, 300, 1000].map((pen) => ({
    name: `planner tol=${tol} pen=${pen}`,
    run: (r, s) => runPlanner(r, s, { priorityTolerance: tol, oddStartPenaltyM: pen }),
  }))),
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

/** Deterministic PRNG so a rerun draws the same starts. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = WalkPlanner.distanceM;
const first = (s) => s.coords[0];
const last = (s) => s.coords[s.coords.length - 1];

/** Metres from a point to a polyline, in a local equirectangular frame (fine at street scale). */
function pointToLineM(p, coords) {
  const kx = Math.cos((p[1] * Math.PI) / 180) * 111320;
  const ky = 110540;
  let best = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1][0] - p[0]) * kx;
    const ay = (coords[i - 1][1] - p[1]) * ky;
    const bx = (coords[i][0] - p[0]) * kx;
    const by = (coords[i][1] - p[1]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** A grid of street endpoints so "which streets end within 25 m of here" is not a scan of the region. */
class EndpointGrid {
  static CELL = 0.0005; // ~55 m N-S, ≥ 38 m E-W at these latitudes: ±1 cell covers 25 m.

  constructor(streets) {
    this.cells = new Map();
    streets.forEach((s, i) => {
      for (const c of [first(s), last(s)]) {
        const k = this.key(Math.floor(c[0] / EndpointGrid.CELL), Math.floor(c[1] / EndpointGrid.CELL));
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(i);
      }
    });
  }

  key(x, y) {
    return `${x},${y}`;
  }

  /** Street indices with an endpoint strictly within radiusM of p, ascending (= server order), deduplicated. */
  near(p, radiusM, streets, keep) {
    const cx = Math.floor(p[0] / EndpointGrid.CELL);
    const cy = Math.floor(p[1] / EndpointGrid.CELL);
    const hits = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of this.cells.get(this.key(cx + dx, cy + dy)) ?? []) {
          if (hits.has(i) || !keep(i)) continue;
          const s = streets[i];
          if (dist(p, first(s)) < radiusM || dist(p, last(s)) < radiusM) hits.add(i);
        }
      }
    }
    return [...hits].sort((a, b) => a - b);
  }
}

const bucket = (p) => Math.min(Math.floor(p / 0.25), 3);

/**
 * Today's TaskContainer.nextTask for a region walk, and its variants. The first street is the caller's (server
 * rule); every later pick follows the client rule, including its two orientation rules.
 */
function runCurrent(region, startIndex, { filter, tol = 0, jump }) {
  const { streets, grid, byPriority } = region;
  const n = streets.length;
  const walked = new Uint8Array(n);
  const reversed = new Uint8Array(n);
  const endOf = (i) => (reversed[i] ? first(streets[i]) : last(streets[i]));
  const steps = [{ index: startIndex, reverse: false }];
  walked[startIndex] = 1;
  let finished = startIndex;
  let ptr = 0;
  for (let remaining = n - 1; remaining > 0; remaining--) {
    while (walked[byPriority[ptr]]) ptr++;
    const highest = byPriority[ptr];
    const bestP = streets[highest].priority;
    const endF = endOf(finished);

    let connected = [];
    for (const r of CONNECT_RADII_M) {
      connected = grid.near(endF, r, streets, (i) => !walked[i]);
      if (connected.length > 0) break;
    }
    const keep = filter === 'bucket'
      ? (i) => bucket(streets[i].priority) === bucket(bestP)
      : (i) => streets[i].priority >= bestP - tol - 1e-9;
    // Array.sort is stable, so equal priorities stay in server (id) order, as in the real code.
    connected = connected.filter(keep).sort((a, b) => streets[b].priority - streets[a].priority);

    let next;
    let isConnected;
    if (connected.length > 0) {
      next = connected[0];
      isConnected = true;
    } else {
      isConnected = false;
      next = highest;
      if (jump === 'nearest') {
        let bestD = Infinity;
        for (let k = ptr; k < n && streets[byPriority[k]].priority === bestP; k++) {
          const i = byPriority[k];
          if (walked[i]) continue;
          const d = Math.min(dist(endF, first(streets[i])), dist(endF, last(streets[i])));
          if (d < bestD || (d === bestD && i < next)) {
            bestD = d;
            next = i;
          }
        }
      }
    }

    const coords = streets[next].coords;
    if (isConnected || pointToLineM(endF, coords) < NEARBY_LINE_M) {
      if (dist(last(streets[next]), endF) < dist(first(streets[next]), endF)) reversed[next] ^= 1;
    } else if (grid.near(endOf(next), CONNECTED_M, streets, (i) => !walked[i] && i !== next).length === 0) {
      // Faithful to the real code: this toggles rather than sets, and the street was in its default orientation.
      reversed[next] ^= 1;
    }
    walked[next] = 1;
    steps.push({ index: next, reverse: reversed[next] === 1 });
    finished = next;
  }
  return steps;
}

function runPlanner(region, startIndex, options) {
  const { steps } = new WalkPlanner(region.plannerInput, options).plan({ streetId: region.streets[startIndex].id });
  return steps.map((s) => ({ index: region.indexById.get(s.id), reverse: s.reverse }));
}

/** Area under cumulative-priority-mass vs cumulative-metres for a walk order. */
function rawAuc(order, streets, totalM, totalMass) {
  let x = 0;
  let y = 0;
  let area = 0;
  for (const i of order) {
    const dx = streets[i].lengthM / totalM;
    const dy = (streets[i].lengthM * streets[i].priority) / totalMass;
    area += dx * (y + y + dy) / 2;
    x += dx;
    y += dy;
  }
  return area;
}

/** Uniform metrics for any walk, so every policy is judged by one yardstick (README "Definitions"). */
function measure(region, steps) {
  const { streets, grid, totalM, totalMass, aucMin, aucMax } = region;
  const walkedAt = new Int32Array(streets.length).fill(-1);
  steps.forEach((s, k) => { walkedAt[s.index] = k; });
  if (steps.length !== streets.length || walkedAt.some((k) => k < 0)) throw new Error('walk does not cover region');
  const jumps = [];
  let deadEnds = 0;
  let prevEnd = null;
  steps.forEach((step, k) => {
    const s = streets[step.index];
    const start = step.reverse ? last(s) : first(s);
    const end = step.reverse ? first(s) : last(s);
    if (prevEnd) {
      const gap = dist(prevEnd, start);
      if (gap > JUMP_GAP_M) jumps.push(gap);
    }
    if (k < steps.length - 1 && grid.near(end, JUMP_GAP_M, streets, (i) => walkedAt[i] > k).length === 0) deadEnds++;
    prevEnd = end;
  });
  const auc = aucMax - aucMin < 1e-12 ? NaN
    : (rawAuc(steps.map((s) => s.index), streets, totalM, totalMass) - aucMin) / (aucMax - aucMin);
  return { jumps, deadEnds, auc };
}

function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function prepareRegion(streets) {
  streets.sort((a, b) => a.id - b.id);
  const byPriority = streets.map((_, i) => i).sort((i, j) => streets[j].priority - streets[i].priority || i - j);
  const totalM = streets.reduce((t, s) => t + s.lengthM, 0);
  const totalMass = streets.reduce((t, s) => t + s.lengthM * s.priority, 0);
  const plannerInput = streets.map((s) => ({ id: s.id, coords: s.coords, priority: s.priority, lengthM: s.lengthM }));
  return {
    streets,
    byPriority,
    grid: new EndpointGrid(streets),
    indexById: new Map(streets.map((s, i) => [s.id, i])),
    plannerInput,
    totalM,
    totalMass,
    aucMax: rawAuc(byPriority, streets, totalM, totalMass),
    aucMin: rawAuc([...byPriority].reverse(), streets, totalM, totalMass),
    lowerBound: WalkPlanner.lowerBoundJumps(plannerInput),
  };
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');

const report = [];
const t0 = Date.now();
for (const city of CITIES) {
  const file = path.join(HERE, 'data', `${city}.json`);
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}; run export.sh first`);
    process.exit(1);
  }
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byRegion = new Map();
  for (const s of all) {
    if (args.region && String(s.regionId) !== String(args.region)) continue;
    if (!byRegion.has(s.regionId)) byRegion.set(s.regionId, []);
    byRegion.get(s.regionId).push(s);
  }

  const perPolicy = new Map(POLICIES.map((p) => [p.name, { regions: [], jumpPool: [] }]));
  let cityKm = 0;
  let cityLb = 0;
  let largest = { n: 0, ms: 0 };
  for (const [regionId, streets] of [...byRegion.entries()].sort((a, b) => a[0] - b[0])) {
    const region = prepareRegion(streets);
    const km = region.totalM / 1000;
    cityKm += km;
    cityLb += region.lowerBound;
    const bestP = streets[region.byPriority[0]].priority;
    const topTier = region.byPriority.filter((i) => streets[i].priority === bestP);
    const starts = Array.from({ length: SEEDS }, (_, seed) => {
      const rand = mulberry32(seed * 100003 + regionId);
      return topTier[Math.floor(rand() * topTier.length)];
    });
    if (streets.length > largest.n) {
      const planner = new WalkPlanner(region.plannerInput);
      planner.plan({ streetId: streets[starts[0]].id }); // Warm the JIT before timing.
      const reps = 10;
      const tp = performance.now();
      for (let r = 0; r < reps; r++) planner.plan({ streetId: streets[starts[r % SEEDS]].id });
      largest = { n: streets.length, ms: (performance.now() - tp) / reps, regionId };
    }
    for (const policy of POLICIES) {
      const seedRows = starts.map((start) => measure(region, policy.run(region, start)));
      const agg = perPolicy.get(policy.name);
      for (const row of seedRows) agg.jumpPool.push(...row.jumps);
      const mean = (f) => seedRows.reduce((t, r) => t + f(r), 0) / seedRows.length;
      agg.regions.push({
        km,
        lb: region.lowerBound,
        jumps: mean((r) => r.jumps.length),
        jumpM: mean((r) => r.jumps.reduce((t, d) => t + d, 0)),
        deadEnds: mean((r) => r.deadEnds),
        auc: mean((r) => r.auc),
      });
    }
  }

  const lines = [];
  lines.push(`### ${city}`, '');
  lines.push(`${byRegion.size} regions, ${all.filter((s) => !args.region || String(s.regionId) === String(args.region))
    .length} streets, ${fmt(cityKm, 1)} km; jump lower bound ${cityLb} (${fmt(cityLb / cityKm)} per km). `
    + `Largest region ${largest.regionId} (${largest.n} streets) plans in ${fmt(largest.ms, 1)} ms.`, '');
  lines.push('| Policy | jumps/km | jumps/km (median region) | median jump m | jump m per km | dead ends/km '
    + '| priority-AUC | priority-AUC (median region) | jumps / lower bound |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const policy of POLICIES) {
    const { regions, jumpPool } = perPolicy.get(policy.name);
    const sum = (f) => regions.reduce((t, r) => t + f(r), 0);
    const withAuc = regions.filter((r) => Number.isFinite(r.auc));
    const aucW = withAuc.reduce((t, r) => t + r.auc * r.km, 0) / withAuc.reduce((t, r) => t + r.km, 0);
    const cells = [
      policy.name,
      fmt(sum((r) => r.jumps) / cityKm),
      fmt(median(regions.map((r) => r.jumps / r.km))),
      fmt(median(jumpPool), 0),
      fmt(sum((r) => r.jumpM) / cityKm, 0),
      fmt(sum((r) => r.deadEnds) / cityKm),
      fmt(aucW, 3),
      fmt(median(regions.map((r) => r.auc)), 3),
      fmt(sum((r) => r.jumps) / Math.max(1, sum((r) => r.lb))),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  console.log(lines.join('\n'));
  report.push(...lines);
}
report.push(`_${SEEDS} seeds per region; ${((Date.now() - t0) / 1000).toFixed(0)} s total._`, '');
console.log(report[report.length - 2]);
if (!args.city && !args.region) fs.writeFileSync(OUT, `${report.join('\n')}`);
