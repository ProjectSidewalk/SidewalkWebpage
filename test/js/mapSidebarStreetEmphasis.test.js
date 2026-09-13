/**
 * Tests for the sidebar's street-row emphasis (public/js/ps-map/MapSidebarFilter.js, #5258).
 *
 * The three street states differ on the map only by color and dash pattern, so pointing at a row swells the streets
 * it stands for. The interesting part is not the swelling but the bookkeeping around it: pointer and keyboard both
 * drive it and they overlap, so the two are tracked separately — a pointer leaving the panel must not cancel an
 * emphasis the keyboard still holds, and a mouse click, which also focuses the row's checkbox, must not strand the
 * emphasis on after the pointer moves away.
 *
 * MapSidebarFilter is a Grunt-concatenated `class` that reaches for page globals, so both it and the shared street
 * helpers are eval'd into jsdom.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js');
const FILTER_SIDEBAR_SRC = fs.readFileSync(path.join(SRC_DIR, 'common/filter-sidebar/FilterSidebar.js'), 'utf8');
const MAP_SIDEBAR_SRC = fs.readFileSync(path.join(SRC_DIR, 'ps-map/MapSidebarFilter.js'), 'utf8');
const MAP_UTILS_SRC = fs.readFileSync(path.join(SRC_DIR, 'ps-map/psMapUtilities.js'), 'utf8');

const STREET_ROWS = ['audited-street', 'outdated-street', 'unaudited-street'];

/** Builds just enough sidebar for MapSidebarFilter's constructor, with a real streets section. */
function buildFixture() {
    const streetRows = STREET_ROWS.map((id) => `
        <li class="filter-sidebar__item">
          <input type="checkbox" id="${id}" class="filter-sidebar__checkbox" checked data-filter-type="streets">
          <label class="filter-sidebar__item-label" for="${id}">
            <span class="filter-sidebar__item-name">${id}</span>
          </label>
        </li>`).join('');

    document.body.innerHTML = `
      <div id="filter-sidebar">
        <button type="button" id="filter-sidebar-close">close</button>
        <section class="filter-sidebar__section" data-filter-section="streets">
          <ul class="filter-sidebar__list">${streetRows}</ul>
        </section>
      </div>
      <button type="button" id="filter-sidebar-open">open</button>
      <div id="filter-sidebar-resize-handle"></div>`;
}

describe('street row emphasis', () => {
    let paint;

    /**
     * The audit state currently thickened, read by matching the painted expression against the ones the shared
     * builder produces — so the test can't drift from the widths the layer is actually built with.
     * @returns {?string} The emphasized state, null when none is, or 'unrecognized' for an expression from neither.
     */
    const emphasizedState = () => {
        const painted = JSON.stringify(paint['line-width']);
        const match = STREET_ROWS.map((id) => id.replace('-street', ''))
            .find((state) => painted === JSON.stringify(window.streetLineWidth(state)));
        if (match) return match;
        return painted === JSON.stringify(window.streetLineWidth()) ? null : 'unrecognized';
    };

    const row = (id) => document.getElementById(id).closest('.filter-sidebar__item');
    const fire = (id, type, target = null) =>
        (target ?? row(id)).dispatchEvent(new window.Event(type, { bubbles: type.startsWith('focus') }));

    /**
     * Focuses a row's checkbox the way a keyboard user would, so it reports `:focus-visible`.
     * @param {string} id The row's checkbox id.
     */
    const focusByKeyboard = (id) => {
        const checkbox = document.getElementById(id);
        checkbox.matches = (selector) => selector === ':focus-visible';
        checkbox.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    };

    /**
     * Focuses a row's checkbox the way a click does — focused, but with no focus ring.
     * @param {string} id The row's checkbox id.
     */
    const focusByPointer = (id) => {
        const checkbox = document.getElementById(id);
        checkbox.matches = () => false;
        checkbox.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    };

    beforeAll(() => {
        window.i18next = { t: (key) => key, language: 'en' };
        window.filterLabelLayers = () => {};
        window.toggleLabelLayer = () => {};
        window.eval(`${FILTER_SIDEBAR_SRC}\nwindow.FilterSidebar = FilterSidebar;`);
        // The real helpers, so the width expression under test is the one the layer is actually built with.
        window.eval(`${MAP_UTILS_SRC}\nwindow.emphasizeStreetState = emphasizeStreetState;`
            + '\nwindow.streetLineWidth = streetLineWidth;\nwindow.filterStreetLayer = filterStreetLayer;');
        window.eval(`${MAP_SIDEBAR_SRC}\nwindow.MapSidebarFilter = MapSidebarFilter;`);
    });

    beforeEach(() => {
        buildFixture();
        paint = { 'line-width': window.streetLineWidth() };
        const map = {
            getLayer: () => true,
            easeTo: () => {},
            setPadding: () => {},
            setFilter: () => {},
            setLayoutProperty: () => {},
            setPaintProperty: (layer, prop, value) => { paint[prop] = value; },
        };
        const mapData = {
            correct: true, incorrect: false, unsure: true, unvalidated: true, lowQualityUsers: false,
            notAdminValidated: false, spotlightLabelId: null, severities: {}, selectedTags: {}, sortedLabels: {},
            layerNames: {}, streetCounts: null,
        };
        return new window.MapSidebarFilter(map, mapData);
    });

    it('starts with no state emphasized', () => {
        expect(emphasizedState()).toBeNull();
    });

    it.each(STREET_ROWS)('thickens the state its row stands for: %s', (id) => {
        fire(id, 'mouseenter');
        expect(emphasizedState()).toBe(id.replace('-street', ''));
    });

    it('returns every street to its normal width when the pointer leaves', () => {
        fire('audited-street', 'mouseenter');
        fire('audited-street', 'mouseleave');

        expect(emphasizedState()).toBeNull();
    });

    it('follows the pointer straight from one row to the next', () => {
        fire('audited-street', 'mouseenter');
        // Browsers fire the new row's enter before the old row's leave; the emphasis must not end up cleared.
        fire('unaudited-street', 'mouseenter');
        fire('audited-street', 'mouseleave');

        expect(emphasizedState()).toBe('unaudited');
    });

    it('emphasizes a row reached by keyboard', () => {
        focusByKeyboard('outdated-street');

        expect(emphasizedState()).toBe('outdated');
    });

    it('keeps the keyboard\'s emphasis when a pointer sweeps over the row and off again', () => {
        focusByKeyboard('outdated-street');
        fire('outdated-street', 'mouseenter');
        fire('outdated-street', 'mouseleave');

        // The row still has focus, so the answer it was giving must survive the pointer wandering past.
        expect(emphasizedState()).toBe('outdated');
    });

    it('lets the pointer override the focused row while it is on another', () => {
        focusByKeyboard('outdated-street');
        fire('audited-street', 'mouseenter');
        expect(emphasizedState()).toBe('audited');

        fire('audited-street', 'mouseleave');
        expect(emphasizedState()).toBe('outdated');
    });

    it('does not strand the emphasis after a click, which focuses the row without a focus ring', () => {
        focusByPointer('audited-street');
        fire('audited-street', 'mouseenter');
        fire('audited-street', 'mouseleave');

        expect(emphasizedState()).toBeNull();
    });

    it('clears the emphasis when focus leaves the row', () => {
        focusByKeyboard('audited-street');
        fire('audited-street', 'focusout');

        expect(emphasizedState()).toBeNull();
    });
});
