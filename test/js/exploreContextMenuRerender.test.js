/**
 * Tests for the canvas re-render in ContextMenu.show()/hide() (public/js/explore/src/canvas/ContextMenu.js, #4824).
 *
 * Label.render() fades the icon whose dialog is open (pinned in exploreLabelDialogFade.test.js), but the canvas is
 * only repainted when something asks it to. What makes the fade appear the instant the panel opens and clear the
 * instant it closes is these two methods repainting themselves, rather than each of their ~15 call sites
 * remembering to. Two things matter and neither is visible from Label.render:
 *
 *  - the repaint has to happen *after* the visibility flip, or it paints the state the panel just left; and
 *  - hide() must not repaint when nothing was open, because it is also called speculatively on navigation and on
 *    keyboard shortcuts, where a repaint per keystroke is waste.
 *
 * ContextMenu is a jQuery-bound class with private fields, so it is driven through a stubbed UI the way
 * validateLabelCardKeyboard.test.js drives Validate's KeyboardManager. Only the surface show()/hide() touch is
 * stubbed; the severity and tag sections are switched off through the same flags production uses.
 */

const fs = require('fs');
const path = require('path');

const CONTEXT_MENU_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/canvas/ContextMenu.js'), 'utf8'
);

/** A chainable jQuery-wrapped-element stand-in. Every method returns the node; `length` 0 means "not in the DOM". */
function makeNode(overrides = {}) {
    const node = {
        length: 0,
        0: undefined,
    };
    const chainable = ['find', 'each', 'text', 'html', 'attr', 'prop', 'addClass', 'removeClass', 'toggleClass',
        'css', 'val', 'on', 'off', 'blur', 'focus', 'filter', 'tooltip', 'trigger', 'append', 'remove'];
    chainable.forEach((name) => { node[name] = () => node; });
    return Object.assign(node, overrides);
}

/** The label a menu opens for. Only the getters show()/hide() actually call are present. */
function makeLabel({ labelType = 'CurbRamp' } = {}) {
    const props = {
        labelType, severity: null, description: '', tagIds: [], temporaryLabelId: 7, auditTaskId: 3, labelId: null,
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

describe('ContextMenu repaints the canvas when the panel opens and closes', () => {
    let menu;
    let renders;      // One entry per canvas render, recording what Label.render would have seen at that moment.

    beforeEach(() => {
        renders = [];
        window.$ = () => makeNode();
        window.i18next = { t: (key) => key };
        window.util = {
            camelToKebab: (s) => s,
            anchorPanelToLabel: jest.fn(),
            misc: {
                getIconImagePaths: () => ({ iconImagePath: 'CurbRamp.svg' }),
                // False everywhere, which is what switches off the severity menu, its smiley images, and its
                // tooltips — none of which this file is about.
                labelTypeHasSeverity: () => false,
                getLabelDescriptions: () => ({ tagInfo: {} }),
            },
        };

        const canvas = {
            clear: jest.fn(() => canvas),
            // Recorded from inside the render, since "did the repaint see the new state?" is the whole question.
            render: jest.fn(() => {
                renders.push({ open: window.svl.contextMenu.isOpen(), target: window.svl.contextMenu.getTargetLabel() });
                return canvas;
            }),
            getStatus: () => false,
        };
        window.svl = {
            canvas,
            tracker: { push: jest.fn() },
            isOnboarding: () => false,
            LABEL_ICON_RADIUS: 17,
            navigationService: { setStatus: jest.fn() },
        };

        window.eval(`${CONTEXT_MENU_SRC}\nwindow.ContextMenu = ContextMenu;`);
        // No #context-menu-share element and no ShareWidget global, so the share widget stays null.
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

    test('show() repaints once, after the panel is already open', () => {
        const label = makeLabel();

        menu.show(label);

        expect(window.svl.canvas.render).toHaveBeenCalledTimes(1);
        expect(window.svl.canvas.clear).toHaveBeenCalledTimes(1);
        // The repaint has to see the open panel and its target, or the icon it paints is the unfaded one.
        expect(renders).toEqual([{ open: true, target: label }]);
    });

    test('hide() repaints once, after the panel is already closed', () => {
        const label = makeLabel();
        menu.show(label);
        renders.length = 0;

        menu.hide();

        expect(window.svl.canvas.render).toHaveBeenCalledTimes(2);
        // Closed at repaint time, so the icon goes back to full opacity rather than staying faded until the next
        // unrelated render.
        expect(renders).toEqual([{ open: false, target: label }]);
        expect(menu.isOpen()).toBe(false);
    });

    test('hide() does not repaint when nothing was open', () => {
        menu.hide();
        menu.hide();

        expect(window.svl.canvas.render).not.toHaveBeenCalled();
        expect(window.svl.tracker.push).not.toHaveBeenCalledWith('ContextMenu_Close');
    });

    test('a second hide() after a real one does not repaint again', () => {
        menu.show(makeLabel());
        menu.hide();
        expect(window.svl.canvas.render).toHaveBeenCalledTimes(2);

        menu.hide();

        expect(window.svl.canvas.render).toHaveBeenCalledTimes(2);
    });

    test('opening and closing repeatedly leaves the canvas showing the closed state', () => {
        const first = makeLabel();
        const second = makeLabel();

        menu.show(first);
        menu.hide();
        menu.show(second);
        menu.hide();

        expect(renders).toEqual([
            { open: true, target: first },
            { open: false, target: first },
            { open: true, target: second },
            { open: false, target: second },
        ]);
    });

    test('Occlusion labels get no panel and no repaint', () => {
        // Occlusion has nothing to rate or tag, so show() deliberately opens nothing for it.
        menu.show(makeLabel({ labelType: 'Occlusion' }));

        expect(menu.isOpen()).toBe(false);
        expect(menu.getTargetLabel()).toBe(null);
        expect(window.svl.canvas.render).not.toHaveBeenCalled();
    });
});
