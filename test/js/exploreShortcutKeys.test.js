/**
 * Explore's shortcut keys (#5618): letters match what's printed on the key, other layouts still work, and keys pressed
 * with the context menu open aren't also handled as menu-closed shortcuts.
 */

const { loadModules } = require('./loadGlobalScript');


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
        Object.assign(window, loadModules('frontend/js/common/KeyboardShortcuts.js', 'frontend/js/explore/keyboard/KeyboardManager.js'));
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

    it('goes by the printed letter on a Latin layout, wherever the key sits', () => {
        release({ key: 'c', code: 'KeyJ' });
        expect(ribbon.modeSwitch).toHaveBeenCalledWith('CurbRamp');
    });

    it.each(['ctrlKey', 'altKey', 'metaKey'])('leaves C to the browser with %s held', (modifier) => {
        release({ key: 'c', code: 'KeyC', [modifier]: true });
        expect(ribbon.modeSwitch).not.toHaveBeenCalled();
    });

    it('leaves E to the tags while the context menu is open', () => {
        menuOpen = true;
        release({ key: 'e', code: 'KeyE' });
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
