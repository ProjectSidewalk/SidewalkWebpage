/**
 * Tests for taking a searched place back off the map (public/js/labelMapLocationSearch.js, #5321).
 *
 * The pin a search drops is the state that outlives everything else: on its own, the search box's ✕ empties the input
 * and leaves the map alone, so unless something else removes the pin there is no way back to an unselected map. These
 * tests pin the contract that `clearSelection` is the only undo path and that it unwinds the whole selection — pin,
 * invitation popup and search text — from each of its triggers, and that the pin itself only opens the invitation
 * rather than leaving the page.
 *
 * Like exploreHerePopup.test.js, the source is a set of top-level declarations written for the Grunt-concatenation
 * world, so it is eval'd into the jsdom global scope with an epilogue exposing what the tests need. Mapbox's Search
 * JS component and GL marker/popup are stubbed to the narrow surface the file uses; `retrieve` is a real event on a
 * real EventTarget, which is what the production code listens to.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/labelMapLocationSearch.js'), 'utf8'
);

/** Markers built by the mapboxgl stub during the current test, newest last. */
let markers = [];
/** Popups built by the mapboxgl stub during the current test, newest last. */
let popups = [];
/** Everything passed to window.logWebpageActivity during the current test. */
let logged = [];

/** A stand-in for Mapbox Search JS's `<mapbox-search-box>`: an EventTarget owning the input the file writes to. */
class SearchBoxStub extends EventTarget {
    constructor() {
        super();
        this.element = document.createElement('div');
        this.element.className = 'mapboxgl-ctrl';
        this.input = document.createElement('input');
        this.input.setAttribute('role', 'combobox');
        this.element.appendChild(this.input);
        // Mirrors Search JS 1.5.0's input keydown handler: with results showing, Escape hides them (flipping
        // aria-expanded back to false) and returns WITHOUT stopping propagation, so the key still reaches the
        // document. That leak is what a list-dismissing Escape must not turn into a clear.
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.input.getAttribute('aria-expanded') === 'true') {
                this.input.setAttribute('aria-expanded', 'false');
            }
        });
    }

    /** Shows the suggestion list the way Search JS does, as far as the file can observe it. */
    openResults() {
        this.input.setAttribute('aria-expanded', 'true');
    }

    /** @returns {HTMLElement} The control's DOM, as Search JS's onAdd returns it. */
    onAdd() {
        return this.element;
    }

    /** @returns {string} The input's current text, mirroring the real component's accessor. */
    get value() {
        return this.input.value;
    }

    set value(v) {
        this.input.value = v || '';
    }
}

/** Installs the globals the file reads off `window`, and mounts the sidebar markup it mounts into. */
function setUpPage() {
    markers = [];
    popups = [];
    logged = [];
    document.body.innerHTML =
        '<section id="labelmap-search-section"><div id="labelmap-search-box"></div></section>'
        + '<button id="elsewhere">Unrelated</button>'
        + '<dialog id="sheet"><button id="in-dialog">Inside</button></dialog>';

    window.i18next = { t: (key) => key };
    window.util = { assetPath: (p) => p };
    window.logWebpageActivity = (activity) => logged.push(activity);
    // The city-extent fetch is fire-and-forget; an empty collection keeps it from touching the network or warning.
    window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }) });
    window.MapboxSearchBox = SearchBoxStub;
    window.mapboxgl = {
        Marker: class {
            constructor(opts) {
                this.element = opts.element;
                this.removed = false;
                markers.push(this);
            }

            setLngLat() { return this; }

            // The real Marker appends its element to the map's container; the pin has to be in the document for
            // the tests (and the file's own focus/hover wiring) to reach it.
            addTo(map) { this.map = map; document.body.appendChild(this.element); return this; }

            remove() { this.removed = true; this.element.remove(); return this; }
        },
        Popup: class {
            constructor() {
                this.removed = false;
                popups.push(this);
            }

            setDOMContent(el) { this.content = el; return this; }

            setLngLat() { return this; }

            // The real Popup mounts its content in the map's container; it has to be in the document for the
            // file's focus hand-off into the popup's button to work.
            addTo() { document.body.appendChild(this.content); return this; }

            getElement() { return this.content; }

            remove() { this.removed = true; this.content.remove(); return this; }
        },
    };
}

