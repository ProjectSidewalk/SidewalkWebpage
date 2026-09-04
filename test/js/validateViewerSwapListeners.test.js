/**
 * Tests that Validate's startup components follow the active viewer instead of the one that happened to be showing
 * the first label (issue #4828), across
 * public/js/validate/src/panorama/PanoManager.js (`#watchViewerPov`) and public/js/common/SpeedLimit.js (`refresh`).
 *
 * PanoManager swaps `svv.panoViewer` between the primary viewer (GSV/Mapillary/Infra3d) and the Pannellum fallback as
 * labels come and go, and the viewer that isn't showing fires no events at all. Both failures are silent — POV pans
 * on a Pannellum label simply stop reaching the logs, and the speed-limit sign keeps showing the first label's value
 * — so the assertions here are about events arriving from the viewer that took over.
 *
 * Both suites drive the REAL production classes (and the REAL `util.throttle`) against fake viewers; no pano is
 * involved, so none of this needs imagery.
 */

const fs = require('fs');
const path = require('path');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoManager.js');
const SPEED_LIMIT_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/SpeedLimit.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');

/**
 * Load a bare `class` declaration out of a production file. The Grunt bundle concatenates these into page scope, so
 * wrap the source in an IIFE that returns the named class (same trick as validateSkipUnrenderableLabel.test.js).
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
  const src = fs.readFileSync(filePath, 'utf8');
  return (0, eval)('(() => {\n' + src + '\nreturn ' + className + ';\n})()');
}

describe('PanoManager logs POV changes from whichever viewer is showing (issue #4828)', () => {
  let panoManager;
  let primaryViewer;
  let pannellumViewer;
  let primaryListeners;   // event name -> callback captured from the primary viewer
  let pannellumListeners; // event name -> callback captured from the Pannellum viewer
  let panoData;
  const attribution = {holder: '© jacobwhall', provider: 'Mapillary', license: 'CC BY-SA 4.0', license_url: 'x'};
  const backupImage = {panoId: 'pano2', cameraHeading: 90, attribution};
  let attributionOverlay;

  /**
   * Build a fake viewer that records the listeners it is handed.
   * @param {object} listenerSink - Object the viewer writes `event -> callback` into.
   * @returns {object} The fake viewer.
   */
  function makeFakeViewer(listenerSink) {
    return {
      setPano: jest.fn(() => succeedingSetPano(listenerSink)),
      addListener: jest.fn((event, cb) => { listenerSink[event] = cb; }),
      resize: jest.fn(),
      setPov: jest.fn(),
      getPov: () => ({heading: 0, pitch: 0, zoom: 1}),
    };
  }

  /**
   * A successful load, which sets the viewer's initial POV and so fires pov_changed the way real viewers do.
   * @param {object} listenerSink - The viewer's captured listeners.
   * @returns {Promise<object>} The loaded pano's metadata.
   */
  function succeedingSetPano(listenerSink) {
    listenerSink.pov_changed?.();
    return Promise.resolve(panoData);
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    // Anchor the fake clock away from zero so the throttle's first elapsed check exceeds its window.
    jest.setSystemTime(1_000_000);

    document.body.innerHTML = '<div id="pano-holder"><div id="svv-panorama"></div></div>';

    global.util = {};
    (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8')); // real throttle, the same one production wires up
    util.isMobile = () => false;

    global.createPanoViewerLogo = jest.fn(() => ({showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn()}));
    attributionOverlay = {show: jest.fn(), hide: jest.fn()};
    global.createPanoAttribution = jest.fn(() => attributionOverlay);
    global.GsvViewer = class GsvViewer {};             // distinct from FakeViewerType, so the GSV-only
    global.MapillaryViewer = class MapillaryViewer {}; // and Mapillary-only attribution paths are skipped
    global.svv = {
      tracker: {push: jest.fn()},
      panoStore: {addPanoMetadata: jest.fn()},
      ui: {viewer: {date: {text: jest.fn()}}},
    };

    panoData = {getPanoId: () => 'pano1', getProperty: () => ({format: () => 'Jun 2026'})};
    primaryListeners = {};
    pannellumListeners = {};
    primaryViewer = makeFakeViewer(primaryListeners);
    pannellumViewer = makeFakeViewer(pannellumListeners);
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
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
    delete global.util;
    delete global.createPanoViewerLogo;
    delete global.createPanoAttribution;
    delete global.GsvViewer;
    delete global.MapillaryViewer;
    delete global.PannellumViewer;
    delete global.svv;
  });

  /** Count how many times the tracker logged a POV_Changed action. */
  function povChangedLogCount() {
    return svv.tracker.push.mock.calls.filter((call) => call[0] === 'POV_Changed').length;
  }

  /**
   * Drop the actions logged so far and let the throttle window lapse, so the next pan is a fresh leading edge.
   * Lets a test count the pans it drives without the surrounding pano loads in the tally.
   */
  function resetPovLog() {
    jest.advanceTimersByTime(1000);
    svv.tracker.push.mockClear();
  }

  /** Load a label whose imagery the primary viewer rejects, so Pannellum takes over. */
  async function loadPannellumLabel() {
    primaryViewer.setPano = jest.fn(() => Promise.reject(new Error('imagery expired')));
    await panoManager.setPanorama('pano2', backupImage);
  }

  /** Load a label the primary viewer can render, handing the pano back to it. */
  async function loadPrimaryLabel(panoId) {
    primaryViewer.setPano = jest.fn(() => succeedingSetPano(primaryListeners));
    await panoManager.setPanorama(panoId, null);
  }

  test('the first pano load is not logged as a pan the user never made', () => {
    // The load fires pov_changed as it sets the viewer's initial POV; logging that would open every session with
    // a POV_Changed the validator never caused.
    expect(povChangedLogCount()).toBe(0);
  });

  test('panning a Pannellum label reaches the tracker', async () => {
    await loadPannellumLabel();
    resetPovLog();

    expect(pannellumListeners.pov_changed).toBeDefined();
    pannellumListeners.pov_changed();
    expect(povChangedLogCount()).toBe(1);
  });

  test('the primary viewer is still logged after a Pannellum label hands the pano back', async () => {
    await loadPannellumLabel();
    await loadPrimaryLabel('pano3');
    resetPovLog();

    primaryListeners.pov_changed();
    expect(povChangedLogCount()).toBe(1);
  });

  test('the two viewers share one throttle window rather than one each', async () => {
    await loadPannellumLabel();
    resetPovLog();

    pannellumListeners.pov_changed();
    primaryListeners.pov_changed();
    expect(povChangedLogCount()).toBe(1); // one leading-edge log for the pair, not one per viewer

    jest.advanceTimersByTime(500);
    expect(povChangedLogCount()).toBe(2); // one trailing log so the final POV is still recorded
  });

  test('Pannellum is subscribed once, not once per label it shows', async () => {
    await loadPannellumLabel();
    await loadPrimaryLabel('pano3');
    await loadPannellumLabel();
    resetPovLog();

    const povSubscriptions = pannellumViewer.addListener.mock.calls.filter((call) => call[0] === 'pov_changed');
    expect(povSubscriptions).toHaveLength(1);

    pannellumListeners.pov_changed();
    expect(povChangedLogCount()).toBe(1);
  });

  test('the imagery attribution shows while Pannellum is up and goes when the primary viewer takes the pano back', async () => {
    // Pannellum shows Project Sidewalk's own copy of the imagery, which owes the attribution the provider's live
    // viewer would otherwise draw itself (#4865); the primary viewer draws its own, so the pill must not linger.
    expect(global.createPanoAttribution).toHaveBeenCalledWith(document.getElementById('pano-holder'));
    expect(attributionOverlay.show).not.toHaveBeenCalled();

    await loadPannellumLabel();
    expect(attributionOverlay.show).toHaveBeenCalledTimes(1);
    expect(attributionOverlay.show).toHaveBeenLastCalledWith(attribution);

    await loadPrimaryLabel('pano3');
    expect(attributionOverlay.hide).toHaveBeenCalledTimes(1);
  });
});

