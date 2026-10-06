/**
 * Tests for Explore's touch affordances (#5664): the Other popover opened by a tap, keyboard nudges kept off screens
 * with no keyboard, and the context menu following its label when a tablet rotates.
 */

const { loadModules } = require('./loadGlobalScript');
const { makeContextMenuUi } = require('./contextMenuUiStub');

/** Makes matchMedia answer as a touch screen (no hover, coarse pointer) or a mouse. */
function setPointer(touch) {
    window.matchMedia = (query) => ({
        matches: query.includes('hover: hover') || query.includes('pointer: fine') ? !touch : touch,
    });
}

afterEach(() => {
    delete window.matchMedia;
});

describe('RibbonMenu Other popover', () => {
    let ribbon;
    let tracker;
    let other;
    let popover;

    /** Builds the ribbon with an Other button holding its popover, as explore.scala.html does. */
    function build(touch) {
        setPointer(touch);
        document.body.innerHTML = `
          <div id="ribbon-menu-holder"></div><div id="pano-border-frame"></div>
          <span class="label-type-button-holder" val="Other" id="mode-switch-button-other">
            <img class="label-type-icon">
            <div id="ribbon-menu-other-subcategory-holder">
              <div class="ribbon-menu-other-subcategory" val="Occlusion" id="occlusion"></div>
            </div>
          </span>
          <div id="elsewhere"></div>`;
        window.i18next = { t: (k) => k };
        window.util = {
            misc: {
                getLabelColors: () => new Proxy({}, { get: () => ({ fillStyle: 'black' }) }),
                getLabelDescriptions: () => ({ keyChar: 'O' }),
            },
        };
        window.svl = {
            ui: { canvas: {} }, isOnboarding: () => false, keyboardShortcutAlert: { modeSwitchButtonClicked: jest.fn() },
        };
        tracker = { push: jest.fn() };
        const { RibbonMenu } = loadModules('frontend/js/explore/menu/RibbonMenu.js');
        ribbon = new RibbonMenu(tracker);
        other = document.getElementById('mode-switch-button-other');
        popover = document.getElementById('ribbon-menu-other-subcategory-holder');
    }

    const open = () => popover.style.visibility === 'visible';

    test('on touch, a tap on Other opens the popover without switching the mode', () => {
        build(true);
        other.click();

        expect(open()).toBe(true);
        expect(ribbon.getStatus('mode')).toBe('Walk');
        expect(tracker.push).toHaveBeenCalledWith('Click_SubcategoryMenu_Open');
    });

    test('on touch, a row picks its type, and a tap elsewhere or on Other again closes the popover', () => {
        build(true);
        other.click();
        document.getElementById('occlusion').click();
        expect(ribbon.getStatus('mode')).toBe('Occlusion');
        expect(open()).toBe(false);

        other.click();
        document.getElementById('elsewhere').dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(open()).toBe(false);

        other.click();
        other.click();
        expect(open()).toBe(false);
    });

    test('with a mouse, a click on Other still selects it, and hover opens the popover', () => {
        build(false);
        other.dispatchEvent(new MouseEvent('mouseenter'));
        expect(open()).toBe(true);

        other.click();
        expect(ribbon.getStatus('mode')).toBe('Other');
    });
});

describe('keyboard-shortcut nudges', () => {
    let alert;
    let controller;

    beforeEach(() => {
        window.i18next = { t: (k) => k };
        window.util = { misc: { getLabelDescriptions: () => ({ keyChar: 'C' }) }, camelToKebab: (s) => s };
        window.svl = { isOnboarding: () => false };
        controller = { showAlert: jest.fn() };
    });

    const clickTen = () => {
        for (let i = 0; i < 10; i++) alert.modeSwitchButtonClicked('CurbRamp');
    };

    test('never appear on a touch screen, where there is no key to press', () => {
        setPointer(true);
        const { KeyboardShortcutAlert } = loadModules('frontend/js/explore/alert/KeyboardShortcutAlert.js');
        alert = new KeyboardShortcutAlert(controller);
        clickTen();

        expect(controller.showAlert).not.toHaveBeenCalled();
    });

    test('still appear with a mouse and keyboard', () => {
        setPointer(false);
        const { KeyboardShortcutAlert } = loadModules('frontend/js/explore/alert/KeyboardShortcutAlert.js');
        alert = new KeyboardShortcutAlert(controller);
        clickTen();

        expect(controller.showAlert).toHaveBeenCalledTimes(1);
    });
});

describe('ContextMenu.reanchor', () => {
    let menu;
    let ui;
    let labelXY;

    beforeEach(() => {
        window.i18next = { t: (key) => key };
        window.util = {
            camelToKebab: (s) => s,
            anchorPanelToLabel: jest.fn(),
            misc: {
                labelTypeName: (type) => type,
                getIconImagePaths: () => ({ iconImagePath: 'CurbRamp.svg' }),
                labelTypeHasSeverity: () => false,
                getLabelDescriptions: () => ({ tagInfo: {} }),
            },
        };
        const canvas = { clear: () => canvas, render: () => canvas, getStatus: () => false };
        window.svl = {
            canvas, tracker: { push: jest.fn() }, ribbon: { enableModeSwitch: jest.fn() },
            keyboard: { setStatus: jest.fn() }, isOnboarding: () => false, LABEL_ICON_RADIUS: 17,
            navigationService: { setStatus: jest.fn() }, labelContainer: { getAllLabels: () => [] },
        };
        const { ContextMenu } = loadModules('frontend/js/explore/canvas/ContextMenu.js');
        ui = makeContextMenuUi();
        document.body.appendChild(ui.holder);
        menu = new ContextMenu(ui);
        window.svl.contextMenu = menu;
        labelXY = { x: 100, y: 100 };
    });

    afterEach(() => {
        menu.hide();
        ui.holder.remove();
    });

    const label = () => {
        const props = { labelType: 'CurbRamp', severity: null, description: '', tagIds: [], temporaryLabelId: 7 };
        return {
            getLabelType: () => 'CurbRamp', getCanvasXY: () => labelXY, getProperty: (k) => props[k],
            getProperties: () => props, isDeleted: () => false, setProperty: (k, v) => { props[k] = v; },
        };
    };

    test('moves the open menu to where its label is now drawn', () => {
        menu.show(label());
        window.util.anchorPanelToLabel.mockClear();
        labelXY = { x: 300, y: 50 };
        menu.reanchor();

        expect(window.util.anchorPanelToLabel).toHaveBeenCalledWith(ui.holder, { x: 300, y: 50 }, 17);
    });

    test('does nothing when the menu is closed', () => {
        menu.reanchor();

        expect(window.util.anchorPanelToLabel).not.toHaveBeenCalled();
    });
});
