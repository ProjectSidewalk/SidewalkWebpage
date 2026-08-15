/**
 * Tests for the MapDownloadControl class (public/js/ps-map/MapDownloadControl.js, issue #4095).
 *
 * Like ShareWidget, MapDownloadControl is a top-level `class` declaration written for the Grunt-concatenation
 * world, so the source is eval'd into the jsdom global scope with an explicit window epilogue.
 *
 * Coverage: the buildDownloadUrl state→query-parameter mapping (all-selected omission, severity `none` token,
 * validation token mapping, one repeated `tags` parameter per tag, regionId), and the panel behavior — the
 * disclosure ARIA contract, count line and zero-count disabling, keyboard navigation, outside-click close,
 * download anchor URLs, the post-click busy state, and activity logging.
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

/** The four severity toggles the sidebar renders: N/A, then 1-3. */
const ALL_SEVERITIES = [0, 1, 2, 3];

/**
 * Builds a FilterSidebar.getState()-shaped object. Defaults model "everything selected, no tags".
 * @param {object} [overrides]
 * @returns {{severities: number[], allSeverities: number[], sections: object, tags: object,
 *      allLabelTypes: string[]}}
 */
function makeState({ severities = ALL_SEVERITIES, labelTypes = ALL_TYPES, validations = ALL_VALIDATIONS,
    tags = {} } = {}) {
    const tagState = {};
    for (const labelType of ALL_TYPES) tagState[labelType] = tags[labelType] ?? [];
    return {
        severities,
        allSeverities: ALL_SEVERITIES,
        sections: { 'label-type': labelTypes, 'label-validations': validations, streets: ['audited-street'] },
        tags: tagState,
        allLabelTypes: ALL_TYPES,
    };
}

/** Parses the query string of a built URL. */
const queryOf = (url) => new URLSearchParams(url.split('?')[1]);

