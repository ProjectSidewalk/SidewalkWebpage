/**
 * Explore's F shortcut for immersive mode (public/js/explore/src/keyboard/KeyboardManager.js, #5085).
 *
 * The key is a tag shortcut while the context menu is open, and an f typed anywhere editable is text, so the toggle
 * has to be reachable only from a bare F on the page itself. Nothing else pins that: KeyboardManager's other tests
 * cover Space and the mode letters.
 */

const fs = require('fs');
const path = require('path');

const KEYBOARD_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/keyboard/KeyboardManager.js'), 'utf8'
);

describe('Explore F shortcut for immersive mode', () => {
    let contextMenuOpen;
    // The svl the manager was constructed with; its collaborators are replaced per test.
    const svl = {};

    beforeAll(() => {
        window.util = { misc: { VALID_LABEL_TYPES_WITHOUT_OTHER: [], getLabelDescriptions: () => ({}) } };
        window.eval(`${KEYBOARD_SRC}\nwindow.KeyboardManager = KeyboardManager;`);
        contextMenuOpen = false;
        // One instance for the file: the constructor adds window listeners that are never removed.
        const contextMenu = { isOpen: () => contextMenuOpen, getTargetLabel: () => null, hide: jest.fn() };
        new window.KeyboardManager(svl, {}, contextMenu, { getStatus: () => true }, {}, {});
    });

    beforeEach(() => {
        contextMenuOpen = false;
        Object.assign(svl, {
            tracker: { push: jest.fn() },
            canvas: { showLabelHoverInfo: jest.fn() },
            immersiveMode: { toggle: jest.fn() },
        });
        window.svl = svl;
        document.body.innerHTML = '<input id="field"><div id="note" contenteditable="true"></div><button id="btn"></button>';
    });

    /** Releases the F key on the element, as a physical KeyF, with the given modifier state. */
    function releaseF(el, init = {}) {
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'f', code: 'KeyF', bubbles: true, ...init }));
    }

    it('toggles on a bare F, and logs the toggle as a keyboard shortcut', () => {
        releaseF(document.body);
        expect(window.svl.immersiveMode.toggle).toHaveBeenCalledWith('KeyboardShortcut');
    });

    it('leaves F to the context menu while it is open', () => {
        contextMenuOpen = true;
        releaseF(document.body);
        expect(window.svl.immersiveMode.toggle).not.toHaveBeenCalled();
    });

    it('leaves an f typed into a text field or an editable region alone', () => {
        const field = document.getElementById('field');
        field.focus();
        releaseF(field);
        const note = document.getElementById('note');
        // jsdom does not implement isContentEditable, which is what a browser reports for the attribute.
        Object.defineProperty(note, 'isContentEditable', { value: true });
        note.focus();
        releaseF(note);
        expect(window.svl.immersiveMode.toggle).not.toHaveBeenCalled();
    });

    it('ignores F with a modifier, which belongs to the browser', () => {
        releaseF(document.body, { ctrlKey: true });
        releaseF(document.body, { metaKey: true });
        releaseF(document.body, { shiftKey: true });
        releaseF(document.body, { altKey: true });
        expect(window.svl.immersiveMode.toggle).not.toHaveBeenCalled();
    });
});
