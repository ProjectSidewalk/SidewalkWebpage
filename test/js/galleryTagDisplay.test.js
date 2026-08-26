/**
 * Tests the Gallery card's tag row, which fits pills into the card in measured pixels (#4691).
 *
 * jsdom has no layout engine, so widths come from a jQuery stand-in that reports whatever each test declares —
 * the same approach anchorPanelToLabel.test.js takes. The stand-in models the page's global `box-sizing: border-box`
 * the way a browser does: a declared width is the pill's content box, and `outerWidth` adds the padding, border and
 * margins on top. That is enough to pin the things that matter here: the fitting arithmetic (which tags show whole,
 * which is ellipsized, which fall into the "+n" popover), that a pill is charged for its own chrome, that a narrow
 * card still shows a tag rather than a bare "+n" (#5009), and that the measurements are read off pills this card
 * built rather than whatever the document happens to contain.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/gallery/src/displays/TagDisplay.js'), 'utf8'
);

/** Widths the stub reports, in the units the production code compares: CSS px. */
const HOLDER_WIDTH = 400;
const TAG_MARGIN = 2;
const PILL_CHROME = 12; // A pill's own padding + border, which border-box measurements have to pay for.
const CHAR_PX = 6; // Width of one character, for the strings a test doesn't size by name (probes, the "+n" pill).

/**
 * Installs a jQuery stand-in over the real DOM.
 *
 * Only the handful of calls TagDisplay makes are implemented. `width()` and `outerWidth()` consult `widthOf`, so a
 * test can declare what each pill measures; everything else falls through to the real element.
 *
 * A string argument is resolved as a selector and may match nothing, which is the case that matters: jQuery's
 * `.css()` on an empty set returns undefined, and reading a length off undefined is what silently poisons the
 * fitting arithmetic with NaN.
 *
 * @param {function(HTMLElement): number} widthOf - Reports an element's content-box width.
 * @returns {{layoutReads: number[]}} How many pills were attached at each width read, so batching is observable.
 */
function stubJQuery(widthOf) {
    const reads = [];
    const wrap = (target) => {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return emptySet;
        return live(el);
    };
    const emptySet = {
        empty: () => emptySet,
        append: () => emptySet,
        popover: () => emptySet,
        width: () => null,
        outerWidth: () => null,
        css: () => undefined,
    };
    const live = (el) => ({
        empty() {
            el.replaceChildren();
            return this;
        },
        append(child) {
            // jQuery accepts an array of nodes; the production code relies on that to attach every pill at once.
            el.append(...(Array.isArray(child) ? child : [child]));
            return this;
        },
        width() {
            return widthOf(el);
        },
        outerWidth(includeMargin) {
            reads.push(el.parentElement ? el.parentElement.children.length : 0);
            // An ellipsized pill is clamped to its max-width, which border-box sizing applies to the whole pill.
            const max = parseFloat(el.style.maxWidth);
            const borderBox = Number.isNaN(max)
                ? widthOf(el) + PILL_CHROME
                : Math.min(max, widthOf(el) + PILL_CHROME);
            return borderBox + (includeMargin ? TAG_MARGIN * 2 : 0);
        },
        css(prop, value) {
            if (value !== undefined) {
                el.style[prop] = typeof value === 'number' ? `${value}px` : value;
                return this;
            }
            if (prop === 'marginLeft' || prop === 'marginRight') return `${TAG_MARGIN}px`;
            return '';
        },
        // The "+n" pill's Bootstrap popover; chained, so every call has to return the wrapper.
        popover() {
            return this;
        },
    });
    global.$ = wrap;
    window.$ = wrap;
    return {layoutReads: reads};
}

/**
 * Renders a tag row into a fresh card.
 *
 * @param {string[]} tags - Tag names to display.
 * @param {Object<string, number>} widths - Content-box width per tag name; other text is sized by character count.
 * @param {number} [holderWidth=HOLDER_WIDTH] - The space the tag row has to spend, i.e. the card's width less its
 *     severity, validation and "Tags" header columns.
 * @returns {{container: HTMLElement, layoutReads: number[]}}
 */
function render(tags, widths, holderWidth = HOLDER_WIDTH) {
    document.body.innerHTML = '<div class="card-tags" id="1"></div>';
    const container = document.querySelector('.card-tags');
    const probe = stubJQuery((el) => {
        if (el.classList.contains('label-tags-holder')) return holderWidth;
        return widths[el.textContent] ?? el.textContent.length * CHAR_PX;
    });
    window.eval(`${SRC}\nwindow.TagDisplay = TagDisplay;`);
    new window.TagDisplay(container, tags);
    return {container, layoutReads: probe.layoutReads};
}

