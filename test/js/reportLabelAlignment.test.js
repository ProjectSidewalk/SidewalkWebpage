/**
 * Tests for frontend/js/report/ReportLabelAlignment.js, the geometry behind the report's aligned-labels view (#5888).
 * No map is involved, so what's pinned is the arithmetic a browser QA can't check by eye: that a label lands at the
 * foot of its own position on the street, on the side the database gave it, that the sideways offset is in screen
 * pixels with the screen's y pointing down, and that markers sharing a line are spread apart and no further.
 */

import { describe, expect, test } from 'vitest';
import {
  alignLocations, localFrame, markerOffsets, projectOntoPolyline, sideNormal, spreadAlong,
} from '../../frontend/js/report/ReportLabelAlignment.js';

// About 111 km per degree of latitude; at 47.6° a degree of longitude is about 75 km.
const ORIGIN = [-122.33, 47.6];
// An eastbound street 1 km long, then a northbound one from its end.
const EAST = [[-122.33, 47.6], [-122.3167, 47.6]];
const EDGES = new Map([
  [1, EAST],
  [2, [[-122.3167, 47.6], [-122.3167, 47.609]]],
]);

/**
 * @param {number} clusterId
 * @param {object} [overrides]
 * @returns {object} A location 20 m north of the eastbound street, a quarter of the way along, on its left.
 */
const northOfEast = (clusterId, overrides = {}) => ({
  clusterId, lng: -122.326675, lat: 47.60018, side: 'left', atCrossing: false, edgeId: 1, ...overrides,
});

describe('localFrame', () => {
  test('is meters east and north of its origin, and round-trips', () => {
    const frame = localFrame(ORIGIN);
    const [x, y] = frame.toMeters([-122.3167, 47.609]);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    // A degree of latitude is about 111.2 km everywhere; a degree of longitude shrinks with the cosine of the latitude.
    expect(y).toBeCloseTo(0.009 * 111195, -2);
    expect(x).toBeCloseTo(0.0133 * 111195 * Math.cos((47.6 * Math.PI) / 180), -2);
    const back = frame.toLngLat([x, y]);
    expect(back[0]).toBeCloseTo(-122.3167, 9);
    expect(back[1]).toBeCloseTo(47.609, 9);
  });
});

describe('projectOntoPolyline', () => {
  const line = [[0, 0], [100, 0], [100, 100]];

  test('finds the foot, the distance along and the direction on the nearest segment', () => {
    const p = projectOntoPolyline([30, 7], line);
    expect(p.foot).toEqual([30, 0]);
    expect(p.along).toBe(30);
    expect(p.tangent).toEqual([1, 0]);
    expect(p.distance).toBe(7);
    const q = projectOntoPolyline([95, 60], line);
    expect(q.foot).toEqual([100, 60]);
    expect(q.along).toBe(160);
    expect(q.tangent).toEqual([0, 1]);
  });

  test('clamps to the line\'s ends rather than reaching past them', () => {
    expect(projectOntoPolyline([-20, 5], line).foot).toEqual([0, 0]);
    expect(projectOntoPolyline([120, 130], line)).toMatchObject({ foot: [100, 100], along: 200 });
  });

  test('skips repeated vertices and gives up on a line with no length', () => {
    expect(projectOntoPolyline([5, 5], [[0, 0], [0, 0], [10, 0]])).toMatchObject({ foot: [5, 0], along: 5 });
    expect(projectOntoPolyline([5, 5], [[0, 0], [0, 0]])).toBeNull();
    expect(projectOntoPolyline([5, 5], [[0, 0]])).toBeNull();
  });
});

describe('sideNormal', () => {
  test('is the side of the direction of travel, as street_side defines it', () => {
    expect(sideNormal([1, 0], 'left')).toEqual([-0, 1]);
    expect(sideNormal([1, 0], 'right')).toEqual([0, -1]);
    expect(sideNormal([0, 1], 'left')).toEqual([-1, 0]);
    expect(sideNormal([0, 1], 'right')).toEqual([1, -0]);
  });
});

describe('spreadAlong', () => {
  test('moves nothing that has room', () => {
    expect(spreadAlong([], 24)).toEqual([]);
    expect(spreadAlong([0, 24, 100], 24)).toEqual([0, 0, 0]);
  });

  test('parts two at one spot evenly, keeping the input order', () => {
    expect(spreadAlong([50, 50], 24)).toEqual([-12, 12]);
    expect(spreadAlong([60, 50], 24)).toEqual([7, -7]);
  });

  test('centers a run on where its members were, shoulder to shoulder', () => {
    const moves = spreadAlong([100, 110, 120], 24);
    const placed = [100, 110, 120].map((p, i) => p + moves[i]);
    expect(placed).toEqual([86, 110, 134]);
  });

  test('keeps merging when a spread run reaches back into the one before it', () => {
    // 0 and 10 form a run at [-7, 17]; 30 alone sits at [18, 42]; 35 overlaps 30, and their run [20.5, 44.5]... reaches
    // back into the first, so all four become one run centered on their mean of 18.75.
    const positions = [0, 10, 30, 35];
    const moves = spreadAlong(positions, 24);
    const placed = positions.map((p, i) => p + moves[i]);
    expect(placed).toEqual([-17.25, 6.75, 30.75, 54.75]);
    for (let i = 1; i < placed.length; i++) expect(placed[i] - placed[i - 1]).toBeCloseTo(24, 9);
  });
});

