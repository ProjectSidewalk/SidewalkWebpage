/**
 * Tests for the shared tooltip (public/js/common/psTooltip.js).
 *
 * Covers the two behaviors that a screenshot pass would not catch, because both only show up in motion or at an
 * edge: the placement preference (above by default, below on request, each yielding to the side that has room) and
 * the live refresh when a trigger's text changes while its tooltip is open. That second one is the Validate
 * Hide/Show toggle — it relabels itself on click with the pointer still resting on it, so a card that only read the
 * text on open would sit there describing the state the user just left.
 *
 * psTooltip.js is an IIFE that wires document listeners on load, so the test evaluates the source directly.
 * jsdom has no layout engine, so getBoundingClientRect is stubbed: the tooltip reports the size each test states,
 * and triggers report the rect they were assigned.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/psTooltip.js'), 'utf8'
);

// Matches the constants in psTooltip.js.
const TRIGGER_GAP = 8;
const VIEWPORT_MARGIN = 8;
const TAIL_INSET = 12; // TAIL_HALF_WIDTH_PX + CORNER_RADIUS_PX

const VIEWPORT_WIDTH = 1000;
const VIEWPORT_HEIGHT = 800;
const CARD_WIDTH = 200;
const CARD_HEIGHT = 40;

// The height the card stub reports. Tests that need a tall card (the Across Cities day breakdown runs to ~250px)
// reassign this before opening one.
let cardHeight = CARD_HEIGHT;

/** Installs a layout stub: the tooltip card reports `cardHeight`, every other element the rect it was given. */
function stubLayout() {
    Element.prototype.getBoundingClientRect = function () {
        if (this.classList.contains('ps-tooltip')) {
            return {
                left: 0, top: 0, right: CARD_WIDTH, bottom: cardHeight, width: CARD_WIDTH, height: cardHeight,
            };
        }
        const r = this._rect || { left: 0, top: 0, width: 0, height: 0 };
        return { ...r, right: r.left + r.width, bottom: r.top + r.height };
    };
}

/** Adds a trigger at `rect` carrying `text`, plus any extra attributes. */
function addTrigger(rect, text, attrs = {}) {
    const el = document.createElement('button');
    el.setAttribute('data-ps-tooltip', text);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el._rect = rect;
    document.body.appendChild(el);
    return el;
}

/** Opens a trigger's tooltip via the keyboard path, which skips the hover delay. */
function open(trigger) {
    trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    return document.getElementById('ps-tooltip');
}

/**
 * Evaluates psTooltip.js, returning a teardown that detaches the listeners that evaluation registered.
 *
 * Each test needs its own evaluation, because the module keeps `activeTrigger` and its card in a closure with no
 * way to reset them from outside. But it wires six document/window listeners on load, so without the teardown
 * every test would leave its set attached and the file would finish with nine of them stacked up — harmless here,
 * since a stale set only ever touches its own detached card, but not something to hand to the next test that
 * counts calls. addEventListener is patched on EventTarget.prototype so it catches document and window alike.
 * @returns {function(): void} Detaches every listener the evaluation added.
 */
function loadPsTooltip() {
    const added = [];
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (...args) {
        added.push([this, args]);
        return original.apply(this, args);
    };
    try {
        new Function(SOURCE)();
    } finally {
        EventTarget.prototype.addEventListener = original;
    }
    return () => added.forEach(([target, args]) => target.removeEventListener(...args));
}

let unloadPsTooltip;

beforeEach(() => {
    document.body.innerHTML = '';
    window.innerWidth = VIEWPORT_WIDTH;
    window.innerHeight = VIEWPORT_HEIGHT;
    cardHeight = CARD_HEIGHT;
    stubLayout();
    unloadPsTooltip = loadPsTooltip();
});

afterEach(() => {
    unloadPsTooltip();
});

