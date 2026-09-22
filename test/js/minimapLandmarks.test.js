/**
 * Tests for MinimapLandmarks (public/js/explore/src/navigation/MinimapLandmarks.js): which places it asks the API for,
 * and that it fetches again only once the view has left the middle of the box it last fetched.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

/** A minimap stand-in: a movable center, a moveend to fire, and the places it was last given. */
function fakeMinimap(center) {
  const handlers = [];
  return {
    center,
    landmarks: [],
    getCenter() { return this.center; },
    onMoveEnd: (callback) => handlers.push(callback),
    setLandmarks(places) { this.landmarks.push(places); },
    moveTo(newCenter) {
      this.center = newCenter;
      handlers.forEach((callback) => callback());
    },
  };
}

/** Lets pending fetch/json promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('MinimapLandmarks', () => {
  const SEATTLE = { lat: 47.6, lng: -122.33 };
  const PLACES = { type: 'FeatureCollection', features: [{ properties: { category: 'school', name: 'A School' } }] };

  beforeAll(() => {
    // turf.distance on a sphere is all the class uses; a plain haversine stands in.
    window.turf = {
      distance: ([lng1, lat1], [lng2, lat2]) => {
        const rad = (d) => (d * Math.PI) / 180;
        const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
          + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
        return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
      },
    };
    window.eval(`${read('public/js/explore/src/navigation/MinimapLandmarks.js')}
      window.MinimapLandmarks = MinimapLandmarks;`);
  });

  beforeEach(() => {
    window.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(PLACES) }));
  });

  test('asks for the landmark categories in a box around the view, and draws what comes back', async () => {
    const minimap = fakeMinimap(SEATTLE);
    new window.MinimapLandmarks(minimap);
    await settle();

    expect(window.fetch).toHaveBeenCalledTimes(1);
    const url = new URL(window.fetch.mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/v3/api/places');
    expect(url.searchParams.get('category')).toBe('school,health,library,community,government');
    const [minLng, minLat, maxLng, maxLat] = url.searchParams.get('bbox').split(',').map(Number);
    expect((minLat + maxLat) / 2).toBeCloseTo(SEATTLE.lat, 5);
    expect((minLng + maxLng) / 2).toBeCloseTo(SEATTLE.lng, 5);
    // 1.5 km each way: ~0.0135 deg of latitude.
    expect(maxLat - minLat).toBeCloseTo(0.027, 3);
    expect(minimap.landmarks).toEqual([PLACES]);
  });

  test('a move within the middle of the fetched box reuses it; one past it fetches again', async () => {
    const minimap = fakeMinimap(SEATTLE);
    new window.MinimapLandmarks(minimap);
    await settle();

    minimap.moveTo({ lat: SEATTLE.lat + 0.005, lng: SEATTLE.lng }); // ~560 m, under the 750 m threshold
    await settle();
    expect(window.fetch).toHaveBeenCalledTimes(1);

    minimap.moveTo({ lat: SEATTLE.lat + 0.01, lng: SEATTLE.lng }); // ~1.1 km
    await settle();
    expect(window.fetch).toHaveBeenCalledTimes(2);
  });

  test('a failed fetch draws nothing and is retried on the next move', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    window.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));
    const minimap = fakeMinimap(SEATTLE);
    new window.MinimapLandmarks(minimap);
    await settle();
    expect(minimap.landmarks).toEqual([]);

    minimap.moveTo({ lat: SEATTLE.lat + 0.0001, lng: SEATTLE.lng });
    await settle();
    expect(window.fetch).toHaveBeenCalledTimes(2);
  });
});
