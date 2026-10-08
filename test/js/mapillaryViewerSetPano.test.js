/**
 * Tests for how MapillaryViewer.setPano tells a pano that is gone from one that is only slow (issue #5581), in
 * frontend/js/common/pano-viewer/MapillaryViewer.js.
 *
 * A single 12 s race over the move *and* the linked-pano wait, whose every failure comes out as the same untyped
 * Error, reads to Validate as "no imagery" and drops labels whose panos the Graph API still serves. So the
 * assertions here are about the type of each rejection, which is what callers decide from: NoImageryError only when
 * Graph says the image is missing; PanoLoadTimeoutError when the move ran out of time, or Graph couldn't be asked
 * whatever the SDK said; the SDK's own error when the image exists. And a linked-pano wait that never finishes must
 * cost the pano its arrows, never the pano.
 *
 * MapillaryViewer is a top-level `class` written for Grunt concatenation, so the sources are eval'd into jsdom with
 * stubs for the sibling classes PanoViewer's constructor compares `new.target` against. The SDK and fetch are fakes.
 */
const { loadGlobalScript, realUtil, loadModules } = require('./loadGlobalScript');


// The linked-pano headings convert through util.math; utilities.js builds a Bowser parser at load time.
window.bowser = {
  getParser: () => ({
    getBrowserName: () => 'Test', getBrowserVersion: () => '1',
    getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
  }),
};
window.util = realUtil();
loadGlobalScript('frontend/js/common/utilitiesMath.js');
loadGlobalScript('frontend/js/common/pano-viewer/panoUtilities.js');

/**
 * Loads fresh copies of the viewer classes and both error types into the jsdom global scope.
 * @returns {{PanoViewer: Function, MapillaryViewer: Function, NoImageryError: Function,
 *     PanoLoadTimeoutError: Function}}
 */
function loadViewer() {
    Object.assign(window, loadModules('frontend/js/common/pano-viewer/PanoData.js', 'frontend/js/common/pano-viewer/NoImageryError.js', 'frontend/js/common/pano-viewer/PanoLoadTimeoutError.js', 'frontend/js/common/pano-viewer/PanoViewer.js', 'frontend/js/common/pano-viewer/MapillaryViewer.js'));
  return {
    PanoViewer: window.PanoViewer,
    MapillaryViewer: window.MapillaryViewer,
    NoImageryError: window.NoImageryError,
    PanoLoadTimeoutError: window.PanoLoadTimeoutError,
  };
}

/**
 * A mapillary-js Image with the fields _getPanoramaCallback reads.
 * @param {string} id - The image id.
 * @param {boolean} [edgesCached] - Whether its linked panos are already known when the move resolves.
 * @returns {object} The fake image.
 */
function makeImage(id, edgesCached = true) {
  return {
    id,
    compassAngle: 0,
    capturedAt: Date.UTC(2024, 5, 1),
    width: 2048,
    height: 1024,
    lngLat: { lat: 37.54, lng: -77.43 },
    rotation: [0, 0, 0],
    creatorUsername: 'someone',
    _cache: { _spatialEdges: { cached: edgesCached, edges: edgesCached ? [LINK] : [] } },
  };
}

// One panoramic link (direction 9 is Mapillary's code for a pano-to-pano edge).
const LINK = { source: 'pano1', target: 'neighbor', data: { direction: 9, worldMotionAzimuth: 0 } };

/**
 * A mapillary-js Viewer with the surface setPano, setPov and prefetchPano touch.
 * @param {() => Promise<object>} moveTo - What the SDK's moveTo does.
 * @returns {object} The fake SDK viewer, with `emit` to fire one of its events.
 */
