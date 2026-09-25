/**
 * Explore's 1/2/3 shortcuts must not rate label types that have no rating (#5363).
 *
 * Drives a real KeyboardManager and ContextMenu over the real util.misc, so the rated/unrated split comes from the
 * backend's label-type table rather than a copy of it.
 */

const fs = require('fs');
const path = require('path');
const { assetPathStub, installUtilitiesMisc } = require('./loadGlobalScript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
const CONTEXT_MENU_SRC = read('public/js/explore/src/canvas/ContextMenu.js');
const KEYBOARD_MANAGER_SRC = read('public/js/explore/src/keyboard/KeyboardManager.js');

/**
 * The context menu's real markup, pared down to what ContextMenu wires up.
 * @returns {object} The `uiContextMenu` argument ContextMenu takes.
 */
function makeContextMenuUi() {
  const holder = document.createElement('div');
  holder.innerHTML = `<img id="context-menu-icon"><span id="context-menu-type"></span>
    <button id="context-menu-done"></button><button id="context-menu-delete"></button>`;
  const radioButtons = [1, 2, 3].map((value) => {
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.value = String(value);
    return radio;
  });
  return {
    holder,
    severityMenu: document.createElement('div'),
    severityRadioHolder: document.createElement('div'),
    radioButtons,
    textBox: document.createElement('input'),
    tagHolder: document.createElement('div'),
    tags: [],
    closeButton: document.createElement('button'),
  };
}

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
  window.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

describe('Explore severity shortcuts', () => {
  let menu;
  let keyboard;

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
    const canvas = { clear: () => canvas, render: () => canvas, getStatus: () => false };
    window.svl = { canvas, tracker: { push: jest.fn() }, isOnboarding: () => false, LABEL_ICON_RADIUS: 17 };

    window.eval(`${CONTEXT_MENU_SRC}\n${KEYBOARD_MANAGER_SRC}\n`
      + 'window.ContextMenu = ContextMenu; window.KeyboardManager = KeyboardManager;');
    menu = new window.ContextMenu(makeContextMenuUi());
    menu.labelTags = [];
    window.svl.contextMenu = menu;
    keyboard = new window.KeyboardManager(window.svl, canvas, menu, {}, {}, {});
  });

  afterEach(() => {
    menu.hide();
    // Its window listeners can't be removed from outside, so switch them off before the next test adds its own.
    keyboard.disableKeyboard();
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
      window.svl.isOnboarding = () => true;
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