describe('SpeedLimit follows the active viewer (issue #4828)', () => {
  let SpeedLimit;
  let speedLimit;
  let activeViewer;
  let currentLabel;
  let primaryViewer;
  let pannellumViewer;
  let primaryListeners;
  let pannellumListeners;

  /**
   * Build a fake viewer that records the listeners it is handed.
   * @param {object} listenerSink - Object the viewer writes `event -> callback` into.
   * @returns {object} The fake viewer.
   */
  function makeFakeViewer(listenerSink) {
    return {
      addListener: jest.fn((event, cb) => { listenerSink[event] = cb; }),
      getPanoId: () => 'pano1',
      getPosition: () => ({lat: 47.6, lng: -122.3}),
    };
  }

  /**
   * Set the label the sign should be reading from.
   * @param {string} maxSpeed - Raw OSM maxspeed value for the label's street.
   * @param {string} [labelType] - Label type; 'NoCurbRamp' is the one the sign is relevant to.
   */
  function setCurrentLabel(maxSpeed, labelType = 'NoCurbRamp') {
    const props = {maxSpeed, labelType};
    currentLabel = {getAuditProperty: (key) => props[key] ?? null};
  }

  /** @returns {string} The number currently rendered on the sign. */
  function signNumber() {
    return document.getElementById('speed-limit').innerText;
  }

  beforeEach(() => {
    document.body.innerHTML = '<div id="speed-limit-sign">'
      + '<span id="speed-limit"></span><span id="speed-limit-sub"></span></div>';

    primaryListeners = {};
    pannellumListeners = {};
    primaryViewer = makeFakeViewer(primaryListeners);
    pannellumViewer = makeFakeViewer(pannellumListeners);
    activeViewer = primaryViewer;

    SpeedLimit = loadClassFromFile(SPEED_LIMIT_PATH, 'SpeedLimit');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  /** Build the sign the way Validate does, reading the active viewer through a closure. */
  function buildSpeedLimit() {
    speedLimit = new SpeedLimit(
      () => activeViewer, () => activeViewer.getPosition(), () => false, 'usa',
      {labelContainer: {getCurrentLabel: () => currentLabel}},
    );
  }

  /** @returns {boolean} Whether the sign is currently on screen. */
  function signVisible() {
    return document.getElementById('speed-limit-sign').style.display !== 'none';
  }

  test('the sign updates for a label shown on the Pannellum viewer', () => {
    setCurrentLabel('25 mph');
    buildSpeedLimit();
    expect(signNumber()).toBe('25');

    // Next label's imagery is expired, so Pannellum takes over and the label carries a different speed limit.
    activeViewer = pannellumViewer;
    setCurrentLabel('40 mph');
    speedLimit.refresh();

    expect(signNumber()).toBe('40');
  });

  test('the sign subscribes to the Pannellum viewer once it becomes the active one', () => {
    setCurrentLabel('25 mph');
    buildSpeedLimit();
    expect(pannellumListeners.pano_changed).toBeUndefined();

    activeViewer = pannellumViewer;
    setCurrentLabel('40 mph');
    speedLimit.refresh();
    expect(pannellumListeners.pano_changed).toBeDefined();

    // A pano change reported by the viewer that is actually showing now moves the sign.
    setCurrentLabel('15 mph');
    pannellumListeners.pano_changed();
    expect(signNumber()).toBe('15');
  });

  test('a mission whose first label is on Pannellum still follows the primary viewer afterwards', () => {
    // PanoManager.create is awaited before SpeedLimit is built, so an expired first label leaves Pannellum active.
    activeViewer = pannellumViewer;
    setCurrentLabel('30 mph');
    buildSpeedLimit();
    expect(signNumber()).toBe('30');

    activeViewer = primaryViewer;
    setCurrentLabel('20 mph');
    speedLimit.refresh();
    expect(signNumber()).toBe('20');

    setCurrentLabel('45 mph');
    primaryListeners.pano_changed();
    expect(signNumber()).toBe('45');
  });

  test('each viewer is subscribed at most once across repeated swaps', () => {
    setCurrentLabel('25 mph');
    buildSpeedLimit();

    activeViewer = pannellumViewer;
    speedLimit.refresh();
    activeViewer = primaryViewer;
    speedLimit.refresh();
    activeViewer = pannellumViewer;
    speedLimit.refresh();

    expect(primaryViewer.addListener).toHaveBeenCalledTimes(1);
    expect(pannellumViewer.addListener).toHaveBeenCalledTimes(1);
  });

  test('a label type the sign is irrelevant for keeps it hidden after a viewer swap', () => {
    setCurrentLabel('25 mph', 'CurbRamp');
    buildSpeedLimit();
    expect(signVisible()).toBe(false);

    activeViewer = pannellumViewer;
    speedLimit.refresh();
    expect(signVisible()).toBe(false);
  });

  test('relevance follows the label type of the mission running now, not the one the tool started on', () => {
    // Validate rolls into the next mission without a page reload, and that mission can be a different label type.
    setCurrentLabel('25 mph', 'NoCurbRamp');
    buildSpeedLimit();
    expect(signVisible()).toBe(true);

    setCurrentLabel('30 mph', 'CurbRamp');
    speedLimit.refresh();
    expect(signVisible()).toBe(false);

    setCurrentLabel('35 mph', 'NoCurbRamp');
    speedLimit.refresh();
    expect(signVisible()).toBe(true);
    expect(signNumber()).toBe('35');
  });
});