function makeSdk(moveTo) {
  const listeners = {};
  return {
    listeners,
    moveTo: jest.fn(moveTo),
    on: jest.fn((event, fn) => { (listeners[event] ??= []).push(fn); }),
    off: jest.fn((event, fn) => { listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn); }),
    getCenter: jest.fn(() => Promise.resolve([0.5, 0.5])),
    getFieldOfView: jest.fn(() => Promise.resolve(70)),
    // MapillaryJS 4.1.2 returns undefined from both, whatever its API docs say (measured in the vendored bundle).
    setCenter: jest.fn(() => undefined),
    setFieldOfView: jest.fn(() => undefined),
    _navigator: {
      _api: { _data: { _accessToken: 'MLY|test' } },
      graphService: { cacheImage$: jest.fn(() => ({ subscribe: jest.fn() })) },
    },
    emit(event, e) { (listeners[event] ?? []).forEach((fn) => fn(e)); },
  };
}

/**
 * A Graph API response for the existence check.
 * @param {number} status - The HTTP status.
 * @param {object} body - The JSON body.
 * @returns {Promise<object>} What fetch resolves with.
 */
function graphAnswers(status, body) {
  return Promise.resolve({ status, json: () => Promise.resolve(body) });
}

const MISSING_BODY = {
  error: { message: 'Unsupported get request. Object with ID does not exist', code: 100, error_subcode: 33 },
};

