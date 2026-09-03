/**
 * Tests for MapSidebarFilter's faceted count math (public/js/ps-map/MapSidebarFilter.js, issue #4585).
 *
 * The counts beside each row answer "how many labels would this option contribute if it were enabled": every *other*
 * active filter applies, but the option's own on/off state doesn't, so unchecking a row never zeroes its own count.
 * That rule is easy to break silently — the numbers still render, they're just wrong — so it's pinned here.
 *
 * MapSidebarFilter is a Grunt-concatenated `class` that reaches for page globals (the Mapbox helpers, i18next), so
 * the source is eval'd into jsdom with those stubbed.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js');
const FILTER_SIDEBAR_SRC = fs.readFileSync(path.join(SRC_DIR, 'common/filter-sidebar/FilterSidebar.js'), 'utf8');
const MAP_SIDEBAR_SRC = fs.readFileSync(path.join(SRC_DIR, 'ps-map/MapSidebarFilter.js'), 'utf8');

const LABEL_TYPES = ['CurbRamp', 'Obstacle'];
const VALIDATIONS = ['correct', 'incorrect', 'unsure', 'unvalidated'];

/** Builds the sidebar markup MapSidebarFilter binds to, including the chrome its constructor looks up by id. */
function buildFixture() {
    const typeRows = LABEL_TYPES.map((type) => `
        <li class="filter-sidebar__item filter-sidebar__item--expandable">
          <div class="filter-sidebar__item-row">
            <input type="checkbox" id="${type}-checkbox" class="filter-sidebar__checkbox" checked
                   data-filter-type="label-type">
            <label class="filter-sidebar__item-label" for="${type}-checkbox">
              <span class="filter-sidebar__item-name">${type}</span>
            </label>
            <span class="filter-sidebar__count" data-count-for="${type}"></span>
            <button type="button" class="filter-sidebar__only" data-section="label-type" data-value="${type}">Only</button>
          </div>
        </li>`).join('');

    const validationRows = VALIDATIONS.map((option) => `
        <li class="filter-sidebar__item">
          <input type="checkbox" id="${option}" class="filter-sidebar__checkbox"
                 ${option === 'incorrect' ? '' : 'checked'} data-filter-type="label-validations">
          <label class="filter-sidebar__item-label" for="${option}">
            <span class="filter-sidebar__item-name">${option}</span>
          </label>
          <span class="filter-sidebar__count" data-count-for="${option}"></span>
        </li>`).join('');

    const streetRows = ['audited-street', 'unaudited-street'].map((id) => `
        <li class="filter-sidebar__item">
          <input type="checkbox" id="${id}" class="filter-sidebar__checkbox" data-filter-type="streets">
          <label class="filter-sidebar__item-label" for="${id}">
            <span class="filter-sidebar__item-name">${id}</span>
          </label>
          <span class="filter-sidebar__count" data-count-for="${id}"></span>
        </li>`).join('');

    document.body.innerHTML = `
      <div id="filter-sidebar">
        <button type="button" id="filter-sidebar-close">close</button>
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

/**
 * One GeoJSON-ish feature.
 * @param {object} props Overrides for the label's properties.
 * @returns {object} A feature shaped like the ones the map loads.
 */
function label(props) {
    return {
        properties: {
            severity: 1, high_quality_user: true, correct: null, has_validations: false, tags: [], ...props,
        },
    };
}

/** Builds the mapData tracker with the given labels per type, mirroring CreateMapLayerTracker's shape. */
function buildMapData(labelsByType) {
    const mapData = {
        correct: true,
        incorrect: false,
        unsure: true,
        unvalidated: true,
        lowQualityUsers: false,
        notAdminValidated: false,
        spotlightLabelId: null,
        severities: { 0: true, 1: true, 2: true, 3: true },
        selectedTags: {},
        sortedLabels: {},
        layerNames: {},
    };
    for (const type of LABEL_TYPES) {
        mapData.sortedLabels[type] = labelsByType[type] ?? [];
        mapData.layerNames[type] = `${type}-layer`;
        mapData.selectedTags[type] = new Set();
    }
    return mapData;
}

describe('MapSidebarFilter counts', () => {
    let mapData;

    /** @returns {string} The rendered count for a row. */
    const countFor = (value) => document.querySelector(`[data-count-for="${value}"]`).textContent;

    /** Builds the sidebar over the fixture with a stub map. */
    function build(labelsByType, streetCounts = null) {
        buildFixture();
        mapData = buildMapData(labelsByType);
        mapData.streetCounts = streetCounts;
        const map = { getLayer: () => true, easeTo: () => {}, setPadding: () => {} };
        return new window.MapSidebarFilter(map, mapData);
    }

    beforeAll(() => {
        window.i18next = { t: (key) => key, language: 'en' };
        window.filterLabelLayers = () => {};
        window.filterStreetLayer = () => {};
        window.toggleLabelLayer = () => {};
        window.eval(`${FILTER_SIDEBAR_SRC}\nwindow.FilterSidebar = FilterSidebar;`);
        window.eval(`${MAP_SIDEBAR_SRC}\nwindow.MapSidebarFilter = MapSidebarFilter;`);
    });

    it('renders counts as soon as it is constructed, before any interaction', () => {
        build({
            CurbRamp: [label({ correct: true }), label({ correct: true }), label({})],
            Obstacle: [label({ correct: false })],
        });

        // Obstacle's one label is "validated incorrect", which is off by default, so it contributes to no type count.
        expect(countFor('CurbRamp')).toBe('3');
        expect(countFor('Obstacle')).toBe('0');
        expect(countFor('correct')).toBe('2');
        expect(countFor('incorrect')).toBe('1');
        expect(countFor('unvalidated')).toBe('1');
        expect(countFor('unsure')).toBe('0');
    });

    it('counts a validation option even while that option is switched off', () => {
        build({ CurbRamp: [label({ correct: false }), label({ correct: false })] });

        // "Validated incorrect" starts unchecked; its count still reports what enabling it would show.
        expect(countFor('incorrect')).toBe('2');
        expect(countFor('CurbRamp')).toBe('0');
    });

    it('drops validation counts to zero when every label type is hidden', () => {
        build({ CurbRamp: [label({ correct: true })] });
        expect(countFor('correct')).toBe('1');

        document.querySelector('.filter-sidebar__deselect-all[data-section="label-type"]').click();

        // Nothing would be shown whichever validation you enable, so 0 is the honest answer here.
        expect(countFor('correct')).toBe('0');
    });

    it('leaves filter state alone for a section the page does not render', () => {
        build({ CurbRamp: [label({ severity: 1, correct: true }), label({ severity: 3, correct: true })] });
        expect(countFor('CurbRamp')).toBe('2');

        // This fixture renders no severity section. Mirroring an absent section as "nothing selected" would wipe the
        // map's severity state on the next interaction and filter everything away.
        mapData.severities[3] = false;
        document.querySelector('#Obstacle-checkbox').click(); // Any interaction re-runs the sync + count pass.

        expect(mapData.severities).toEqual({ 0: true, 1: true, 2: true, 3: false });
        expect(countFor('CurbRamp')).toBe('1');
    });

    it('reports the street counts the map loaded, which no label filter narrows', () => {
        build({ CurbRamp: [label({ correct: true })] }, { audited: 1204, unaudited: 87 });

        expect(countFor('audited-street')).toBe('1,204');
        expect(countFor('unaudited-street')).toBe('87');

        // Hiding every label type empties the map of labels; the streets on it are untouched.
        document.querySelector('.filter-sidebar__deselect-all[data-section="label-type"]').click();

        expect(countFor('audited-street')).toBe('1,204');
    });

    it('leaves the street slots blank on a map that loaded no streets', () => {
        build({ CurbRamp: [label({ correct: true })] });

        expect(countFor('audited-street')).toBe('');
    });

    it('excludes low-quality users\' labels from the counts, matching the layer filter', () => {
        build({
            CurbRamp: [label({ correct: true }), label({ correct: true, high_quality_user: false })],
        });

        expect(countFor('CurbRamp')).toBe('1');
    });

    describe('getVisibleLabelCount', () => {
        it('sums only checked label types, applying every active filter', () => {
            const sidebar = build({
                // Two visible CurbRamps plus one hidden by each filter axis: the default-off "incorrect" validation,
                // a low-quality user, and an unchecked label type.
                CurbRamp: [label({ correct: true }), label({}), label({ correct: false }),
                    label({ high_quality_user: false })],
                Obstacle: [label({ correct: true })],
            });
            expect(sidebar.getVisibleLabelCount()).toBe(3);

            document.querySelector('#Obstacle-checkbox').click();
            expect(sidebar.getVisibleLabelCount()).toBe(2);
        });

        it('respects the active tag filters', () => {
            const sidebar = build({
                CurbRamp: [label({ tags: ['narrow'] }), label({ tags: ['steep'] })],
            });
            expect(sidebar.getVisibleLabelCount()).toBe(2);

            mapData.selectedTags.CurbRamp.add('narrow');
            expect(sidebar.getVisibleLabelCount()).toBe(1);
        });

        it('returns 0 when every label type is deselected', () => {
            const sidebar = build({ CurbRamp: [label({ correct: true })] });
            document.querySelector('.filter-sidebar__deselect-all[data-section="label-type"]').click();
            expect(sidebar.getVisibleLabelCount()).toBe(0);
        });
    });

    // The per-label predicate behind the popup's prev/next arrows (#5124): the same filters the count applies,
    // minus the viewport, which is not a filter.
    describe('matchesFilters', () => {
        it('applies the type checkbox and every per-label filter axis', () => {
            const sidebar = build({ CurbRamp: [], Obstacle: [] });
            const visible = label({ correct: true });
            expect(sidebar.matchesFilters('CurbRamp', visible)).toBe(true);
            expect(sidebar.matchesFilters('CurbRamp', label({ correct: false }))).toBe(false); // Off by default.
            expect(sidebar.matchesFilters('CurbRamp', label({ high_quality_user: false }))).toBe(false);

            mapData.severities[1] = false;
            expect(sidebar.matchesFilters('CurbRamp', visible)).toBe(false);
            mapData.severities[1] = true;

            mapData.selectedTags.CurbRamp.add('narrow');
            expect(sidebar.matchesFilters('CurbRamp', visible)).toBe(false);
            expect(sidebar.matchesFilters('CurbRamp', label({ correct: true, tags: ['narrow'] }))).toBe(true);
            mapData.selectedTags.CurbRamp.clear();

            document.querySelector('#Obstacle-checkbox').click();
            expect(sidebar.matchesFilters('Obstacle', visible)).toBe(false);
            expect(sidebar.matchesFilters('CurbRamp', visible)).toBe(true);
        });

        it('splits unvalidated labels from unsure ones on has_validations, like the layer filter', () => {
            const sidebar = build({ CurbRamp: [] });
            const unsure = label({ correct: null, has_validations: true });
            const unvalidated = label({ correct: null, has_validations: false });
            expect(sidebar.matchesFilters('CurbRamp', unsure)).toBe(true);
            expect(sidebar.matchesFilters('CurbRamp', unvalidated)).toBe(true);

            document.querySelector('#unsure').click();
            expect(sidebar.matchesFilters('CurbRamp', unsure)).toBe(false);
            expect(sidebar.matchesFilters('CurbRamp', unvalidated)).toBe(true);
        });

        it('applies the admin-only "not admin validated" filter when a host turns it on', () => {
            const sidebar = build({ CurbRamp: [] });
            mapData.notAdminValidated = true;
            expect(sidebar.matchesFilters('CurbRamp', label({ has_admin_validation: false }))).toBe(true);
            expect(sidebar.matchesFilters('CurbRamp', label({ has_admin_validation: true }))).toBe(false);
        });

        it('treats a label type the sidebar does not render as unchecked', () => {
            const sidebar = build({ CurbRamp: [] });
            expect(sidebar.matchesFilters('Signal', label({ correct: true }))).toBe(false);
        });

        it('ignores the viewport: a label just off screen is still a match', () => {
            buildFixture();
            mapData = buildMapData({ CurbRamp: [] });
            const map = {
                getLayer: () => true,
                easeTo: () => {},
                setPadding: () => {},
                getBounds: () => ({ contains: () => false }),
            };
            const sidebar = new window.MapSidebarFilter(map, mapData, { viewportCounts: true });
            const offScreen = { ...label({ correct: true }), geometry: { coordinates: [5, 5] } };
            expect(sidebar.matchesFilters('CurbRamp', offScreen)).toBe(true);
        });
    });

    // Viewport-scoped label loading (#5002): counts restrict to the current view, and refresh() recomputes
    // after a data swap or pan with no filter interaction.
    describe('viewportCounts', () => {
        /** A feature with coordinates, since viewport counting reads geometry. */
        const placedLabel = (lng, lat, props = {}) => ({ ...label(props), geometry: { coordinates: [lng, lat] } });

        /** Builds the sidebar with viewportCounts on and a map whose bounds contain |lng|,|lat| <= 1. */
        function buildViewportScoped(labelsByType) {
            buildFixture();
            mapData = buildMapData(labelsByType);
            const map = {
                getLayer: () => true,
                easeTo: () => {},
                setPadding: () => {},
                getBounds: () => ({
                    contains: ([lng, lat]) => Math.abs(lng) <= 1 && Math.abs(lat) <= 1,
                }),
            };
            return new window.MapSidebarFilter(map, mapData, { viewportCounts: true });
        }

        it('counts only labels inside the current view', () => {
            const sidebar = buildViewportScoped({
                CurbRamp: [placedLabel(0, 0, { correct: true }), placedLabel(5, 5, { correct: true })],
            });
            expect(countFor('CurbRamp')).toBe('1');
            expect(countFor('correct')).toBe('1');
            expect(sidebar.getVisibleLabelCount()).toBe(1);
        });

        it('refresh() recomputes after the loaded labels are swapped in place', () => {
            const sidebar = buildViewportScoped({ CurbRamp: [placedLabel(0, 0, { correct: true })] });
            expect(countFor('CurbRamp')).toBe('1');

            // Simulate setLabelData: same arrays, new contents.
            mapData.sortedLabels.CurbRamp.length = 0;
            mapData.sortedLabels.CurbRamp.push(
                placedLabel(0.1, 0.1, { correct: true }),
                placedLabel(0.2, 0.2, { correct: true }),
                placedLabel(9, 9, { correct: true }),
            );
            sidebar.refresh();

            expect(countFor('CurbRamp')).toBe('2');
        });
    });
});
