/**
 * Explore's spacebar route-advance shortcut must leave Space to a focused checkbox
 * (frontend/js/explore/keyboard/KeyboardManager.js, #4945).
 *
 * The shortcut listens on window in the capture phase and cancels Space so it can't re-activate a focused button. A
 * checkbox has no other key that toggles it, so cancelling Space there made the minimap key's "My earlier labels"
 * toggle unreachable from the keyboard and walked the user down the street instead.
 */

import { loadModules } from './loader.js';
import { fakeGate } from './fakes.js';

describe('Explore spacebar shortcut and focused form controls', () => {
    let navigationService;

    beforeAll(async () => {
        const { KeyboardManager } = await loadModules('frontend/js/explore/keyboard/KeyboardManager.js');
        navigationService = {
            // Walking barred makes the route advance a no-op, so the test sees only whether it was attempted.
            canWalk: vi.fn(() => false),
            moveToLinkedPano: vi.fn(),
        };
        // One instance for the file: the constructor adds window listeners that are never removed.
        new KeyboardManager(fakeGate(), {},
            { isOpen: () => false, onTextFieldFocusChanged: vi.fn() }, navigationService, {}, {}, {}, {}, {}, {});
    });

    beforeEach(() => {
        navigationService.canWalk.mockClear();
        document.body.innerHTML = '<input id="cb" type="checkbox"><button id="btn" type="button">Stuck</button>';
    });

    /** Dispatches a cancelable Space keydown on an element and returns the event. */
    function pressSpaceOn(el) {
        const e = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
        el.dispatchEvent(e);
        return e;
    }

    it('leaves Space to a focused checkbox and does not advance', () => {
        const e = pressSpaceOn(document.getElementById('cb'));
        expect(e.defaultPrevented).toBe(false);
        expect(navigationService.canWalk).not.toHaveBeenCalled();
    });

    it('still takes Space from a focused button and advances along the route', () => {
        const e = pressSpaceOn(document.getElementById('btn'));
        expect(e.defaultPrevented).toBe(true);
        expect(navigationService.canWalk).toHaveBeenCalled();
    });
});
