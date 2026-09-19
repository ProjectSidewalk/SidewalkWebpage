/**
 * Tests for Toast's per-anchor queueing (public/js/common/Toast.js).
 *
 * Every toast anchored to the same element is positioned at the identical spot, so before #4895 they drew on top of
 * one another — two cards in one rectangle, and two `role="status"` regions live at once. Explore alone can raise six
 * over `#pano`. The queue is what makes that safe, and it is easy to get subtly wrong (a successor mounting during its
 * predecessor's fade, a cancelled toast leaving the anchor stuck), so each of those cases is pinned here.
 *
 * Toast.js declares a top-level class, so the source is evaluated directly rather than required — the same approach
 * toastPosition.test.js takes. A fresh class is built per test because the queue lives in static state.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/Toast.js'), 'utf8'
);

/** Every `.ps-toast` currently in the document. */
const mounted = () => document.querySelectorAll('.ps-toast');

/** The message text of each mounted toast, in DOM order. */
const mountedMessages = () => [...mounted()].map((el) => el.querySelector('.ps-toast__message').textContent);

describe('Toast queueing', () => {
    let Toast;
    let anchorA;
    let anchorB;

    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '';
        global.i18next = { t: (key) => key };
        global.util = { assetPath: assetPathStub }; // The close button's icon URL.
        // A fresh class per test: the live/waiting maps are static, so a shared one would leak between cases.
        Toast = new Function(`${SOURCE}; return Toast;`)();
        anchorA = document.createElement('div');
        anchorB = document.createElement('div');
        document.body.append(anchorA, anchorB);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /** Advances past a toast of `duration` and the fade that follows it. */
    const elapse = (duration) => jest.advanceTimersByTime(duration + Toast.FADE_MS);

    it('shows the first toast and holds the second back', () => {
        Toast.show({ message: 'first', reference: anchorA, duration: 1000 });
        Toast.show({ message: 'second', reference: anchorA, duration: 1000 });

        expect(mountedMessages()).toEqual(['first']);
    });

    it('shows the queued toast once its predecessor has faded, never during the fade', () => {
        Toast.show({ message: 'first', reference: anchorA, duration: 1000 });
        Toast.show({ message: 'second', reference: anchorA, duration: 1000 });

        // The dismiss timer has fired but the fade is still running: the spot is not free yet.
        jest.advanceTimersByTime(1000);
        expect(mountedMessages()).toEqual(['first']);

        jest.advanceTimersByTime(Toast.FADE_MS);
        expect(mountedMessages()).toEqual(['second']);
    });

    it('never has two live status regions on one anchor', () => {
        Toast.show({ message: 'first', reference: anchorA, duration: 1000 });
        Toast.show({ message: 'second', reference: anchorA, duration: 1000 });
        Toast.show({ message: 'third', reference: anchorA, duration: 1000 });

        for (const expected of ['first', 'second', 'third']) {
            expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
            expect(mountedMessages()).toEqual([expected]);
            elapse(1000);
        }
        expect(mounted()).toHaveLength(0);
    });

    it('does not serialize toasts on different anchors', () => {
        Toast.show({ message: 'on A', reference: anchorA, duration: 1000 });
        Toast.show({ message: 'on B', reference: anchorB, duration: 1000 });

        expect(mountedMessages()).toEqual(['on A', 'on B']);
    });

    it('drops a queued toast that is dismissed before its turn, and promotes the one behind it', () => {
        Toast.show({ message: 'first', reference: anchorA, duration: 1000 });
        const cancelled = Toast.show({ message: 'cancelled', reference: anchorA, duration: 1000 });
        Toast.show({ message: 'third', reference: anchorA, duration: 1000 });

        cancelled.dismiss();
        elapse(1000);

        expect(mountedMessages()).toEqual(['third']);
    });

    it('releases the anchor when the only toast is dismissed early', () => {
        const first = Toast.show({ message: 'first', reference: anchorA, duration: 0 });
        first.dismiss();
        jest.advanceTimersByTime(Toast.FADE_MS);

        Toast.show({ message: 'later', reference: anchorA, duration: 0 });
        expect(mountedMessages()).toEqual(['later']);
    });

    it('queues anchorless toasts against each other, since they share one position', () => {
        Toast.show({ message: 'first', duration: 1000 });
        Toast.show({ message: 'second', duration: 1000 });

        expect(mountedMessages()).toEqual(['first']);
        elapse(1000);
        expect(mountedMessages()).toEqual(['second']);
    });
});
