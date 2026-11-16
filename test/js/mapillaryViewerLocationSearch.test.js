/**
 * Tests for how MapillaryViewer (frontend/js/common/pano-viewer/MapillaryViewer.js) finds a pano near a point: the
 * Graph API search behind setLocation(), findPanoNear() and preloadPanoNear(), the ranking that picks one candidate
 * (conf/pano-scoring.json, shared with check_streets_for_imagery.py, #4411), the prefetch cache Explore fills along a
 * street, and lookupPanoPosition() for a nav arrow's destination. Graph is a routed fetch stub, and the SDK is the
 * fake in support/streetImageryHarness.js. (#5840)
 */

import { graphImage, loadMapillaryViewer, mapillaryImage } from './support/streetImageryHarness.js';
import { routeFetch, sentRequests } from './support/routeFetch.js';

const { MapillaryViewer, NoImageryError, FakeMapillaryViewer } = await loadMapillaryViewer();

const SEARCH = 'https://graph.mapillary.com/images?';
const HERE = { lat: 37.5407, lng: -77.4360 };
/** About 1.1 m of latitude. */
const METER = 0.00001;

/**
 * A point some meters north of HERE, as Graph's [lng, lat].
 * @param {number} meters - How far north.
 * @returns {[number, number]} The coordinates.
 */
const north = (meters) => [HERE.lng, HERE.lat + meters * METER];

