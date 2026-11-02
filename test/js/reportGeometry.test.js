/**
 * Tests for the report's pure map shapes: the wedge showing what a photo sees, and the sketch that stands in for a map.
 */

import { describe, expect, test } from 'vitest';
import { bearing, distance, point } from '@turf/turf';
import { viewWedge, viewpointOf } from '../../frontend/js/report/viewWedge.js';
import { fitProjection, reportSketch } from '../../frontend/js/report/reportSketch.js';

const CAMERA = [-122.33, 47.6];

describe('viewWedge', () => {
  test('starts and ends at the camera, so the polygon closes', () => {
    const ring = viewWedge(CAMERA, 0, 60, 30).geometry.coordinates[0];
    expect(ring[0]).toEqual(CAMERA);
    expect(ring.at(-1)).toEqual(CAMERA);
  });

  test('spans the field of view around the heading, at the radius', () => {
    const ring = viewWedge(CAMERA, 90, 60, 30).geometry.coordinates[0];
    const arc = ring.slice(1, -1);
    expect(bearing(point(CAMERA), point(arc[0]))).toBeCloseTo(60, 1);
    expect(bearing(point(CAMERA), point(arc.at(-1)))).toBeCloseTo(120, 1);
    for (const p of arc) expect(distance(point(CAMERA), point(p), { units: 'meters' })).toBeCloseTo(30, 1);
  });
});

describe('viewpointOf', () => {
  const label = { camera_lat: CAMERA[1], camera_lng: CAMERA[0], heading: 0, lat: 47.6003, lng: CAMERA[0] };

  test('reaches past the label, so the shape visibly touches it', () => {
    const { camera, wedge } = viewpointOf(label, 60, 12);
    expect(camera).toEqual(CAMERA);
    const toLabel = distance(point(CAMERA), point([label.lng, label.lat]), { units: 'meters' });
    const middle = wedge.geometry.coordinates[0][7];
    expect(distance(point(CAMERA), point(middle), { units: 'meters' })).toBeGreaterThan(toLabel);
  });

  test('reaches what its host says will show, when the label itself is closer than that', () => {
    const { wedge } = viewpointOf(label, 60, 200);
    expect(distance(point(CAMERA), point(wedge.geometry.coordinates[0][1]), { units: 'meters' })).toBeCloseTo(200, 0);
  });

  test('still shows a direction with no label position to reach for', () => {
    const { wedge } = viewpointOf({ ...label, lat: null, lng: null }, 60, 12);
    expect(distance(point(CAMERA), point(wedge.geometry.coordinates[0][1]), { units: 'meters' })).toBeCloseTo(12, 1);
  });

  test.each(['camera_lat', 'camera_lng', 'heading'])('has nothing to show without %s', (field) => {
    expect(viewpointOf({ ...label, [field]: null }, 60, 12)).toBeNull();
  });
});

describe('reportSketch', () => {
  const line = [[-122.33, 47.6], [-122.32, 47.6]];

  test('keeps everything inside its frame, north up', () => {
    const project = fitProjection([[-122.33, 47.6], [-122.32, 47.61]]);
    const [x1, y1] = project([-122.33, 47.6]);
    const [x2, y2] = project([-122.32, 47.61]);
    for (const n of [x1, x2]) expect(n).toBeGreaterThanOrEqual(0);
    expect(x2).toBeGreaterThan(x1);
    expect(y2).toBeLessThan(y1);
  });

  test('a street with no width or height still fits', () => {
    const [x, y] = fitProjection([[-122.33, 47.6]])([-122.33, 47.6]);
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });

  test('draws a path per line and an icon per location, hidden from screen readers', () => {
    const svg = reportSketch([line, line], [{ lng: -122.325, lat: 47.6, iconUrl: '/a.svg' }]);
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('href="/a.svg"');
    expect(svg).toContain('aria-hidden="true"');
  });

  test('draws nothing with nothing to draw', () => {
    expect(reportSketch([], [])).toBe('');
  });
});
