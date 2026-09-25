/**
 * Tests for logPopupLinkClicks (public/js/ps-map/psMapUtilities.js) and its use by addCitiesToMap.
 *
 * Map popup links are rebuilt every time a popup opens, so the click log listens on the map container and matches
 * each click against a selector. These pin that a click anywhere inside the link logs, that clicks elsewhere don't,
 * and that the cities map wires the selector its popup template actually uses.
 */

const fs = require('fs');
const path = require('path');

const SRC = ['public/js/common/geoBounds.js', 'public/js/ps-map/psMapUtilities.js', 'public/js/ps-map/addCitiesToMap.js']
    .map((file) => fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8'))
    .join('\n');

/** Mirrors the link in app/views/common/cityPopupTemplate.scala.html. */
const POPUP_TEMPLATE = `
  <template id="city-popup-template">
    <div class="popup-content">
      <div class="popup-title"></div>
      <div class="popup-stats">
        <div class="stat" data-stat="validations"></div>
        <div class="stat" data-stat="labels"></div>
        <div class="stat" data-stat="distance"></div>
      </div>
      <a href="#" class="popup-link city-selection-trigger"></a>
    </div>
  </template>
  <div id="cities-map"></div>`;

/** Loads the sources as globals, the way the Grunt-concatenated bundle runs in the browser. */
function loadGlobals() {
    return new Function(`${SRC}\nreturn { logPopupLinkClicks, addCitiesToMap };`)();
}

/**
 * Minimal Mapbox map stand-in: the popup put into it is rendered straight into the container, and layer handlers are
 * recorded so a test can fire a city click.
 * @param {HTMLElement} container
 * @returns {object}
 */
function makeFakeMap(container) {
    const handlers = {};
    return {
        handlers,
        getContainer: () => container,
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

/** Popup stand-in that renders its content into the map container, as the real one renders into the map's DOM. */
class FakePopup {
    setLngLat() { return this; }
    setHTML() { return this; }
    addTo(map) { this.container = map.getContainer(); return this; }
    setDOMContent(content) {
        this.container.replaceChildren(content);
        return this;
    }
}

class FakeLngLatBounds {
    extend() { return this; }
}

describe('logPopupLinkClicks', () => {
    let logged;

    beforeEach(() => {
        document.body.innerHTML = POPUP_TEMPLATE;
        logged = [];
        window.logWebpageActivity = (activity) => logged.push(activity);
    });

    afterEach(() => {
        delete window.logWebpageActivity;
    });

    test('logs a click on the link or anything inside it, and ignores the rest of the map', () => {
        const container = document.getElementById('cities-map');
        container.innerHTML = '<div class="not-a-link"></div><a class="go" data-id="7"><b class="inner">x</b></a>';
        const { logPopupLinkClicks } = loadGlobals();
        logPopupLinkClicks(makeFakeMap(container), '.go', (link) => `Click_id=${link.dataset.id}`);

        container.querySelector('.inner').click();
        container.querySelector('.go').click();
        container.querySelector('.not-a-link').click();
        container.click();

        expect(logged).toEqual(['Click_id=7', 'Click_id=7']);
    });

    describe('on the cities map', () => {
        beforeEach(() => {
            global.i18next = { t: (key, opts) => (key === 'common:format-number' ? String(opts.val) : key) };
            global.util = { isMetric: () => true, longDistanceToString: (km) => `${km} km` };
            global.mapboxgl = { Popup: FakePopup, LngLatBounds: FakeLngLatBounds };
            const stats = { km_explored: 1, labels: { count: 2 }, validations: { combined: { total_validations: 3 } } };
            global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(stats) }));
        });

        afterEach(() => {
            delete global.i18next;
            delete global.util;
            delete global.mapboxgl;
            delete global.fetch;
        });

        test('logs the city id of the popup link that was clicked', async () => {
            const container = document.getElementById('cities-map');
            const map = makeFakeMap(container);
            const { addCitiesToMap } = loadGlobals();
            const cities = { features: [{ properties: { city_id: 'seattle' }, geometry: { coordinates: [-122.33, 47.6] } }] };
            await addCitiesToMap(map, cities, { mapName: 'cities-map', logClicks: true });
            await map.handlers['click:cities']({
                features: [{
                    id: 'seattle',
                    properties: { url: 'https://example.org', city_id: 'seattle', city_name_formatted: 'Seattle, WA' },
                    geometry: { coordinates: [-122.33, 47.6] },
                }],
            });

            container.querySelector('.popup-link').click();

            expect(logged).toEqual(['Click_module=cities-map_cityId=seattle']);
        });
    });
});
