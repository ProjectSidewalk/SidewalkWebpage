/**
 * Tests the map filter drawer's open/closed state machine (#4875).
 *
 * The drawer is built at map-ready, before the label feed lands, because below its breakpoint it starts collapsed
 * and the reopen button is then the only route back to the filters — and to the search box nested inside them. So
 * what has to be pinned is that the state machine is complete on its own: the chrome, the accessibility state, and
 * the map padding all follow the drawer, in both directions, including across a breakpoint crossing.
 *
 * jsdom has no layout and no matchMedia, so the viewport is a controllable stub and the sidebar reports a fixed
 * width. Loaded the same way as navbarDisclosures.test.js: eval'd with an explicit export.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/ps-map/MapSidebarDrawer.js'), 'utf8'
);

const SIDEBAR_WIDTH = 350;

/** Controllable matchMedia: `setNarrow` flips the viewport and notifies listeners the way a real crossing does. */
function installViewport() {
    const listeners = [];
    const mql = {
        matches: false,
        addEventListener: (_type, fn) => listeners.push(fn),
    };
    window.matchMedia = () => mql;
    return {
        setNarrow(narrow) {
            mql.matches = narrow;
            listeners.forEach((fn) => fn(mql));
        },
    };
}

/** A stand-in for the mapbox map, recording the padding the drawer asks for. */
function fakeMap() {
    return {
        easeTo: jest.fn(),
        setPadding: jest.fn(),
        /** @returns {?object} The most recent padding requested, by either route. */
        lastPadding() {
            const calls = [...this.easeTo.mock.calls.map((c) => c[0].padding), ...this.setPadding.mock.calls.map((c) => c[0])];
            return calls.length ? calls[calls.length - 1] : null;
        },
    };
}

/**
 * Builds the sidebar markup and constructs a drawer over it.
 *
 * @param {object} [options]
 * @param {boolean} [options.narrow=false] Start below the drawer's breakpoint.
 * @param {boolean} [options.startCollapsed=false] Pass the same-named drawer option.
 * @returns {object} The drawer, its elements, the map stub, and the viewport control.
 */
function build({narrow = false, startCollapsed = false} = {}) {
    document.body.innerHTML = `
      <div id="filter-sidebar" class="filter-sidebar ps-invisible" role="complementary">
        <button type="button" id="filter-sidebar-close"></button>
        <section class="filter-sidebar__section"><button type="button">Deselect all</button></section>
      </div>
      <div id="filter-sidebar-resize-handle"></div>
      <button type="button" id="filter-sidebar-open" aria-expanded="false"></button>`;

    const sidebar = document.getElementById('filter-sidebar');
    // jsdom lays nothing out, so the drawer's padding arithmetic needs a width to read.
    Object.defineProperty(sidebar, 'offsetWidth', {value: SIDEBAR_WIDTH, configurable: true});

    const viewport = installViewport();
    viewport.setNarrow(narrow);
    window.logWebpageActivity = jest.fn();

    window.eval(`${SRC}\nwindow.MapSidebarDrawer = MapSidebarDrawer;`);
    const map = fakeMap();
    const drawer = new window.MapSidebarDrawer(map, sidebar, {startCollapsed});

    return {
        drawer, map, viewport, sidebar,
        openBtn: document.getElementById('filter-sidebar-open'),
        closeBtn: document.getElementById('filter-sidebar-close'),
        handle: document.getElementById('filter-sidebar-resize-handle'),
    };
}

/** @returns {boolean} Whether the drawer is parked off-canvas. */
const isCollapsed = (sidebar) => sidebar.classList.contains('filter-sidebar--hidden');

