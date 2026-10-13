/**
 * Explore's shortcut keys (#5618): letters match what's printed on the key, other layouts still work, and keys pressed
 * with the context menu open aren't also handled as menu-closed shortcuts.
 */

const { loadModules } = require('./loadGlobalScript');


describe('Explore shortcut keys', () => {
    const tracker = { push: jest.fn() };
    const canvas = { showLabelHoverInfo: jest.fn() };
    const labelModes = { switchTo: jest.fn(), backToWalk: jest.fn() };
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
        const contextMenu = {
            isOpen: () => menuOpen, getTargetLabel: () => null, hide: () => { menuOpen = false; },
            onTextFieldFocusChanged: jest.fn(),
        };
        new window.KeyboardManager({ isHeld: () => false }, canvas, contextMenu, { walking: { isHeld: () => true } },
            labelModes, {}, {}, {}, {}, tracker);
    });

    beforeEach(() => {
        labelModes.switchTo.mockClear();
        labelModes.backToWalk.mockClear();
        menuOpen = false;
        tracker.push = jest.fn();
        canvas.showLabelHoverInfo = jest.fn();
    });

    /** Releases a key on the page. */
    function release(init) {
        document.body.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, ...init }));
    }

    it('switches mode from the C key even when the layout types a Cyrillic letter there', () => {
        release({ key: 'с', code: 'KeyC' });
        expect(labelModes.switchTo).toHaveBeenCalledWith('CurbRamp');
        expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ModeSwitch_CurbRamp', { code: 'KeyC' });
    });

    it('goes by the printed letter on a Latin layout, wherever the key sits', () => {
        release({ key: 'c', code: 'KeyJ' });
        expect(labelModes.switchTo).toHaveBeenCalledWith('CurbRamp');
    });

    it.each(['ctrlKey', 'altKey', 'metaKey'])('leaves C to the browser with %s held', (modifier) => {
        release({ key: 'c', code: 'KeyC', [modifier]: true });
        expect(labelModes.switchTo).not.toHaveBeenCalled();
    });

    it('leaves E to the tags while the context menu is open', () => {
        menuOpen = true;
        release({ key: 'e', code: 'KeyE' });
        expect(labelModes.switchTo).not.toHaveBeenCalled();
    });

    it('closes an open context menu on Escape without also logging a switch back to Explore Mode', () => {
        menuOpen = true;
        release({ key: 'Escape', code: 'Escape' });
        expect(menuOpen).toBe(false);
        expect(labelModes.backToWalk).toHaveBeenCalledTimes(1);
        expect(tracker.push).toHaveBeenCalledWith('ContextMenu_CloseKeyboardShortcut', { code: 'Escape' }, null);
        expect(tracker.push).not.toHaveBeenCalledWith('KeyboardShortcut_ModeSwitch_Walk', expect.anything());
    });

    it('switches back to Explore Mode on Escape with the menu closed', () => {
        release({ key: 'Escape', code: 'Escape' });
        expect(tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ModeSwitch_Walk', { code: 'Escape' });
    });
});