/** A map stub with no rendered neighborhood layer, so the popup body skips its completion pitch. */
const mapStub = { getLayer: () => null };

/** Evals the production source fresh and returns the pieces the tests drive. */
function loadModule() {
    window.eval(`${SRC}\nwindow.__search = { initLabelMapLocationSearch };`);
    return window.__search;
}

/** Selects a place the way Search JS does: a `retrieve` event carrying the chosen feature. */
function retrieve(name = 'Teaneck Public Library') {
    window.__searchBoxInstance.dispatchEvent(new CustomEvent('retrieve', {
        detail: {
            features: [{
                geometry: { coordinates: [-74.02, 40.9] },
                properties: { name, full_address: '840 Teaneck Rd, Teaneck, NJ 07666' },
            }],
        },
    }));
}

/** Presses Escape on the document, where the file binds its handler. */
function pressEscape() {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
}

describe('clearing a searched place', () => {
    let search;

    beforeEach(() => {
        setUpPage();
        // Capture the instance the file constructs, so the tests can fire `retrieve` at the object it listens on.
        window.MapboxSearchBox = class extends SearchBoxStub {
            constructor() {
                super();
                window.__searchBoxInstance = this;
            }
        };
        search = loadModule().initLabelMapLocationSearch(mapStub, 'test-token');
    });

    afterEach(() => {
        // Each init binds its own document-level Escape handler that outlives its test, so every test must leave
        // its selection cleared or a later Escape would fire a stale one too.
        search.clear();
    });

    test('nothing is cleared, or logged, until a place is selected', () => {
        expect(search.clear()).toBe(false);
        window.__searchBoxInstance.input.focus();
        pressEscape();
        expect(logged).toEqual([]);
    });

    test('selecting a place drops a pin named for the place', () => {
        retrieve();

        expect(markers).toHaveLength(1);
        const pin = document.querySelectorAll('.ps-search-pin');
        expect(pin).toHaveLength(1);
        // The pin only opens the invitation, so it is named for what it marks, not for what the popup's button does.
        expect(pin[0].getAttribute('aria-label')).toBe('Teaneck Public Library');
    });

    test('the search box\'s own clear event removes the pin and empties the box', () => {
        retrieve();
        window.__searchBoxInstance.dispatchEvent(new CustomEvent('clear'));

        expect(markers[0].removed).toBe(true);
        expect(document.querySelectorAll('.ps-search-pin')).toHaveLength(0);
        expect(window.__searchBoxInstance.value).toBe('');
        expect(logged).toEqual(['Click_module=ClearSearchResult']);
    });

    test('activating the pin opens the invitation and hands focus to its button instead of navigating', () => {
        retrieve();
        document.querySelector('.ps-search-pin').click();

        expect(popups).toHaveLength(1);
        expect(popups[0].removed).toBe(false);
        const button = popups[0].content.querySelector('.explore-here-button');
        expect(document.activeElement).toBe(button);
        // The pin's own log row is not the ExploreSidewalksHere one: only the button's click means Explore opened.
        expect(logged).toEqual(['Click_module=SearchPin_lat=40.9_lng=-74.02']);
    });

    test('the invitation stays open while focus is inside it, and closes once focus has left both it and the pin',
        () => {
            jest.useFakeTimers();
            try {
                retrieve();
                const pin = document.querySelector('.ps-search-pin');
                pin.focus();
                pin.click();
                jest.runAllTimers();
                expect(popups[0].removed).toBe(false);

                document.getElementById('elsewhere').focus();
                expect(popups[0].removed).toBe(false);
                jest.runAllTimers();
                expect(popups[0].removed).toBe(true);
                expect(markers[0].removed).toBe(false);
            } finally {
                jest.useRealTimers();
            }
        });

    test('Escape with focus on the invitation\'s button closes it and returns focus to the pin', () => {
        retrieve();
        const pin = document.querySelector('.ps-search-pin');
        pin.click();
        pressEscape();

        expect(popups[0].removed).toBe(true);
        expect(markers[0].removed).toBe(false);
        expect(document.activeElement).toBe(pin);
        // Handing focus back must not reopen the popup that was just closed.
        expect(popups).toHaveLength(1);
    });

    test('Escape closes an open invitation popup first, and only then clears the place', () => {
        retrieve();
        // Focusing the pin is what opens the popup; the pin is a real button built by the production code.
        document.querySelector('.ps-search-pin').focus();
        expect(popups).toHaveLength(1);

        pressEscape();
        expect(popups[0].removed).toBe(true);
        expect(markers[0].removed).toBe(false);
        expect(logged).toEqual([]);

        pressEscape();
        expect(markers[0].removed).toBe(true);
        expect(logged).toEqual(['KeyboardShortcut_module=ClearSearchResult']);
    });

    test('Escape from the search input clears the place', () => {
        retrieve();
        window.__searchBoxInstance.input.focus();
        pressEscape();

        expect(markers[0].removed).toBe(true);
        expect(logged).toEqual(['KeyboardShortcut_module=ClearSearchResult']);
    });

    test('Escape from an unrelated control leaves the place alone', () => {
        retrieve();
        document.getElementById('elsewhere').focus();
        pressEscape();

        // Escape is the dismiss key for half the page (cluster sheet, label card, Mapbox popup, suggestion list);
        // none of those may take the pin with them.
        expect(markers[0].removed).toBe(false);
        expect(logged).toEqual([]);
    });

    test('Escape while a modal dialog is open leaves the place alone', () => {
        retrieve();
        document.getElementById('sheet').setAttribute('open', '');
        document.getElementById('in-dialog').focus();
        pressEscape();

        expect(markers[0].removed).toBe(false);
        expect(logged).toEqual([]);

        // And with the dialog closed again, the same key from the same place still does nothing: the guard is a
        // second line of defence, not the thing doing the scoping.
        document.getElementById('sheet').removeAttribute('open');
        pressEscape();
        expect(markers[0].removed).toBe(false);
        expect(logged).toEqual([]);
    });

    test('Escape that closes the suggestion list leaves the place and the typed query alone', () => {
        retrieve();
        const box = window.__searchBoxInstance;
        box.input.focus();
        box.input.value = 'Second sea';
        box.openResults();

        // Dispatched at the input, so the SDK's handler and the file's capture-phase one both see it in real order.
        box.input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(box.input.getAttribute('aria-expanded')).toBe('false');
        expect(markers[0].removed).toBe(false);
        expect(box.input.value).toBe('Second sea');
        expect(logged).toEqual([]);

        // With the list gone, the next Escape is the clear.
        box.input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(markers[0].removed).toBe(true);
        expect(logged).toEqual(['KeyboardShortcut_module=ClearSearchResult']);
    });

    test('Escape aimed at an open modal leaves the invitation popup open', () => {
        retrieve();
        document.querySelector('.ps-search-pin').focus();
        expect(popups).toHaveLength(1);
        document.getElementById('sheet').setAttribute('open', '');

        pressEscape();

        expect(popups[0].removed).toBe(false);
        expect(markers[0].removed).toBe(false);
        document.getElementById('sheet').removeAttribute('open');
    });

    test('clearing with focus on the pin or in its popup hands focus back to the search field', () => {
        retrieve();
        document.querySelector('.ps-search-pin').focus();
        expect(search.clear()).toBe(true);
        // Not document.body: a keyboard user whose focus target is removed out from under them loses their place.
        expect(document.activeElement).toBe(window.__searchBoxInstance.input);

        retrieve();
        document.querySelector('.ps-search-pin').click();
        expect(document.activeElement.className).toContain('explore-here-button');
        expect(search.clear()).toBe(true);
        expect(document.activeElement).toBe(window.__searchBoxInstance.input);
    });

    test('a second search replaces the first place rather than stacking pins', () => {
        retrieve('First Place');
        retrieve('Second Place');

        expect(markers).toHaveLength(2);
        expect(markers[0].removed).toBe(true);
        expect(document.querySelectorAll('.ps-search-pin')).toHaveLength(1);
    });

    test('clear() reports whether there was anything to clear, and logs only when there was', () => {
        retrieve();
        expect(search.clear()).toBe(true);
        expect(search.clear()).toBe(false);
        expect(logged).toEqual(['Click_module=ClearSearchResult']);
    });
});
