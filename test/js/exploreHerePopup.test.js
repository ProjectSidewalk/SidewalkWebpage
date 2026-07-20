/**
 * Tests for the LabelMap search-pin "explore here" popup builder (public/js/labelMapLocationSearch.js, #4451).
 *
 * The load-bearing contract: the place name, street address, and neighborhood name shown in the popup come from
 * OUTSIDE this codebase (Mapbox Search Box results are built on user-editable OSM data), so they must land in the
 * DOM as text, never as markup — the file's innerHTML template may only carry trusted structure. These tests feed
 * hostile strings through `buildExploreHereContent` and assert nothing parses as an element. Also pins the
 * progress-bar gating (no "100% explored" pitch), the href passthrough, and `streetAddress`'s fallback chain.
 *
 * The file's functions are top-level declarations written for the Grunt-concatenation world, so (like
 * share-widget.test.js) the source is eval'd into the jsdom global scope with an epilogue exposing what the tests
 * need. The pin/marker/Escape wiring needs real mapboxgl + MapboxSearchBox objects and stays manual-QA territory.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/labelMapLocationSearch.js'), 'utf8'
);

/** Evals the production source fresh and returns the functions under test. */
function loadModule() {
    window.eval(`${SRC}\nwindow.__exploreHere = { buildExploreHereContent, streetAddress };`);
    return window.__exploreHere;
}

/** A map stub whose rendered neighborhood layer is absent (point outside the deployment). */
const mapWithoutNeighborhood = { getLayer: () => null };

/** A map stub that reports one rendered neighborhood under the pin. */
function mapWithNeighborhood(regionName, completionRate) {
    return {
        getLayer: () => ({}),
        project: () => ({ x: 0, y: 0 }),
        queryRenderedFeatures: () => [{ properties: { region_name: regionName, completionRate } }],
    };
}

const HREF = '/explore?lat=40.9&lng=-74.02&placeName=Town%20Hall';

describe('buildExploreHereContent', () => {
    let mod;

    beforeEach(() => {
        // Identity-t mock, except the percent interpolation which the progress assertions need realized.
        window.i18next = {
            t: (key, opts) => (opts && opts.percent !== undefined ? `${opts.percent}% explored` : key),
        };
        mod = loadModule();
    });

    test('hostile place name and address render as text, not markup', () => {
        const payload = '<img src=x onerror="window.__pwned = 1">';
        const el = mod.buildExploreHereContent(mapWithoutNeighborhood, 40.9, -74.02, payload, '<b>addr</b>', HREF);

        expect(el.querySelector('img')).toBeNull();
        expect(el.querySelector('b')).toBeNull();
        expect(window.__pwned).toBeUndefined();
        expect(el.querySelector('.explore-here__place').textContent).toBe(payload);
        expect(el.querySelector('.explore-here__address').textContent).toBe('<b>addr</b>');
    });

    test('hostile neighborhood name renders as text, and the progress bar reflects the completion rate', () => {
        const map = mapWithNeighborhood('<script>bad()</script>', 41.6);
        const el = mod.buildExploreHereContent(map, 40.9, -74.02, 'Town Hall', '', HREF);

        expect(el.querySelector('script')).toBeNull();
        expect(el.querySelector('.explore-here__region').textContent).toBe('<script>bad()</script>');
        expect(el.querySelector('.explore-here__percent').textContent).toContain('42% explored');
        expect(el.querySelector('.explore-here__fill').style.width).toBe('42%');
    });

    test('a fully-explored neighborhood gets no progress pitch', () => {
        const el = mod.buildExploreHereContent(mapWithNeighborhood('Somewhere', 100), 40.9, -74.02, 'X', '', HREF);
        expect(el.querySelector('.explore-here__context')).toBeNull();
        expect(el.querySelector('.explore-here__track')).toBeNull();
    });

    test('empty place name and address emit no empty paragraphs', () => {
        const el = mod.buildExploreHereContent(mapWithoutNeighborhood, 40.9, -74.02, '', '', HREF);
        expect(el.querySelector('.explore-here__place')).toBeNull();
        expect(el.querySelector('.explore-here__address')).toBeNull();
    });

    test('the explore button links to exactly the href it was given', () => {
        const el = mod.buildExploreHereContent(mapWithoutNeighborhood, 40.9, -74.02, 'Town Hall', '', HREF);
        expect(el.querySelector('.explore-here-button').getAttribute('href')).toBe(HREF);
    });
});

describe('streetAddress', () => {
    let mod;

    beforeEach(() => {
        window.i18next = { t: (key) => key };
        mod = loadModule();
    });

    test('prefers the structured context address', () => {
        expect(mod.streetAddress({ context: { address: { name: '100 Elizabeth Ave' } } })).toBe('100 Elizabeth Ave');
    });

    test('falls back to the flat address property, then the first segment of the formatted address', () => {
        expect(mod.streetAddress({ address: '1 Main St' })).toBe('1 Main St');
        expect(mod.streetAddress({ full_address: '2 Oak Ln, Teaneck, NJ 07666' })).toBe('2 Oak Ln');
    });

    test('returns an empty string when the result carries no address at all', () => {
        expect(mod.streetAddress({})).toBe('');
    });
});
