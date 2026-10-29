/**
 * The context menu builds a button per tag of the label's type (frontend/js/explore/canvas/ContextMenu.js), so
 * every tag shows however long a city's list is.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { makeContextMenuUi } from './contextMenuUiStub.js';
import { fakeGate, fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

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
    edit: (changes) => { Object.assign(props, changes); },
  };
}

describe('ContextMenu tag buttons', () => {
  let menu;
  let ui;

  beforeEach(async () => {
    // Never resolves, so the tag tooltips (which need real images) are never built.
    useUtil({ getImage: () => new Promise(() => {}) });

    const { ContextMenu } = await loadModules('frontend/js/explore/canvas/ContextMenu.js');
    ui = makeContextMenuUi();
    menu = new ContextMenu(ui, { isOnboarding: false }, { iconRadius: 17 },
      { canDelete: () => true, getAllLabels: () => [] },
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

  test('writes each edit through label.edit(), which is what files the label for the next submission', () => {
    const label = makeLabel('Obstacle');
    const edit = vi.spyOn(label, 'edit');
    menu.show(label);

    ui.tagHolder.querySelector('button').click();
    expect(edit).toHaveBeenLastCalledWith({ tagIds: [1] });

    ui.radioButtons[1].checked = true;
    ui.radioButtons[1].dispatchEvent(new Event('change'));
    expect(edit).toHaveBeenLastCalledWith({ severity: Number(ui.radioButtons[1].value) });

    ui.textBox.value = 'a bin';
    ui.textBox.dispatchEvent(new Event('change'));
    expect(edit).toHaveBeenLastCalledWith({ description: 'a bin' });
  });

  test('opening a label of another type rebuilds the row for that type', () => {
    menu.show(makeLabel('Obstacle'));
    menu.hide();
    menu.show(makeLabel('CurbRamp'));

    const buttons = Array.from(ui.tagHolder.querySelectorAll('button'));
    expect(buttons.map((b) => b.dataset.tagId)).toEqual(['4']);
  });
});
