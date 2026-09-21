/**
 * Infra3dViewer's retry of failed image downloads (#5436): the retry schedule, that the SDK sees exactly one outcome
 * per download, and the batched TileRetries diagnostic.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');
const NO_IMAGERY_ERROR_SRC = fs.readFileSync(path.join(SRC_DIR, 'NoImageryError.js'), 'utf8');
const PANO_VIEWER_SRC = fs.readFileSync(path.join(SRC_DIR, 'PanoViewer.js'), 'utf8');
const INFRA3D_SRC = fs.readFileSync(path.join(SRC_DIR, 'Infra3dViewer.js'), 'utf8');

// utilities.js builds a Bowser parser at load time; nothing here consults it.
window.bowser = {
  getParser: () => ({
    getBrowserName: () => 'Test', getBrowserVersion: () => '1',
    getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
  }),
};
loadGlobalScript('public/js/common/utilities.js');
loadGlobalScript('public/js/common/utilitiesMath.js');
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');

window.eval(`
  class GsvViewer {}
  class MapillaryViewer {}
  class PannellumViewer {}
  class PanoramaxViewer {}
  class PanoData {
    constructor(params) { this.params = params; }
    getPanoId() { return this.params.panoId; }
    getProperty(key) { return this.params[key]; }
  }
  const proj4 = () => [0, 0];
  const moment = (timestamp) => timestamp;
  ${NO_IMAGERY_ERROR_SRC}
  ${PANO_VIEWER_SRC}
  ${INFRA3D_SRC}
  window.Infra3dViewer = Infra3dViewer;
`);
const { Infra3dViewer } = window;

/** A token two hours from expiry, so no renewal runs during a test. */
const freshToken = () => `hdr.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 2 * 60 * 60 }))
  .replace(/=+$/, '')}.sig`;

/** An Infra3d node with the fields #finishRecordingMetadata reads. */
const nodeFor = (id) => ({
  cameraType: 'cubemap',
  frame: {
    id, timestamp: 0, framedatameta: { imagewidth: 1, imageheight: 1, tilesize: 1 }, latitude: 47.4, longitude: 8.5,
    omega: 0, phi: 0,
  },
  spatialEdges: { cached: true, edges: [] },
});

/**
 * Stubs the SDK with an engine whose downloads answer from `outcomes`, one entry per call: true loads, false fails.
 * @param {{outcomes?: boolean[], withEngine?: boolean}} [options]
 * @returns {{requestTexture: jest.Mock, engine: object}|null} The unwrapped download stub and the engine, or null.
 */
function fakeSdk({ outcomes = [], withEngine = true } = {}) {
  const requestTexture = jest.fn((url, priority, onLoad, onError) => {
    if (outcomes.shift()) onLoad({ name: url }, url);
    else onError('[object Event]');
  });
  const sdkViewer = {
    setFilter: async () => {},
    on: () => {},
    moveToKey: async (id) => nodeFor(id),
    deactivateComponent: () => {},
    ...(withEngine ? { _container: { scene: { engine: { requestTexture } } } } : {}),
  };
  const viewer = { _sdk_viewer: sdkViewer, on: () => {}, getCameraView: () => ({ type: 'pano' }) };
  window.infra3dapi = { init: jest.fn(async () => ({ initViewer: async () => viewer, setTokens: () => {} })) };
  return withEngine ? { requestTexture, engine: sdkViewer._container.scene.engine } : null;
}

