/**
 * Tests for Validate's refusal to act on the current label while that label's pano is still loading (issue #5211),
 * across public/js/validate/src/label/LabelContainer.js and the busy region public/js/validate/src/Main.js names.
 *
 * `moveToNextLabel()` advances `#currLabel` synchronously and only then awaits the load, so for the length of that
 * load — 1.7 s on average on the Pannellum fallback path, and up to 4.5 s — "the current label" and "the pano on
 * screen" disagree. A verdict cast in that window is stored against the previous label's imagery: its POV and canvas
 * coordinates come from a pano the validator was never asked about, and nothing in the stored row says so.
 *
 * The suites below pin the two halves of the fix. The first drives the REAL LabelContainer against a PanoManager
 * whose load can be held open, and checks that everything reaching for the current label in that window is dropped
 * and logged. The second checks that the elements the busy state dims actually exist in the view it is dimming them
 * in — the invariant that broke silently on mobile, where both of the ids `#setUiBusy` used to name were desktop-only
 * and so matched nothing at all.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LABEL_CONTAINER_PATH = path.join(REPO_ROOT, 'public/js/validate/src/label/LabelContainer.js');
const MAIN_PATH = path.join(REPO_ROOT, 'public/js/validate/src/Main.js');
const DESKTOP_VIEW_PATH = path.join(REPO_ROOT, 'app/views/apps/validate.scala.html');
const MOBILE_VIEW_PATH = path.join(REPO_ROOT, 'app/views/apps/mobileValidate.scala.html');

const LABEL_TYPE = 'CurbRamp';

/**
 * Load a bare `class` or `const` declaration out of a production file. The Grunt bundle concatenates these into page
 * scope, so wrap the source in an IIFE that returns the named binding (same trick as validateSkipUnrenderableLabel).
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} name - Name of the binding the file declares.
 * @returns {*} The binding's value.
 */
function loadBindingFromFile(filePath, name) {
  const src = fs.readFileSync(filePath, 'utf8');
  return (0, eval)('(() => {\n' + src + '\nreturn ' + name + ';\n})()');
}

/** @returns {object} A fake jQuery wrapper with the handful of methods Validate calls on its UI elements. */
function fakeJqueryElement() {
  return {addClass: jest.fn(), removeClass: jest.fn(), toggleClass: jest.fn(), css: jest.fn(), attr: jest.fn()};
}

