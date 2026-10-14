/**
 * The context menu builds a button per tag of the label's type (frontend/js/explore/canvas/ContextMenu.js), so
 * every tag shows however long a city's list is.
 */

import { loadModules, useUtil } from './loader.js';
import { makeContextMenuUi } from './contextMenuUiStub.js';
import { fakeGate, fakeTracker } from './fakes.js';

/**
 * @param {string} labelType
 * @returns {object} A label with just the methods ContextMenu.show() calls.
 */
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

describe('ContextMenu tag buttons', () => {
  let menu;
  let ui;
  let labelContainer;

  beforeEach(async () => {
    window.i18next = { t: (key) => key };
    // Never resolves, so the tag tooltips (which need real images) are never built.
    useUtil({ getImage: () => new Promise(() => {}) });

    const { ContextMenu } = await loadModules('frontend/js/explore/canvas/ContextMenu.js');
    ui = makeContextMenuUi();
    labelContainer = { canDelete: () => true, getAllLabels: () => [], addToLabelsToLog: vi.fn() };
    menu = new ContextMenu(ui, { isOnboarding: false }, { iconRadius: 17 }, labelContainer,
      { switching: fakeGate() }, { onMoveStarted: vi.fn() },
      { ratingClicked: vi.fn() }, { ensureLabelSaved: vi.fn() }, fakeTracker());
    menu.labelTags = [
      ...[1, 2, 3].map((id) => ({ tag_id: id, label_type: 'Obstacle', tag: 'trash/recycling can' })),
      { tag_id: 4, label_type: 'CurbRamp', tag: 'narrow' },
    ];
  });

  afterEach(() => menu.hide());

  test('a label gets one button per tag of its type, each toggling its tag', () => {
    menu.show(makeLabel('Obstacle'));

    const buttons = Array.from(ui.tagHolder.querySelectorAll('button'));
    expect(buttons.map((b) => b.dataset.tagId)).toEqual(['1', '2', '3']);

    buttons[2].click();
    expect(menu.getTargetLabel().getProperty('tagIds')).toEqual([3]);
    expect(buttons[2].classList.contains('tag-pill--active')).toBe(true);
  });

  test('files the label for the next submission on each edit, not only when the menu opens', () => {
    const label = makeLabel('Obstacle');
    menu.show(label);
    // A save while the menu is open (a share, the tracker's flush) empties the list the same way.
    labelContainer.addToLabelsToLog.mockClear();

    ui.tagHolder.querySelector('button').click();
    expect(labelContainer.addToLabelsToLog).toHaveBeenCalledWith(label);

    labelContainer.addToLabelsToLog.mockClear();
    ui.radioButtons[1].checked = true;
    ui.radioButtons[1].dispatchEvent(new Event('change'));
    expect(labelContainer.addToLabelsToLog).toHaveBeenCalledWith(label);

    labelContainer.addToLabelsToLog.mockClear();
    ui.textBox.value = 'a bin';
    ui.textBox.dispatchEvent(new Event('change'));
    expect(labelContainer.addToLabelsToLog).toHaveBeenCalledWith(label);
  });

  test('opening a label of another type rebuilds the row for that type', () => {
    menu.show(makeLabel('Obstacle'));
    menu.hide();
    menu.show(makeLabel('CurbRamp'));

    const buttons = Array.from(ui.tagHolder.querySelectorAll('button'));
    expect(buttons.map((b) => b.dataset.tagId)).toEqual(['4']);
  });
});
