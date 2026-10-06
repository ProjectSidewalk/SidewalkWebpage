/**
 * Tests for Validate prefetching the next labels' imagery (frontend/js/validate/label/LabelContainer.js
 * `#prefetchUpcomingPanos`, issues #5562 and #5581).
 *
 * After a label's imagery is on screen the connection is idle, so that is when the next labels' images start
 * downloading. A label whose pano is known to have expired has its backup asked for: those go straight to the
 * Pannellum fallback (#5561), which is the one viewer that loads from a URL this page controls, while a live label's
 * backup would be bytes nobody looks at. Every other label has its pano warmed in the provider instead
 * (PanoManager.prefetchPano, #5581), since that is the viewer its load will ask.
 *
 * Fake PanoManager and cache, in the shape validateSkipUnrenderableLabel.test.js uses.
 */

const path = require('path');

const { assetPathStub, loadModules } = require('./loadGlobalScript');

const LABEL_CONTAINER_PATH = path.resolve(__dirname, '..', '..', 'frontend/js/validate/label/LabelContainer.js');

/**
 * Load a bare `class` declaration out of a production file, wrapped in an IIFE that returns it.
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
  return loadModules(filePath)[className];
}

describe('LabelContainer prefetches upcoming backup panos (issue #5562)', () => {
  let LabelContainer;
  const backup = (panoId) => ({ pano_id: panoId, image_url: `/backupImage/${panoId}` });
  const labels = [
    { labelId: 1, panoId: 'a', expired: false, backupImage: null },
    { labelId: 2, panoId: 'b', expired: true, backupImage: backup('b') },
    { labelId: 3, panoId: 'c', expired: true, backupImage: backup('c') },
    { labelId: 4, panoId: 'd', expired: true, backupImage: null },   // Expired, but nothing to fetch.
    { labelId: 5, panoId: 'e', expired: false, backupImage: backup('e') }, // Live: the provider's viewer loads it.
    { labelId: 6, panoId: 'f', expired: true, backupImage: backup('f') },
  ];

  beforeEach(() => {
    global.util = { isMobile: () => false, assetPath: assetPathStub };
    global.i18next = { t: jest.fn((key) => key) };
    global.Label = class Label {
      constructor(params) {
        this.auditProps = params;
        this.props = {};
      }

      getAuditProperty(key) { return this.auditProps[key]; }
      setProperty(key, value) { this.props[key] = value; }
      getProperty(key) { return this.props[key]; }
    };
    const el = () => document.createElement('div');
    global.svv = {
      adminVersion: false,
      tracker: { push: jest.fn() },
      labelCard: { render: jest.fn() },
      validationMenu: { resetMenu: jest.fn() },
      undoValidation: { enableUndo: jest.fn() },
      labelVisibilityControl: {
        hideLabelCard: jest.fn(),
        unhideLabel: jest.fn(),
        openCardOnLoad: jest.fn(),
        isVisible: () => true,
      },
      modalNoNewMission: { show: jest.fn() },
      validateParams: {},
      ui: { holder: el(), busyRegion: [el()], viewer: { controlLayer: el() } },
      panoManager: {
        renderPanoMarker: jest.fn(),
        setPanorama: jest.fn((panoId) => Promise.resolve({ panoData: { panoId } })),
        prefetchPano: jest.fn(),
      },
      panoImageCache: { prefetchBackups: jest.fn() },
    };
    LabelContainer = loadClassFromFile(LABEL_CONTAINER_PATH, 'LabelContainer');
  });

  afterEach(() => {
    for (const name of ['util', 'i18next', 'Label', 'svv']) delete global[name];
  });

  /** @returns {string[][]} The pano ids asked for on each prefetch, in order. */
  function prefetchedPanoIds() {
    return svv.panoImageCache.prefetchBackups.mock.calls.map(([backups]) => backups.map((b) => b.pano_id));
  }

  /** @returns {string[]} The pano ids warmed in the provider, in order. */
  function providerPrefetchedPanoIds() {
    return svv.panoManager.prefetchPano.mock.calls.map(([panoId]) => panoId);
  }

  test('the two labels after the current one are asked for, when they are expired with a backup', async () => {
    await LabelContainer.create(labels, 'CurbRamp');

    expect(prefetchedPanoIds()).toEqual([['b', 'c']]);
  });

  test('the window moves with the current label, passing over labels with nothing to fetch', async () => {
    const labelContainer = await LabelContainer.create(labels, 'CurbRamp');

    await labelContainer.moveToNextLabel(); // On b: c is next, d is expired without a backup.
    await labelContainer.moveToNextLabel(); // On c: d has nothing, e is live.
    await labelContainer.moveToNextLabel(); // On d: e is live, f is expired with a backup.

    expect(prefetchedPanoIds()).toEqual([['b', 'c'], ['c'], [], ['f']]);
  });

  test('labels that will ask the provider are warmed there instead, in the same window', async () => {
    const labelContainer = await LabelContainer.create(labels, 'CurbRamp'); // On a: b and c go to their backups.
    expect(providerPrefetchedPanoIds()).toEqual([]);

    await labelContainer.moveToNextLabel(); // On b: c goes to its backup; d has no backup, so asks the provider.
    await labelContainer.moveToNextLabel(); // On c: d and e both ask the provider.
    await labelContainer.moveToNextLabel(); // On d: e asks the provider; f goes to its backup.

    expect(providerPrefetchedPanoIds()).toEqual(['d', 'd', 'e', 'e']);
  });

  test('the prefetch waits for the current label\'s imagery to be up', async () => {
    await LabelContainer.create(labels, 'CurbRamp');

    const loadOrder = svv.panoManager.setPanorama.mock.invocationCallOrder[0];
    const prefetchOrder = svv.panoImageCache.prefetchBackups.mock.invocationCallOrder[0];
    expect(prefetchOrder).toBeGreaterThan(loadOrder);
  });

  test('a label the mission dropped for bad imagery is not what the window is measured from', async () => {
    svv.panoManager.setPanorama = jest.fn((panoId) => Promise.resolve(
      panoId === 'b' ? { panoData: null, reason: 'no-imagery' } : { panoData: { panoId } },
    ));
    const labelContainer = await LabelContainer.create(labels, 'CurbRamp');

    await labelContainer.moveToNextLabel(); // b is dropped; c is shown in its place, so d and e are next.

    expect(prefetchedPanoIds()).toEqual([['b', 'c'], []]);
  });

  test('a page with no cache asks for nothing and carries on', async () => {
    delete svv.panoImageCache;

    const labelContainer = await LabelContainer.create(labels, 'CurbRamp');
    await expect(labelContainer.moveToNextLabel()).resolves.toBeUndefined();

    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(2);
    // The provider warm-up doesn't depend on the backup cache.
    expect(providerPrefetchedPanoIds()).toEqual(['d']);
  });
});