describe('input aimed at a label whose pano is still loading is dropped (issue #5211)', () => {
  let LabelContainer;
  let releaseLoad; // Resolves the held-open setPanorama, if one is being held.
  let holdNextLoad;

  beforeEach(() => {
    holdNextLoad = false;
    releaseLoad = null;

    global.util = {assetPath: assetPathStub, isMobile: () => false};

    // Only the surface LabelContainer reaches for: it stamps a timestamp on the label it is about to load, reads the
    // pano to load off it, and hands it to the UI. `validate` stands in for the real submission path.
    global.Label = class Label {
      constructor(params) {
        this.auditProps = params;
        this.props = {};
        this.validate = jest.fn();
      }

      getAuditProperty(key) { return this.auditProps[key]; }
      setProperty(key, value) { this.props[key] = value; }
      getProperty(key) { return this.props[key]; }
    };

    global.svv = {
      adminVersion: false,
      tracker: {push: jest.fn()},
      labelCard: {render: jest.fn()},
      validationMenu: {resetMenu: jest.fn()},
      undoValidation: {enableUndo: jest.fn()},
      labelVisibilityControl: {hideLabelCard: jest.fn(), unhideLabel: jest.fn(), isVisible: () => true},
      modalNoNewMission: {show: jest.fn()},
      ui: {
        holder: fakeJqueryElement(),
        busyRegion: fakeJqueryElement(),
        viewer: {controlLayer: fakeJqueryElement()},
      },
      panoManager: {
        renderPanoMarker: jest.fn(),
        setPanorama: jest.fn((panoId) => {
          if (!holdNextLoad) return Promise.resolve({panoId});
          holdNextLoad = false;
          return new Promise((resolve) => { releaseLoad = () => resolve({panoId}); });
        }),
      },
    };

    LabelContainer = loadBindingFromFile(LABEL_CONTAINER_PATH, 'LabelContainer');
  });

  afterEach(() => {
    delete global.util;
    delete global.Label;
    delete global.svv;
  });

  /**
   * Builds a container sitting on its first label, then starts a move to the second and leaves its pano in flight.
   * @returns {Promise<{labelContainer: object, inFlight: Promise}>} The container, mid-load, and the pending move.
   */
  async function buildContainerMidLoad() {
    const labelContainer = await LabelContainer.create(
      [{labelId: 1, panoId: 'panoA'}, {labelId: 2, panoId: 'panoB'}, {labelId: 3, panoId: 'panoC'}], LABEL_TYPE,
    );
    svv.tracker.push.mockClear();
    holdNextLoad = true;
    // Not awaited: moveToNextLabel runs as far as the pano load and stops there, which is the window under test.
    const inFlight = labelContainer.moveToNextLabel();
    return {labelContainer, inFlight};
  }

  /**
   * Lets the held-open pano load finish and waits for the move that was waiting on it.
   * @param {Promise} inFlight - The pending moveToNextLabel.
   */
  async function finishLoad(inFlight) {
    releaseLoad();
    await inFlight;
  }

  test('a second advance during the load is dropped, so the label queue moves one label at a time', async () => {
    const {labelContainer, inFlight} = await buildContainerMidLoad();

    await labelContainer.moveToNextLabel();

    expect(svv.tracker.push).toHaveBeenCalledWith('ValidateInputDropped_Loading', {source: 'NextLabel'});
    await finishLoad(inFlight);
    // Label 3 was never reached for, so the validator is asked about label 2 — the one whose pano just arrived.
    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(2);
    expect(svv.panoManager.setPanorama).toHaveBeenCalledTimes(2);
  });

  // Mission progress is rolled back only for an undo that actually happened, so a dropped one has to report itself
  // as not taken — the same contract as an undo whose imagery has died (#4810).
  test('an undo during the load is dropped and reports failure', async () => {
    const {labelContainer, inFlight} = await buildContainerMidLoad();

    expect(await labelContainer.undoLabel()).toBe(false);

    expect(svv.tracker.push).toHaveBeenCalledWith('ValidateInputDropped_Loading', {source: 'Undo'});
    await finishLoad(inFlight);
    expect(labelContainer.getCurrentLabel().getAuditProperty('labelId')).toBe(2);
  });

  // The heart of #5211: this is the call that would write a validation row against the wrong pano.
  test('a verdict cast during the load never reaches the label', async () => {
    const {labelContainer, inFlight} = await buildContainerMidLoad();

    labelContainer.validateCurrentLabel('Agree', new Date(), '');

    expect(svv.tracker.push).toHaveBeenCalledWith('ValidateInputDropped_Loading', {source: 'Validate=Agree'});
    await finishLoad(inFlight);
    expect(labelContainer.getCurrentLabel().validate).not.toHaveBeenCalled();
  });

  test('the same verdict is recorded normally once the pano is on screen', async () => {
    const {labelContainer, inFlight} = await buildContainerMidLoad();
    await finishLoad(inFlight);
    svv.tracker.push.mockClear();

    const timestamp = new Date();
    labelContainer.validateCurrentLabel('Agree', timestamp, 'looks right');

    expect(labelContainer.getCurrentLabel().validate).toHaveBeenCalledWith('Agree', 'looks right');
    expect(labelContainer.getProperty('validationTimestamp')).toBe(timestamp);
    expect(svv.tracker.push).not.toHaveBeenCalledWith('ValidateInputDropped_Loading', expect.anything());
  });

  // What the menus call. It answers for the current moment, so it has to go quiet the instant the label lands.
  test('dropInputWhileLoading answers for the load and only for the load', async () => {
    const {labelContainer, inFlight} = await buildContainerMidLoad();

    expect(labelContainer.dropInputWhileLoading('Agree')).toBe(true);
    expect(svv.tracker.push).toHaveBeenCalledWith('ValidateInputDropped_Loading', {source: 'Agree'});

    await finishLoad(inFlight);
    svv.tracker.push.mockClear();
    expect(labelContainer.dropInputWhileLoading('Agree')).toBe(false);
    expect(svv.tracker.push).not.toHaveBeenCalled();
  });

  // `validate-disabled` is opacity and pointer-events only, so without this a screen reader is told nothing at all.
  test('the busy region is marked aria-busy for the load and unmarked after it', async () => {
    const {labelContainer, inFlight} = await buildContainerMidLoad();

    expect(svv.ui.busyRegion.attr).toHaveBeenLastCalledWith('aria-busy', 'true');
    expect(svv.ui.busyRegion.toggleClass).toHaveBeenLastCalledWith('validate-disabled', true);

    await finishLoad(inFlight);

    expect(svv.ui.busyRegion.attr).toHaveBeenLastCalledWith('aria-busy', null);
    expect(svv.ui.busyRegion.toggleClass).toHaveBeenLastCalledWith('validate-disabled', false);
    expect(labelContainer.dropInputWhileLoading('Agree')).toBe(false);
  });

  // The lock is released on the two normal exits only, so before this a throw anywhere in the render left it set for
  // good: every later verdict, undo and advance dropped, the tool reading as dead rather than busy, and the only
  // trace a flood of this event. Mobile is where it would bite, since desktop is already unusable once the
  // validate-disabled class stays on.
  test('a render that throws still hands the tool back', async () => {
    const {labelContainer, inFlight} = await buildContainerMidLoad();
    await finishLoad(inFlight);

    const boom = new Error('label card blew up');
    svv.labelCard.render.mockImplementationOnce(() => { throw boom; });

    await expect(labelContainer.moveToNextLabel()).rejects.toThrow(boom);

    expect(labelContainer.dropInputWhileLoading('Agree')).toBe(false);
    expect(svv.ui.busyRegion.attr).toHaveBeenLastCalledWith('aria-busy', null);
    expect(svv.ui.busyRegion.toggleClass).toHaveBeenLastCalledWith('validate-disabled', false);
  });

  // Releasing the lock on a throw takes away the symptom that used to announce one — an endless run of
  // ValidateInputDropped_Loading from a tool that never came back. Both callers lose the rejection (Form swallows it,
  // moveToNextLabel drops it), so if the render doesn't report itself here, a render failure reaches nobody at all.
  test('a render that throws says so, rather than just recovering quietly', async () => {
    const {labelContainer, inFlight} = await buildContainerMidLoad();
    await finishLoad(inFlight);
    svv.tracker.push.mockClear();

    svv.labelCard.render.mockImplementationOnce(() => { throw new Error('label card blew up'); });

    await expect(labelContainer.moveToNextLabel()).rejects.toThrow('label card blew up');

    expect(svv.tracker.push).toHaveBeenCalledWith('ValidateRenderFailed', {error: 'label card blew up'});
  });

  // The no-more-labels path releases the lock before showing its modal, so that the modal's own disableKeyboard is
  // what stands. A release in the finally has to leave that alone rather than re-enable the keyboard behind it.
  test('the out-of-labels modal is not handed a re-enabled keyboard', async () => {
    global.svv.keyboard = {enableKeyboard: jest.fn(), disableKeyboard: jest.fn()};
    const labelContainer = await LabelContainer.create([{labelId: 1, panoId: 'panoA'}], LABEL_TYPE);
    svv.keyboard.enableKeyboard.mockClear();

    await labelContainer.moveToNextLabel();

    expect(svv.modalNoNewMission.show).toHaveBeenCalled();
    expect(svv.keyboard.enableKeyboard).toHaveBeenCalledTimes(1); // The deliberate early release, and no second one.
  });
});

