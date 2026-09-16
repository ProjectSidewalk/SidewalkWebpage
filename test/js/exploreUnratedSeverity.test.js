/**
 * Explore's 1/2/3 shortcuts only check isRatingSeverityDisabled(), so it must be true for unrated types (#5363).
 */

const fs = require('fs');
const path = require('path');

const CONTEXT_MENU_SRC = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'public/js/explore/src/canvas/ContextMenu.js'), 'utf8',
);

function makeNode() {
  const node = { length: 0, 0: undefined };
  ['find', 'each', 'text', 'html', 'attr', 'prop', 'addClass', 'removeClass', 'toggleClass', 'css', 'val', 'on',
    'off', 'blur', 'focus', 'filter', 'tooltip', 'trigger', 'append', 'remove'].forEach((name) => {
    node[name] = () => node;
  });
  return node;
}

/** @returns {object} A label with only the getters show() and isRatingSeverityDisabled() call. */
function makeLabel(labelType) {
  const props = { labelType, severity: null, description: '', tagIds: [], temporaryLabelId: 7, auditTaskId: 3 };
  return {
    getLabelType: () => labelType,
    getCanvasXY: () => ({ x: 100, y: 100 }),
    getProperty: (key) => props[key],
    getProperties: () => props,
    isDeleted: () => false,
    setProperty: (key, value) => { props[key] = value; },
  };
}

describe('ContextMenu.isRatingSeverityDisabled', () => {
  let menu;

  beforeEach(() => {
    window.$ = () => makeNode();
    window.i18next = { t: (key) => key };
    window.util = {
      camelToKebab: (s) => s,
      anchorPanelToLabel: jest.fn(),
      misc: {
        getIconImagePaths: () => ({ iconImagePath: 'icon.svg' }),
        labelTypeHasSeverity: (labelType) => !['Signal', 'NoSidewalk', 'Occlusion'].includes(labelType),
        getSeverityLevelColors: () => null,
        getSmileyIconPath: () => '',
        isPositiveLabelType: () => false,
        getRatingLevelKeys: () => ({}),
        getLabelDescriptions: () => ({ tagInfo: {} }),
      },
    };
    const canvas = { clear: () => canvas, render: () => canvas, getStatus: () => false };
    window.svl = { canvas, tracker: { push: jest.fn() }, isOnboarding: () => false, LABEL_ICON_RADIUS: 17 };

    window.eval(`${CONTEXT_MENU_SRC}\nwindow.ContextMenu = ContextMenu;`);
    menu = new window.ContextMenu({
      holder: makeNode(),
      severityMenu: makeNode(),
      severityRadioHolder: makeNode(),
      radioButtons: makeNode(),
      textBox: makeNode(),
      tagHolder: makeNode(),
      tags: makeNode(),
      closeButton: makeNode(),
    });
    window.svl.contextMenu = menu;
  });

  test.each(['Signal', 'NoSidewalk'])('is disabled for unrated %s outside the tutorial', (labelType) => {
    menu.show(makeLabel(labelType));
    expect(menu.isRatingSeverityDisabled()).toBe(true);
  });

  test('is enabled for a rated type outside the tutorial', () => {
    menu.show(makeLabel('Other'));
    expect(menu.isRatingSeverityDisabled()).toBe(false);
  });
});
