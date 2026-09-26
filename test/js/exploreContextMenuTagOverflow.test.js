/**
 * The context menu grows its tag buttons to fit the label type (public/js/explore/src/canvas/ContextMenu.js).
 *
 * The markup ships a fixed row of tag buttons, and some cities give Obstacle more tags than that. Each extra tag
 * gets a button of its own, wired up like the rest, instead of being dropped or crashing the menu open.
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
        // The markup's row holds two buttons here; the label type below needs three.
        for (let i = 0; i < 2; i++) {
            const button = document.createElement('button');
            ui.tagHolder.append(button);
            ui.tags.push(button);
        }
        menu = new window.ContextMenu(ui);
        window.svl.contextMenu = menu;
        menu.labelTags = [1, 2, 3].map((id) => ({ tag_id: id, label_type: 'Obstacle', tag: 'trash/recycling can' }));
    });

    afterEach(() => menu.hide());

    test('a label type with more tags than buttons gets a button per tag', () => {
        menu.show(makeLabel('Obstacle'));

        const buttons = Array.from(ui.tagHolder.querySelectorAll('button'));
        expect(buttons.map((b) => b.dataset.tagId)).toEqual(['1', '2', '3']);
        expect(buttons.every((b) => b.style.visibility === 'inherit')).toBe(true);

        // The grown button toggles its tag like the originals do.
        buttons[2].click();
        expect(menu.getTargetLabel().getProperty('tagIds')).toEqual([3]);
        expect(buttons[2].classList.contains('tag-pill--active')).toBe(true);
    });

    test('buttons a smaller label type does not need are hidden, not removed', () => {
        menu.show(makeLabel('Obstacle'));
        menu.hide();
        menu.labelTags = menu.labelTags.slice(0, 1);
        menu.show(makeLabel('Obstacle'));

        const buttons = Array.from(ui.tagHolder.querySelectorAll('button'));
        expect(buttons).toHaveLength(3);
        expect(buttons.map((b) => b.style.visibility)).toEqual(['inherit', 'hidden', 'hidden']);
    });
});
