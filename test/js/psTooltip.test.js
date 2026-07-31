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

/** Installs a layout stub: the tooltip card reports a fixed size, every other element the rect it was given. */
function stubLayout() {
    Element.prototype.getBoundingClientRect = function () {
        if (this.classList.contains('ps-tooltip')) {
            return {
                left: 0, top: 0, right: CARD_WIDTH, bottom: CARD_HEIGHT, width: CARD_WIDTH, height: CARD_HEIGHT,
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
