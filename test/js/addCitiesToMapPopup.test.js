/**
 * Regression test for the /cities map city popup — public/js/ps-map/addCitiesToMap.js.
 *
 * Guards issue #4591: the popup read `stats.validations.total_validations` from /v3/api/overallStats after that total
 * had moved under `stats.validations.combined` (the endpoint was restructured into combined/human/ai sub-objects).
 * The result was that the "Validations" cell always rendered 0 while distance and labels populated correctly. This
 * pins the popup's read paths against a realistic overallStats response shape so the same field drift can't recur
 * silently (the `|| 0` fallback turns a moved field into a wrong value, not a thrown error).
 *
 * Runs under jsdom (jest.config.js testEnvironment) so window/document exist. addCitiesToMap is a bare global
 * function (Project Sidewalk's frontend has no module system), so we execute the file in global scope via
 * `new Function` — unlike the *Preview modules, it never self-assigns onto `window`, so a plain require() wouldn't
 * expose it. Mapbox, i18next and fetch are all stubbed.
 */

const fs = require('fs');
const path = require('path');

const MODULE_PATH = path.resolve(__dirname, '..', '..', 'public/js/ps-map/addCitiesToMap.js');

// Realistic slice of /v3/api/overallStats: validation totals live under validations.combined/human/ai (#4591),
// labels under labels.label_count, distance at km_explored.
const GOOD_STATS = {
    km_explored: 1234,
    labels: { label_count: 21649 },
    validations: {
        combined: { total_validations: 32747 },
        human: { total_validations: 32747 },
        ai: { total_validations: 0 },
    },
};

// The pre-restructure shape the buggy code expected: a flat total_validations with no `combined` sub-object.
const OLD_FLAT_STATS = {
    km_explored: 1234,
    labels: { label_count: 21649 },
    validations: { total_validations: 32747 },
};

// Mirrors the [data-stat] hooks in app/views/common/cityPopupTemplate.scala.html (only the parts the JS touches).
const POPUP_TEMPLATE = `
  <template id="city-popup-template">
    <div class="popup-content">
      <h3 class="popup-title"></h3>
      <div class="popup-stats-grid">
        <div class="popup-stat-value" data-stat="distance">-</div>
        <div class="popup-stat-value" data-stat="labels">-</div>
        <div class="popup-stat-value" data-stat="validations">-</div>
      </div>
      <a href="#" class="popup-link city-selection-trigger"></a>
    </div>
  </template>`;

// Captures the DocumentFragment the popup is populated with so tests can inspect the rendered cells.
let lastPopupContent;

/**
 * Minimal mapboxgl.Popup stub: the fluent methods return `this`; setDOMContent records the fragment.
 */
class FakePopup {
    setLngLat() { return this; }
    setHTML() { return this; }
    addTo() { return this; }
    setDOMContent(content) { lastPopupContent = content; return this; }
}

class FakeLngLatBounds {
    extend() { return this; }
}

/**
 * Build a stub Mapbox map that records the handlers registered via `map.on(type, layer, cb)` so a test can fire a
 * synthetic click. getLayer() returns truthy so addCitiesToMap's completion promise resolves immediately.
 * @returns {object} The fake map, exposing captured handlers on `.handlers` keyed as `type` or `type:layer`.
 */
function makeFakeMap() {
    const handlers = {};
    return {
        handlers,
        addSource() {},
        addLayer() {},
        on(type, layerOrCb, maybeCb) {
            handlers[maybeCb ? `${type}:${layerOrCb}` : type] = maybeCb || layerOrCb;
        },
        getCanvas() { return { style: {} }; },
        setFeatureState() {},
        setMinZoom() {},
        setMaxZoom() {},
        setProjection() {},
        setMaxBounds() {},
        fitBounds() {},
        getLayer() { return true; },
    };
}

/**
 * Synthetic click event for a public city, matching the feature shape addCitiesToMap reads.
 * @returns {object} A Mapbox-style click event with one feature.
 */
