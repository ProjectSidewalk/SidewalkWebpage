/**
 * What an Infra3dViewer rejection is allowed to claim about a street (#4918, #5008).
 *
 * StreetSweep only concludes "this street has no imagery ahead" when *every* rejection it collected is a
 * NoImageryError; a single untyped one means the provider never answered, and the labeler is told to retry rather
 * than moved on. So a viewer that answers "nothing usable here" with a plain Error strands the labeler
 * on the street with no way past it — the failure mode #5008 hit on a route through an 11.6 m street, where the only
 * image in range was the one already being stood on.
 */

import { loadModules, mockModule } from './loader.js';

/** The exclusion check only compares pano ids, so the excluded set is built from a PanoData that validates nothing. */
class PanoData {
  constructor(params) { this.params = params; }

  getPanoId() { return this.params.panoId; }
}
mockModule('frontend/js/common/pano-viewer/PanoData.js', () => ({ PanoData }));

/** An Infra3d node with the fields #finishRecordingMetadata reads. `cameraType` decides panoramic vs flat. */
const nodeFor = (id, cameraType = 'cubemap') => ({
  cameraType,
  frame: {
    id,
    timestamp: 0,
    framedatameta: { imagewidth: 1, imageheight: 1, tilesize: 1 },
    latitude: 47.413137835,
    longitude: 8.4747970537,
    omega: 0,
    phi: 0,
  },
  spatialEdges: { cached: true, edges: [] },
});

/** A node whose metadata is still loading, so the filter has to guess from the rendered camera mode. */
const nodeWithoutCameraType = (id) => {
  const node = nodeFor(id);
  delete node.cameraType;
  return node;
};

const SOMEWHERE = { lat: 47.413137835, lng: 8.4747970537 };

describe('Infra3dViewer.setLocation rejections', () => {
  let Infra3dViewer;
  let NoImageryError;

  beforeAll(async () => {
    mockModule('frontend/js/common/pano-viewer/sdk/infra3d.js', () => ({ infra3dapi: {}, proj4: () => [0, 0] }));
    ({ Infra3dViewer, NoImageryError } = await loadModules('frontend/js/common/pano-viewer/Infra3dViewer.js',
      'frontend/js/common/pano-viewer/NoImageryError.js'));
    await Infra3dViewer.preloadLibrary();
  });

  /**
     * @param {object|Error} node - The node movePosition resolves with, or an error for it to reject with.
     */
  const viewerLanding = (node, cameraViewType = 'flat') => {
    const viewer = new Infra3dViewer();
    viewer.currNode = nodeFor('PREV');
    viewer.viewer = {
      getCameraView: () => ({ type: cameraViewType }),
      _sdk_viewer: {
        movePosition: () => (node instanceof Error ? Promise.reject(node) : Promise.resolve(node)),
        moveToKey: (id) => Promise.resolve(nodeFor(id)),
      },
    };
    return viewer;
  };

  it('types an excluded pano as NoImageryError', async () => {
    const viewer = viewerLanding(nodeFor('ALREADY_VISITED'));
    const excluded = new Set([new PanoData({ panoId: 'ALREADY_VISITED' })]);

    await expect(viewer.setLocation(SOMEWHERE, excluded)).rejects.toBeInstanceOf(NoImageryError);
  });

  it('types a non-panoramic image as NoImageryError', async () => {
    const viewer = viewerLanding(nodeFor('FLAT_PHOTO', 'mono'));

    await expect(viewer.setLocation(SOMEWHERE)).rejects.toBeInstanceOf(NoImageryError);
  });

  it('leaves a guessed non-panoramic verdict untyped, since the SDK never gave us a camera type', async () => {
    // The seed image on a page load is the case that reaches this: its metadata is still arriving, so the filter
    // falls back to the rendered camera mode. Typing that guess would let a wrong one report a street with good
    // imagery and reload the page (#4918).
    const viewer = viewerLanding(nodeWithoutCameraType('SEED_IMAGE'));

    await expect(viewer.setLocation(SOMEWHERE)).rejects.not.toBeInstanceOf(NoImageryError);
  });

  it('accepts a guessed panoramic verdict, so a slow-loading seed image is not bounced', async () => {
    const viewer = viewerLanding(nodeWithoutCameraType('SEED_IMAGE'), 'pano');

    await expect(viewer.setLocation(SOMEWHERE)).resolves.toBeDefined();
  });

  it('leaves an SDK failure untyped, so it cannot be recorded against the street', async () => {
    const viewer = viewerLanding(new Error('movePosition blew up'));

    await expect(viewer.setLocation(SOMEWHERE)).rejects.not.toBeInstanceOf(NoImageryError);
  });

  it('lets a sweep of excluded-pano rejections conclude the street is out of imagery', async () => {
    const viewer = viewerLanding(nodeFor('ALREADY_VISITED'));
    const excluded = new Set([new PanoData({ panoId: 'ALREADY_VISITED' })]);

    const failures = [];
    for (let probe = 0; probe < 2; probe++) {
      await viewer.setLocation(SOMEWHERE, excluded).catch((err) => failures.push(err));
    }

    expect(NoImageryError.allNoImagery(failures)).toBe(true);
  });
});
