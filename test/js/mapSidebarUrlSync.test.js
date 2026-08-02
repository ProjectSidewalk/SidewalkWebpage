/**
 * Tests for MapSidebarUrlSync (public/js/ps-map/MapSidebarUrlSync.js, issue #4696): the two-way sync between
 * the LabelMap's filter sidebar + viewport and the page URL.
 *
 * Pins the URL contract both ways — reading (params validated against the rendered controls, applied through
 * MapSidebarFilter) and writing (debounced replaceState, defaults omitted, foreign params preserved) — plus the
 * regression the issue calls out explicitly: the two URL writers on the page (this sync and
 * LabelDetail.syncUrlLabelId) must compose rather than clobber each other.
 *
 * The classes are Grunt-concatenated top-level `class` declarations reaching for page globals, so the sources are
 * eval'd into jsdom with those stubbed. jsdom's real History API backs the URL assertions (galleryFilter.test.js
 * precedent).
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js');
const FILTER_SIDEBAR_SRC = fs.readFileSync(path.join(SRC_DIR, 'common/filter-sidebar/FilterSidebar.js'), 'utf8');
const MAP_SIDEBAR_SRC = fs.readFileSync(path.join(SRC_DIR, 'ps-map/MapSidebarFilter.js'), 'utf8');
const URL_SYNC_SRC = fs.readFileSync(path.join(SRC_DIR, 'ps-map/MapSidebarUrlSync.js'), 'utf8');
const LABEL_DETAIL_SRC = fs.readFileSync(path.join(SRC_DIR, 'common/label-detail/LabelDetail.js'), 'utf8');

const LABEL_TYPES = ['CurbRamp', 'Obstacle'];
// "shared" appears on both types, mirroring real tags that repeat across types ("narrow" is both a curb ramp's
// and a sidewalk's).
const TAGS_BY_TYPE = { CurbRamp: ['narrow', 'shared'], Obstacle: ['shared'] };

/** Builds the sidebar markup the classes bind to, mirroring the Twirl partial's hooks and default state. */
function buildFixture() {
    const severityCells = [0, 1, 2, 3].map((severity) => `
        <div class="filter-sidebar__severity-cell">
          <button type="button" class="severity-button" data-severity="${severity}" aria-pressed="true">
            <span class="severity-button__label">sev ${severity}</span>
          </button>
        </div>`).join('');

    const typeRows = LABEL_TYPES.map((type) => `
        <li class="filter-sidebar__item filter-sidebar__item--expandable">
          <div class="filter-sidebar__item-row">
            <input type="checkbox" id="${type}-checkbox" class="filter-sidebar__checkbox" checked
                   data-filter-type="label-type" disabled>
            <label class="filter-sidebar__item-label" for="${type}-checkbox">
              <span class="filter-sidebar__item-name">${type}</span>
            </label>
            <button type="button" class="filter-sidebar__tag-toggle" aria-expanded="false">
              <img src="down.svg" data-down-src="down.svg" data-up-src="up.svg" alt="">
            </button>
          </div>
          <div class="filter-sidebar__tag-pills" hidden>
            ${TAGS_BY_TYPE[type].map((tag) => `
              <button type="button" class="tag-pill" data-tag="${tag}" data-label-type="${type}">
                <span class="tag-pill__label">${tag}</span>
              </button>`).join('')}
          </div>
        </li>`).join('');

    const validationRows = ['correct', 'incorrect', 'unsure', 'unvalidated'].map((option) => `
        <li class="filter-sidebar__item">
          <input type="checkbox" id="${option}" class="filter-sidebar__checkbox"
                 ${option === 'incorrect' ? '' : 'checked'} data-filter-type="label-validations" disabled>
          <label class="filter-sidebar__item-label" for="${option}">
            <span class="filter-sidebar__item-name">${option}</span>
          </label>
        </li>`).join('');

    const streetRows = ['audited-street', 'unaudited-street'].map((id) => `
        <li class="filter-sidebar__item">
          <input type="checkbox" id="${id}" class="filter-sidebar__checkbox" data-filter-type="streets" disabled>
          <label class="filter-sidebar__item-label" for="${id}">
            <span class="filter-sidebar__item-name">${id}</span>
          </label>
        </li>`).join('');

    document.body.innerHTML = `
      <div id="filter-sidebar">
        <button type="button" id="filter-sidebar-close">close</button>
        <section class="filter-sidebar__section">
          <button type="button" class="filter-sidebar__deselect-all" data-section="severity">Deselect all</button>
          <div class="filter-sidebar__severity-toggles">${severityCells}</div>
        </section>
        <section class="filter-sidebar__section">
          <button type="button" class="filter-sidebar__deselect-all" data-section="label-type">Deselect all</button>
          <ul class="filter-sidebar__list">${typeRows}</ul>
        </section>
        <section class="filter-sidebar__section">
          <button type="button" class="filter-sidebar__deselect-all" data-section="label-validations">Deselect all</button>
          <ul class="filter-sidebar__list">${validationRows}</ul>
        </section>
        <section class="filter-sidebar__section">
          <ul class="filter-sidebar__list">${streetRows}</ul>
        </section>
      </div>
      <button type="button" id="filter-sidebar-open">open</button>
      <div id="filter-sidebar-resize-handle"></div>`;
}