describe('Infra3dViewer image download retries', () => {
  let mount;
  let diagnostics;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // No jitter, so the waits are exactly TILE_RETRY_MS.
    window.logWebpageActivity = jest.fn();
    mount = document.createElement('div');
    mount.id = 'pano-mount';
    document.body.appendChild(mount);
    diagnostics = jest.fn();
  });

  afterEach(() => {
    mount.remove();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete window.logWebpageActivity;
    delete window.infra3dapi;
  });

  async function createViewer() {
    const viewer = await Infra3dViewer.create(mount, { accessToken: freshToken(), startPanoId: 'SEED' });
    viewer.addListener('diagnostic', diagnostics);
    return viewer;
  }

  it('passes a first-try download straight through without logging', async () => {
    const { requestTexture, engine } = fakeSdk({ outcomes: [true] });
    await createViewer();
    const onLoad = jest.fn();
    const onError = jest.fn();

    engine.requestTexture('tile-url', 300, onLoad, onError, false);
    await jest.advanceTimersByTimeAsync(60 * 1000);

    expect(requestTexture).toHaveBeenCalledTimes(1);
    expect(requestTexture).toHaveBeenCalledWith('tile-url', 300, expect.any(Function), expect.any(Function), false);
    expect(onLoad).toHaveBeenCalledWith({ name: 'tile-url' }, 'tile-url');
    expect(onError).not.toHaveBeenCalled();
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it('retries a failed download after a wait and hands the SDK only the eventual success', async () => {
    const { requestTexture, engine } = fakeSdk({ outcomes: [false, false, true] });
    await createViewer();
    const onLoad = jest.fn();
    const onError = jest.fn();

    engine.requestTexture('tile-url', 300, onLoad, onError, false);
    expect(requestTexture).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(499);
    expect(requestTexture).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(requestTexture).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1500);
    expect(requestTexture).toHaveBeenCalledTimes(3);

    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(Infra3dViewer.TILE_RETRY_LOG_DELAY_MS);
    expect(diagnostics).toHaveBeenCalledWith('TileRetries', { recovered: '1', failed: '0' });
  });

  it('passes the failure on once the retries run out, and logs a pano of bad tiles as one line', async () => {
    const { requestTexture, engine } = fakeSdk({ outcomes: [] }); // Every download fails.
    await createViewer();
    const onErrors = [jest.fn(), jest.fn()];

    engine.requestTexture('tile-a', 300, jest.fn(), onErrors[0], false);
    engine.requestTexture('tile-b', 300, jest.fn(), onErrors[1], false);
    await jest.advanceTimersByTimeAsync(500 + 1500 + 4000);

    expect(requestTexture).toHaveBeenCalledTimes(8); // One try and three retries, for each of the two tiles.
    expect(onErrors[0]).toHaveBeenCalledTimes(1);
    expect(onErrors[1]).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(Infra3dViewer.TILE_RETRY_LOG_DELAY_MS);
    expect(diagnostics).toHaveBeenCalledTimes(1);
    expect(diagnostics).toHaveBeenCalledWith('TileRetries', { recovered: '0', failed: '2' });
  });

  it('stops retrying once the viewer is off the page', async () => {
    const { requestTexture, engine } = fakeSdk({ outcomes: [] });
    await createViewer();
    const onError = jest.fn();

    engine.requestTexture('tile-url', 300, jest.fn(), onError, false);
    mount.remove();
    await jest.advanceTimersByTimeAsync(500);

    expect(requestTexture).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("lets the SDK's own re-request of a URL that's waiting on a retry through once, without a second chain", async () => {
    const { requestTexture, engine } = fakeSdk({ outcomes: [] });
    await createViewer();
    const onError = jest.fn();

    engine.requestTexture('tile-url', 300, jest.fn(), jest.fn(), false);
    engine.requestTexture('tile-url', 300, jest.fn(), onError, false);
    expect(onError).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(500 + 1500 + 4000);
    expect(requestTexture).toHaveBeenCalledTimes(5); // The first chain's four tries, plus the one pass-through.
  });

  it('logs a batch within the window even while failures keep coming', async () => {
    const { engine } = fakeSdk({ outcomes: [] });
    await createViewer();

    // tile-a gives up at 6 s, which opens the window; tile-b gives up at 10 s, inside it. The batch still goes at
    // 11 s rather than waiting for failures to stop.
    engine.requestTexture('tile-a', 300, jest.fn(), jest.fn(), false);
    await jest.advanceTimersByTimeAsync(4000);
    engine.requestTexture('tile-b', 300, jest.fn(), jest.fn(), false);
    await jest.advanceTimersByTimeAsync(6999);
    expect(diagnostics).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(diagnostics).toHaveBeenCalledWith('TileRetries', { recovered: '0', failed: '2' });
  });

  it('logs when the SDK has no engine to wrap', async () => {
    fakeSdk({ withEngine: false });
    await createViewer();

    expect(window.logWebpageActivity).toHaveBeenCalledWith('PanoViewer_TileRetryUnavailable', true);
  });
});
