/**
 * Tests for taking a searched place back off the map (public/js/labelMapLocationSearch.js, #5321).
 *
 * The pin a search drops is the state that outlives everything else: the search box's own ✕ empties the input and
 * leaves the map alone, so unless something else removes the pin there is no way back to an unselected map. These
 * tests pin the contract that `clearSelection` is the only undo path and that it unwinds the whole selection —
 * pin, invitation popup, search text, and the clear button itself — from each of the three triggers.
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
        '<section id="labelmap-search-section"><div id="labelmap-search-box"></div></section>';

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

            addTo() { return this; }

            getElement() { return this.content; }

            remove() { this.removed = true; return this; }
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

    test('the clear button is mounted hidden and does nothing until a place is selected', () => {
        const button = document.getElementById('labelmap-search-clear');
        expect(button).not.toBeNull();
        expect(button.hidden).toBe(true);
        expect(button.textContent).toBe('labelmap:search-clear');
        // It sits in the search section, not inside the Mapbox control, so the SDK can't re-render it away.
        expect(button.parentElement.id).toBe('labelmap-search-section');

        expect(search.clear()).toBe(false);
        pressEscape();
        expect(logged).toEqual([]);
    });

    test('selecting a place drops a pin and reveals the clear button', () => {
        retrieve();

        expect(markers).toHaveLength(1);
        expect(document.querySelectorAll('.ps-search-pin')).toHaveLength(1);
        expect(document.getElementById('labelmap-search-clear').hidden).toBe(false);
    });

    test('the clear button removes the pin, empties the box, and hides itself', () => {
        retrieve();
        document.getElementById('labelmap-search-clear').click();

        expect(markers[0].removed).toBe(true);
        expect(document.querySelectorAll('.ps-search-pin')).toHaveLength(0);
        expect(document.getElementById('labelmap-search-clear').hidden).toBe(true);
        expect(window.__searchBoxInstance.value).toBe('');
        expect(logged).toEqual(['Click_module=ClearSearchResult']);
    });

    test('the search box\'s own clear event drops the pin with it', () => {
        retrieve();
        window.__searchBoxInstance.dispatchEvent(new CustomEvent('clear'));

        expect(markers[0].removed).toBe(true);
        expect(document.getElementById('labelmap-search-clear').hidden).toBe(true);
        expect(logged).toEqual(['Click_module=ClearSearchResult']);
    });

    test('Escape closes an open invitation popup first, and only then clears the place', () => {
        retrieve();
        // Focusing the pin is what opens the popup; the pin is a real button built by the production code.
        document.querySelector('.ps-search-pin').dispatchEvent(new window.FocusEvent('focus'));
        expect(popups).toHaveLength(1);

        pressEscape();
        expect(popups[0].removed).toBe(true);
        expect(markers[0].removed).toBe(false);
        expect(logged).toEqual([]);

        pressEscape();
        expect(markers[0].removed).toBe(true);
        expect(document.getElementById('labelmap-search-clear').hidden).toBe(true);
        expect(logged).toEqual(['KeyboardShortcut_module=ClearSearchResult']);
    });

    test('clearing from the button hands focus back to the search field', () => {
        retrieve();
        const button = document.getElementById('labelmap-search-clear');
        button.focus();
        button.click();

        // Not document.body: a keyboard user whose focus target is hidden out from under them loses their place.
        expect(document.activeElement).toBe(window.__searchBoxInstance.input);
    });

    test('a second search replaces the first place rather than stacking pins', () => {
        retrieve('First Place');
        retrieve('Second Place');

        expect(markers).toHaveLength(2);
        expect(markers[0].removed).toBe(true);
        expect(document.querySelectorAll('.ps-search-pin')).toHaveLength(1);
        expect(document.getElementById('labelmap-search-clear').hidden).toBe(false);
    });

    test('clear() reports whether there was anything to clear, and logs only when there was', () => {
        retrieve();
        expect(search.clear()).toBe(true);
        expect(search.clear()).toBe(false);
        expect(logged).toEqual(['Click_module=ClearSearchResult']);
    });
});
