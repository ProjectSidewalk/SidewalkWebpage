/**
 * Tests for Infra3dViewer's camera and lookups (frontend/js/common/pano-viewer/Infra3dViewer.js): turning a frame's
 * omega/phi pose and the SDK's camera view into the heading, pitch and zoom the rest of the tool speaks, aiming the
 * camera back, the metadata and links read off a loaded pano, and the position and nearest-pano lookups Explore's
 * arrows and crumbs use. The SDK is the fake in infra3dViewerHarness.js. (#5840)
 */

import { fakeInfra3dSdk, infra3dSdk, jwtExpiringAt, loadInfra3dViewer, nodeFor } from './infra3dViewerHarness.js';

const Infra3dViewer = await loadInfra3dViewer();

/** A camera pose (degrees) Infra3d reports for a level camera facing north. */
const LEVEL = { omega: 90, phi: 0 };

/**
 * An Infra3d node with the given camera pose.
 * @param {string} id - The frame id.
 * @param {{omega: number, phi: number}} pose - The camera's pose, in degrees.
 * @param {object} [overrides] - Node fields to replace.
 * @returns {object} The node.
 */
const nodeWithPose = (id, pose, overrides = {}) => {
  const node = nodeFor(id);
  Object.assign(node.frame, pose);
  return Object.assign(node, overrides);
};

/** The heading in degrees of atan(1 / (sin 30° cos 30°)), the quadrant-one answer for a 30°/30° tilt. */
const TILT_HEADING = Math.atan(0.5 / (0.5 * Math.cos(Math.PI / 6))) * 180 / Math.PI;

