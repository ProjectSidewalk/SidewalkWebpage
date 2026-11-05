/**
 * One street's elevation profile, from the edges it's made of. A report's street usually spans several edges while
 * `/v3/api/streetGrade` answers per edge, each in its own digitized direction and in no useful order, and the chart
 * expects one line of evenly spaced samples. A way with a gap, or an edge with no profile, leaves more than one run of
 * connected edges; this draws the longest.
 */

import { along, length, lineString, nearestPointOnLine, point } from '@turf/turf';

/**
 * @typedef {object} ReportProfileEdge
 * @property {number[][]} coordinates - The edge's `[lng, lat]`s, in its digitized direction.
 * @property {import('../common/AccessScoreElevationProfile.js').AccessScoreProfileResponse} response - Its answer.
 *
 * @typedef {object} ReportStitchedProfile
 * @property {import('../common/AccessScoreElevationProfile.js').AccessScoreProfile} profile - One evenly spaced line.
 * @property {?{from: number, to: number, grade: number}} steepest - The steepest stretch of any edge, along the line.
 * @property {(meters: number) => number[]} lngLatAt - Where a distance along the profile falls on the map.
 * @property {(lngLat: number[]) => number} metersAt - How far along the profile a place falls.
 */

/** Two edges meet where their endpoints print alike, which the page's rounded coordinates make exact. */
const key = ([lng, lat]) => `${lng},${lat}`;

/**
 * @param {ReportProfileEdge} edge
 * @returns {number} Its profile's length, in meters.
 */
const profileLength = ({ response: { profile } }) => (profile.elevations_meters.length - 1) * profile.spacing_meters;

/**
 * Walks connected edges into runs, turning each to face the way the run travels.
 * @param {ReportProfileEdge[]} edges
 * @returns {Array<Array<{edge: ReportProfileEdge, reversed: boolean}>>} The runs.
 */
function runsOf(edges) {
  const unused = new Set(edges);
  const runs = [];
  const start = ({ edge, reversed }) => key(reversed ? edge.coordinates.at(-1) : edge.coordinates[0]);
  const end = ({ edge, reversed }) => key(reversed ? edge.coordinates[0] : edge.coordinates.at(-1));

  for (const first of edges) {
    if (!unused.has(first)) continue;
    unused.delete(first);
    const run = [{ edge: first, reversed: false }];
    let extended = true;
    while (extended) {
      extended = false;
      for (const edge of unused) {
        const forward = { edge, reversed: false };
        const backward = { edge, reversed: true };
        const after = [forward, backward].find((step) => start(step) === end(run.at(-1)));
        const before = [forward, backward].find((step) => end(step) === start(run[0]));
        if (after) run.push(after);
        else if (before) run.unshift(before);
        else continue;
        unused.delete(edge);
        extended = true;
        break;
      }
    }
    runs.push(run);
  }
  return runs;
}

/**
 * @param {number[]} distances - Ascending positions of the samples.
 * @param {number[]} values - The sample at each.
 * @param {number} at - A position within them.
 * @returns {number} The line between the samples either side of it.
 */
function interpolate(distances, values, at) {
  let i = 1;
  while (i < distances.length - 1 && distances[i] < at) i += 1;
  const span = distances[i] - distances[i - 1];
  const t = span > 0 ? (at - distances[i - 1]) / span : 0;
  return values[i - 1] + (values[i] - values[i - 1]) * t;
}

/**
 * @param {ReportProfileEdge[]} edges - The street's edges, in any order and direction. Those with no drawable profile
 *   are simply not part of a run.
 * @returns {?ReportStitchedProfile} The longest run as one profile, or null when no edge has a shape to draw.
 */
export function stitchProfile(edges) {
  const drawable = edges.filter(({ response }) => (response?.profile?.elevations_meters?.length ?? 0) >= 2
    && response.profile.spacing_meters > 0);
  if (drawable.length === 0) return null;

  const totalOf = (run) => run.reduce((sum, { edge }) => sum + profileLength(edge), 0);
  const run = runsOf(drawable).reduce((best, next) => (totalOf(next) > totalOf(best) ? next : best));

  const distances = [];
  const values = [];
  const path = [];
  /** @type {?{from: number, to: number, grade: number}} */
  let steepest = null;
  let offset = 0;
  for (const { edge, reversed } of run) {
    const { profile, max_grade: grade, max_grade_from_meters: from, max_grade_to_meters: to, stale } = edge.response;
    const edgeLength = profileLength(edge);
    const samples = reversed ? [...profile.elevations_meters].reverse() : profile.elevations_meters;
    samples.forEach((z, i) => {
      // A joint's two samples sit at one position; keeping the later one leaves the positions ascending.
      const at = offset + i * profile.spacing_meters;
      if (distances.at(-1) === at) {
        values[values.length - 1] = z;
      } else {
        distances.push(at);
        values.push(z);
      }
    });
    const line = reversed ? [...edge.coordinates].reverse() : edge.coordinates;
    path.push(...(path.length ? line.slice(1) : line));
    // A stale edge's stretch was placed along the geometry it used to have.
    if (!stale && [grade, from, to].every(Number.isFinite) && grade > (steepest?.grade ?? -Infinity)) {
      steepest = reversed
        ? { from: offset + edgeLength - to, to: offset + edgeLength - from, grade }
        : { from: offset + from, to: offset + to, grade };
    }
    offset += edgeLength;
  }

  const spacing = run[0].edge.response.profile.spacing_meters;
  const stretches = Math.max(1, Math.round(offset / spacing));
  const step = offset / stretches;
  const profile = {
    spacing_meters: step,
    elevations_meters: Array.from({ length: stretches + 1 }, (_, i) => interpolate(distances, values, i * step)),
  };

  // The sampled length and the drawn geometry differ by a little, so positions are carried across as proportions.
  const line = lineString(path);
  const lineMeters = length(line, { units: 'meters' });
  const scale = lineMeters > 0 ? offset / lineMeters : 1;
  return {
    profile,
    steepest,
    lngLatAt: (meters) => along(line, meters / scale, { units: 'meters' }).geometry.coordinates,
    metersAt: (lngLat) => nearestPointOnLine(line, point(lngLat), { units: 'meters' }).properties.location * scale,
  };
}
