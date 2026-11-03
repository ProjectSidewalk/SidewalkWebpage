/**
 * Tests for frontend/js/report/stitchProfile.js: one chart's line from a street's edges, which arrive in any order and
 * direction, sometimes with gaps.
 */

import { describe, expect, test } from 'vitest';
import { stitchProfile } from '../../frontend/js/report/stitchProfile.js';

// Each stretch is 0.001° of longitude, about 75 m here; the sampled length is what the chart counts.
const edge = (fromLng, toLng, elevations, extra = {}) => ({
  coordinates: [[fromLng, 47.6], [toLng, 47.6]],
  response: { profile: { spacing_meters: 10, elevations_meters: elevations }, ...extra },
});

describe('stitchProfile', () => {
  test('has nothing to draw when no edge has a shape', () => {
    expect(stitchProfile([])).toBeNull();
    expect(stitchProfile([{ coordinates: [[0, 0], [1, 1]], response: { profile: null } }])).toBeNull();
    expect(stitchProfile([edge(0, 1, [5])])).toBeNull();
  });

  test('passes one edge through as it is', () => {
    const { profile } = stitchProfile([edge(-122.33, -122.329, [1, 2, 3])]);
    expect(profile.spacing_meters).toBe(10);
    expect(profile.elevations_meters).toEqual([1, 2, 3]);
  });

  test('joins edges given out of order', () => {
    const { profile } = stitchProfile([
      edge(-122.329, -122.328, [3, 4, 5]),
      edge(-122.33, -122.329, [1, 2, 3]),
    ]);
    expect(profile.elevations_meters).toEqual([1, 2, 3, 4, 5]);
  });

  test('turns an edge digitized the other way, so its hill runs the same direction', () => {
    const { profile } = stitchProfile([
      edge(-122.33, -122.329, [1, 2, 3]),
      edge(-122.328, -122.329, [5, 4, 3]),
    ]);
    expect(profile.elevations_meters).toEqual([1, 2, 3, 4, 5]);
  });

  test('draws the longest run when a gap leaves more than one', () => {
    const { profile } = stitchProfile([
      edge(-122.33, -122.329, [9, 9]),
      edge(-122.32, -122.319, [1, 2, 3]),
      edge(-122.319, -122.318, [3, 4, 5]),
    ]);
    expect(profile.elevations_meters).toEqual([1, 2, 3, 4, 5]);
  });

  test('leaves out an edge with no profile and draws what still connects', () => {
    const { profile } = stitchProfile([
      edge(-122.33, -122.329, [1, 2]),
      { coordinates: [[-122.329, 47.6], [-122.328, 47.6]], response: { profile: null } },
      edge(-122.32, -122.319, [7, 8, 9]),
    ]);
    expect(profile.elevations_meters).toEqual([7, 8, 9]);
  });

  test('evens out edges sampled at different spacings', () => {
    const coarse = edge(-122.329, -122.328, [3, 5]);
    coarse.response.profile.spacing_meters = 20;
    const { profile } = stitchProfile([edge(-122.33, -122.329, [1, 2, 3]), coarse]);
    expect(profile.spacing_meters).toBe(10);
    expect(profile.elevations_meters).toEqual([1, 2, 3, 4, 5]);
  });

  test('places the steepest stretch of any edge, along the joined line', () => {
    const steep = { max_grade: 0.09, max_grade_from_meters: 0, max_grade_to_meters: 10 };
    const gentle = { max_grade: 0.02, max_grade_from_meters: 0, max_grade_to_meters: 10 };
    const { steepest } = stitchProfile([
      edge(-122.33, -122.329, [1, 1, 1], gentle),
      edge(-122.329, -122.328, [1, 2, 3], steep),
    ]);
    expect(steepest).toEqual({ from: 20, to: 30, grade: 0.09 });
  });

  test('mirrors the steepest stretch of a turned edge', () => {
    const steep = { max_grade: 0.09, max_grade_from_meters: 0, max_grade_to_meters: 10 };
    const { steepest } = stitchProfile([
      edge(-122.33, -122.329, [1, 1, 1]),
      edge(-122.328, -122.329, [3, 2, 1], steep),
    ]);
    expect(steepest).toEqual({ from: 30, to: 40, grade: 0.09 });
  });

  test('ignores the stretch of a stale edge, placed along geometry it no longer has', () => {
    const stale = { max_grade: 0.09, max_grade_from_meters: 0, max_grade_to_meters: 10, stale: true };
    expect(stitchProfile([edge(-122.33, -122.329, [1, 2, 3], stale)]).steepest).toBeNull();
  });

  test('carries places across though sampled length and drawn geometry differ', () => {
    const { lngLatAt, metersAt } = stitchProfile([edge(-122.33, -122.328, [1, 2, 3])]);
    expect(metersAt([-122.329, 47.6])).toBeCloseTo(10, 1);
    expect(lngLatAt(20)[0]).toBeCloseTo(-122.328, 5);
    expect(lngLatAt(10)[0]).toBeCloseTo(-122.329, 5);
  });
});
