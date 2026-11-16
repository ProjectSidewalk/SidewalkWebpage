/**
 * Tests for MapillaryViewer (frontend/js/common/pano-viewer/MapillaryViewer.js) from create() onward: the options each
 * page hands the SDK, the events it relays to our listeners, and the camera bookkeeping behind the synchronous getPov()
 * that Explore's label canvas reads on every frame. Location search has its own suite, and setPano's failure
 * classification lives in mapillaryViewerSetPano.test.js. The SDK is a fake (support/streetImageryHarness.js). (#5840)
 */

import { loadMapillaryViewer, mapillaryImage } from './support/streetImageryHarness.js';
import { flush } from './support/routeFetch.js';

const { MapillaryViewer, FakeMapillaryViewer } = await loadMapillaryViewer();

describe('MapillaryViewer', () => {
  let mount;

  beforeEach(() => {
    document.body.innerHTML = '<div id="pano-mount"></div>';
    mount = document.getElementById('pano-mount');
  });

  /** @returns {FakeMapillaryViewer} The SDK viewer the last create() built. */
  const sdkViewer = () => FakeMapillaryViewer.instances.at(-1);

  /**
   * Brings a viewer up at a start pano, as the pages do.
   * @param {object} [options] - Page options on top of the access token and start pano.
   * @param {Record<string, object>} [images] - The images the SDK can move to, by id; the start pano is always one.
   * @returns {Promise<MapillaryViewer>} The viewer.
   */
  async function create(options = {}, images = {}) {
    FakeMapillaryViewer.images = { start: mapillaryImage('start'), ...images };
    return MapillaryViewer.create(mount, {
      accessToken: 'MLY|token', startPanoId: 'start', defaultNavigation: false, ...options,
    });
  }

  describe('the options each page hands the SDK', () => {
    it("Explore's: its own arrows instead of the SDK's, neighbours cached, links awaited, animated moves", async () => {
      const viewer = await create({ preloadNeighbors: true });
      const { options } = sdkViewer();

      expect(options.container).toBe('pano-mount');
      expect(options.component).toMatchObject({
        bearing: false, cache: true, direction: false, keyboard: false, sequence: false, zoom: false,
      });
      expect(options.transitionMode).toBeUndefined();
      expect(viewer.wantsLinkedPanos).toBe(true);
      // Flat photos are no use to a 360° labeler.
      expect(sdkViewer().setFilter).toHaveBeenCalledWith(['==', 'cameraType', 'spherical']);
      expect(viewer.getPanoId()).toBe('start');
    });

    it("Validate's: no neighbour cache, no link wait, and jumps instead of animated moves", async () => {
      const viewer = await create({ linkedPanos: false, instantTransitions: true, scrollwheel: false });
      const { options } = sdkViewer();

      expect(options.component.cache).toBe(false);
      expect(options.transitionMode).toBe(1);
      expect(viewer.wantsLinkedPanos).toBe(false);
      // Our own options stay ours; everything else is the SDK's.
      expect(options).not.toHaveProperty('linkedPanos');
      expect(options).not.toHaveProperty('instantTransitions');
      expect(options.scrollwheel).toBe(false);
    });

    it('fetches images through a provider that asks the API at most 30 ids at a time', async () => {
      await create();
      const provider = sdkViewer().options.dataProvider;
      const ids = Array.from({ length: 65 }, (_, i) => `img${i}`);

      const images = await provider.getSpatialImages(ids);

      expect(provider.batches.map((batch) => batch.length)).toEqual([30, 30, 5]);
      expect(images.map((image) => image.node_id)).toEqual(ids);
      expect(provider.options).toEqual({ accessToken: 'MLY|token' });
    });
  });

  describe('events', () => {
    it('tells pov_changed listeners about a pan and a zoom, one listener after the other', async () => {
      const viewer = await create();
      const order = [];
      viewer.addListener('pov_changed', async () => { await flush(); order.push('first'); });
      viewer.addListener('pov_changed', () => order.push('second'));

      await sdkViewer().emit('pov');
      await sdkViewer().emit('fov');

      expect(order).toEqual(['first', 'second', 'first', 'second']);
    });

    it("passes on a move made with the SDK's own arrows, after reading the new pano's metadata", async () => {
      const viewer = await create({ defaultNavigation: true }, { next: mapillaryImage('next') });
      const seen = [];
      viewer.addListener('pano_changed', () => seen.push(viewer.getPanoId()));

      await sdkViewer().emit('image', { image: sdkViewer().images.next });

      expect(sdkViewer().options.component.direction).toBe(true);
      expect(seen).toEqual(['next']);
    });

    it('reads a pano\'s metadata once for a move of its own, even with the SDK\'s arrows on', async () => {
      const viewer = await create({ defaultNavigation: true }, { next: mapillaryImage('next') });
      sdkViewer().getCenter.mockClear();

      await viewer.setPano('next');
      await flush();

      expect(sdkViewer().getCenter).toHaveBeenCalledTimes(1);
    });

    it("holds back the SDK's image event for its own move, announcing it once the getters catch up", async () => {
      const viewer = await create({}, { next: mapillaryImage('next') });
      const seen = [];
      viewer.addListener('pano_changed', (e) => seen.push([e.image.id, viewer.getPanoId()]));
      sdkViewer().moveTo.mockImplementationOnce(async (id) => {
        // The SDK fires 'image' while the move is still settling.
        await sdkViewer().emit('image', { image: sdkViewer().images[id] });
        return sdkViewer().images[id];
      });

      await viewer.setPano('next');
      await flush();

      expect(seen).toEqual([['next', 'next']]);
    });

    it('logs a pano_changed listener that fails, without failing the move', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const viewer = await create({}, { next: mapillaryImage('next') });
      const failure = new Error('listener broke');
      viewer.addListener('pano_changed', () => { throw failure; });

      await expect(viewer.setPano('next')).resolves.toBeTruthy();
      await flush();

      expect(console.error).toHaveBeenCalledWith('pano_changed listener failed', failure);
    });

    it('does not announce a move a newer one overtook, even when the older one lands', async () => {
      const viewer = await create({}, { older: mapillaryImage('older'), newer: mapillaryImage('newer') });
      const seen = [];
      viewer.addListener('pano_changed', (e) => seen.push(e.image.id));
      let landOlder;
      sdkViewer().moveTo.mockImplementationOnce(() => new Promise((resolve) => { landOlder = resolve; }));

      const older = viewer.setPano('older');
      const newer = viewer.setPano('newer');
      await newer;
      landOlder(sdkViewer().images.older);
      await older;
      await flush();

      expect(seen).toEqual(['newer']);
    });
  });

  describe('before the first pano', () => {
    it('answers null for the pano and its position, since the tracker asks during init', () => {
      const viewer = new MapillaryViewer();

      expect(viewer.getPanoId()).toBeNull();
      expect(viewer.getPosition()).toBeNull();
    });
  });

  describe('the camera', () => {
    it('reports position and links of the pano on screen', async () => {
      const link = { source: 'start', target: 'ahead', data: { direction: 9, worldMotionAzimuth: 0 } };
      const flatLink = { source: 'start', target: 'photo', data: { direction: 3, worldMotionAzimuth: 0 } };
      const start = mapillaryImage('start', { _cache: { _spatialEdges: { cached: true, edges: [link, flatLink] } } });
      const viewer = await create({}, { start });

      expect(viewer.getPosition()).toEqual({ lat: 37.5407, lng: -77.4360 });
      // Only pano-to-pano links; motion azimuth 0 (east) is a compass heading of 90.
      expect(viewer.getLinkedPanos()).toEqual([{ panoId: 'ahead', heading: 90 }]);
    });

    it('reads heading and pitch from where the view is centered on the image', async () => {
      const viewer = await create({}, { start: mapillaryImage('start', { compassAngle: 90 }) });
      sdkViewer().renderCamera(70, 1.5, 'start');

      // The image's left edge faces 270°, so a quarter of the way across is due north; above center is up.
      viewer.currCenter = [0.25, 0.25];
      expect(viewer.getPov()).toMatchObject({ heading: 0, pitch: 45 });
    });

    it('keeps the center the SDK reports as the view pans', async () => {
      const viewer = await create();
      sdkViewer().center = [0.75, 0.5];

      // The tracker resubscribes on each pov change, so a pan lands in the cache getPov() reads.
      await sdkViewer().emit('pov');

      expect(viewer.currCenter).toEqual([0.75, 0.5]);
    });

    it('aims at the heading and pitch asked for, keeping the zoom when none is given', async () => {
      const viewer = await create({}, { start: mapillaryImage('start', { compassAngle: 90 }) });
      sdkViewer().renderCamera(70, 1.5, 'start');
      const { zoom } = viewer.getPov();

      viewer.setPov({ heading: 0, pitch: 45 });

      expect(sdkViewer().setCenter).toHaveBeenCalledWith([0.25, 0.25]);
      expect(viewer.getPov().zoom).toBeCloseTo(zoom, 9);
    });

    it("caps the fov it remembers at what the SDK can render, so getPov() reports the zoom on screen", async () => {
      const viewer = await create();
      sdkViewer().renderCamera(70, 0.5, 'start');

      // A tall, narrow viewport asks for more than 90° vertically at zoom 1.
      viewer.setPov({ heading: 0, pitch: 0, zoom: 1 });
      expect(viewer.currVerticalFov).toBe(90);

      // A wide one asks for less than the 14.25° floor at zoom 4.
      sdkViewer().renderCamera(70, 4, 'start');
      viewer.setPov({ heading: 0, pitch: 0, zoom: 4 });
      expect(viewer.currVerticalFov).toBeCloseTo(2 * Math.atan(1 / 8) * 180 / Math.PI, 9);
    });

    it('measures the container until the render camera first reports an aspect', async () => {
      const viewer = await create();
      viewer.currVerticalFov = 60;
      vi.spyOn(mount, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 300 });
      const wide = viewer.getPov().zoom;

      mount.getBoundingClientRect.mockReturnValue({ width: 300, height: 300 });

      expect(viewer.getPov().zoom).toBeGreaterThan(wide);
    });

    it('falls back to zoom 1 when it has no rendered fov to keep a zoom from', async () => {
      const viewer = await create();
      sdkViewer().renderCamera(70, 1.5, 'start');
      viewer.currVerticalFov = undefined;

      viewer.setPov({ heading: 0, pitch: 0 });

      // Zoom 1 is 89.75° across; at 3:2 that is this much vertically.
      const expected = 2 * Math.atan(Math.tan((89.75 / 2) * Math.PI / 180) / 1.5) * 180 / Math.PI;
      expect(sdkViewer().setFieldOfView.mock.calls.at(-1)[0]).toBeCloseTo(expected, 9);
    });

    it('keeps the view pointed the same way when moving to the next pano', async () => {
      const viewer = await create({}, { next: mapillaryImage('next', { compassAngle: 45 }) });
      sdkViewer().renderCamera(70, 1.5, 'start');
      viewer.setPov({ heading: 120, pitch: -10, zoom: 2 });

      await viewer.setPano('next');

      expect(sdkViewer().setCenter).toHaveBeenLastCalledWith([expect.any(Number), 0.5 + 10 / 180]);
      const [x] = sdkViewer().setCenter.mock.calls.at(-1)[0];
      // On an image whose left edge faces 225°, 120° is 255° around.
      expect(x * 360).toBeCloseTo(255, 9);
    });

    it("ignores the render camera's fov while it is still on the previous image", async () => {
      const viewer = await create();
      sdkViewer().renderCamera(70, 1.5, 'start');

      sdkViewer().renderCamera(30, 1.5, 'previous');
      expect(viewer.currVerticalFov).toBe(70);

      sdkViewer().renderCamera(40, 1.5, 'start');
      expect(viewer.currVerticalFov).toBe(40);
    });

    it("treats a change in the container's shape as a pov change, but not the first or a bad reading", async () => {
      const viewer = await create();
      const onPov = vi.fn();
      viewer.addListener('pov_changed', onPov);

      sdkViewer().renderCamera(70, 1.5, 'start');
      sdkViewer().renderCamera(70, 0, 'start');
      sdkViewer().renderCamera(70, 1.5, 'start');
      expect(onPov).not.toHaveBeenCalled();

      sdkViewer().renderCamera(70, 2, 'start');
      expect(onPov).toHaveBeenCalledTimes(1);
      expect(viewer.currAspect).toBe(2);
    });
  });

  describe('controls', () => {
    it("hides and shows the SDK's navigation arrows", async () => {
      const viewer = await create();

      viewer.hideNavigationArrows();
      viewer.showNavigationArrows();

      expect(sdkViewer().deactivateComponent).toHaveBeenCalledWith('direction');
      expect(sdkViewer().activateComponent).toHaveBeenCalledWith('direction');
    });

    it('says it can search by location', () => {
      expect(new MapillaryViewer().supportsLocationSearch()).toBe(true);
    });
  });

  describe('publicViewerLink', () => {
    it("opens Mapillary's own viewer on the image, centered where ours is when we know", () => {
      const viewer = new MapillaryViewer();

      expect(viewer.publicViewerLink('123', { center: [0.25, 0.5] })).toEqual({
        url: 'https://www.mapillary.com/app/?pKey=123&focus=photo&x=0.25&y=0.5',
        i18nKey: 'common:pano-info.view-in-mapillary',
      });
      expect(viewer.publicViewerLink('123', { heading: 10, pitch: 0 }).url)
        .toBe('https://www.mapillary.com/app/?pKey=123&focus=photo');
    });
  });
});