/** @returns {string[]} The text of the pills actually on the card, "+n" excluded. */
const shownTags = (container) => [...container.querySelectorAll('.thumbnail-tag')].map((el) => el.textContent);

/** @returns {?string} The "+n" pill's text, or null when every tag fit. */
const overflowPill = (container) => container.querySelector('.additional-count')?.textContent ?? null;

beforeAll(() => {
    // The production file translates tag names and the "Tags" header through i18next; identity keeps the test
    // readable, since a pill's text is also how the stub looks up its width.
    global.i18next = {t: (key) => key.replace(/^tag\./, '')};
    window.i18next = global.i18next;
    global.sg = {cardFilter: {getAppliedTagNames: () => []}};
    window.sg = global.sg;

    // jsdom implements no layout, and therefore no innerText; the pills set their text through it.
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() {
            return this.textContent;
        },
        set(value) {
            this.textContent = value;
        },
    });
});

beforeEach(() => {
    document.body.replaceChildren();
});

describe('TagDisplay', () => {
    it('shows every tag when they all fit', () => {
        const {container} = render(['narrow', 'grass'], {narrow: 100, grass: 100});

        expect(shownTags(container)).toEqual(['narrow', 'grass']);
        expect(overflowPill(container)).toBeNull();
    });

    it('moves the tags that do not fit into the "+n" popover', () => {
        // 380px of room; the first two pills eat 332px of it, leaving too little for even a stub of a third.
        const {container} = render(['narrow', 'grass', 'uneven'], {narrow: 150, grass: 150, uneven: 150}, 380);

        expect(shownTags(container)).toEqual(['narrow', 'grass']);
        expect(overflowPill(container)).toBe(' + 1');
    });

    it('ellipsizes a tag that half fits, and titles it with the full text', () => {
        // 400px of room, and 282px of it is spent before a 150px pill with only ~118px left arrives.
        const {container} = render(['narrow', 'grass', 'uneven'], {narrow: 150, grass: 100, uneven: 150});

        const last = [...container.querySelectorAll('.thumbnail-tag')].at(-1);
        expect(last.textContent).toBe('uneven');
        expect(parseFloat(last.style.maxWidth)).toBeGreaterThan(0);
        expect(last.title).toBe('uneven');
    });

    it('counts a pill\'s padding, border and margins against the row', () => {
        // The tag's text fits the row on its own; the pill it sits in does not, so it has to be cut down.
        const {container} = render(['narrow'], {narrow: 100}, 110);

        expect(shownTags(container)).toEqual(['narrow']);
        expect(parseFloat(container.querySelector('.thumbnail-tag').style.maxWidth)).toBeLessThan(110);
    });

    it('still shows a tag on a card too narrow to hold a whole one', () => {
        // A phone-width card leaves the row under 100px. A cutoff fixed in px outgrew that budget and buried every
        // tag behind a bare "+n"; the cutoff a pill actually needs to say something still fits (#5009).
        const {container} = render(['narrow', 'grass'], {narrow: 150, grass: 150}, 100);

        expect(shownTags(container)).toEqual(['narrow']);
        expect(container.querySelector('.thumbnail-tag').title).toBe('narrow');
        expect(overflowPill(container)).toBe(' + 1');
    });

    it('keeps the popover contents out of the card, marked as not shown', () => {
        const {container} = render(['narrow', 'grass', 'uneven'], {narrow: 150, grass: 150, uneven: 150}, 380);

        expect(container.querySelector('.not-added')).toBeNull();
        expect(overflowPill(container)).toBe(' + 1');
    });

    it('measures pills this card built, so the first card on a page fits like any other', () => {
        // An empty document is exactly the first-card case: a document-wide margin lookup finds nothing there and
        // turns every width comparison into NaN, hiding tags that plainly fit.
        expect(document.querySelectorAll('.gallery-tag')).toHaveLength(0);

        const {container} = render(['narrow', 'grass'], {narrow: 100, grass: 100});

        expect(shownTags(container)).toEqual(['narrow', 'grass']);
    });

    it('reads every pill in one pass, after they are all attached', () => {
        const {layoutReads} = render(['narrow', 'grass', 'uneven'], {narrow: 100, grass: 100, uneven: 100});

        // Three pills, their three minimum-width probes and the "+n" pill: interleaving would attach each one only
        // after measuring the last, so the reads would climb rather than all seeing the full row.
        expect(layoutReads).toEqual([7, 7, 7, 7, 7, 7, 7]);
    });

    it('renders nothing when the label has no tags', () => {
        const {container} = render([], {});

        expect(container.querySelector('.label-tags-holder')).toBeNull();
        expect(container.textContent).toBe('');
    });
});
