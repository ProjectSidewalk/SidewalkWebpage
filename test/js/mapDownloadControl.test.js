/**
 * Tests for the MapDownloadControl class (public/js/ps-map/MapDownloadControl.js, issue #4095).
 *
 * Like ShareWidget, MapDownloadControl is a top-level `class` declaration written for the Grunt-concatenation
 * world, so the source is eval'd into the jsdom global scope with an explicit window epilogue.
 *
 * Coverage: the buildDownloadUrl state→query-parameter mapping (all-selected omission, severity `none` token,
 * validation token mapping, per-type tag pairs, regionId), and the menu behavior — ARIA contract, count line and
 * zero-count disabling, keyboard navigation, outside-click close, download anchor URLs, and activity logging.
 */

const fs = require('fs');
const path = require('path');

const CONTROL_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/ps-map/MapDownloadControl.js'), 'utf8'
);

/** Loads a fresh MapDownloadControl class into the jsdom global scope. */
function loadControl() {
    window.eval(`${CONTROL_SRC}\nwindow.MapDownloadControl = MapDownloadControl;`);
    return window.MapDownloadControl;
}

/** The nine label types the public LabelMap renders. */
const ALL_TYPES = [
    'CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'NoSidewalk', 'Crosswalk', 'Signal', 'Occlusion', 'Other',
];

const ALL_VALIDATIONS = ['correct', 'incorrect', 'unsure', 'unvalidated'];

/**
 * Builds a FilterSidebar.getState()-shaped object. Defaults model "everything selected, no tags".
 * @param {object} [overrides]
 * @returns {{severities: number[], sections: object, tags: object}}
 */
function makeState({ severities = [0, 1, 2, 3], labelTypes = ALL_TYPES, validations = ALL_VALIDATIONS,
    tags = {} } = {}) {
    const tagState = {};
    for (const labelType of ALL_TYPES) tagState[labelType] = tags[labelType] ?? [];
    return {
        severities,
        sections: { 'label-type': labelTypes, 'label-validations': validations, streets: ['audited-street'] },
        tags: tagState,
    };
}

/** Parses the query string of a built URL. */
const queryOf = (url) => new URLSearchParams(url.split('?')[1]);

/** Flushes pending promise microtasks / zero-delay timeouts (the outside-click listener defers registration). */
const flushTimeouts = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('MapDownloadControl.buildDownloadUrl', () => {
    let MapDownloadControl;

    beforeEach(() => {
        MapDownloadControl = loadControl();
    });

    test('always sets filetype and highQualityUserOnly, omitting all-selected sections', () => {
        const url = MapDownloadControl.buildDownloadUrl(makeState(), { format: 'geojson' });
        const params = queryOf(url);
        expect(url.startsWith('/v3/api/rawLabels?')).toBe(true);
        expect(params.get('filetype')).toBe('geojson');
        expect(params.get('highQualityUserOnly')).toBe('true');
        expect(params.has('labelType')).toBe(false);
        expect(params.has('severity')).toBe(false);
        expect(params.has('validationStatus')).toBe(false);
        expect(params.has('tags')).toBe(false);
        expect(params.has('regionId')).toBe(false);
    });

    test('serializes a label type subset', () => {
        const url = MapDownloadControl.buildDownloadUrl(
            makeState({ labelTypes: ['CurbRamp', 'Obstacle'] }), { format: 'csv' });
        expect(queryOf(url).get('labelType')).toBe('CurbRamp,Obstacle');
        expect(queryOf(url).get('filetype')).toBe('csv');
    });

    test('serializes severities sorted, with 0 as the none token', () => {
        const url = MapDownloadControl.buildDownloadUrl(makeState({ severities: [3, 0] }), { format: 'geojson' });
        expect(queryOf(url).get('severity')).toBe('none,3');
    });

    test('maps validation checkbox ids to API tokens, including the default state (incorrect unchecked)', () => {
        const url = MapDownloadControl.buildDownloadUrl(
            makeState({ validations: ['correct', 'unsure', 'unvalidated'] }), { format: 'geojson' });
        expect(queryOf(url).get('validationStatus')).toBe('validated_correct,unsure,unvalidated');
    });

    test('maps the incorrect checkbox to validated_incorrect', () => {
        const url = MapDownloadControl.buildDownloadUrl(makeState({ validations: ['incorrect'] }), { format: 'geojson' });
        expect(queryOf(url).get('validationStatus')).toBe('validated_incorrect');
    });

    test('serializes tags as LabelType:tag pairs, preserving spaces and colons in tag names', () => {
        const url = MapDownloadControl.buildDownloadUrl(
            makeState({ tags: { CurbRamp: ['narrow'], Crosswalk: ['parallel lines:yes'] } }), { format: 'geojson' });
        expect(queryOf(url).get('tags')).toBe('CurbRamp:narrow,Crosswalk:parallel lines:yes');
    });

    test('includes regionId only when provided', () => {
        const withRegion = MapDownloadControl.buildDownloadUrl(makeState(), { format: 'geojson', regionId: 42 });
        expect(queryOf(withRegion).get('regionId')).toBe('42');
        const withoutRegion = MapDownloadControl.buildDownloadUrl(makeState(), { format: 'geojson', regionId: null });
        expect(queryOf(withoutRegion).has('regionId')).toBe(false);
    });

    test('omits empty selections (the UI disables downloads in that state)', () => {
        const url = MapDownloadControl.buildDownloadUrl(
            makeState({ severities: [], labelTypes: [], validations: [] }), { format: 'geojson' });
        const params = queryOf(url);
        expect(params.has('severity')).toBe(false);
        expect(params.has('labelType')).toBe(false);
        expect(params.has('validationStatus')).toBe(false);
    });
});

