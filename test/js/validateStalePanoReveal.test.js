/**
 * Tests that Validate never paints a pano the current label doesn't belong to, in
 * public/js/validate/src/panorama/PanoManager.js (`#showPannellumPano`, `setPanorama`).
 *
 * The Pannellum fallback viewer is reused across labels so its WebGL context survives, which means its canvas still
 * holds the last pano it drew. Revealing that canvas before the new image loaded put an earlier label's imagery on
 * screen for the length of the download — with this label's marker on it — and validators answered the question
 * against it (#5206). The load now happens with the canvas laid out but unpainted, and the swap happens in one step
 * once the image is really there.
 *
 * The assertions are about what a validator could see at each instant, so they read `display`/`visibility` off the
 * two canvases rather than trusting the call order. Fake viewers throughout; no imagery is involved.
 */

const fs = require('fs');
const path = require('path');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoManager.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');

/**
 * Let every already-queued microtask run, so an assertion about a load in flight isn't really an assertion about how
 * many `await` hops the production code happens to take to reach it.
 * @returns {Promise<void>}
 */
async function settlePending() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * Load a bare `class` declaration out of a production file. The Grunt bundle concatenates these into page scope, so
 * wrap the source in an IIFE that returns the named class (same trick as validateViewerSwapListeners.test.js).
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
  const src = fs.readFileSync(filePath, 'utf8');
  return (0, eval)('(() => {\n' + src + '\nreturn ' + className + ';\n})()');
}

