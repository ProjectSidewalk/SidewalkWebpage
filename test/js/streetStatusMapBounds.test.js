/**
 * Tests for StreetStatusMap.boundsOfFeature, the one piece of arithmetic behind the regained-imagery queue's "show
 * me where this is" action (#4929).
 *
 * The queue lists retired streets, which Explore cannot serve, so the street id points at the page's own status map
 * instead — and the map can only zoom to a segment if something works out that segment's bounds. Getting the
 * lng/lat order backwards here would fly the map to the wrong hemisphere silently, which is exactly the sort of
 * mistake a mocked map test would sail past.
 *
 * Runs under jsdom (jest.config.js). StreetStatusMap.js is a bare top-level class in a concatenated bundle, so it is
 * eval'd into scope rather than required; the static helper touches no Mapbox API, so no `mapboxgl` global is needed.
 */

const fs = require('fs');
const path = require('path');

const StreetStatusMap = (0, eval)(
  `${fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard/StreetStatusMap.js'), 'utf8',
  )}\nStreetStatusMap;`,
);

/** One street as the v3 streets GeoJSON carries it: [lng, lat] pairs, in that order. */
const feature = (coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates } });

describe('StreetStatusMap.boundsOfFeature', () => {
  test('boxes a segment as [[minLng, minLat], [maxLng, maxLat]]', () => {
    expect(StreetStatusMap.boundsOfFeature(feature([[-122.34, 47.61], [-122.31, 47.63]])))
      .toEqual([[-122.34, 47.61], [-122.31, 47.63]]);
  });

  test('covers every vertex, not just the endpoints', () => {
    // A street that bends: the bounding box has to reach the bend, or the zoom clips part of the segment away.
    expect(StreetStatusMap.boundsOfFeature(feature([[-122.34, 47.61], [-122.30, 47.70], [-122.32, 47.63]])))
      .toEqual([[-122.34, 47.61], [-122.30, 47.70]]);
  });

  test('handles a MultiLineString\'s nested coordinates', () => {
    expect(StreetStatusMap.boundsOfFeature({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: [[[-1, 1], [-2, 2]], [[-3, 3], [-4, 4]]] },
    })).toEqual([[-4, 1], [-1, 4]]);
  });
});
