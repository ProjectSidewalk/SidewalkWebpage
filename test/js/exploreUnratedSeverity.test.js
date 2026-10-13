/**
 * Explore's 1/2/3 shortcuts must not rate label types that have no rating (#5363).
 *
 * Drives a real KeyboardManager and ContextMenu over the real util.misc, so the rated/unrated split comes from the
 * backend's label-type table rather than a copy of it.
 */

const { assetPathStub, installUtilitiesMisc, loadModules } = require('./loadGlobalScript');
const { makeContextMenuUi } = require('./contextMenuUiStub');


/**
 * @param {string} labelType
 * @param {number} [tutorialLabelNumber]
 * @returns {object} A label with just the methods ContextMenu and KeyboardManager call.
 */
function makeLabel(labelType, tutorialLabelNumber) {
  const props = {
    labelType, severity: null, description: '', tagIds: [], temporaryLabelId: 7, auditTaskId: 3, tutorialLabelNumber,
  };
  return {
    getLabelType: () => labelType,
    getCanvasXY: () => ({ x: 100, y: 100 }),
    getProperty: (key) => props[key],
    getProperties: () => props,
    isDeleted: () => false,
    setProperty: (key, value) => { props[key] = value; },
  };
}

function pressKey(key) {
  window.dispatchEvent(new KeyboardEvent('keyup', { key, code: `Digit${key}` }));
}

describe('Explore severity shortcuts', () => {
  let menu;
  let config;
  let keyboardDisabled;

  beforeEach(() => {
    window.i18next = { t: (key) => key };
    window.util = {
      assetPath: assetPathStub,
      camelToKebab: (s) => s,
      anchorPanelToLabel: jest.fn(),
      // Never resolves, so the severity tooltips (which need real DOM) are never built.
      getImage: () => new Promise(() => {}),
    };
    installUtilitiesMisc();
    const canvas = { clear: () => canvas, render: () => canvas };
    const tracker = { push: jest.fn() };
    config = { isOnboarding: false };
    keyboardDisabled = false;

    Object.assign(window, loadModules('frontend/js/explore/canvas/ContextMenu.js',
      'frontend/js/explore/keyboard/KeyboardManager.js'));
    menu = new window.ContextMenu(makeContextMenuUi(), config, { iconRadius: 17 },
      { canDelete: () => true, getAllLabels: () => [], addToLabelsToLog: jest.fn() },
      { switching: { hold: jest.fn(), release: jest.fn() } }, { onMoveStarted: jest.fn() },
      { ratingClicked: jest.fn() }, { ensureLabelSaved: jest.fn() }, tracker);
    menu.labelTags = [];
    new window.KeyboardManager({ isHeld: () => keyboardDisabled }, canvas, menu, {}, {}, {}, {}, {}, {}, tracker);
  });

  afterEach(() => {
    menu.hide();
    // Its window listeners can't be removed from outside, so switch them off before the next test adds its own.
    keyboardDisabled = true;
  });

  test.each(['Signal', 'NoSidewalk'])('pressing 2 leaves an unrated %s label unrated', (labelType) => {
    const label = makeLabel(labelType);
    menu.show(label);

    pressKey('2');

    expect(label.getProperty('severity')).toBe(null);
  });

  test('pressing 2 rates a rated label', () => {
    const label = makeLabel('CurbRamp');
    menu.show(label);

    pressKey('2');

    expect(label.getProperty('severity')).toBe(2);
  });

  describe('in the tutorial', () => {
    beforeEach(() => {
      config.isOnboarding = true;
    });

    test('rating stays off until the tutorial reaches that label', () => {
      const label = makeLabel('CurbRamp', 2);
      menu.show(label);
      menu.enableRatingSeverityForTutorialLabel(1);

      pressKey('2');

      expect(label.getProperty('severity')).toBe(null);
    });

    test('rating works on the label the tutorial has reached', () => {
      const label = makeLabel('CurbRamp', 2);
      menu.show(label);
      menu.enableRatingSeverityForTutorialLabel(2);

      pressKey('3');

      expect(label.getProperty('severity')).toBe(3);
    });
  });

  test('reports rating as off when no label is open', () => {
    expect(menu.isRatingSeverityDisabled()).toBe(true);
  });
});