describe('MapillaryViewer location search', () => {
  let viewer;
  let sdk;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="pano-mount"></div>';
    FakeMapillaryViewer.images = { start: mapillaryImage('start', { sequenceId: 'seq-current' }) };
    viewer = await MapillaryViewer.create(document.getElementById('pano-mount'), {
      accessToken: 'MLY|token', startPanoId: 'start', defaultNavigation: false,
    });
    sdk = FakeMapillaryViewer.instances.at(-1);
  });

  /**
   * Lets the SDK move to these search results, as it can to any image Graph returns.
   * @param {...object} results - Graph search results.
   */
  function reachable(...results) {
    for (const result of results) {
      const fields = { capturedAt: result.captured_at, sequenceId: result.sequence };
      sdk.images[result.id] = mapillaryImage(result.id, fields);
    }
  }

  /**
   * Answers every search with these results.
   * @param {...object} results - Graph search results.
   * @returns {import('vitest').Mock} The fetch stub.
   */
  function searchFinds(...results) {
    reachable(...results);
    return routeFetch({ [SEARCH]: { data: results } });
  }

  describe('ranking candidates', () => {
    it('moves to the nearest pano, judged by its refined position rather than its raw GPS fix', async () => {
      const near = graphImage('near', north(2));
      const far = graphImage('far', north(20));
      // A raw fix 30 m out, refined by Mapillary to the spot asked for.
      const refined = graphImage('refined', north(30), { computed_geometry: { type: 'Point', coordinates: north(0) } });
      searchFinds(far, near);
      expect((await viewer.setLocation(HERE)).getPanoId()).toBe('near');

      viewer.clearPrefetchCache();
      searchFinds(far, near, refined);
      expect((await viewer.setLocation(HERE)).getPanoId()).toBe('refined');
    });

    it('prefers the sharper image at one spot, ranking one with no width below any with one', async () => {
      searchFinds(graphImage('small', north(1), { width: 2048 }),
        graphImage('unsized', north(1), { width: undefined }));

      expect((await viewer.setLocation(HERE)).getPanoId()).toBe('small');
    });

    it('prefers the newer image at one spot', async () => {
      searchFinds(graphImage('old', north(1), { captured_at: Date.UTC(2015, 0, 1) }), graphImage('new', north(1)));

      expect((await viewer.setLocation(HERE)).getPanoId()).toBe('new');
    });

    it('stays in the sequence it is walking when the candidates are otherwise even', async () => {
      searchFinds(graphImage('other', north(1), { sequence: 'seq-other' }),
        graphImage('same', north(1), { sequence: 'seq-current' }));

      expect((await viewer.setLocation(HERE)).getPanoId()).toBe('same');
    });

    it('starts at the best pano near a street\'s start point when the page has no pano to start at', async () => {
      routeFetch({ [SEARCH]: { data: [graphImage('first', north(1))] } });
      FakeMapillaryViewer.images = { first: mapillaryImage('first') };

      const fresh = await MapillaryViewer.create(document.getElementById('pano-mount'), {
        accessToken: 'MLY|token', startLatLng: HERE, defaultNavigation: false,
      });

      expect(fresh.getPanoId()).toBe('first');
    });
  });

  describe('excluding panos', () => {
    it('skips an excluded pano and its duplicates, which Mapillary serves under other ids', async () => {
      const visited = graphImage('visited', north(1), { captured_at: Date.UTC(2023, 1, 2) });
      const duplicate = graphImage('duplicate', north(1), { captured_at: Date.UTC(2023, 1, 2) });
      const elsewhere = graphImage('elsewhere', north(15));
      searchFinds(visited, duplicate, elsewhere);
      const excluded = new Set([await viewer.setPano('visited')]);

      expect((await viewer.setLocation(HERE, excluded)).getPanoId()).toBe('elsewhere');
    });

    it('rejects with NoImageryError when every candidate is excluded, so the street reads as done', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const only = graphImage('only', north(1));
      searchFinds(only);
      const excluded = new Set([await viewer.setPano('only')]);

      await expect(viewer.setLocation(HERE, excluded)).rejects.toBeInstanceOf(NoImageryError);
      expect(console.error).toHaveBeenCalledWith('Error moving to location:', expect.any(NoImageryError));
    });

    it('rejects with NoImageryError where Graph has no panos at all', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      routeFetch({ [SEARCH]: { data: [] } });

      await expect(viewer.setLocation(HERE)).rejects.toThrow('No usable Mapillary image within 25m');
    });
  });

  describe('talking to Graph', () => {
    it('searches a box around the point, asking only for panos, with the access token', async () => {
      const fetchStub = searchFinds(graphImage('near', north(1)));

      await viewer.setLocation(HERE);

      const url = new URL(sentRequests(fetchStub)[0].url);
      expect(url.searchParams.get('is_pano')).toBe('true');
      expect(url.searchParams.get('access_token')).toBe('MLY|token');
      const [west, south, east, northEdge] = url.searchParams.get('bbox').split(',').map(Number);
      expect(west).toBeLessThan(HERE.lng);
      expect(east).toBeGreaterThan(HERE.lng);
      expect(south).toBeLessThan(HERE.lat);
      expect(northEdge).toBeGreaterThan(HERE.lat);
    });

    it('shrinks the box and asks again when Graph says it holds too many images', async () => {
      const near = graphImage('near', north(1));
      reachable(near);
      const answers = [{ error: { code: 1, message: 'Please reduce the amount of data' } }, { data: [near] }];
      const fetchStub = routeFetch({ [SEARCH]: () => answers.shift() });

      expect((await viewer.setLocation(HERE)).getPanoId()).toBe('near');

      const widths = sentRequests(fetchStub).map(({ url }) => {
        const [west, , east] = new URL(url).searchParams.get('bbox').split(',').map(Number);
        return east - west;
      });
      expect(widths[1]).toBeLessThan(widths[0]);
    });

    it('treats a box that never gets small enough as holding nothing', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchStub = routeFetch({ [SEARCH]: { error: { code: 1, message: 'Please reduce the amount of data' } } });

      await expect(viewer.setLocation(HERE)).rejects.toBeInstanceOf(NoImageryError);
      // 25 m, 15 m, then 5 m, 10 m at a time.
      expect(fetchStub).toHaveBeenCalledTimes(3);
    });

    it('passes on any other Graph error as an ordinary failure, never as "no imagery"', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      routeFetch({ [SEARCH]: { error: { code: 190, message: 'Invalid OAuth access token' } } });

      const error = await viewer.setLocation(HERE).catch((err) => err);

      expect(error.message).toBe('Invalid OAuth access token');
      expect(error).not.toBeInstanceOf(NoImageryError);
      expect(console.error).toHaveBeenCalledWith('Error moving to location:', error);
    });

    it('passes on a reply it does not recognize, verbatim', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      routeFetch({ [SEARCH]: { unexpected: true } });

      await expect(viewer.setLocation(HERE)).rejects.toThrow('{"unexpected":true}');
    });
  });

  describe('the prefetch cache along a street', () => {
    it('answers a move from a search prefetched at that spot, and prefetches each spot once', async () => {
      const fetchStub = searchFinds(graphImage('near', north(1)));

      viewer.prefetchLocation(HERE);
      viewer.prefetchLocation({ lat: HERE.lat + 2 * METER, lng: HERE.lng });
      await viewer.setLocation(HERE);

      expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('searches afresh for a point more than 5 m from any prefetch', async () => {
      const fetchStub = searchFinds(graphImage('near', north(1)));
      viewer.prefetchLocation({ lat: HERE.lat + 20 * METER, lng: HERE.lng });
      viewer.prefetchLocation({ lat: HERE.lat + 50 * METER, lng: HERE.lng });

      await viewer.setLocation(HERE);

      expect(fetchStub).toHaveBeenCalledTimes(3);
    });

    it('searches afresh when everything a prefetch found has since been excluded', async () => {
      const visited = graphImage('visited', north(1));
      reachable(visited);
      const fresh = graphImage('fresh', north(3), { captured_at: Date.UTC(2025, 0, 1) });
      reachable(fresh);
      const answers = [{ data: [visited] }, { data: [visited, fresh] }];
      const fetchStub = routeFetch({ [SEARCH]: () => answers.shift() });
      viewer.prefetchLocation(HERE);
      const excluded = new Set([await viewer.setPano('visited')]);

      expect((await viewer.setLocation(HERE, excluded)).getPanoId()).toBe('fresh');
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it('forgets every prefetch when the street changes', async () => {
      const fetchStub = searchFinds(graphImage('near', north(1)));
      viewer.prefetchLocation(HERE);

      viewer.clearPrefetchCache();
      await viewer.setLocation(HERE);

      expect(fetchStub).toHaveBeenCalledTimes(2);
    });
  });

  describe('preloadPanoNear', () => {
    it("warms the SDK's cache with the pano the next move would pick, without moving", async () => {
      searchFinds(graphImage('far', north(20)), graphImage('near', north(1)));

      await viewer.preloadPanoNear(HERE, new Set());

      expect(sdk.cacheImage$).toHaveBeenCalledWith('near');
      expect(viewer.getPanoId()).toBe('start');
    });

    it('warms nothing where there is nothing to move to', async () => {
      routeFetch({ [SEARCH]: { data: [] } });

      await viewer.preloadPanoNear(HERE, new Set());

      expect(sdk.cacheImage$).not.toHaveBeenCalled();
    });

    it('logs a failed search instead of failing the caller, since a preload is only a guess', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      routeFetch({ [SEARCH]: new TypeError('Failed to fetch') });

      await expect(viewer.preloadPanoNear(HERE, new Set())).resolves.toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith('Failed to preload pano near', HERE, expect.any(TypeError));
    });
  });

  describe('findPanoNear', () => {
    it('names the pano a move would land on and where it stands, preferring the refined position', async () => {
      searchFinds(graphImage('raw', north(1)));
      expect(await viewer.findPanoNear(HERE)).toEqual({ panoId: 'raw', lat: HERE.lat + METER, lng: HERE.lng });

      viewer.clearPrefetchCache();
      searchFinds(graphImage('refined', north(9), { computed_geometry: { type: 'Point', coordinates: north(2) } }));
      expect(await viewer.findPanoNear(HERE)).toEqual({
        panoId: 'refined', lat: HERE.lat + 2 * METER, lng: HERE.lng,
      });
      expect(viewer.getPanoId()).toBe('start');
    });

    it('answers null where there is no pano', async () => {
      routeFetch({ [SEARCH]: { data: [] } });

      expect(await viewer.findPanoNear(HERE)).toBeNull();
    });
  });

  describe('lookupPanoPosition', () => {
    it("answers from the SDK's own graph when it holds the image, at no network cost", async () => {
      const fetchStub = routeFetch({});
      sdk.images.ahead = mapillaryImage('ahead', { lngLat: { lat: 1, lng: 2 } });

      expect(await viewer.lookupPanoPosition('ahead')).toEqual({ lat: 1, lng: 2 });
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('asks Graph for an image the SDK no longer holds, preferring its refined position', async () => {
      const fetchStub = routeFetch({
        'https://graph.mapillary.com/evicted?': {
          geometry: { type: 'Point', coordinates: [2, 1] }, computed_geometry: { type: 'Point', coordinates: [4, 3] },
        },
        'https://graph.mapillary.com/raw?': { geometry: { type: 'Point', coordinates: [2, 1] } },
      });

      expect(await viewer.lookupPanoPosition('evicted')).toEqual({ lat: 3, lng: 4 });
      expect(await viewer.lookupPanoPosition('raw')).toEqual({ lat: 1, lng: 2 });
      expect(sentRequests(fetchStub)[0].url).toContain('fields=geometry,computed_geometry&access_token=MLY|token');
    });

    it('asks Graph when the SDK\'s graph cannot be read, as after an SDK upgrade moves it', async () => {
      sdk._navigator.graphService._graph$ = { subscribe: () => { throw new Error('internals moved'); } };
      routeFetch({ 'https://graph.mapillary.com/ahead?': { geometry: { type: 'Point', coordinates: [2, 1] } } });

      expect(await viewer.lookupPanoPosition('ahead')).toEqual({ lat: 1, lng: 2 });
    });

    it('answers null for an image Graph has no position for, and fails on a Graph error', async () => {
      routeFetch({
        'https://graph.mapillary.com/nowhere?': { id: 'nowhere' },
        'https://graph.mapillary.com/gone?': { error: { message: 'Object with ID does not exist', code: 100 } },
      });

      expect(await viewer.lookupPanoPosition('nowhere')).toBeNull();
      await expect(viewer.lookupPanoPosition('gone')).rejects.toThrow('Object with ID does not exist');
    });
  });
});
