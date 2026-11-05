/**
 * common/geoBounds.js, which every map that opens on or flies to a set of features relies on (#4929). Getting the
 * lng/lat order backwards would fly the map to the wrong hemisphere silently, which a mocked map would sail past, so
 * these run against the real mapbox-gl bounds class.
 */

import { loadModules } from './loader.js';

const { geometryBounds, featureCollectionBounds } = await loadModules('frontend/js/common/geoBounds.js');

/** One street as the v3 streets GeoJSON carries it: [lng, lat] pairs, in that order. */
const line = (coordinates) => ({ type: 'LineString', coordinates });

describe('geometryBounds', () => {
  test('boxes a segment as [[minLng, minLat], [maxLng, maxLat]]', () => {
    expect(geometryBounds(line([[-122.34, 47.61], [-122.31, 47.63]])).toArray())
      .toEqual([[-122.34, 47.61], [-122.31, 47.63]]);
  });

  test('covers every vertex, not just the endpoints', () => {
    // A street that bends: the bounding box has to reach the bend, or the zoom clips part of the segment away.
    expect(geometryBounds(line([[-122.34, 47.61], [-122.30, 47.70], [-122.32, 47.63]])).toArray())
      .toEqual([[-122.34, 47.61], [-122.30, 47.70]]);
  });

  test('handles a MultiLineString\'s nested coordinates', () => {
    expect(geometryBounds({ type: 'MultiLineString', coordinates: [[[-1, 1], [-2, 2]], [[-3, 3], [-4, 4]]] }).toArray())
      .toEqual([[-4, 1], [-1, 4]]);
  });

  test('handles a GeometryCollection', () => {
    expect(geometryBounds({
      type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [-1, 1] }, line([[-3, 3], [-4, 4]])],
    }).toArray()).toEqual([[-4, 1], [-1, 4]]);
  });
});

describe('featureCollectionBounds', () => {
  test('covers every feature, and skips one without a geometry', () => {
    const features = [
      { type: 'Feature', geometry: line([[-122.4, 47.6], [-122.39, 47.61]]) },
      { type: 'Feature', geometry: null },
      { type: 'Feature', geometry: line([[-122.35, 47.55], [-122.34, 47.66]]) },
    ];
    expect(featureCollectionBounds({ type: 'FeatureCollection', features }).toArray())
      .toEqual([[-122.4, 47.55], [-122.34, 47.66]]);
  });

  test('is empty for no features', () => {
    expect(featureCollectionBounds({ type: 'FeatureCollection', features: [] }).isEmpty()).toBe(true);
  });
});
