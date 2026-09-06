/**
 * Tests that Validate never paints a pano the current label doesn't belong to, in
 * public/js/validate/src/panorama/PanoManager.js (`#showPannellumPano`, `setPanorama`).
 *
 * The Pannellum fallback viewer is reused across labels so its WebGL context survives, which means its canvas
 * carries whatever pano it last drew — an earlier label's. Painting it before the new image has loaded would put
 * that pano on screen for the length of the download, with this label's marker on it, and a validator would answer
 * the question against it (#5206). So the load runs against a laid-out but unpainted canvas, and the swap happens
 * in one step once the image is really there.
 *
 * The assertions are about what a validator could see at each instant, so they read `display`/`visibility` off the
 * two canvases rather than trusting the call order. Fake viewers throughout; no imagery is involved.
 */

const fs = require('fs');
const path = require('path');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoManager.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');

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
   *
   * `started` resolves from inside the mock, which is the moment the production code has actually reached the load.
   * Awaiting that rather than a fixed number of microtask ticks keeps the mid-flight assertions from depending on
   * how many `await` hops the call path happens to take.
   *
   * @returns {{started: Promise<void>, resolve: Function, reject: Function}} Controls for settling that load.
   */
  function holdPannellumLoad() {
    const controls = {};
    const gate = new Promise((resolve, reject) => {
      controls.resolve = () => resolve(panoData);
      controls.reject = () => reject(new Error('backup image failed'));
    });
    controls.started = new Promise((markStarted) => {
      const enter = () => { markStarted(); return gate; };
      pannellumViewer.loadPano = jest.fn(enter);
      global.PannellumViewer.create = jest.fn(() => enter().then(() => pannellumViewer));
    });
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
    await load.started;

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
    await load.started;

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
    await load.started;

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
    await load.started;
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
    await load.started;

    // Already the right canvas, and it holds the outgoing label's imagery — the honest thing to keep showing.
    expect(visibleCanvas()).toBe('pannellum');
    expect(pannellumCanvas.style.visibility).not.toBe('hidden');

    load.resolve();
    await inFlight;
    expect(visibleCanvas()).toBe('pannellum');
  });

  test('a load that finishes after another one failed still leaves its image on screen', async () => {
    // Two loads in flight at once: the older one's failure cleanup takes the canvas out of the layout while the
    // newer one is still downloading. The newer one has to restate the whole visible state, not just the part it
    // expects to have changed, or it reports success over an empty pano area and the caller draws a marker on it.
    primaryViewerFails();
    const first = holdPannellumLoad();
    const firstInFlight = panoManager.setPanorama('pano2', backupImage);
    await first.started;

    const second = holdPannellumLoad();
    const secondInFlight = panoManager.setPanorama('pano3', { panoId: 'backup-pano-2', cameraHeading: 12 });
    await second.started;

    first.reject();
    await firstInFlight;
    second.resolve();
    const result = await secondInFlight;

    expect(result).not.toBeNull();
    expect(panoManager.getProperty('panoLoaded')).toBe(true);
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