describe('MapSidebarDrawer', () => {
    describe('initial state', () => {
        it('opens on a wide viewport and pushes the map centre clear of the panel', () => {
            const {sidebar, map, openBtn, drawer} = build();

            expect(drawer.isOpen).toBe(true);
            expect(isCollapsed(sidebar)).toBe(false);
            expect(openBtn.style.display).toBe('none');
            expect(map.lastPadding()).toEqual({left: SIDEBAR_WIDTH, top: 0, right: 0, bottom: 0});
        });

        it('starts collapsed below the breakpoint, with the reopen button already usable', () => {
            const {sidebar, map, openBtn, drawer} = build({narrow: true});

            expect(drawer.isOpen).toBe(false);
            expect(isCollapsed(sidebar)).toBe(true);
            expect(openBtn.style.display).toBe('block');
            expect(openBtn.getAttribute('aria-expanded')).toBe('false');
            // The whole point: the button works now, not once the label feed lands.
            openBtn.click();
            expect(drawer.isOpen).toBe(true);
            expect(isCollapsed(sidebar)).toBe(false);
        });

        it('honours startCollapsed on a wide viewport', () => {
            const {drawer, sidebar} = build({startCollapsed: true});

            expect(drawer.isOpen).toBe(false);
            expect(isCollapsed(sidebar)).toBe(true);
        });

        it('does not log its own initial state, and does not steal focus on load', () => {
            build({narrow: true});

            expect(window.logWebpageActivity).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(document.body);
        });

        it('leaves the camera centred when the drawer covers the map', () => {
            const {map} = build({narrow: true});

            expect(map.lastPadding()).toEqual({left: 0, top: 0, right: 0, bottom: 0});
        });
    });

    describe('opening and closing', () => {
        it('keeps the off-canvas panel out of the tab order and the accessibility tree', () => {
            const {sidebar, closeBtn, openBtn} = build();

            expect(sidebar.inert).toBe(false);
            expect(sidebar.getAttribute('aria-hidden')).toBe('false');

            closeBtn.click();
            expect(sidebar.inert).toBe(true);
            expect(sidebar.getAttribute('aria-hidden')).toBe('true');
            expect(openBtn.getAttribute('aria-expanded')).toBe('false');

            openBtn.click();
            expect(sidebar.inert).toBe(false);
            expect(openBtn.getAttribute('aria-expanded')).toBe('true');
        });

        it('moves focus to whichever control is now the way back out', () => {
            const {closeBtn, openBtn} = build();

            closeBtn.click();
            expect(document.activeElement).toBe(openBtn);

            openBtn.click();
            expect(document.activeElement).toBe(closeBtn);
        });

        it('logs each user-driven change, and nothing for a programmatic one', () => {
            const {drawer, closeBtn} = build();

            closeBtn.click();
            expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=MapSidebar_Close');

            window.logWebpageActivity.mockClear();
            drawer.open({log: false});
            expect(window.logWebpageActivity).not.toHaveBeenCalled();
        });

        it('closes on Escape while the drawer covers the map', () => {
            const {drawer, openBtn} = build({narrow: true});
            openBtn.click();
            expect(drawer.isOpen).toBe(true);

            document.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape'}));
            expect(drawer.isOpen).toBe(false);
        });

        it('leaves Escape alone on a wide viewport, where the map is still reachable beside the panel', () => {
            const {drawer} = build();

            document.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape'}));
            expect(drawer.isOpen).toBe(true);
        });

        it('does not animate the camera to padding it already has', () => {
            const {drawer, map} = build({narrow: true});
            map.easeTo.mockClear();
            map.setPadding.mockClear();

            // Both states leave a covering drawer's camera unpadded, so neither move is worth half a second.
            drawer.open();
            drawer.close();

            expect(map.easeTo).not.toHaveBeenCalled();
            expect(map.setPadding).not.toHaveBeenCalled();
        });

        it('hides the resize handle whenever the panel is not a resizable column', () => {
            const {handle, closeBtn} = build();
            expect(handle.style.display).toBe('');

            closeBtn.click();
            expect(handle.style.display).toBe('none');
        });
    });

    describe('crossing the breakpoint', () => {
        it('collapses a drawer that would otherwise cover the whole map', () => {
            const {drawer, sidebar, viewport, openBtn} = build();
            expect(drawer.isOpen).toBe(true);

            viewport.setNarrow(true);

            expect(drawer.isOpen).toBe(false);
            expect(isCollapsed(sidebar)).toBe(true);
            expect(openBtn.style.display).toBe('block');
        });

        it('drops an inline width from a drag session, which would beat the full-width rule', () => {
            const {sidebar, viewport} = build();
            sidebar.style.width = '520px';

            viewport.setNarrow(true);

            expect(sidebar.style.width).toBe('');
        });

        it('gives a dragged width back on the way to a wide viewport, rather than losing it to a rotation', () => {
            const {sidebar, viewport} = build();
            sidebar.style.width = '520px';

            viewport.setNarrow(true);
            expect(sidebar.style.width).toBe('');

            viewport.setNarrow(false);
            expect(sidebar.style.width).toBe('520px');
        });

        it('re-derives the padding on the way back to a wide viewport', () => {
            const {map, viewport, openBtn} = build({narrow: true});
            openBtn.click();
            expect(map.lastPadding()).toEqual({left: 0, top: 0, right: 0, bottom: 0});

            viewport.setNarrow(false);

            expect(map.lastPadding()).toEqual({left: SIDEBAR_WIDTH, top: 0, right: 0, bottom: 0});
        });

        it('reconciles a crossing without logging it or moving focus', () => {
            const {viewport} = build();
            window.logWebpageActivity.mockClear();

            viewport.setNarrow(true);

            expect(window.logWebpageActivity).not.toHaveBeenCalled();
            expect(document.activeElement).toBe(document.body);
        });
    });
});