function makeClickEvent() {
    return {
        features: [{
            id: 'seattle',
            properties: {
                url: 'https://example.org',
                city_id: 'seattle',
                city_name_formatted: 'Seattle, WA',
                city_name_short: 'Seattle',
                visibility: 'public',
            },
            geometry: { coordinates: [-122.33, 47.6] },
        }],
    };
}

/**
 * Fresh citiesData GeoJSON for each run (addCitiesToMap mutates features in place).
 * @returns {object} GeoJSON FeatureCollection-ish object with one city.
 */
function makeCitiesData() {
    return { features: [{ properties: { city_id: 'seattle' }, geometry: { coordinates: [-122.33, 47.6] } }] };
}

/**
 * Install a global `fetch` stub resolving to the given JSON body.
 * @param {object} body - The object the stubbed fetch resolves with as JSON.
 */
function stubFetch(body) {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }));
}

/**
 * Load addCitiesToMap into global scope. It's a top-level `function` declaration with no `window.X = ...` self-assign,
 * so require() would keep it module-scoped; executing the source via `new Function` puts the declaration on the
 * global object, matching how Grunt-concatenated scripts behave in the browser.
 * @returns {Function} The addCitiesToMap function.
 */
function loadAddCitiesToMap() {
    const src = fs.readFileSync(MODULE_PATH, 'utf8');
    return new Function(`${src}\nreturn addCitiesToMap;`)();
}

describe('addCitiesToMap city popup (#4591)', () => {
    let addCitiesToMap;
    let map;

    beforeEach(() => {
        document.body.innerHTML = POPUP_TEMPLATE;
        lastPopupContent = undefined;
        // format-number echoes the raw value so tests can assert exact numbers; other keys just return the key.
        global.i18next = {
            t: (key, opts) => {
                if (key === 'common:format-number') return String(opts.val);
                if (key === 'common:measurement-system') return 'metric';
                if (key === 'common:unit-distance-abbreviation') return 'km';
                return key;
            },
        };
        global.mapboxgl = { Popup: FakePopup, LngLatBounds: FakeLngLatBounds };
        addCitiesToMap = loadAddCitiesToMap();
        map = makeFakeMap();
    });

    afterEach(() => {
        delete global.fetch;
        delete global.i18next;
        delete global.mapboxgl;
        jest.restoreAllMocks();
    });

    /**
     * Wire up the map, fire a city click with the given stats body, and wait for the async handler to finish.
     * @param {object} statsBody - The overallStats JSON the stubbed fetch returns.
     */
    async function clickCity(statsBody) {
        stubFetch(statsBody);
        await addCitiesToMap(map, makeCitiesData(), { mapName: 'cities-map', logClicks: false });
        await map.handlers['click:cities'](makeClickEvent());
    }

    const validationsCell = () => lastPopupContent.querySelector('[data-stat="validations"]').textContent;
    const labelsCell = () => lastPopupContent.querySelector('[data-stat="labels"]').textContent;
    const distanceCell = () => lastPopupContent.querySelector('[data-stat="distance"]').textContent;

    test('fetches overallStats from the clicked city origin', async () => {
        await clickCity(GOOD_STATS);
        expect(global.fetch).toHaveBeenCalledWith('https://example.org/v3/api/overallStats');
    });

    test('populates all three stat cells from the current overallStats shape', async () => {
        await clickCity(GOOD_STATS);
        expect(validationsCell()).toBe('32747'); // stats.validations.combined.total_validations
        expect(labelsCell()).toBe('21649'); // stats.labels.label_count
        expect(distanceCell()).toBe('1234 km'); // stats.km_explored
    });

    // The regression itself: with the pre-restructure flat shape, validations.combined is undefined, so the cell
    // falls back to 0 while labels/distance still populate — exactly the reported #4591 symptom. If the code ever
    // reverts to reading the flat `validations.total_validations`, the assertion above fails against GOOD_STATS.
    test('the removed flat validations shape renders 0 (documents the #4591 symptom)', async () => {
        await clickCity(OLD_FLAT_STATS);
        expect(validationsCell()).toBe('0');
        expect(labelsCell()).toBe('21649');
    });
});