describe('Validate only paints the fallback canvas once it holds this label\'s pano (issue #5206)', () => {
  let panoManager;
  let primaryViewer;
  let pannellumViewer;
  let panoData;
  let primaryCanvas;
  let pannellumCanvas;
  let logo;         // the stubbed source/primary logo control
  let attribution;  // the stubbed imagery-attribution pill

  const backupImage = { panoId: 'backup-pano', cameraHeading: 90 };

  /** Build a fake viewer that resolves its loads immediately. */
  function makeFakeViewer() {
    return {
      setPano: jest.fn(() => Promise.resolve(panoData)),
      addListener: jest.fn(),
      resize: jest.fn(),
      setPov: jest.fn(),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
    };
  }

  /** What a validator can see in the pano area right now. */
  function visibleCanvas() {
    const showing = (el) => el.style.display !== 'none' && el.style.visibility !== 'hidden';
    if (showing(pannellumCanvas)) return 'pannellum';
    if (showing(primaryCanvas)) return 'primary';
    return 'none';
  }

  /** Make the primary viewer reject, the way it does for imagery that has gone from the provider. */
  function primaryViewerFails() {
    primaryViewer.setPano = jest.fn(() => Promise.reject(new Error('imagery expired')));
  }

  /**
   * Hold the next Pannellum load open so a test can look at the screen while it is in flight.
   * @returns {{resolve: Function, reject: Function}} Controls for settling that load.
   */
  function holdPannellumLoad() {
    const controls = {};
    const gate = new Promise((resolve, reject) => {
      controls.resolve = () => resolve(panoData);
      controls.reject = () => reject(new Error('backup image failed'));
    });
    pannellumViewer.loadPano = jest.fn(() => gate);
    global.PannellumViewer.create = jest.fn(() => gate.then(() => pannellumViewer));
    return controls;
  }

  beforeEach(async () => {
    document.body.innerHTML = '<div id="pano-holder"><div id="svv-panorama"></div></div>';

    global.util = {};
    (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8'));
    util.isMobile = () => false;

    logo = { showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() };
    attribution = { show: jest.fn(), hide: jest.fn() };
    global.createPanoViewerLogo = jest.fn(() => logo);
    global.createPanoAttribution = jest.fn(() => attribution);
    global.GsvViewer = class GsvViewer {};
    global.MapillaryViewer = class MapillaryViewer {};
    global.svv = {
      tracker: { push: jest.fn() },
      panoStore: { addPanoMetadata: jest.fn() },
      ui: { viewer: { date: { text: jest.fn() } } },
    };

    panoData = { getPanoId: () => 'pano1', getProperty: () => ({ format: () => 'Jun 2026' }) };
    primaryViewer = makeFakeViewer();
    pannellumViewer = makeFakeViewer();
    pannellumViewer.currPanoData = panoData;
    pannellumViewer.loadPano = jest.fn(() => Promise.resolve(panoData));

    global.PannellumViewer = class PannellumViewer {
      static create() { return Promise.resolve(pannellumViewer); }
    };
    const FakeViewerType = class FakeViewerType {
      static create() { return Promise.resolve(primaryViewer); }
    };

    const PanoManager = loadClassFromFile(PANO_MANAGER_PATH, 'PanoManager');
    panoManager = await PanoManager.create(FakeViewerType, 'token', 'pano1');

    primaryCanvas = document.getElementById('svv-panorama');
    pannellumCanvas = document.getElementById('svv-panorama-pannellum');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete global.util;
    delete global.createPanoViewerLogo;
    delete global.createPanoAttribution;
    delete global.GsvViewer;
    delete global.MapillaryViewer;
    delete global.PannellumViewer;
    delete global.svv;
  });

  test('the outgoing label stays on screen while the fallback image downloads', async () => {
    primaryViewerFails();
    const load = holdPannellumLoad();

    const inFlight = panoManager.setPanorama('pano2', backupImage);
    await settlePending();

    // This is the bug: the fallback canvas held an earlier label's pano, and revealing it here showed that pano.
    expect(visibleCanvas()).toBe('primary');

    load.resolve();
    await inFlight;
    expect(visibleCanvas()).toBe('pannellum');
  });

  test('the fallback canvas is laid out while it loads, so the viewer can measure itself', async () => {
    primaryViewerFails();
    const load = holdPannellumLoad();

    const inFlight = panoManager.setPanorama('pano2', backupImage);
    await settlePending();

    // A display:none element has no size, and a viewer only measures the box it is mounted in.
    expect(pannellumCanvas.style.display).not.toBe('none');
    expect(pannellumCanvas.style.visibility).toBe('hidden');

    load.resolve();
    await inFlight;
  });

  test('the logo and attribution swap with the image, not before it', async () => {
    primaryViewerFails();
    const load = holdPannellumLoad();

    const inFlight = panoManager.setPanorama('pano2', backupImage);
    await settlePending();

    // Crediting our own copy over the previous label's provider imagery would misattribute it.
    expect(logo.showSourceLogo).not.toHaveBeenCalled();
    expect(attribution.show).not.toHaveBeenCalled();

    load.resolve();
    await inFlight;
    expect(logo.showSourceLogo).toHaveBeenCalled();
    expect(attribution.show).toHaveBeenCalled();
  });

  test('a fallback that never loads leaves the outgoing label up rather than a blank pano', async () => {
    primaryViewerFails();
    const load = holdPannellumLoad();

    const inFlight = panoManager.setPanorama('pano2', backupImage);
    await settlePending();
    load.reject();
    const result = await inFlight;

    // setPanorama reports the failure by returning null (#4810); what it must not do is leave a canvas showing an
    // unrelated pano behind the caller's back.
    expect(result).toBeNull();
    expect(visibleCanvas()).toBe('none');
  });

  test('a second fallback label keeps the first one on screen until its own image arrives', async () => {
    primaryViewerFails();
    await panoManager.setPanorama('pano2', backupImage);
    expect(visibleCanvas()).toBe('pannellum');

    const load = holdPannellumLoad();
    const inFlight = panoManager.setPanorama('pano3', { panoId: 'backup-pano-2', cameraHeading: 12 });
    await settlePending();

    // Already the right canvas, and it holds the outgoing label's imagery — the honest thing to keep showing.
    expect(visibleCanvas()).toBe('pannellum');
    expect(pannellumCanvas.style.visibility).not.toBe('hidden');

    load.resolve();
    await inFlight;
    expect(visibleCanvas()).toBe('pannellum');
  });

  test('handing the pano back to the primary viewer takes the fallback canvas out of the layout', async () => {
    primaryViewerFails();
    await panoManager.setPanorama('pano2', backupImage);

    primaryViewer.setPano = jest.fn(() => Promise.resolve(panoData));
    await panoManager.setPanorama('pano3', null);

    // Left in the layout it would sit over the primary viewer and swallow its pointer events.
    expect(pannellumCanvas.style.display).toBe('none');
    expect(visibleCanvas()).toBe('primary');
  });
});

describe('Validate skips a live attempt it already knows will fail (issue #5206)', () => {
  let panoManager;
  let primaryViewer;
  let pannellumViewer;
  let panoData;

  const backupImage = { panoId: 'backup-pano', cameraHeading: 90 };

  beforeEach(async () => {
    document.body.innerHTML = '<div id="pano-holder"><div id="svv-panorama"></div></div>';

    global.util = {};
    (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8'));
    util.isMobile = () => false;

    global.createPanoViewerLogo = jest.fn(() => ({ showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() }));
    global.createPanoAttribution = jest.fn(() => ({ show: jest.fn(), hide: jest.fn() }));
    global.GsvViewer = class GsvViewer {};
    global.MapillaryViewer = class MapillaryViewer {};
    global.svv = {
      tracker: { push: jest.fn() },
      panoStore: { addPanoMetadata: jest.fn() },
      ui: { viewer: { date: { text: jest.fn() } } },
    };

    panoData = { getPanoId: () => 'pano1', getProperty: () => ({ format: () => 'Jun 2026' }) };
    primaryViewer = {
      setPano: jest.fn(() => Promise.resolve(panoData)),
      addListener: jest.fn(),
      resize: jest.fn(),
      setPov: jest.fn(),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
    };
    pannellumViewer = {
      addListener: jest.fn(),
      resize: jest.fn(),
      setPov: jest.fn(),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
      currPanoData: panoData,
      loadPano: jest.fn(() => Promise.resolve(panoData)),
    };

    global.PannellumViewer = class PannellumViewer {
      static create() { return Promise.resolve(pannellumViewer); }
    };
    const FakeViewerType = class FakeViewerType {
      static create() { return Promise.resolve(primaryViewer); }
    };

    const PanoManager = loadClassFromFile(PANO_MANAGER_PATH, 'PanoManager');
    panoManager = await PanoManager.create(FakeViewerType, 'token', 'pano1');
    primaryViewer.setPano.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete global.util;
    delete global.createPanoViewerLogo;
    delete global.createPanoAttribution;
    delete global.GsvViewer;
    delete global.MapillaryViewer;
    delete global.PannellumViewer;
    delete global.svv;
  });

  test('an expired label with a backup goes straight to the fallback', async () => {
    await panoManager.setPanorama('pano2', backupImage, true);

    expect(primaryViewer.setPano).not.toHaveBeenCalled();
    expect(panoManager.getActiveViewerName()).toBe('Pannellum');
  });

  test('an expired label with no backup still tries the live viewer', async () => {
    // `expired` comes from a nightly sweep that re-checks its own verdicts, and with nothing to fall back to the
    // live viewer is the label's last chance — skipping it would drop a label that would have rendered.
    await panoManager.setPanorama('pano2', null, true);

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano2');
    expect(panoManager.getActiveViewerName()).toBe('Default');
  });

  test('a label that is not flagged expired tries the live viewer even when a backup exists', async () => {
    await panoManager.setPanorama('pano2', backupImage);

    expect(primaryViewer.setPano).toHaveBeenCalledWith('pano2');
    expect(panoManager.getActiveViewerName()).toBe('Default');
  });
});