describe('psTooltip placement', () => {
    test('opens above the trigger by default', () => {
        const trigger = addTrigger({ left: 400, top: 300, width: 100, height: 30 }, 'above');
        const card = open(trigger);

        expect(card.style.top).toBe(`${300 - CARD_HEIGHT - TRIGGER_GAP}px`);
        expect(card.classList.contains('ps-tooltip--flipped')).toBe(false);
    });

    test('flips below when there is no room above', () => {
        const trigger = addTrigger({ left: 400, top: 4, width: 100, height: 30 }, 'no room');
        const card = open(trigger);

        expect(card.style.top).toBe(`${34 + TRIGGER_GAP}px`);
        expect(card.classList.contains('ps-tooltip--flipped')).toBe(true);
    });

    test('opens below when the trigger asks for it', () => {
        const trigger = addTrigger(
            { left: 400, top: 300, width: 100, height: 30 }, 'below', { 'data-ps-tooltip-placement': 'bottom' }
        );
        const card = open(trigger);

        expect(card.style.top).toBe(`${330 + TRIGGER_GAP}px`);
        expect(card.classList.contains('ps-tooltip--flipped')).toBe(true);
    });

    test('a bottom-placed tooltip still yields to the viewport floor', () => {
        // Asking for below orders the two sides; it does not pin the card off the bottom of the screen.
        const trigger = addTrigger(
            { left: 400, top: 770, width: 100, height: 25 }, 'below', { 'data-ps-tooltip-placement': 'bottom' }
        );
        const card = open(trigger);

        expect(card.style.top).toBe(`${770 - CARD_HEIGHT - TRIGGER_GAP}px`);
        expect(card.classList.contains('ps-tooltip--flipped')).toBe(false);
    });

    test('clamps into the viewport but keeps the tail on the trigger', () => {
        const trigger = addTrigger({ left: 0, top: 300, width: 40, height: 30 }, 'at the edge');
        const card = open(trigger);

        // Centering would put the card at -80; it clamps to the margin instead.
        expect(card.style.left).toBe(`${VIEWPORT_MARGIN}px`);
        // The tail stays aimed at the trigger's center (20px), not the card's, and clears the rounded corner.
        expect(card.style.getPropertyValue('--ps-tooltip-tail-left')).toBe(`${TAIL_INSET}px`);
    });

    test('holds the tail off the far corner too', () => {
        const trigger = addTrigger({ left: 970, top: 300, width: 30, height: 30 }, 'far edge');
        const card = open(trigger);

        expect(card.style.getPropertyValue('--ps-tooltip-tail-left')).toBe(`${CARD_WIDTH - TAIL_INSET}px`);
    });

    test('keeps a tall card that fits on neither side inside the viewport', () => {
        // The Across Cities day breakdown is a ~250px card on triggers that sit mid-page. In a short window there is
        // room for it neither above nor below, and without a vertical clamp its lower rows run off screen unread.
        cardHeight = 250;
        window.innerHeight = 400;
        const trigger = addTrigger({ left: 400, top: 180, width: 100, height: 30 }, 'tall');
        const card = open(trigger);

        const top = parseFloat(card.style.top);
        expect(top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
        expect(top + cardHeight).toBeLessThanOrEqual(400 - VIEWPORT_MARGIN);
    });

    test('drops the tail when the clamp moves the card off its trigger', () => {
        // A tail is only meaningful while an edge of the card still touches the trigger.
        cardHeight = 250;
        window.innerHeight = 400;
        const trigger = addTrigger({ left: 400, top: 180, width: 100, height: 30 }, 'tall');
        const card = open(trigger);

        expect(card.classList.contains('ps-tooltip--untailed')).toBe(true);
    });

    test('pins a card taller than the viewport to the top, so it is read from the beginning', () => {
        cardHeight = VIEWPORT_HEIGHT + 200;
        const trigger = addTrigger({ left: 400, top: 400, width: 100, height: 30 }, 'enormous');
        const card = open(trigger);

        expect(card.style.top).toBe(`${VIEWPORT_MARGIN}px`);
    });

    test('leaves an ordinary card tailed, since it still sits against its trigger', () => {
        const trigger = addTrigger({ left: 400, top: 300, width: 100, height: 30 }, 'ordinary');
        const card = open(trigger);

        expect(card.classList.contains('ps-tooltip--untailed')).toBe(false);
    });
});

describe('psTooltip live refresh', () => {
    test('re-renders when the open trigger relabels itself', async () => {
        const trigger = addTrigger({ left: 400, top: 300, width: 100, height: 30 }, 'Hide the label.');
        const card = open(trigger);
        expect(card.innerHTML).toBe('Hide the label.');

        trigger.setAttribute('data-ps-tooltip', 'Show the label again.');
        await Promise.resolve(); // MutationObserver callbacks are microtasks.

        expect(card.innerHTML).toBe('Show the label again.');
    });

    test('re-places, not just re-fills — the new string is a different width', async () => {
        const trigger = addTrigger({ left: 0, top: 300, width: 40, height: 30 }, 'Hide the label.');
        const card = open(trigger);

        card.style.setProperty('--ps-tooltip-tail-left', '999px'); // Sentinel: a re-fill alone would leave this.
        trigger.setAttribute('data-ps-tooltip', 'Show the label again.');
        await Promise.resolve();

        expect(card.style.getPropertyValue('--ps-tooltip-tail-left')).toBe(`${TAIL_INSET}px`);
    });

    test('stops watching a trigger once its tooltip is dismissed', async () => {
        const trigger = addTrigger({ left: 400, top: 300, width: 100, height: 30 }, 'Hide the label.');
        const card = open(trigger);

        document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        trigger.setAttribute('data-ps-tooltip', 'Show the label again.');
        await Promise.resolve();

        expect(card.classList.contains('ps-tooltip--visible')).toBe(false);
        expect(card.innerHTML).toBe('Hide the label.');
    });
});

describe('psTooltip pinning (#5495)', () => {
    /** A pinnable trigger, like the Across Cities day bars, whose card carries a link. */
    function addPinnable() {
        return addTrigger(
            { left: 400, top: 300, width: 100, height: 30 },
            '<a id="card-link" href="https://example.org/admin/user/a">a</a>',
            {
                'data-ps-tooltip-pinnable': '', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
                'aria-label': 'Mon',
            },
        );
    }

    const card = () => document.getElementById('ps-tooltip');
    const isVisible = () => card()?.classList.contains('ps-tooltip--visible') ?? false;
    const isPinned = () => card()?.classList.contains('ps-tooltip--pinned') ?? false;
    const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

    test('a click pins the card open as a labeled dialog', () => {
        const trigger = addPinnable();
        trigger.click();

        expect(isVisible()).toBe(true);
        expect(isPinned()).toBe(true);
        expect(card().getAttribute('role')).toBe('dialog');
        expect(card().getAttribute('aria-label')).toBe('Mon');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    test('a pinned card ignores the pointer passing over another trigger on the way to its links', () => {
        const trigger = addPinnable();
        const other = addTrigger({ left: 0, top: 0, width: 10, height: 10 }, 'other');
        trigger.click();
        other.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseleave'));

        expect(isPinned()).toBe(true);
        expect(card().innerHTML).toContain('card-link');
    });

    test('focus moving from the trigger into the card keeps it pinned', () => {
        const trigger = addPinnable();
        trigger.click();
        trigger.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        document.getElementById('card-link').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

        expect(isPinned()).toBe(true);
    });

    test('focus landing elsewhere closes it', () => {
        const trigger = addPinnable();
        const elsewhere = addTrigger({ left: 0, top: 0, width: 10, height: 10 }, 'elsewhere');
        trigger.click();
        elsewhere.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

        expect(isPinned()).toBe(false);
        expect(card().innerHTML).toBe('elsewhere');
    });

    test('a pointerdown outside closes it; one inside does not', () => {
        const trigger = addPinnable();
        trigger.click();
        document.getElementById('card-link').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        expect(isPinned()).toBe(true);

        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        expect(isVisible()).toBe(false);
        expect(isPinned()).toBe(false);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    test('clicking the same trigger again unpins and closes it', () => {
        const trigger = addPinnable();
        trigger.click();
        trigger.click();

        expect(isVisible()).toBe(false);
    });

    test('Enter pins from the keyboard and moves focus into the card, and Escape hands it back', () => {
        const trigger = addPinnable();
        trigger.setAttribute('tabindex', '0');
        trigger.focus();
        key(trigger, 'Enter');

        expect(isPinned()).toBe(true);
        expect(document.activeElement).toBe(card());

        key(card(), 'Escape');
        expect(isVisible()).toBe(false);
        expect(document.activeElement).toBe(trigger);
    });

    test('Space pins too, without scrolling the page', () => {
        const trigger = addPinnable();
        const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        trigger.dispatchEvent(event);

        expect(isPinned()).toBe(true);
        expect(event.defaultPrevented).toBe(true);
    });

    test('a trigger that does not opt in is not pinned by a click', () => {
        const trigger = addTrigger({ left: 400, top: 300, width: 100, height: 30 }, 'plain');
        open(trigger);
        trigger.click();

        expect(isPinned()).toBe(false);
    });

    test('a pinned card follows its trigger through a scroll instead of closing', () => {
        const trigger = addPinnable();
        trigger.click();
        trigger._rect = { left: 400, top: 200, width: 100, height: 30 };
        window.dispatchEvent(new Event('scroll'));

        expect(isPinned()).toBe(true);
        expect(card().style.top).toBe(`${200 - CARD_HEIGHT - TRIGGER_GAP}px`);
    });

    test('a click no pointer made (a screen reader\'s Enter) moves focus into the card like a keyboard pin', () => {
        const trigger = addPinnable();
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

        expect(isPinned()).toBe(true);
        expect(document.activeElement).toBe(card());
    });

    test('a pointer click leaves focus where it was', () => {
        const trigger = addPinnable();
        trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

        expect(isPinned()).toBe(true);
        expect(document.activeElement).not.toBe(card());
    });

    test('a pinned card closes on scroll once a redraw has detached its trigger', () => {
        const trigger = addPinnable();
        trigger.click();
        trigger.remove(); // What MiniLineChart's resize redraw does to a bar.
        window.dispatchEvent(new Event('scroll'));

        expect(isVisible()).toBe(false);
    });

    test('a held Enter pins once rather than toggling on every repeat', () => {
        const trigger = addPinnable();
        key(trigger, 'Enter');
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }));

        expect(isPinned()).toBe(true);
    });

    test('a modified Enter is left to whoever it belongs to', () => {
        const trigger = addPinnable();
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, ctrlKey: true }));

        expect(isVisible()).toBe(false);
    });

    test('stops describing the trigger with the card once it is a dialog', () => {
        const trigger = addPinnable();
        open(trigger);
        expect(trigger.getAttribute('aria-describedby')).toBe('ps-tooltip');

        trigger.click();
        expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    });

    test('Tab off either end of a pinned card goes back to its trigger and keeps it open', () => {
        const trigger = addPinnable();
        trigger.setAttribute('tabindex', '0');
        trigger.focus();
        key(trigger, 'Enter');
        const link = document.getElementById('card-link');
        link.focus();

        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        link.dispatchEvent(tab);
        expect(tab.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(trigger);
        expect(isPinned()).toBe(true);

        link.focus();
        const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
        link.dispatchEvent(back);
        expect(document.activeElement).toBe(trigger);
    });

    test('a pinned card keeps its content while focus is in it, not re-rendering the link away', async () => {
        const trigger = addPinnable();
        trigger.setAttribute('tabindex', '0');
        trigger.focus();
        key(trigger, 'Enter');
        const link = document.getElementById('card-link');
        link.focus();
        trigger.setAttribute('data-ps-tooltip', 'replaced');
        await Promise.resolve();

        expect(document.activeElement).toBe(link);
        expect(link.isConnected).toBe(true);
    });

    test('a pinned card closes once its trigger scrolls out of view', () => {
        const trigger = addPinnable();
        trigger.click();
        trigger._rect = { left: 400, top: -100, width: 100, height: 30 };
        window.dispatchEvent(new Event('scroll'));

        expect(isVisible()).toBe(false);
    });
});