/** Flushes pending promise microtasks / zero-delay timeouts (several listeners defer registration). */
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

    test('measures "all selected" against the rendered options, not a fixed count', () => {
        // A host that renders only severities 1-3 has "all selected" at three, not four.
        const state = { ...makeState({ severities: [1, 2, 3] }), allSeverities: [1, 2, 3] };
        expect(queryOf(MapDownloadControl.buildDownloadUrl(state, { format: 'geojson' })).has('severity')).toBe(false);
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

    test('sends one repeated tags parameter per tag, scoped to its label type', () => {
        const url = MapDownloadControl.buildDownloadUrl(
            makeState({ tags: { CurbRamp: ['narrow', 'steep'], Crosswalk: ['parallel lines:yes'] } }),
            { format: 'geojson' });
        expect(queryOf(url).getAll('tags'))
            .toEqual(['CurbRamp:narrow', 'CurbRamp:steep', 'Crosswalk:parallel lines:yes']);
    });

    test('keeps a tag name containing a comma in one piece', () => {
        // A comma-separated list would shred this real Signal tag into two tags that match nothing.
        const tag = 'yellow box, accessibility features not visible';
        const url = MapDownloadControl.buildDownloadUrl(makeState({ tags: { Signal: [tag] } }), { format: 'geojson' });
        expect(queryOf(url).getAll('tags')).toEqual([`Signal:${tag}`]);
    });

    test('tagging one type does not narrow the download to that type', () => {
        // The sidebar leaves the untagged types showing in full, so the download must not add a labelType filter;
        // the endpoint reads a scoped tag as narrowing only its own type.
        const url = MapDownloadControl.buildDownloadUrl(
            makeState({ tags: { CurbRamp: ['narrow'] } }), { format: 'geojson' });
        expect(queryOf(url).has('labelType')).toBe(false);
        expect(queryOf(url).getAll('tags')).toEqual(['CurbRamp:narrow']);
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

describe('MapDownloadControl panel', () => {
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
    const panel = () => container.querySelector('.map-download-control__panel');
    const items = () => [...container.querySelectorAll('.map-download-control__item')];
    const busyLabel = () => container.querySelector('.map-download-control__label--busy');

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

    test('renders a collapsed disclosure wired to its own panel', () => {
        mount();
        expect(button().getAttribute('aria-expanded')).toBe('false');
        expect(panel().hidden).toBe(true);
        // A disclosure, not an ARIA menu: the panel holds static text alongside the actions.
        expect(button().hasAttribute('aria-haspopup')).toBe(false);
        expect(container.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
        expect(panel().getAttribute('role')).toBe('group');
        // The visible title is the panel's accessible name, and the count line describes it.
        expect(button().getAttribute('aria-controls')).toBe(panel().id);
        expect(panel().getAttribute('aria-labelledby'))
            .toBe(panel().querySelector('.map-download-control__title').id);
        expect(panel().getAttribute('aria-describedby'))
            .toBe(panel().querySelector('.map-download-control__count').id);
        expect(items().map((item) => item.dataset.format)).toEqual(['geojson', 'csv', 'shapefile', 'geopackage']);
    });

    test('gives each instance its own element ids', () => {
        const first = mount();
        const firstPanelId = first.querySelector('.map-download-control__panel').id;
        const second = mount();
        expect(second.querySelector('.map-download-control__panel').id).not.toBe(firstPanelId);
    });

    test('opens on click: expands, renders the count pill + suffix, focuses the first item, and logs', () => {
        mount({ count: 7 });
        button().click();
        expect(button().getAttribute('aria-expanded')).toBe('true');
        expect(panel().hidden).toBe(false);
        expect(panel().querySelector('.map-download-control__count-pill').textContent)
            .toBe('labelmap:download.count[7]');
        expect(panel().querySelector('.map-download-control__count').textContent)
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

    test('clicking a format downloads the built URL, logs, and closes the panel', () => {
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
        expect(panel().hidden).toBe(true);
        expect(document.activeElement).toBe(button());
    });

    test('acknowledges the click with a busy pill and a live-region status, then restores itself', () => {
        jest.useFakeTimers();
        try {
            mount();
            button().click();
            items()[0].click();

            expect(button().getAttribute('aria-busy')).toBe('true');
            expect(busyLabel().hidden).toBe(false);
            expect(container.querySelector('[role="status"]').textContent).toBe('Preparing your download…');

            jest.advanceTimersByTime(4000);
            expect(button().getAttribute('aria-busy')).toBe('false');
            expect(busyLabel().hidden).toBe(true);
            expect(container.querySelector('[role="status"]').textContent).toBe('');
        } finally {
            jest.useRealTimers();
        }
    });

    test('Escape closes the panel and returns focus to the button', () => {
        mount();
        button().click();
        items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(panel().hidden).toBe(true);
        expect(button().getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(button());
    });

    test('arrow keys cycle through the panel items and wrap', () => {
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

    test('Tab closes the panel only after the browser has moved focus on', async () => {
        mount();
        button().click();
        items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        // Still open during the keydown, so focus does not have to escape a display:none subtree.
        expect(panel().hidden).toBe(false);
        await flushTimeouts();
        expect(panel().hidden).toBe(true);
    });

    test('a click outside the control closes the panel without stealing focus back', async () => {
        mount();
        button().click();
        await flushTimeouts(); // The outside-click listener registers on a zero-delay timeout.
        document.body.click();
        expect(panel().hidden).toBe(true);
        expect(document.activeElement).not.toBe(button());
    });

    test('does not leave an outside-click listener behind when closed before the timeout fires', async () => {
        mount();
        button().click();
        button().click(); // Close again within the same tick, before the deferred registration runs.
        const addedAfterClose = jest.spyOn(document, 'addEventListener');
        await flushTimeouts();
        expect(addedAfterClose).not.toHaveBeenCalled();
    });

    test('shows the partial-filter caveat, and describes the panel with it, only when it applies', () => {
        mount({ showsPartialFilterCaveat: true });
        const caveat = container.querySelector('.map-download-control__caveat');
        expect(caveat.hidden).toBe(false);
        expect(panel().getAttribute('aria-describedby').split(' ')).toContain(caveat.id);

        document.body.innerHTML = '';
        mount({ showsPartialFilterCaveat: false });
        expect(container.querySelector('.map-download-control__caveat').hidden).toBe(true);
        expect(panel().getAttribute('aria-describedby').split(' '))
            .not.toContain(container.querySelector('.map-download-control__caveat').id);
    });

    test('warns screen reader users that the docs link opens in a new tab', () => {
        mount();
        const link = container.querySelector('.map-download-control__docs-link');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.textContent).toContain('opens in a new tab');
    });
});
