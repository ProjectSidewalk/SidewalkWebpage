/**
 * The context menu builds a button per tag of the label's type (public/js/explore/src/canvas/ContextMenu.js), so
 * every tag shows however long a city's list is.
 */

const fs = require('fs');
const path = require('path');
const { assetPathStub, installUtilitiesMisc } = require('./loadGlobalScript');
const { makeContextMenuUi } = require('./contextMenuUiStub');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONTEXT_MENU_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/explore/src/canvas/ContextMenu.js'), 'utf8');

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

    beforeEach(() => {
        window.i18next = { t: (key) => key };
        window.util = {
            assetPath: assetPathStub,
            camelToKebab: (s) => s,
            anchorPanelToLabel: jest.fn(),
            // Never resolves, so the tag tooltips (which need real images) are never built.
            getImage: () => new Promise(() => {}),
        };
        installUtilitiesMisc();
        const canvas = { clear: () => canvas, render: () => canvas, getStatus: () => false };
        window.svl = {
            canvas, tracker: { push: jest.fn() }, ribbon: { enableModeSwitch: jest.fn() },
            keyboard: { setStatus: jest.fn() }, isOnboarding: () => false, LABEL_ICON_RADIUS: 17,
        };

        window.eval(`${CONTEXT_MENU_SRC}\nwindow.ContextMenu = ContextMenu;`);
        ui = makeContextMenuUi();
        menu = new window.ContextMenu(ui);
        window.svl.contextMenu = menu;
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

    test('opening a label of another type rebuilds the row for that type', () => {
        menu.show(makeLabel('Obstacle'));
        menu.hide();
        menu.show(makeLabel('CurbRamp'));

        const buttons = Array.from(ui.tagHolder.querySelectorAll('button'));
        expect(buttons.map((b) => b.dataset.tagId)).toEqual(['4']);
    });
});
