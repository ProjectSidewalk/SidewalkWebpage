/**
 * Explore's label-type shortcuts match the physical key (`KeyboardEvent.code`), not the character typed (#5618), so a
 * non-Latin layout or input method still reaches them, and the logged note names the key. Escape with the context
 * menu open closes only the menu.
 */

const fs = require('fs');
const path = require('path');

const KEYBOARD_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/keyboard/KeyboardManager.js'), 'utf8'
);

describe('Explore shortcut keys', () => {
    const svl = {};
    const ribbon = { modeSwitch: jest.fn(), backToWalk: jest.fn() };
    let menuOpen = false;

    beforeAll(() => {
        const keyChars = { Walk: 'E', CurbRamp: 'C' };
        window.util = {
            misc: {
                VALID_LABEL_TYPES_WITHOUT_OTHER: ['CurbRamp'],
                getLabelDescriptions: (type) => ({ keyChar: keyChars[type] }),
            },
        };
        window.eval(`${KEYBOARD_SRC}\nwindow.KeyboardManager = KeyboardManager;`);
        // One instance for the file: the constructor adds window listeners that are never removed.
        const contextMenu = { isOpen: () => menuOpen, getTargetLabel: () => null, hide: () => { menuOpen = false; } };
        new window.KeyboardManager(svl, {}, contextMenu, { getStatus: () => true }, ribbon, {});
    });

    beforeEach(() => {
        ribbon.modeSwitch.mockClear();
        ribbon.backToWalk.mockClear();
        menuOpen = false;
        svl.tracker = { push: jest.fn() };
        svl.canvas = { showLabelHoverInfo: jest.fn() };
        window.svl = svl;
    });

    /** Releases a key on the page. */
    function release(init) {
        document.body.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, ...init }));
    }

    it('switches mode from the C key even when the layout types a Cyrillic letter there', () => {
        release({ key: 'с', code: 'KeyC' });
        expect(ribbon.modeSwitch).toHaveBeenCalledWith('CurbRamp');
        expect(svl.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ModeSwitch_CurbRamp', { code: 'KeyC' });
    });

    it('ignores a C typed from a different key', () => {
        release({ key: 'c', code: 'KeyJ' });
        expect(ribbon.modeSwitch).not.toHaveBeenCalled();
    });

    it('leaves Ctrl+C to the browser', () => {
        release({ key: 'c', code: 'KeyC', ctrlKey: true });
        expect(ribbon.modeSwitch).not.toHaveBeenCalled();
    });

    it('closes an open context menu on Escape without also logging a switch back to Explore Mode', () => {
        menuOpen = true;
        release({ key: 'Escape', code: 'Escape' });
        expect(menuOpen).toBe(false);
        expect(ribbon.backToWalk).toHaveBeenCalledTimes(1);
        expect(svl.tracker.push).toHaveBeenCalledWith('ContextMenu_CloseKeyboardShortcut', { code: 'Escape' });
        expect(svl.tracker.push).not.toHaveBeenCalledWith('KeyboardShortcut_ModeSwitch_Walk', expect.anything());
    });

    it('switches back to Explore Mode on Escape with the menu closed', () => {
        release({ key: 'Escape', code: 'Escape' });
        expect(svl.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ModeSwitch_Walk', { code: 'Escape' });
    });
});
