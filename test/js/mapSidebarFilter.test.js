/**
 * Tests MapSidebarFilter (frontend/js/ps-map/MapSidebarFilter.js) for what the count and emphasis suites leave out:
 * the activity string each sidebar control logs, and how the map copes with a page that leaves a section out (the
 * admin filter is on the admin map only; a host may drop others). A wrong log string still "works", it just files
 * clicks under the wrong name, so the formats are pinned here (#5840).
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key, language: 'en' } }));

// The layer helpers drive a real Mapbox map; here we only check what they're asked to do.
const toggleLabelLayer = vi.fn();
mockModule('frontend/js/ps-map/psMapUtilities.js', async (importOriginal) => ({
  ...await importOriginal(),
  emphasizeStreetState: () => {},
  filterLabelLayers: () => {},
  filterStreetLayer: () => {},
  toggleLabelLayer,
}));

const LABEL_TYPES = ['CurbRamp', 'Obstacle'];

/**
 * Builds the sidebar markup, with each section optional so a test can drop the ones a page leaves out.
 * @param {object} [options]
 * @param {boolean} [options.labelTypes=true] - Render the label type section.
 * @param {boolean} [options.validations=true] - Render the validations section.
 * @param {boolean} [options.admin=true] - Render the admin-only section.
 */
function buildFixture({ labelTypes = true, validations = true, admin = true } = {}) {
  const severityButtons = [0, 1, 2, 3].map((severity) => `
        <button type="button" class="severity-button" data-severity="${severity}" aria-pressed="true">
          <span class="severity-button__label">sev ${severity}</span>
        </button>`).join('');

  const typeRows = LABEL_TYPES.map((type) => `
        <li class="filter-sidebar__item">
          <input type="checkbox" id="${type}-checkbox" checked data-filter-type="label-type">
          <span class="filter-sidebar__count" data-count-for="${type}"></span>
          <button type="button" class="tag-pill" data-tag="narrow" data-label-type="${type}">narrow</button>
          <button type="button" class="filter-sidebar__only" data-section="label-type" data-value="${type}">Only</button>
        </li>`).join('');

  const validationRows = ['correct', 'incorrect', 'unsure', 'unvalidated'].map((option) => `
        <li class="filter-sidebar__item">
          <input type="checkbox" id="${option}" checked data-filter-type="label-validations">
        </li>`).join('');

  document.body.innerHTML = `
      <div id="filter-sidebar">
        <section class="filter-sidebar__section">
          <button type="button" class="filter-sidebar__deselect-all" data-section="severity">Deselect all</button>
          ${severityButtons}
        </section>
        ${labelTypes ? `<section><ul>${typeRows}</ul></section>` : ''}
        ${validations ? `<section><ul>${validationRows}</ul></section>` : ''}
        ${admin ? `<section><input type="checkbox" id="not-admin-validated" data-filter-type="admin-validation"
                                     disabled></section>` : ''}
        <section data-filter-section="streets">
          <ul><li class="filter-sidebar__item">
            <input type="checkbox" id="audited-street" data-filter-type="streets">
          </li></ul>
        </section>
      </div>`;
}

/**
 * One loaded label's GeoJSON feature.
 * @param {object} props - Overrides for the label's properties.
 * @returns {object} The feature.
 */
function label(props) {
  return {
    geometry: { coordinates: [0, 0] },
    properties: {
      severity: 1, high_quality_user: true, correct: null, has_validations: false, has_admin_validation: false,
      tags: [], ...props,
    },
  };
}

/**
 * The mapData tracker MapSidebarFilter mirrors the sidebar into. Only CurbRamp has tags, as in a city whose
 * Obstacle labels have none to choose from.
 * @param {Record<string, object[]>} [labelsByType] - Loaded labels per type.
 * @returns {object} The tracker.
 */
function buildMapData(labelsByType = {}) {
  return {
    correct: true, incorrect: true, unsure: true, unvalidated: true, lowQualityUsers: false,
    notAdminValidated: false, spotlightLabelId: null,
    severities: { 0: true, 1: true, 2: true, 3: true },
    selectedTags: { CurbRamp: new Set() },
    sortedLabels: { CurbRamp: labelsByType.CurbRamp ?? [], Obstacle: labelsByType.Obstacle ?? [] },
    layerNames: { CurbRamp: 'CurbRamp-layer', Obstacle: 'Obstacle-layer' },
    streetCounts: null,
  };
}