describe('alignLocations', () => {
  test('drops a label at a crossing, without a side, or without a known edge, and keeps the rest in order', () => {
    const aligned = alignLocations([
      northOfEast(1, { atCrossing: true }),
      northOfEast(2, { side: null }),
      northOfEast(3, { side: undefined }),
      northOfEast(4, { edgeId: null }),
      northOfEast(5, { edgeId: 99 }),
      northOfEast(6),
      northOfEast(7, { side: 'right' }),
    ], EDGES);
    expect(aligned.map((a) => a.clusterId)).toEqual([6, 7]);
  });

  test('puts a label at the foot of its position on its own street, with its side and distance along', () => {
    const [a] = alignLocations([northOfEast(1)], EDGES);
    // On the street's line: its latitude, a quarter of the way along.
    expect(a.lngLat[1]).toBeCloseTo(47.6, 9);
    expect(a.lngLat[0]).toBeCloseTo(-122.326675, 7);
    const frame = localFrame(ORIGIN);
    const streetLength = frame.toMeters(EAST[1])[0];
    expect(a.along).toBeCloseTo(streetLength / 4, 0);
    expect(a.tangent[0]).toBeCloseTo(1, 9);
    expect(a.tangent[1]).toBeCloseTo(0, 9);
    // North of an eastbound street is its left.
    expect(a.normal[1]).toBeCloseTo(1, 9);
    expect(a.line).toBe('1:left');
  });

  test('judges the side the database gave it, not where the point is', () => {
    const [a] = alignLocations([northOfEast(1, { side: 'right' })], EDGES);
    expect(a.normal[1]).toBeCloseTo(-1, 9);
    expect(a.line).toBe('1:right');
  });

  test('projects onto the edge it belongs to, not the nearest one', () => {
    // At the corner, nearer the northbound street's line than the eastbound one's interior, but on edge 1.
    const [a] = alignLocations([northOfEast(1, { lng: -122.3166, lat: 47.6002 })], EDGES);
    expect(a.lngLat[0]).toBeCloseTo(-122.3167, 9);
    expect(a.lngLat[1]).toBeCloseTo(47.6, 9);
    expect(a.tangent[0]).toBeCloseTo(1, 9);
  });
});

describe('markerOffsets', () => {
  const scale = { offsetPx: 16, markerPx: 24, metersPerPixel: 0.3 };

  test('offsets sideways in screen pixels, with the screen\'s y pointing down', () => {
    const aligned = alignLocations([
      northOfEast(1),
      northOfEast(2, { side: 'right' }),
      { clusterId: 3, lng: -122.3168, lat: 47.6045, side: 'left', edgeId: 2 },
    ], EDGES);
    const offsets = markerOffsets(aligned, scale);
    // Left of an eastbound street is north: up the screen.
    expect(offsets.get(1)[0]).toBeCloseTo(0, 9);
    expect(offsets.get(1)[1]).toBeCloseTo(-16, 9);
    expect(offsets.get(2)[1]).toBeCloseTo(16, 9);
    // Left of a northbound street is west: left on the screen.
    expect(offsets.get(3)[0]).toBeCloseTo(-16, 9);
    expect(offsets.get(3)[1]).toBeCloseTo(0, 9);
  });

  test('spreads markers that share a line along it, by their width at this zoom', () => {
    const frame = localFrame(ORIGIN);
    const at = (clusterId, meters, side = 'left') => northOfEast(clusterId, {
      side, lng: frame.toLngLat([meters, 20])[0], lat: frame.toLngLat([meters, 20])[1],
    });
    // 3 m apart: 10 px at this zoom, so the two markers would overlap by 14 px, which is what the moves make up.
    // Opposite sides never collide.
    const aligned = alignLocations([at(1, 100), at(2, 103), at(3, 103, 'right')], EDGES);
    const offsets = markerOffsets(aligned, scale);
    expect(offsets.get(2)[0] - offsets.get(1)[0]).toBeCloseTo(14, 6);
    expect(offsets.get(1)[0]).toBeCloseTo(-7, 6);
    expect(offsets.get(2)[0]).toBeCloseTo(7, 6);
    expect(offsets.get(3)[0]).toBeCloseTo(0, 6);
    // Zoomed in far enough, the same two have room and stay put.
    const close = markerOffsets(aligned, { ...scale, metersPerPixel: 0.1 });
    expect(close.get(1)[0]).toBeCloseTo(0, 6);
    expect(close.get(2)[0]).toBeCloseTo(0, 6);
  });
});
