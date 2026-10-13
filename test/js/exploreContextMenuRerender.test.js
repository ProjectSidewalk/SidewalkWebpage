/**
 * Tests for the canvas re-render in ContextMenu.show()/hide() (frontend/js/explore/canvas/ContextMenu.js, #4824).
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
 * ContextMenu is a DOM-bound class with private fields, so it is driven through a bare-bones UI the way
 * validateLabelCardKeyboard.test.js drives Validate's KeyboardManager. Only the surface show()/hide() touch is
 * built; the severity and tag sections are switched off through the same flags production uses. The canvas hears
 * about the panel through onChange, as Canvas subscribes in production.
 */

const { loadModules } = require('./loadGlobalScript');

const { makeContextMenuUi } = require('./contextMenuUiStub');

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
    let canvas;
    let tracker;
    let renders;      // One entry per canvas render, recording what Label.render would have seen at that moment.

    beforeEach(() => {
        renders = [];
        window.i18next = { t: (key) => key };
        window.util = {
            camelToKebab: (s) => s,
            anchorPanelToLabel: jest.fn(),
            misc: {
                labelTypeName: (type) => window.i18next.t(`common:${window.util.camelToKebab(type)}`),
                getIconImagePaths: () => ({ iconImagePath: 'CurbRamp.svg' }),
                // False everywhere, which is what switches off the severity menu, its smiley images, and its
                // tooltips — none of which this file is about.
                labelTypeHasSeverity: () => false,
                getLabelDescriptions: () => ({ tagInfo: {} }),
            },
        };

        canvas = {
            clear: jest.fn(() => canvas),
            // Recorded from inside the render, since "did the repaint see the new state?" is the whole question.
            render: jest.fn(() => {
                renders.push({ open: menu.isOpen(), target: menu.getTargetLabel() });
                return canvas;
            }),
        };
        tracker = { push: jest.fn() };

        Object.assign(window, loadModules('frontend/js/explore/canvas/ContextMenu.js'));
        // No #context-menu-share element and no ShareWidget global, so the share widget stays null.
        menu = new window.ContextMenu(makeContextMenuUi(), { isOnboarding: false }, { iconRadius: 17 },
            { canDelete: () => true, getAllLabels: () => [], addToLabelsToLog: jest.fn() },
            { switching: { hold: jest.fn(), release: jest.fn() } }, { onMoveStarted: jest.fn() },
            { ratingClicked: jest.fn() }, { ensureLabelSaved: jest.fn() }, tracker);
        menu.onChange(() => canvas.clear().render());
    });

    test('show() repaints once, after the panel is already open', () => {
        const label = makeLabel();

        menu.show(label);

        expect(canvas.render).toHaveBeenCalledTimes(1);
        expect(canvas.clear).toHaveBeenCalledTimes(1);
        // The repaint has to see the open panel and its target, or the icon it paints is the unfaded one.
        expect(renders).toEqual([{ open: true, target: label }]);
    });

    test('hide() repaints once, after the panel is already closed', () => {
        const label = makeLabel();
        menu.show(label);
        renders.length = 0;

        menu.hide();

        expect(canvas.render).toHaveBeenCalledTimes(2);
        // Closed at repaint time, so the icon goes back to full opacity rather than staying faded until the next
        // unrelated render.
        expect(renders).toEqual([{ open: false, target: label }]);
        expect(menu.isOpen()).toBe(false);
    });

    test('hide() does not repaint when nothing was open', () => {
        menu.hide();
        menu.hide();

        expect(canvas.render).not.toHaveBeenCalled();
        expect(tracker.push).not.toHaveBeenCalledWith('ContextMenu_Close');
    });

    test('a second hide() after a real one does not repaint again', () => {
        menu.show(makeLabel());
        menu.hide();
        expect(canvas.render).toHaveBeenCalledTimes(2);

        menu.hide();

        expect(canvas.render).toHaveBeenCalledTimes(2);
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
        expect(canvas.render).not.toHaveBeenCalled();
    });
});