describe('MapSidebarFilter', () => {
  let MapSidebarFilter;
  let mapData;
  let sidebar;

  beforeAll(async () => {
    ({ MapSidebarFilter } = await loadModules('frontend/js/ps-map/MapSidebarFilter.js'));
  });

  beforeEach(() => {
    window.logWebpageActivity = vi.fn();
    toggleLabelLayer.mockClear();
  });

  afterEach(() => {
    delete window.logWebpageActivity;
  });

  /**
   * Builds the sidebar and the filter over a stub map.
   * @param {Record<string, object[]>} [labelsByType] - Loaded labels per type.
   * @param {object} [fixtureOptions] - Passed to buildFixture.
   */
  function build(labelsByType, fixtureOptions) {
    buildFixture(fixtureOptions);
    mapData = buildMapData(labelsByType);
    sidebar = new MapSidebarFilter({ getLayer: () => true }, mapData);
  }

  const click = (selector) => document.querySelector(selector).click();
  const toggle = (id) => {
    const cb = document.getElementById(id);
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change'));
  };

  describe('logging', () => {
    beforeEach(() => build());

    test.each([
      ['turning a severity off', () => click('[data-severity="2"]'), 'Click_module=MapSidebar_SeverityUnapply_severity=2'],
      ['turning N/A severity off', () => click('[data-severity="0"]'),
        'Click_module=MapSidebar_SeverityUnapply_severity=null'],
      ['hiding a label type', () => toggle('Obstacle-checkbox'),
        'Click_module=MapSidebar_LabelTypeUnapply_labelType=Obstacle'],
      ['hiding a validation option', () => toggle('unsure'),
        'Click_module=MapSidebar_ValidationOptionUnapply_option=unsure'],
      ['showing a street state', () => toggle('audited-street'), 'Click_module=MapSidebar_StreetApply_street=audited'],
      ['the admin-only filter', () => toggle('not-admin-validated'),
        'Click_module=MapSidebar_NotAdminValidated_checked=true'],
      ['picking a tag', () => click('.tag-pill[data-label-type="CurbRamp"]'),
        'Click_module=MapSidebar_TagApply_labelType=CurbRamp_tag=narrow'],
      ['deselecting all severities', () => click('.filter-sidebar__deselect-all'),
        'Click_module=MapSidebar_DeselectAll_section=severity'],
    ])('%s', (_name, act, expected) => {
      act();
      expect(window.logWebpageActivity).toHaveBeenCalledWith(expected);
    });

    test('"Only" on a label type logs the type picked', () => {
      click('.filter-sidebar__only[data-value="Obstacle"]');
      expect(window.logWebpageActivity).toHaveBeenCalledWith(
        'Click_module=MapSidebar_Only_section=label-type_value=Obstacle');
    });

    test('selecting all again after deselecting logs a select-all', () => {
      click('.filter-sidebar__deselect-all');
      click('.filter-sidebar__deselect-all');
      expect(window.logWebpageActivity).toHaveBeenLastCalledWith('Click_module=MapSidebar_SelectAll_section=severity');
    });

    test('dropping a tag logs it as unapplied', () => {
      click('.tag-pill[data-label-type="CurbRamp"]');
      click('.tag-pill[data-label-type="CurbRamp"]');
      expect(window.logWebpageActivity).toHaveBeenLastCalledWith(
        'Click_module=MapSidebar_TagUnapply_labelType=CurbRamp_tag=narrow');
    });

    test('a page without the shared logger still filters', () => {
      delete window.logWebpageActivity;
      expect(() => toggle('Obstacle-checkbox')).not.toThrow();
      expect(toggleLabelLayer).toHaveBeenCalledWith('Obstacle', false, expect.anything(), mapData);
    });
  });

  describe('filtering', () => {
    test('the admin-only filter hides labels an admin already validated', () => {
      build({ CurbRamp: [label({}), label({ has_admin_validation: true })] });
      expect(sidebar.getVisibleLabelCount()).toBe(2);
      toggle('not-admin-validated');
      expect(mapData.notAdminValidated).toBe(true);
      expect(sidebar.getVisibleLabelCount()).toBe(1);
    });

    test('a label with no severity follows the N/A toggle', () => {
      build({ CurbRamp: [label({ severity: null }), label({ severity: 2 })] });
      click('[data-severity="0"]');
      expect(sidebar.getVisibleLabelCount()).toBe(1);
      expect(document.querySelector('[data-count-for="CurbRamp"]').textContent).toBe('1');
    });

    test('a picked tag hides labels whose feed row has no tags at all', () => {
      build({ CurbRamp: [label({ tags: ['narrow'] }), label({ tags: undefined })] });
      click('.tag-pill[data-label-type="CurbRamp"]');
      expect(sidebar.getVisibleLabelCount()).toBe(1);
    });

    test('a tag on a type the tracker keeps no tags for is ignored', () => {
      build({ Obstacle: [label({})] });
      click('.tag-pill[data-label-type="Obstacle"]');
      expect(mapData.selectedTags.Obstacle).toBeUndefined();
      expect(sidebar.getVisibleLabelCount()).toBe(1);
    });
  });

  describe('a page that leaves a section out', () => {
    test('without the validations section, every validation state stays shown', () => {
      build({ CurbRamp: [label({ correct: false })] }, { validations: false });
      click('[data-severity="3"]');
      expect(mapData).toMatchObject({ correct: true, incorrect: true, unsure: true, unvalidated: true });
      expect(sidebar.getVisibleLabelCount()).toBe(1);
    });

    test('without the admin section, the admin filter stays off', () => {
      build({}, { admin: false });
      click('[data-severity="3"]');
      expect(mapData.notAdminValidated).toBe(false);
    });

    test('without the label type section, every type layer is hidden', () => {
      build({}, { labelTypes: false });
      click('[data-severity="3"]');
      expect(toggleLabelLayer).toHaveBeenCalledWith('CurbRamp', false, expect.anything(), mapData);
      expect(toggleLabelLayer).toHaveBeenCalledWith('Obstacle', false, expect.anything(), mapData);
    });
  });
});
