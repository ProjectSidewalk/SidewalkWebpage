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
        <li class="map-sidebar__item map-sidebar__item--expandable">
          <div class="map-sidebar__item-row">
            <input type="checkbox" id="${type}-checkbox" class="map-sidebar__checkbox" checked
                   data-filter-type="label-type">
            <label class="map-sidebar__item-label" for="${type}-checkbox">
              <span class="map-sidebar__item-name">${type}</span>
            </label>
            <span class="map-sidebar__count" data-count-for="${type}"></span>
            <button type="button" class="map-sidebar__only" data-section="label-type" data-value="${type}">Only</button>
          </div>
        </li>`).join('');

    const validationRows = VALIDATIONS.map((option) => `
        <li class="map-sidebar__item">
          <input type="checkbox" id="${option}" class="map-sidebar__checkbox"
                 ${option === 'incorrect' ? '' : 'checked'} data-filter-type="label-validations">
          <label class="map-sidebar__item-label" for="${option}">
            <span class="map-sidebar__item-name">${option}</span>
          </label>
          <span class="map-sidebar__count" data-count-for="${option}"></span>
        </li>`).join('');

    document.body.innerHTML = `
      <div id="map-sidebar">
        <button type="button" id="map-sidebar-close">close</button>
        <section class="map-sidebar__section">
          <button type="button" class="map-sidebar__deselect-all" data-section="label-type">Deselect all</button>
          <ul class="map-sidebar__list">${typeRows}</ul>
        </section>
        <section class="map-sidebar__section">
          <button type="button" class="map-sidebar__deselect-all" data-section="label-validations">Deselect all</button>
          <ul class="map-sidebar__list">${validationRows}</ul>
        </section>
      </div>
      <button type="button" id="map-sidebar-open">open</button>
      <div id="map-sidebar-resize-handle"></div>`;
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
    function build(labelsByType) {
        buildFixture();
        mapData = buildMapData(labelsByType);
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

        document.querySelector('.map-sidebar__deselect-all[data-section="label-type"]').click();

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

    it('excludes low-quality users\' labels from the counts, matching the layer filter', () => {
        build({
            CurbRamp: [label({ correct: true }), label({ correct: true, high_quality_user: false })],
        });

        expect(countFor('CurbRamp')).toBe('1');
    });
});