describe('MapDownloadControl menu', () => {
    let MapDownloadControl;
    let control;
    let container;
    let anchorClicks;

    /** Builds the control with stubbed accessors and mounts it, mirroring map.addControl(). */
    function mount({ count = 1234, regionId = null, showsPartialFilterCaveat = false } = {}) {
        control = new MapDownloadControl({
            getFilterState: () => makeState({ labelTypes: ['CurbRamp'] }),
            getVisibleLabelCount: () => count,
            regionId,
            showsPartialFilterCaveat,
        });
        container = control.onAdd();
        document.body.appendChild(container);
        return container;
    }

    const button = () => container.querySelector('.map-download-control__button');
    const menu = () => container.querySelector('.map-download-control__menu');
    const items = () => [...container.querySelectorAll('.map-download-control__item')];

    beforeEach(() => {
        document.body.innerHTML = '';
        MapDownloadControl = loadControl();
        window.logWebpageActivity = jest.fn();
        // Locale-independent count line: render the key with the interpolated count.
        window.i18next = { t: (key, opts) => `${key}[${opts?.count}]` };
        anchorClicks = [];
        jest.spyOn(window.HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            anchorClicks.push(this.getAttribute('href'));
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete window.logWebpageActivity;
        delete window.i18next;
    });

    test('renders a collapsed menu button with the ARIA menu contract', () => {
        mount();
        expect(button().getAttribute('aria-haspopup')).toBe('menu');
        expect(button().getAttribute('aria-expanded')).toBe('false');
        expect(button().getAttribute('aria-controls')).toBe('map-download-menu');
        expect(menu().hidden).toBe(true);
        // The visible title is the menu's accessible name.
        expect(menu().getAttribute('aria-labelledby')).toBe('map-download-title');
        expect(menu().querySelector('.map-download-control__title').id).toBe('map-download-title');
        expect(items().map((item) => item.dataset.format)).toEqual(['geojson', 'csv', 'shapefile', 'geopackage']);
    });

    test('opens on click: expands, renders the count pill + suffix, focuses the first item, and logs', () => {
        mount({ count: 7 });
        button().click();
        expect(button().getAttribute('aria-expanded')).toBe('true');
        expect(menu().hidden).toBe(false);
        expect(menu().querySelector('.map-download-control__count-pill').textContent)
            .toBe('labelmap:download.count[7]');
        expect(menu().querySelector('.map-download-control__count').textContent)
            .toBe('labelmap:download.count[7]labelmap:download.count-match[7]');
        expect(document.activeElement).toBe(items()[0]);
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=MapDownload_Open');
    });

    test('disables the format items (but not the docs link) when nothing is shown', () => {
        mount({ count: 0 });
        button().click();
        expect(items().every((item) => item.disabled)).toBe(true);
        expect(container.querySelector('.map-download-control__docs-link').hasAttribute('disabled')).toBe(false);
    });

    test('clicking a format downloads the built URL, logs, and closes the menu', () => {
        mount({ regionId: 42 });
        button().click();
        items().find((item) => item.dataset.format === 'csv').click();

        expect(anchorClicks).toHaveLength(1);
        const params = queryOf(anchorClicks[0]);
        expect(anchorClicks[0].startsWith('/v3/api/rawLabels?')).toBe(true);
        expect(params.get('filetype')).toBe('csv');
        expect(params.get('labelType')).toBe('CurbRamp');
        expect(params.get('regionId')).toBe('42');
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=MapDownload_Download_format=csv');
        expect(menu().hidden).toBe(true);
        expect(document.activeElement).toBe(button());
    });

    test('Escape closes the menu and returns focus to the button', () => {
        mount();
        button().click();
        items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(menu().hidden).toBe(true);
        expect(button().getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(button());
    });

    test('arrow keys cycle through the menu items and wrap', () => {
        mount();
        button().click();
        const first = items()[0];
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(items()[1]);
        items()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        expect(document.activeElement).toBe(first);
        first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        expect(document.activeElement).toBe(container.querySelector('.map-download-control__docs-link'));
    });

    test('a click outside the control closes the menu without stealing focus back', async () => {
        mount();
        button().click();
        await flushTimeouts(); // The outside-click listener registers on a zero-delay timeout.
        document.body.click();
        expect(menu().hidden).toBe(true);
        expect(document.activeElement).not.toBe(button());
    });

    test('shows the partial-filter caveat only when the page carries inexpressible deep-link filters', () => {
        mount({ showsPartialFilterCaveat: true });
        expect(container.querySelector('.map-download-control__caveat').hidden).toBe(false);

        document.body.innerHTML = '';
        mount({ showsPartialFilterCaveat: false });
        expect(container.querySelector('.map-download-control__caveat').hidden).toBe(true);
    });
});