/** Builds the mapData tracker at its defaults, mirroring CreateMapLayerTracker's shape. */
function buildMapData() {
    const mapData = {
        correct: true,
        incorrect: false,
        unsure: true,
        unvalidated: true,
        lowQualityUsers: false,
        notAdminValidated: false,
        severities: { 0: true, 1: true, 2: true, 3: true },
        selectedTags: {},
        sortedLabels: {},
        layerNames: {},
    };
    for (const type of LABEL_TYPES) {
        mapData.sortedLabels[type] = [];
        mapData.layerNames[type] = `${type}-layer`;
        mapData.selectedTags[type] = new Set();
    }
    return mapData;
}

describe('MapSidebarUrlSync', () => {
    let mapData;
    let map;
    let mapHandlers;

    const search = () => window.location.search;
    const sevBtn = (severity) => document.querySelector(`.severity-button[data-severity="${severity}"]`);
    const checkbox = (id) => document.getElementById(id);
    const tagPill = (type, tag) => document.querySelector(`.tag-pill[data-label-type="${type}"][data-tag="${tag}"]`);

    /** Builds the sidebar + URL sync over the fixture with a stub map; the URL should be set before calling. */
    function build() {
        buildFixture();
        mapData = buildMapData();
        const sidebarFilter = new window.MapSidebarFilter(map, mapData);
        return new window.MapSidebarUrlSync(sidebarFilter, map);
    }

    beforeAll(() => {
        window.i18next = { t: (key) => key, language: 'en' };
        window.filterLabelLayers = jest.fn();
        window.filterStreetLayer = jest.fn();
        window.toggleLabelLayer = jest.fn();
        window.logWebpageActivity = jest.fn();
        window.eval(`${FILTER_SIDEBAR_SRC}\nwindow.FilterSidebar = FilterSidebar;`);
        window.eval(`${MAP_SIDEBAR_SRC}\nwindow.MapSidebarFilter = MapSidebarFilter;`);
        window.eval(`${URL_SYNC_SRC}\nwindow.MapSidebarUrlSync = MapSidebarUrlSync;`);
        window.eval(`${LABEL_DETAIL_SRC}\nwindow.LabelDetail = LabelDetail;`);
    });

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        window.history.replaceState({}, '', '/labelMap');
        mapHandlers = {};
        map = {
            getLayer: () => true,
            easeTo: () => {},
            setPadding: () => {},
            on: (event, handler) => { mapHandlers[event] = handler; },
            getCenter: () => ({ lat: 47.61234567, lng: -122.33456789 }),
            getZoom: () => 11.256,
            jumpTo: jest.fn(),
        };
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('viewport statics', () => {
        it('reports and applies a complete lat/lng(/zoom) viewport', () => {
            window.history.replaceState({}, '', '/labelMap?lat=47.6&lng=-122.3&zoom=14.5');

            expect(window.MapSidebarUrlSync.hasUrlViewport()).toBe(true);
            expect(window.MapSidebarUrlSync.applyUrlViewport(map)).toBe(true);
            expect(map.jumpTo).toHaveBeenCalledWith({ center: [-122.3, 47.6], zoom: 14.5 });
        });

        it('applies lat/lng without a zoom, leaving the map\'s zoom alone', () => {
            window.history.replaceState({}, '', '/labelMap?lat=47.6&lng=-122.3');

            expect(window.MapSidebarUrlSync.applyUrlViewport(map)).toBe(true);
            expect(map.jumpTo).toHaveBeenCalledWith({ center: [-122.3, 47.6] });
        });

        it('does not move the map on an incomplete or invalid viewport', () => {
            for (const query of ['', '?lat=47.6', '?lng=-122.3', '?lat=abc&lng=-122.3']) {
                window.history.replaceState({}, '', `/labelMap${query}`);
                expect(window.MapSidebarUrlSync.hasUrlViewport()).toBe(false);
                expect(window.MapSidebarUrlSync.applyUrlViewport(map)).toBe(false);
            }
            expect(map.jumpTo).not.toHaveBeenCalled();
        });
    });

    describe('reading filters from the URL', () => {
        it('restores every filter section onto the controls and the map', () => {
            window.history.replaceState({}, '',
                '/labelMap?severities=null,2&labelTypes=CurbRamp&validationOptions=correct&tags=shared&streets=audited');
            build();

            expect(sevBtn(0).getAttribute('aria-pressed')).toBe('true');
            expect(sevBtn(1).getAttribute('aria-pressed')).toBe('false');
            expect(sevBtn(2).getAttribute('aria-pressed')).toBe('true');
            expect(sevBtn(3).getAttribute('aria-pressed')).toBe('false');
            expect(mapData.severities).toEqual({ 0: true, 1: false, 2: true, 3: false });

            expect(checkbox('CurbRamp-checkbox').checked).toBe(true);
            expect(checkbox('Obstacle-checkbox').checked).toBe(false);

            expect(checkbox('correct').checked).toBe(true);
            expect(checkbox('unsure').checked).toBe(false);
            expect(checkbox('unvalidated').checked).toBe(false);
            expect(mapData.correct).toBe(true);
            expect(mapData.unsure).toBe(false);
            expect(mapData.unvalidated).toBe(false);

            expect(checkbox('audited-street').checked).toBe(true);
            expect(checkbox('unaudited-street').checked).toBe(false);
            expect(window.filterStreetLayer).toHaveBeenCalled();

            // The restore ran the full pipeline: layer filters reapplied, the hidden type's layer toggled off.
            expect(window.filterLabelLayers).toHaveBeenCalled();
            expect(window.toggleLabelLayer).toHaveBeenCalledWith('Obstacle', false, map, mapData);
        });

        it('activates a restored tag on checked types only, with its drawer opened', () => {
            window.history.replaceState({}, '', '/labelMap?labelTypes=CurbRamp&tags=shared');
            build();

            expect(tagPill('CurbRamp', 'shared').classList.contains('tag-pill--active')).toBe(true);
            expect(mapData.selectedTags.CurbRamp.has('shared')).toBe(true);
            const drawer = tagPill('CurbRamp', 'shared').closest('.filter-sidebar__tag-pills');
            expect(drawer.hidden).toBe(false);

            // Obstacle also renders "shared", but the URL excluded the type; implying it on would break round-trips.
            expect(tagPill('Obstacle', 'shared').classList.contains('tag-pill--active')).toBe(false);
            expect(checkbox('Obstacle-checkbox').checked).toBe(false);
            expect(mapData.selectedTags.Obstacle.size).toBe(0);
        });

        it('drops unknown tokens and treats a fully-invalid param as absent', () => {
            window.history.replaceState({}, '', '/labelMap?labelTypes=CurbRamp,Bogus&severities=9,foo');
            build();

            // "Bogus" is dropped but "CurbRamp" survives, so the param still narrows the types.
            expect(checkbox('CurbRamp-checkbox').checked).toBe(true);
            expect(checkbox('Obstacle-checkbox').checked).toBe(false);

            // No severity token was valid, so the section stays at its default (everything on).
            for (const severity of [0, 1, 2, 3]) {
                expect(sevBtn(severity).getAttribute('aria-pressed')).toBe('true');
            }
        });
    });

    describe('writing filters to the URL', () => {
        it('writes the changed section after the debounce, always stamping the viewport', () => {
            build();
            sevBtn(0).click();
            expect(search()).toBe(''); // Nothing until the debounce elapses.

            jest.advanceTimersByTime(300);

            expect(search()).toBe('?severities=1,2,3&lat=47.61235&lng=-122.33457&zoom=11.26');
        });

        it('deletes a param when its section returns to the rendered default', () => {
            build();
            sevBtn(0).click();
            jest.advanceTimersByTime(300);
            expect(search()).toContain('severities=1,2,3');

            sevBtn(0).click();
            jest.advanceTimersByTime(300);

            expect(search()).not.toContain('severities');
            expect(search()).toContain('lat=');
        });

        it('serializes each filter section under its own param', () => {
            build();
            checkbox('Obstacle-checkbox').click();
            checkbox('incorrect').click();
            tagPill('CurbRamp', 'narrow').click();
            checkbox('audited-street').click();
            jest.advanceTimersByTime(300);

            const params = new URLSearchParams(search());
            expect(params.get('labelTypes')).toBe('CurbRamp');
            expect(params.get('validationOptions')).toBe('correct,incorrect,unsure,unvalidated');
            expect(params.get('tags')).toBe('narrow');
            expect(params.get('streets')).toBe('audited');
        });

        it('coalesces a burst of clicks into one URL write', () => {
            build();
            const replaceState = jest.spyOn(window.history, 'replaceState');
            sevBtn(0).click();
            sevBtn(1).click();
            checkbox('Obstacle-checkbox').click();
            jest.advanceTimersByTime(300);

            expect(replaceState).toHaveBeenCalledTimes(1);
            expect(search()).toContain('severities=2,3');
            expect(search()).toContain('labelTypes=CurbRamp');
            replaceState.mockRestore();
        });

        it('preserves foreign params, keeping their commas readable', () => {
            window.history.replaceState({}, '', '/labelMap?regions=1,2&labelId=42');
            build();
            sevBtn(0).click();
            jest.advanceTimersByTime(300);

            expect(search()).toContain('regions=1,2');
            expect(search()).toContain('labelId=42');
            expect(search()).toContain('severities=1,2,3');
            expect(search()).not.toContain('%2C');
        });

        it('writes the viewport on a user-initiated move only', () => {
            build();

            mapHandlers.moveend({}); // Programmatic move: no originalEvent.
            jest.advanceTimersByTime(300);
            expect(search()).toBe('');

            mapHandlers.moveend({ originalEvent: {} });
            jest.advanceTimersByTime(300);
            expect(search()).toBe('?lat=47.61235&lng=-122.33457&zoom=11.26');
        });
    });

    describe('composition with LabelDetail.syncUrlLabelId', () => {
        it('the two URL writers compose rather than clobber (#4696)', () => {
            build();
            sevBtn(0).click();
            jest.advanceTimersByTime(300);
            expect(search()).toContain('severities=1,2,3');

            // Opening a label popup writes labelId without touching the filter params — commas stay readable.
            window.LabelDetail.syncUrlLabelId(123);
            expect(search()).toContain('labelId=123');
            expect(search()).toContain('severities=1,2,3');
            expect(search()).not.toContain('%2C');

            // A further filter change keeps the open label's id in the URL.
            checkbox('Obstacle-checkbox').click();
            jest.advanceTimersByTime(300);
            expect(search()).toContain('labelId=123');
            expect(search()).toContain('labelTypes=CurbRamp');

            // Closing the popup removes only labelId.
            window.LabelDetail.syncUrlLabelId(null);
            expect(search()).not.toContain('labelId');
            expect(search()).toContain('severities=1,2,3');
            expect(search()).toContain('labelTypes=CurbRamp');
        });
    });
});