// Every menu path that writes onto the current label outside the guarded verdict path needs a guard of its own,
// because none of them are reached through #validateLabel. The shared mechanism is native activation: a control that
// keeps focus after a click is still activated by the browser once KeyboardManager stops intercepting keys — which is
// exactly what #setUiBusy does for the length of a load. Enter re-fires a focused reason button; an arrow key roves
// the severity radios, which are only visually hidden and so still take focus, and whose keydown the pano viewers
// stopPropagation but never preventDefault. The write then lands on a label the validator has not seen and survives
// resetMenu, which clears the chosen styling but not the label's properties.
//
// Checked in the source rather than by driving the menus, which need jQuery, i18next and Bootstrap to construct, and
// whose #private methods a test can't reach anyway. The invariant is narrow enough to read directly: the guard has to
// be the handler's first statement, since everything after it writes.
describe('every menu path that writes onto the current label refuses one that is still loading', () => {
  const MENU_PATHS = {
    desktop: path.join(REPO_ROOT, 'public/js/validate/src/menu/DesktopValidationMenu.js'),
    mobile: path.join(REPO_ROOT, 'public/js/validate/src/menu/MobileValidationMenu.js'),
  };

  // [layout, what it is, the line that opens the handler, the source it drops under].
  test.each([
    ['desktop', 'the disagree reason setter', '#setDisagreeReason(id) {', 'DisagreeReason'],
    ['desktop', 'the unsure reason setter', '#setUnsureReason(id) {', 'UnsureReason'],
    ['desktop', 'the disagree "other" box', "menuUI.disagreeReasonTextBox.on('input', () => {", 'DisagreeReason'],
    ['desktop', 'the unsure "other" box', "menuUI.unsureReasonTextBox.on('input', () => {", 'UnsureReason'],
    ['desktop', 'the tag adder', '#addTag(tagName, fromAiSuggestion = false) {', 'TagAdd'],
    ['desktop', 'the tag remover', '#removeTag(tagName, label, fromAiSuggestion = false) {', 'TagRemove'],
    ['mobile', 'the disagree reason setter', '#setDisagreeReason(id) {', 'DisagreeReason'],
    ['mobile', 'the unsure reason setter', '#setUnsureReason(id) {', 'UnsureReason'],
    ['mobile', 'the disagree "other" box', "menuUI.disagreeReasonTextBox.on('input', () => {", 'DisagreeReason'],
    ['mobile', 'the unsure "other" box', "menuUI.unsureReasonTextBox.on('input', () => {", 'UnsureReason'],
    ['mobile', 'the disagree skip button', "$('#no-menu-skip-reason-button').click((e) => {", 'DisagreeReason_Skip'],
    ['mobile', 'the unsure skip button', "$('#unsure-menu-skip-reason-button').click((e) => {", 'UnsureReason_Skip'],
    // Expert Validate only, and the widest blast radius of the lot: unlike a reason this writes newSeverity, which
    // is submitted as validation data rather than as a comment string.
    ['desktop', 'the severity buttons', '$severityButtons.click((e) => {', 'Severity'],
  ])('%s: %s opens with the load guard', (layout, what, opener, source) => {
    const lines = fs.readFileSync(MENU_PATHS[layout], 'utf8').split('\n');
    const openerLine = lines.findIndex((line) => line.trim() === opener);

    // A rename or a reflow of the opener would leave the case below matching nothing and passing vacuously. Keyed by
    // the handler's name so the failure says which one moved rather than just "expected true".
    expect({ [what]: openerLine > -1 }).toEqual({ [what]: true });
    // First statement, not first line: several of these explain themselves in a comment before the guard.
    const firstStatement = lines.slice(openerLine + 1)
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('//'));

    expect(firstStatement).toBe(`if (svv.labelContainer.dropInputWhileLoading('${source}')) return;`);
  });
});

// Mobile had no busy state for years because #setUiBusy named two ids that exist only in the desktop view: jQuery
// answers an unmatched selector with an empty set and no complaint, so the tool went on reporting itself busy to
// nothing at all. These check the selector lists against the markup they are meant to cover.
describe('every element the busy state covers exists in the view it covers it in', () => {
  const busySelectors = loadBindingFromFile(MAIN_PATH, 'VALIDATE_BUSY_SELECTORS');

  test.each([
    ['desktop', DESKTOP_VIEW_PATH],
    ['mobile', MOBILE_VIEW_PATH],
  ])('%s', (layout, viewPath) => {
    const view = fs.readFileSync(viewPath, 'utf8');
    const selectors = busySelectors[layout];

    // An empty list would pass every assertion below without covering anything.
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toMatch(/^#[\w-]+$/); // Only id selectors can be checked this way.
      expect(view).toContain(`id="${selector.slice(1)}"`);
    }
  });
});
