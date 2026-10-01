/**
 * Tests for public/js/validate/src/Tracker.js: key events log the key's position, never the character typed, and
 * nothing for a password field (#5618).
 */

const fs = require('fs');
const path = require('path');

const TRACKER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/Tracker.js');
const Tracker = (0, eval)(`(() => {\n${fs.readFileSync(TRACKER_PATH, 'utf8')}\nreturn Tracker;\n})()`);

describe('Tracker key notes', () => {
    let tracker;

    beforeAll(() => {
        global.svv = { panoViewer: { getPosition: () => null, getPov: () => null, getPanoId: () => null }, form: {} };
        // One instance for the file: the constructor adds document listeners that are never removed.
        tracker = new Tracker();
    });

    afterAll(() => {
        delete global.svv;
    });

    beforeEach(() => {
        document.body.innerHTML = '<input id="comment"><input id="password" type="password">';
    });

    /** Presses a key on the element and returns the note its keydown row was logged with. */
    function noteFor(el) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', bubbles: true }));
        return tracker.getActions().filter((a) => a.action === 'LowLevelEvent_keydown').at(-1).note;
    }

    test('notes the key code, not the character typed', () => {
        expect(noteFor(document.getElementById('comment'))).toBe('code:KeyA');
    });

    test('notes nothing about a key pressed in a password field', () => {
        expect(noteFor(document.getElementById('password'))).toBe('');
    });
});
