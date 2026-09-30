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
 * The same holds in the other direction (#5453): while the fallback is up, the primary viewer's canvas is out of the
 * layout and still carries the last live label's pano, so a live label that follows a fallback one loads into it
 * unpainted and is revealed only once the load resolves.
 *
 * A viewer that draws a new pano before its load resolves (Mapillary, Panoramax: PanoViewer.PAINTS_DURING_LOAD) breaks
 * the invariant on a live label after a live one too (#5582): mid-load, it shows the incoming pano at the outgoing
 * label's heading. Its canvas is kept unpainted from before the load until renderPanoMarker has applied the label's
 * POV.
 *
 * The assertions are about what a validator could see at each instant, so they read `display`/`visibility` off the
 * two canvases rather than trusting the call order. Fake viewers throughout; no imagery is involved.
 */

const fs = require('fs');
const path = require('path');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoManager.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');
const TIMEOUT_ERROR_PATH = path.resolve(__dirname, '..', '..',
  'public/js/common/pano-viewer/src/PanoLoadTimeoutError.js');

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

describe('Validate only paints a viewer canvas once it holds this label\'s pano (issues #5206, #5453)', () => {
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

  /**
   * Hold the next primary-viewer load open, the way holdPannellumLoad does for the fallback.
   * @returns {{started: Promise<void>, resolve: Function, reject: Function}} Controls for settling that load.
   */
  function holdPrimaryLoad() {
    const controls = {};
    const gate = new Promise((resolve, reject) => {
      controls.resolve = () => resolve(panoData);
      controls.reject = () => reject(new Error('imagery expired'));
    });
    controls.started = new Promise((markStarted) => {
      primaryViewer.setPano = jest.fn(() => { markStarted(); return gate; });
    });
    return controls;
  }

  beforeEach(async () => {
    document.body.innerHTML = '<div id="pano-holder"><div id="svv-panorama"></div></div>';

    global.util = {};
    (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8'));
    util.isMobile = () => false;
    global.i18next = { language: 'en' };

    logo = { showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() };
    attribution = { show: jest.fn(), hide: jest.fn() };
    global.createPanoViewerLogo = jest.fn(() => logo);
    global.createPanoAttribution = jest.fn(() => attribution);
    global.GsvViewer = class GsvViewer {};
    global.MapillaryViewer = class MapillaryViewer {};
    global.PanoLoadTimeoutError = loadClassFromFile(TIMEOUT_ERROR_PATH, 'PanoLoadTimeoutError');
    global.svv = {
      tracker: { push: jest.fn() },
      panoStore: { addPanoMetadata: jest.fn() },
      ui: { viewer: { date: { text: jest.fn() } } },
    };

    panoData = { getPanoId: () => 'pano1', getProperty: () => new Date(2026, 5) };
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
    panoManager = await PanoManager.create(FakeViewerType, 'token');

    primaryCanvas = document.getElementById('svv-panorama');
    pannellumCanvas = document.getElementById('svv-panorama-pannellum');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete global.util;
    delete global.i18next;
    delete global.createPanoViewerLogo;
    delete global.createPanoAttribution;
    delete global.GsvViewer;
    delete global.MapillaryViewer;
    delete global.PanoLoadTimeoutError;
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

    // setPanorama reports the failure with a null panoData (#4810); what it must not do is leave a canvas showing an
    // unrelated pano behind the caller's back.
    expect(result.panoData).toBeNull();
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

    expect(result.panoData).not.toBeNull();
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

  describe('a live label after a fallback one (issue #5453)', () => {
    beforeEach(async () => {
      primaryViewerFails();
      await panoManager.setPanorama('pano2', backupImage);
      expect(visibleCanvas()).toBe('pannellum');
      logo.showPrimaryLogo.mockClear();
      attribution.hide.mockClear();
    });

    test('the outgoing fallback pano stays on screen while the live one loads', async () => {
      const load = holdPrimaryLoad();
      const inFlight = panoManager.setPanorama('pano3', null);
      await load.started;

      // This is the bug: out of the layout, the primary canvas never drew this pano, so revealing it showed the last
      // live label's instead. It has to be switching panos laid out, underneath what the validator still sees.
      expect(visibleCanvas()).toBe('pannellum');
      expect(primaryCanvas.style.display).not.toBe('none');
      expect(logo.showPrimaryLogo).not.toHaveBeenCalled();
      expect(attribution.hide).not.toHaveBeenCalled();

      load.resolve();
      await inFlight;
      expect(visibleCanvas()).toBe('primary');
      expect(logo.showPrimaryLogo).toHaveBeenCalled();
      expect(attribution.hide).toHaveBeenCalled();
    });

    test('the primary canvas is laid out while it loads, so the provider renders at its real size', async () => {
      const load = holdPrimaryLoad();
      const inFlight = panoManager.setPanorama('pano3', null);
      await load.started;

      expect(primaryCanvas.style.display).not.toBe('none');
      expect(primaryCanvas.style.visibility).toBe('hidden');
      // A window resize while the fallback was up never reached the primary viewer, so it has to re-measure here.
      expect(primaryViewer.resize).toHaveBeenCalled();

      load.resolve();
      await inFlight;
      expect(primaryCanvas.style.visibility).not.toBe('hidden');
    });

    test('a live load that fails puts the primary canvas back out of the layout', async () => {
      const load = holdPrimaryLoad();
      const inFlight = panoManager.setPanorama('pano3', { panoId: 'backup-pano-2', cameraHeading: 12 });
      await load.started;
      load.reject();
      await inFlight;

      // The fallback took this label too; a primary canvas left laid out would sit under it, hidden but in the way.
      expect(visibleCanvas()).toBe('pannellum');
      expect(primaryCanvas.style.display).toBe('none');
      expect(primaryCanvas.style.visibility).toBe('');
    });

    test('a failed live load takes the primary canvas out of the layout before the fallback loads', async () => {
      const live = holdPrimaryLoad();
      const inFlight = panoManager.setPanorama('pano3', { panoId: 'backup-pano-2', cameraHeading: 12 });
      await live.started;
      const fallback = holdPannellumLoad();
      live.reject();
      await fallback.started;

      // Checked mid-load: once the fallback settles, its own reveal or #clearViewer hides the primary regardless.
      expect(primaryCanvas.style.display).toBe('none');
      expect(primaryCanvas.style.visibility).toBe('');

      fallback.reject();
      expect((await inFlight).panoData).toBeNull();
      expect(primaryCanvas.style.display).toBe('none');
      expect(primaryCanvas.style.visibility).toBe('');
    });

    test('an empty pano area stays empty until the live pano has loaded', async () => {
      // Both viewers fail, which empties the pano area (#4810); the label after that one is live.
      const failed = holdPrimaryLoad();
      const failing = panoManager.setPanorama('pano3', null);
      await failed.started;
      failed.reject();
      expect((await failing).panoData).toBeNull();
      expect(visibleCanvas()).toBe('none');

      const load = holdPrimaryLoad();
      const inFlight = panoManager.setPanorama('pano4', null);
      await load.started;
      expect(visibleCanvas()).toBe('none');

      load.resolve();
      await inFlight;
      expect(visibleCanvas()).toBe('primary');
    });
  });

  test('a live label after a live one keeps the outgoing pano on screen throughout (issue #5453)', async () => {
    // The common path: the primary canvas is already showing, so nothing about it should change during the load.
    const load = holdPrimaryLoad();
    const inFlight = panoManager.setPanorama('pano2', null);
    await load.started;
    expect(visibleCanvas()).toBe('primary');

    load.resolve();
    await inFlight;
    expect(visibleCanvas()).toBe('primary');
  });
});

describe('a viewer that paints during a load stays unpainted until it faces the label (issue #5582)', () => {
  let panoManager;
  let primaryViewer;
  let panoData;
  let primaryCanvas;
  let frames;     // Animation-frame callbacks, run by hand so a test controls which frame has painted.
  let povSettle;  // Resolves the pending setPov, standing in for the SDK applying the label's POV.

  /** What a validator can see of the primary canvas right now. */
  function primaryShowing() {
    return primaryCanvas.style.display !== 'none' && primaryCanvas.style.visibility !== 'hidden';
  }

  /** @returns {?HTMLElement} The label marker element, if one is drawn. */
  function markerEl() {
    return document.querySelector('.fake-marker');
  }

  /** Runs every frame callback queued so far, as one paint would. */
  function paint() {
    frames.splice(0).forEach((cb) => cb());
  }

  /** Lets queued promise callbacks run, without advancing any frame. */
  async function flushMicrotasks() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  /**
   * Hold the next primary load open.
   * @returns {{started: Promise<void>, resolve: Function, reject: Function}} Controls for settling that load.
   */
  function holdPrimaryLoad() {
    const controls = {};
    const gate = new Promise((resolve, reject) => {
      controls.resolve = () => resolve(panoData);
      controls.reject = (err) => reject(err);
    });
    controls.started = new Promise((markStarted) => {
      primaryViewer.setPano = jest.fn(() => { markStarted(); return gate; });
    });
    return controls;
  }

  /** @returns {object} A fake label with the surface renderPanoMarker reads. */
  function makeLabel() {
    const auditProps = { heading: 200, pitch: -5, zoom: 1, labelType: 'CurbRamp', aiGenerated: false };
    return {
      getOriginalPov: () => ({ heading: 200, pitch: -5, zoom: 1 }),
      getAuditProperty: (key) => auditProps[key],
      getProperty: () => 'CurbRamp',
      getIconUrl: () => '/assets/fake-icon.svg',
      getIconColor: () => '#abcdef', // arbitrary test value, not a real label-type color
    };
  }

  beforeEach(async () => {
    document.body.innerHTML = '<div id="pano-holder"><div id="svv-panorama"></div></div>'
      + '<div id="view-control-layer"></div>';
    frames = [];
    global.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };

    global.util = {};
    (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8'));
    util.isMobile = () => false;
    util.uiScale = () => 1;
    util.cappedMarkerDiameter = (diameter) => diameter;
    util.misc = { labelTypeName: () => 'Curb ramp' };
    global.i18next = { language: 'en' };
    global.createPanoViewerLogo = jest.fn(() => ({ showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() }));
    global.createPanoAttribution = jest.fn(() => ({ show: jest.fn(), hide: jest.fn() }));
    global.GsvViewer = class GsvViewer {};
    global.MapillaryViewer = class MapillaryViewer {};
    global.PanoLoadTimeoutError = loadClassFromFile(TIMEOUT_ERROR_PATH, 'PanoLoadTimeoutError');
    global.PannellumViewer = class PannellumViewer {};
    // Only what renderPanoMarker needs of a marker: an element to hide and show, in the marker layer.
    global.PanoMarker = class PanoMarker {
      constructor(opts) {
        this.marker_ = document.createElement('div');
        this.marker_.className = 'fake-marker';
        opts.markerContainer.append(this.marker_);
      }

      setPosition() {}

      removeMarker() { this.marker_.remove(); }
    };
    global.svv = {
      tracker: { push: jest.fn() },
      panoStore: { addPanoMetadata: jest.fn() },
      ui: { viewer: { date: { text: jest.fn() } } },
      labelRadius: 10,
    };

    panoData = { getPanoId: () => 'pano1', getProperty: () => new Date(2026, 5) };
    primaryViewer = {
      setPano: jest.fn(() => Promise.resolve(panoData)),
      addListener: jest.fn(),
      resize: jest.fn(),
      prefetchPano: jest.fn(),
      setPov: jest.fn(() => new Promise((resolve) => { povSettle = resolve; })),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
    };
    const PaintingViewerType = class PaintingViewerType {
      static PAINTS_DURING_LOAD = true;

      static create() { return Promise.resolve(primaryViewer); }
    };

    const PanoManager = loadClassFromFile(PANO_MANAGER_PATH, 'PanoManager');
    panoManager = await PanoManager.create(PaintingViewerType, 'token');
    primaryCanvas = document.getElementById('svv-panorama');

    // The first label is up and aimed, as it is by the time a validator moves on from it.
    await panoManager.setPanorama('pano1', null);
    const firstRender = panoManager.renderPanoMarker(makeLabel());
    povSettle();
    await flushMicrotasks();
    paint();
    paint();
    await firstRender;
    expect(primaryShowing()).toBe(true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete global.requestAnimationFrame;
    delete global.util;
    delete global.i18next;
    delete global.createPanoViewerLogo;
    delete global.createPanoAttribution;
    delete global.GsvViewer;
    delete global.MapillaryViewer;
    delete global.PanoLoadTimeoutError;
    delete global.PannellumViewer;
    delete global.PanoMarker;
    delete global.svv;
  });

  test('the canvas is unpainted from before the load starts until the label\'s POV has been applied', async () => {
    const load = holdPrimaryLoad();
    const inFlight = panoManager.setPanorama('pano2', null);
    await load.started;
    // This is the bug: the viewer draws the incoming pano here, at the outgoing label's heading.
    expect(primaryShowing()).toBe(false);
    expect(primaryCanvas.style.display).not.toBe('none'); // Laid out, so the provider renders at its real size.

    load.resolve();
    await inFlight;
    // The load resolving is not enough: the viewer is still facing the old label's way.
    expect(primaryShowing()).toBe(false);

    const rendering = panoManager.renderPanoMarker(makeLabel());
    await flushMicrotasks();
    paint();
    paint();
    expect(primaryShowing()).toBe(false); // The POV hasn't landed, so no frame may show yet.

    povSettle();
    await flushMicrotasks();
    expect(primaryShowing()).toBe(false); // The SDK draws the new center in its own frame first.
    paint();
    paint();
    await rendering;
    expect(primaryShowing()).toBe(true);
  });

  test('the outgoing label\'s marker goes with the canvas, and comes back with it', async () => {
    const load = holdPrimaryLoad();
    const inFlight = panoManager.setPanorama('pano2', null);
    await load.started;
    expect(markerEl().style.visibility).toBe('hidden'); // Or it would float over an empty pano area.

    load.resolve();
    await inFlight;
    const rendering = panoManager.renderPanoMarker(makeLabel());
    povSettle();
    await flushMicrotasks();
    paint();
    paint();
    await rendering;
    expect(markerEl().style.visibility).toBe('');
  });

  test('a newer load that starts before the reveal keeps the canvas unpainted', async () => {
    await panoManager.setPanorama('pano2', null);
    const rendering = panoManager.renderPanoMarker(makeLabel());

    const next = holdPrimaryLoad();
    const nextInFlight = panoManager.setPanorama('pano3', null);
    await next.started;
    povSettle();
    await flushMicrotasks();
    paint();
    paint();
    await rendering;
    // pano2's reveal would show pano3 mid-load, at pano2's heading.
    expect(primaryShowing()).toBe(false);

    next.resolve();
    await nextInFlight;
  });

  test('a load that fails never reveals the half-drawn pano it left behind', async () => {
    const load = holdPrimaryLoad();
    const inFlight = panoManager.setPanorama('pano2', null);
    await load.started;
    load.reject(new Error('imagery expired'));
    const result = await inFlight;

    expect(result.panoData).toBeNull();
    expect(primaryCanvas.style.display).toBe('none');
  });

  test('a POV the SDK fails to apply still reveals the pano rather than leaving the area blank', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await panoManager.setPanorama('pano2', null);
    primaryViewer.setPov = jest.fn(() => Promise.reject(new Error('not navigable')));

    const rendering = panoManager.renderPanoMarker(makeLabel());
    await flushMicrotasks();
    paint();
    paint();
    await rendering;
    expect(primaryShowing()).toBe(true);
    console.warn.mockRestore();
  });
});