describe('Infra3dViewer camera', () => {
  let mount;
  let sdk;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="pano-mount"></div>';
    mount = document.getElementById('pano-mount');
    vi.spyOn(mount, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 400 });
  });

  afterEach(() => {
    infra3dSdk.infra3dapi = {};
  });

  /**
   * Brings a viewer up at a start node.
   * @param {object} [start] - The node the viewer starts on.
   * @returns {Promise<object>} The viewer.
   */
  async function create(start = nodeWithPose('SEED', LEVEL)) {
    sdk = fakeInfra3dSdk({ nodes: { SEED: start } });
    return Infra3dViewer.create(mount, {
      accessToken: jwtExpiringAt(Date.now() + 60 * 60 * 1000), startPanoId: 'SEED', defaultNavigation: false,
    });
  }

  describe('the pano on screen', () => {
    it('records its position, size, date and pose, and its links to other panos only', async () => {
      const ahead = { to: 'AHEAD', data: { direction: 9, worldMotionAzimuth: Math.PI / 2 } };
      const backCamera = { to: 'BACK', data: { direction: 4, worldMotionAzimuth: 0 } };
      const start = nodeWithPose('SEED', LEVEL, { spatialEdges: { cached: true, edges: [ahead, backCamera] } });
      start.frame.framedatameta = { imagewidth: 2048, imageheight: 2048, tilesize: 512 };
      const viewer = await create(start);

      expect(viewer.getPosition()).toEqual({ lat: 47.413137835, lng: 8.4747970537 });
      // A motion azimuth of π/2 (counter-clockwise from east) is due north.
      expect(viewer.getLinkedPanos()).toEqual([{ panoId: 'AHEAD', heading: 0 }]);
      expect(viewer.currPanoData.getProperty('width')).toBe(8192);
      expect(viewer.currPanoData.getProperty('height')).toBe(4096);
      expect(viewer.currPanoData.getProperty('tileWidth')).toBe(512);
      expect(viewer.currPanoData.getProperty('source')).toBe('infra3d');
    });

    it("waits for the first pano's links when the SDK hasn't worked them out yet", async () => {
      let pushEdges;
      const edges = { cached: false, edges: [] };
      const unsubscribe = vi.fn();
      const start = nodeWithPose('SEED', LEVEL, {
        spatialEdges: edges,
        spatialEdges$: { subscribe: (next) => { pushEdges = next; return { unsubscribe }; } },
      });
      let ready = false;
      const created = create(start).then((viewer) => { ready = true; return viewer; });
      await vi.advanceTimersByTimeAsync(0);

      pushEdges(edges);
      await vi.advanceTimersByTimeAsync(0);
      expect(ready).toBe(false);

      edges.cached = true;
      edges.edges = [{ to: 'AHEAD', data: { direction: 9, worldMotionAzimuth: Math.PI / 2 } }];
      pushEdges(edges);
      const viewer = await created;

      expect(viewer.getLinkedPanos().map((link) => link.panoId)).toEqual(['AHEAD']);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('refuses a flat photo as the very first pano, with no previous pano to fall back to', async () => {
      await expect(create(nodeWithPose('SEED', LEVEL, { cameraType: 'mono' })))
        .rejects.toMatchObject({ name: 'NoImageryError', message: 'Non-panoramic image: SEED' });
      // Nothing to move back to.
      expect(sdk.sdkViewer.moveToKey).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPov', () => {
    it('adds the camera view to the frame\'s own pose', async () => {
      const viewer = await create();
      sdk.viewer.cameraView = { type: 'pano', lon: 30, lat: -10, fov: 60 };

      const pov = viewer.getPov();

      expect(pov.heading).toBeCloseTo(30, 9);
      expect(pov.pitch).toBeCloseTo(-10, 9);
    });

    it('reports a zoom from the vertical fov at the container\'s shape, wider for a wider box', async () => {
      const viewer = await create();
      const landscape = viewer.getPov().zoom;

      mount.getBoundingClientRect.mockReturnValue({ width: 400, height: 400 });

      expect(viewer.getPov().zoom).toBeGreaterThan(landscape);
    });

    it('keeps answering from the previous pano while the next one loads', async () => {
      const viewer = await create();
      let land;
      sdk.sdkViewer.moveToKey.mockImplementationOnce(() => new Promise((resolve) => { land = resolve; }));
      sdk.viewer.cameraView = { type: 'pano', lon: 15, lat: 0, fov: 60 };

      const moving = viewer.setPano('NEXT');
      expect(viewer.getPov().heading).toBeCloseTo(15, 9);

      viewer.setPov({ heading: 40, pitch: 0, zoom: 1 });
      expect(sdk.viewer.setCameraView).toHaveBeenLastCalledWith(expect.objectContaining({ lon: 40 }), false);

      land(nodeWithPose('NEXT', LEVEL));
      await moving;
    });

    it.each([
      ['tilted right and forward', { omega: 30, phi: -30 }, TILT_HEADING],
      ['tilted right and back', { omega: -30, phi: -30 }, 180 - TILT_HEADING],
      ['tilted left and back', { omega: -30, phi: 30 }, 180 + TILT_HEADING],
      ['tilted left and forward', { omega: 30, phi: 30 }, 360 - TILT_HEADING],
      ['level, facing north', LEVEL, 0],
    ])('reads the heading of a frame %s off its pose', async (_name, pose, heading) => {
      const viewer = await create(nodeWithPose('SEED', pose));

      expect(viewer.getPov().heading).toBeCloseTo(heading, 9);
    });
  });

  describe('setPov', () => {
    it('turns the camera by the difference from the frame\'s pose, the short way round', async () => {
      const viewer = await create();

      viewer.setPov({ heading: 270, pitch: 10, zoom: 1 });

      expect(sdk.viewer.setCameraView).toHaveBeenCalledWith(expect.objectContaining({ type: 'pano', lon: -90 }), false);
      expect(sdk.viewer.setCameraView.mock.calls[0][0].lat).toBeCloseTo(10, 9);
    });

    it('turns down the short way too', async () => {
      const viewer = await create();

      viewer.setPov({ heading: 0, pitch: -20, zoom: 1 });

      expect(sdk.viewer.setCameraView.mock.calls[0][0].lat).toBeCloseTo(-20, 9);
    });

    it('converts a zoom to the vertical fov at the container\'s shape, and keeps the fov when given none', async () => {
      const viewer = await create();

      viewer.setPov({ heading: 0, pitch: 0, zoom: 1 });
      // Zoom 1 is 89.75° across; the box is 3:2.
      const expected = 2 * Math.atan(Math.tan((89.75 / 2) * Math.PI / 180) / 1.5) * 180 / Math.PI;
      expect(sdk.viewer.setCameraView.mock.calls[0][0].fov).toBeCloseTo(expected, 9);

      viewer.setPov({ heading: 0, pitch: 0 });
      expect(sdk.viewer.setCameraView.mock.calls[1][0].fov).toBe(60);
    });
  });

  describe('controls', () => {
    it('hides and shows the SDK\'s arrows, and re-measures at once on a resize', async () => {
      const viewer = await create();
      sdk.sdkViewer.deactivateComponent.mockClear();

      viewer.hideNavigationArrows();
      viewer.showNavigationArrows();
      viewer.resize();

      expect(sdk.sdkViewer.deactivateComponent).toHaveBeenCalledWith('direction');
      expect(sdk.sdkViewer.activateComponent).toHaveBeenCalledWith('direction');
      expect(sdk.sdkViewer.resize).toHaveBeenCalledTimes(1);
    });

    it('says it can search by location', () => {
      expect(new Infra3dViewer().supportsLocationSearch()).toBe(true);
    });
  });

  describe('lookupPanoPosition', () => {
    /**
     * Gives the SDK a graph holding these nodes.
     * @param {Record<string, {lat: number, lon: number}>} positions - Node positions, by key.
     */
    function graphHolds(positions) {
      const graph = { hasNode: (key) => key in positions, getNode: (key) => ({ latLon: positions[key] }) };
      sdk.sdkViewer._navigator.graphService._graph$ = {
        subscribe: (next) => { next(graph); return { unsubscribe: () => {} }; },
      };
    }

    it("answers from the SDK's graph, and null for a key it doesn't hold", async () => {
      const viewer = await create();
      graphHolds({ AHEAD: { lat: 47.4, lon: 8.5 } });

      expect(await viewer.lookupPanoPosition('AHEAD')).toEqual({ lat: 47.4, lng: 8.5 });
      expect(await viewer.lookupPanoPosition('ELSEWHERE')).toBeNull();
    });

    it('answers null when the graph has not been built or cannot be read', async () => {
      const viewer = await create();
      sdk.sdkViewer._navigator.graphService._graph$ = { subscribe: () => ({ unsubscribe: () => {} }) };
      expect(await viewer.lookupPanoPosition('AHEAD')).toBeNull();

      sdk.sdkViewer._navigator.graphService._graph$ = { subscribe: () => { throw new Error('internals moved'); } };
      expect(await viewer.lookupPanoPosition('AHEAD')).toBeNull();
    });
  });

  describe('findPanoNear', () => {
    const HERE = { lat: 47.413137835, lng: 8.4747970537 };

    /**
     * Makes the SDK's nearest-frame query answer once.
     * @param {(observer: {next: Function, error: Function}) => void} answer - What the query does with its observer.
     */
    function knnAnswers(answer) {
      sdk.sdkViewer._navigator._api.imagesByKNN$ = vi.fn(() => ({ subscribe: answer }));
    }

    /**
     * A nearest frame as the SDK reports it.
     * @param {object} [overrides] - Fields to replace.
     * @returns {object} The frame.
     */
    const frame = (overrides = {}) => ({
      key: 'NEAR', camera_projection_type: 'cubemap', l: { lat: HERE.lat + 0.00005, lon: HERE.lng }, ...overrides,
    });

    it('names the nearest 360° frame and where it is, without moving', async () => {
      const viewer = await create();
      knnAnswers(({ next }) => next(frame()));

      expect(await viewer.findPanoNear(HERE)).toEqual({ panoId: 'NEAR', lat: HERE.lat + 0.00005, lng: HERE.lng });
      expect(sdk.sdkViewer._navigator._api.imagesByKNN$).toHaveBeenCalledWith(HERE.lng, HERE.lat, 4326);
      expect(viewer.getPanoId()).toBe('SEED');
    });

    it('answers null for a flat photo, a frame out of range, or one already excluded', async () => {
      const viewer = await create();

      knnAnswers(({ next }) => next(frame({ camera_projection_type: 'mono' })));
      expect(await viewer.findPanoNear(HERE)).toBeNull();

      knnAnswers(({ next }) => next(frame({ l: { lat: HERE.lat + 0.001, lon: HERE.lng } })));
      expect(await viewer.findPanoNear(HERE)).toBeNull();

      knnAnswers(({ next }) => next(frame({ key: 'SEED' })));
      expect(await viewer.findPanoNear(HERE, new Set([viewer.currPanoData]))).toBeNull();
    });

    it("answers null where the SDK finds no frame at all, which it says with a bare string", async () => {
      const viewer = await create();
      knnAnswers(({ error }) => error('No frame found'));

      expect(await viewer.findPanoNear(HERE)).toBeNull();
    });

    it('fails on any other SDK error, as an Error whatever the SDK threw', async () => {
      const viewer = await create();

      knnAnswers(({ error }) => error('Request failed'));
      await expect(viewer.findPanoNear(HERE)).rejects.toThrow('Request failed');

      const sdkError = new TypeError('Failed to fetch');
      knnAnswers(({ error }) => error(sdkError));
      await expect(viewer.findPanoNear(HERE)).rejects.toBe(sdkError);
    });
  });
});