describe('MapillaryViewer.setPano tells a missing pano from a slow one (issue #5581)', () => {
  let classes;
  let viewer;
  let sdk;

  /**
   * Builds a MapillaryViewer on a fake SDK.
   * @param {() => Promise<object>} moveTo - What the SDK's moveTo does.
   */
  function buildViewer(moveTo) {
    sdk = makeSdk(moveTo);
    viewer = new classes.MapillaryViewer();
    viewer.viewer = sdk;
    viewer.extractPitchRoll = () => ({ pitch: 0, roll: 0 }); // THREE isn't loaded; the angles don't matter here.
  }

  /** A move that never settles, like one stuck on a slow CDN. */
  const hangs = () => new Promise(() => {});

  beforeEach(() => {
    jest.useFakeTimers();
    classes = loadViewer();
    global.fetch = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
  });

  /**
   * Starts a setPano and runs the clock far enough for every deadline in it to pass.
   * @param {string} panoId - The pano to move to.
   * @returns {Promise<*>} The settled outcome: the resolved value, or the rejection wrapped as {error}.
   */
  async function settle(panoId) {
    const outcome = viewer.setPano(panoId).then((value) => value, (error) => ({ error }));
    await jest.advanceTimersByTimeAsync(
      classes.MapillaryViewer.PANO_LOAD_TIMEOUT_MS + classes.MapillaryViewer.EXISTS_CHECK_TIMEOUT_MS + 1,
    );
    return outcome;
  }

  test('a move that succeeds resolves with the pano, its links, and no timer left behind', async () => {
    buildViewer(() => Promise.resolve(makeImage('pano1')));

    const panoData = await viewer.setPano('pano1');

    expect(panoData.getPanoId()).toBe('pano1');
    expect(panoData.getProperty('linkedPanos').map((link) => link.panoId)).toEqual(['neighbor']);
    // A timer left behind per move would pile up on a page that moves often.
    expect(jest.getTimerCount()).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled(); // No existence check on the happy path.
    expect(viewer.changingPanoOurselves).toBe(false);
  });

  test('a move that times out on an image Graph says is missing is a NoImageryError', async () => {
    buildViewer(hangs);
    global.fetch.mockReturnValue(graphAnswers(404, MISSING_BODY));

    const { error } = await settle('gone');

    expect(error).toBeInstanceOf(classes.NoImageryError);
    expect(global.fetch.mock.calls[0][0]).toContain('https://graph.mapillary.com/gone?fields=id');
  });

  test('Graph\'s "does not exist" error code counts as missing even without a 404', async () => {
    buildViewer(hangs);
    global.fetch.mockReturnValue(graphAnswers(400, MISSING_BODY));

    const { error } = await settle('gone');

    expect(error).toBeInstanceOf(classes.NoImageryError);
  });

  test('a move that times out on an image Graph still serves is a PanoLoadTimeoutError, not "no imagery"', async () => {
    buildViewer(hangs);
    global.fetch.mockReturnValue(graphAnswers(200, { id: 'slow' }));

    const { error } = await settle('slow');

    expect(error).toBeInstanceOf(classes.PanoLoadTimeoutError);
    expect(error).not.toBeInstanceOf(classes.NoImageryError);
    expect(error.panoId).toBe('slow');
    expect(error.elapsedMs).toBeGreaterThanOrEqual(classes.MapillaryViewer.PANO_LOAD_TIMEOUT_MS);
  });

  test('a timeout whose existence check can\'t reach Graph is slow, never missing', async () => {
    // "Missing" drops the label, so a guess must never produce it: an unreachable Graph is "unknown".
    buildViewer(hangs);
    global.fetch.mockReturnValue(Promise.reject(new TypeError('Failed to fetch')));

    const { error } = await settle('slow');

    expect(error).toBeInstanceOf(classes.PanoLoadTimeoutError);
  });

  test('a timeout whose existence check never answers is slow once the check gives up', async () => {
    buildViewer(hangs);
    global.fetch.mockReturnValue(new Promise(() => {}));

    const { error } = await settle('slow');

    expect(error).toBeInstanceOf(classes.PanoLoadTimeoutError);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a rate-limited or unauthorized existence check is inconclusive, so the timeout stays slow', async () => {
    buildViewer(hangs);
    const rateLimited = { error: { message: 'Application request limit reached', code: 4 } };
    global.fetch.mockReturnValue(graphAnswers(400, rateLimited));

    const { error } = await settle('slow');

    expect(error).toBeInstanceOf(classes.PanoLoadTimeoutError);
  });

  test('a move the SDK rejects on an image Graph says is missing is a NoImageryError', async () => {
    buildViewer(() => Promise.reject(new Error('MLY image not found')));
    global.fetch.mockReturnValue(graphAnswers(404, MISSING_BODY));

    const { error } = await settle('gone');

    expect(error).toBeInstanceOf(classes.NoImageryError);
    expect(error.cause.message).toBe('MLY image not found');
  });

  test('a move the SDK rejects on an image that exists passes the SDK\'s own error through', async () => {
    const sdkError = new Error('WebGL texture upload failed');
    buildViewer(() => Promise.reject(sdkError));
    global.fetch.mockReturnValue(graphAnswers(200, { id: 'there' }));

    const { error } = await settle('there');

    expect(error).toBe(sdkError);
    expect(error).not.toBeInstanceOf(classes.PanoLoadTimeoutError);
  });

  test('an SDK that fails fast while Graph is unreachable is slow, not missing', async () => {
    // Offline, a 429 or a 5xx makes the SDK's own request reject in milliseconds, never as a TimeoutError, and the
    // existence check then fails on the same network. "Unknown" must still never read as "gone".
    buildViewer(() => Promise.reject(new Error('Request error: 0')));
    global.fetch.mockReturnValue(Promise.reject(new TypeError('Failed to fetch')));

    const { error } = await settle('offline');

    expect(error).toBeInstanceOf(classes.PanoLoadTimeoutError);
    expect(error).not.toBeInstanceOf(classes.NoImageryError);
    expect(error.cause.message).toBe('Request error: 0');
  });

  test('an SDK that fails fast on an image Graph answers 404 for is a NoImageryError', async () => {
    buildViewer(() => Promise.reject(new Error('Response status error')));
    global.fetch.mockReturnValue(graphAnswers(404, {}));

    const { error } = await settle('gone');

    expect(error).toBeInstanceOf(classes.NoImageryError);
  });

  test('Graph\'s code 100 without subcode 33 is a malformed request, not a missing image, so it stays slow', async () => {
    buildViewer(hangs);
    global.fetch.mockReturnValue(graphAnswers(400, { error: { message: 'Invalid parameter', code: 100 } }));

    const { error } = await settle('slow');

    expect(error).toBeInstanceOf(classes.PanoLoadTimeoutError);
  });

  test('a failure reading the loaded image\'s metadata is classified like a failed move', async () => {
    buildViewer(() => Promise.resolve(makeImage('pano1')));
    sdk.getCenter = jest.fn(() => Promise.reject(new Error('Request error: 0')));
    global.fetch.mockReturnValue(Promise.reject(new TypeError('Failed to fetch')));

    const { error } = await settle('pano1');

    expect(error).toBeInstanceOf(classes.PanoLoadTimeoutError);
  });

  test('the existence check hands fetch a signal, so an abandoned check doesn\'t hold a connection open', async () => {
    buildViewer(hangs);
    global.fetch.mockReturnValue(graphAnswers(200, { id: 'slow' }));

    await settle('slow');

    expect(global.fetch.mock.calls[0][1].signal).toBeDefined();
  });

  test('a move a newer one superseded is rethrown as is: no existence check, no error logged', async () => {
    const cancelled = new Error('Request aborted by a subsequent request.');
    cancelled.name = 'CancelMapillaryError';
    buildViewer(() => Promise.reject(cancelled));

    const { error } = await settle('older');

    expect(error).toBe(cancelled);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  test('a superseded call finishing first leaves the flag set for the newer call still in flight', async () => {
    let rejectOlder;
    let resolveNewer;
    buildViewer(() => new Promise(() => {}));
    sdk.moveTo
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectOlder = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve; }));

    const older = viewer.setPano('older').catch((err) => err);
    const newer = viewer.setPano('newer');
    const cancelled = new Error('Request aborted by a subsequent request.');
    cancelled.name = 'CancelMapillaryError';
    rejectOlder(cancelled);
    await older;

    // Cleared here, the newer pano's 'image' event would run updateImageData as though the user had navigated.
    expect(viewer.changingPanoOurselves).toBe(true);

    resolveNewer(makeImage('newer'));
    await newer;
    expect(viewer.changingPanoOurselves).toBe(false);
  });

  test('a failed load clears the flag that makes nav-arrow moves skip their metadata update', async () => {
    buildViewer(hangs);
    global.fetch.mockReturnValue(graphAnswers(200, { id: 'slow' }));

    await settle('slow');

    expect(viewer.changingPanoOurselves).toBe(false);
  });

  test('linked panos that never arrive cost the pano its arrows, not the pano', async () => {
    buildViewer(() => Promise.resolve(makeImage('pano1', false)));

    const outcome = viewer.setPano('pano1');
    await jest.advanceTimersByTimeAsync(classes.MapillaryViewer.SPATIAL_EDGES_TIMEOUT_MS);
    const panoData = await outcome;

    expect(panoData.getPanoId()).toBe('pano1');
    expect(panoData.getProperty('linkedPanos')).toEqual([]);
    expect(sdk.listeners.spatialedges).toEqual([]); // The listener goes with the wait.
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a viewer that opted out of linked panos resolves as soon as the image is set, listening for nothing', async () => {
    buildViewer(() => Promise.resolve(makeImage('pano1', false)));
    viewer.wantsLinkedPanos = false;

    const panoData = await viewer.setPano('pano1');

    expect(panoData.getPanoId()).toBe('pano1');
    expect(panoData.getProperty('linkedPanos')).toEqual([]);
    expect(sdk.listeners.spatialedges ?? []).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('linked panos that arrive late are used, and the wait cleans up after itself', async () => {
    buildViewer(() => Promise.resolve(makeImage('pano1', false)));

    const outcome = viewer.setPano('pano1');
    await jest.advanceTimersByTimeAsync(500);
    sdk.emit('spatialedges', { status: { cached: true, edges: [LINK] } });
    const panoData = await outcome;

    expect(panoData.getProperty('linkedPanos').map((link) => link.panoId)).toEqual(['neighbor']);
    expect(sdk.listeners.spatialedges).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('linked panos reported for a different image are ignored', async () => {
    buildViewer(() => Promise.resolve(makeImage('pano1', false)));

    const outcome = viewer.setPano('pano1');
    await jest.advanceTimersByTimeAsync(100);
    // The previous image's links, which the SDK can still be reporting as the move lands.
    sdk.emit('spatialedges', { status: { cached: true, edges: [{ ...LINK, source: 'previous', target: 'elsewhere' }] } });
    sdk.emit('spatialedges', { status: { cached: true, edges: [{ ...LINK, source: 'pano1' }] } });
    const panoData = await outcome;

    expect(panoData.getProperty('linkedPanos').map((link) => link.panoId)).toEqual(['neighbor']);
  });

  test('the move alone is held to the load deadline, so a slow link wait can\'t fail a pano that loaded', async () => {
    // The move resolves just inside its deadline and the links take their full budget after it: together they run
    // past 12 s, which a deadline over both would have called a failed load.
    buildViewer(() => new Promise((resolve) => {
      setTimeout(() => resolve(makeImage('pano1', false)), classes.MapillaryViewer.PANO_LOAD_TIMEOUT_MS - 100);
    }));

    const outcome = viewer.setPano('pano1');
    await jest.advanceTimersByTimeAsync(
      classes.MapillaryViewer.PANO_LOAD_TIMEOUT_MS + classes.MapillaryViewer.SPATIAL_EDGES_TIMEOUT_MS,
    );

    await expect(outcome).resolves.toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('MapillaryViewer\'s other load-path contracts (issues #5581, #5582)', () => {
  let classes;

  beforeEach(() => {
    classes = loadViewer();
  });

  test('Mapillary paints during a load; the base viewer does not', () => {
    expect(classes.MapillaryViewer.PAINTS_DURING_LOAD).toBe(true);
    expect(classes.PanoViewer.PAINTS_DURING_LOAD).toBe(false);
  });

  test('prefetchPano warms the SDK cache, and a failing SDK internal never reaches the caller', () => {
    const viewer = new classes.MapillaryViewer();
    viewer.viewer = makeSdk(() => Promise.resolve(makeImage('pano1')));
    viewer.prefetchPano('next');
    expect(viewer.viewer._navigator.graphService.cacheImage$).toHaveBeenCalledWith('next');

    jest.spyOn(console, 'warn').mockImplementation(() => {});
    viewer.viewer._navigator.graphService.cacheImage$ = () => { throw new Error('internals moved'); };
    expect(() => viewer.prefetchPano('next')).not.toThrow();
    console.warn.mockRestore();
  });

  test('setPov hands the SDK the center and fov and offers nothing to wait on, as the SDK offers nothing', () => {
    // Validate's reveal waits for animation frames because no promise here could mean "applied" (#5582).
    const viewer = new classes.MapillaryViewer();
    const sdk = makeSdk(() => Promise.resolve(makeImage('pano1')));
    viewer.viewer = sdk;
    viewer.currCameraHeading = 0;
    viewer.currCenter = [0.5, 0.5];
    viewer.currAspect = 1.5;

    expect(viewer.setPov({ heading: 90, pitch: 0, zoom: 1 })).toBeUndefined();
    expect(sdk.setCenter).toHaveBeenCalledWith([0.75, 0.5]);
    expect(sdk.setFieldOfView).toHaveBeenCalled();
    expect(viewer.currCenter).toEqual([0.75, 0.5]); // Cached for the synchronous getPov().
  });

  test('_withTimeout names its own rejection, so a caller can tell giving up from the provider failing', async () => {
    jest.useFakeTimers();
    const outcome = classes.PanoViewer._withTimeout(new Promise(() => {}), 10, 'test').catch((err) => err);
    await jest.advanceTimersByTimeAsync(10);
    expect((await outcome).name).toBe('TimeoutError');
    jest.useRealTimers();
  });
});
