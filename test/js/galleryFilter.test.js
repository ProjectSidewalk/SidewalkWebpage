/**
 * Tests for GalleryFilter (public/js/gallery/src/filter/GalleryFilter.js, issue #4585).
 *
 * GalleryFilter is the Gallery's adapter for the shared FilterSidebar: it turns the sidebar's state into a card
 * query — the URL the page can be reloaded from, the refetch, and the tracker events — and keeps the severity block
 * in step with the selected label type. These tests pin that translation, since a wrong query param shows the wrong
 * cards without anything looking broken.
 *
 * Both classes are Grunt-concatenated `class` declarations that reach for page globals, so the sources are eval'd
 * into jsdom with those stubbed.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js');
const FILTER_SIDEBAR_SRC = fs.readFileSync(path.join(SRC_DIR, 'common/filter-sidebar/FilterSidebar.js'), 'utf8');
const GALLERY_FILTER_SRC = fs.readFileSync(path.join(SRC_DIR, 'gallery/src/filter/GalleryFilter.js'), 'utf8');

const LABEL_TYPES = ['CurbRamp', 'Obstacle', 'NoSidewalk'];
const VALIDATIONS = ['correct', 'incorrect', 'unsure', 'unvalidated'];
const DEFAULT_VALIDATIONS = ['correct', 'unvalidated'];

/** Builds the sidebar markup the Gallery renders: single-select label types, severity toggles, validations. */
function buildFixture() {
    const typeRows = ['Assorted', ...LABEL_TYPES].map((type) => `
        <li class="filter-sidebar__item filter-sidebar__item--expandable">
          <div class="filter-sidebar__item-row">
            <input type="radio" id="${type}-checkbox" class="filter-sidebar__checkbox" name="label-type"
                   ${type === 'Assorted' ? 'checked' : ''} data-filter-type="label-type">
            <label class="filter-sidebar__item-label" for="${type}-checkbox">
              <span class="filter-sidebar__item-name">${type}</span>
            </label>
          </div>
          ${type === 'Assorted' ? '' : `
            <div class="filter-sidebar__tag-pills" hidden>
              <button type="button" class="tag-pill" data-tag="${type.toLowerCase()}-tag" data-label-type="${type}">
                <span class="tag-pill__label">tag</span>
              </button>
            </div>`}
        </li>`).join('');

    const severityCells = [0, 1, 2, 3].map((severity) => `
        <div class="filter-sidebar__severity-cell">
          <button type="button" class="severity-button" data-severity="${severity}" aria-pressed="true">
            <img class="severity-button__icon" src="sev-${severity}-negative-filled.svg"
                 data-selected-src="sev-${severity}-negative-filled.svg"
                 data-unselected-src="sev-${severity}-negative.svg" alt="">
            <span class="severity-button__label">level ${severity}</span>
          </button>
          <button type="button" class="filter-sidebar__only" data-section="severity" data-value="${severity}">
            Only
          </button>
        </div>`).join('');

    const validationRows = VALIDATIONS.map((option) => `
        <li class="filter-sidebar__item">
          <input type="checkbox" id="${option}" class="filter-sidebar__checkbox"
                 ${DEFAULT_VALIDATIONS.includes(option) ? 'checked' : ''} data-filter-type="label-validations">
          <label class="filter-sidebar__item-label" for="${option}">
            <span class="filter-sidebar__item-name">${option}</span>
          </label>
          <button type="button" class="filter-sidebar__only" data-section="label-validations" data-value="${option}">
            Only
          </button>
        </li>`).join('');

    document.body.innerHTML = `
      <div id="card-filter">
        <div class="gallery-filter-header">
          <h4 id="filter-header">Filter By</h4>
          <button type="button" id="clear-filters" class="button-ps button--tiny button--secondary" hidden>
            <span aria-hidden="true">&#10006;</span><span>Clear Filters</span>
          </button>
        </div>
        <section class="filter-sidebar__section" data-filter-section="severity">
          <div class="filter-sidebar__heading-row">
            <h3 class="filter-sidebar__heading" data-i18n="common:severity">Severity</h3>
            <button type="button" class="filter-sidebar__deselect-all" data-section="severity">Deselect all</button>
          </div>
          <div class="filter-sidebar__severity-toggles">${severityCells}</div>
        </section>
        <section class="filter-sidebar__section" data-filter-section="label-type" data-select-mode="single">
          <ul class="filter-sidebar__list">${typeRows}</ul>
        </section>
        <section class="filter-sidebar__section" data-filter-section="validations">
          <div class="filter-sidebar__heading-row">
            <h3 class="filter-sidebar__heading">Validations</h3>
            <button type="button" class="filter-sidebar__deselect-all" data-section="label-validations">
              Select all
            </button>
          </div>
          <ul class="filter-sidebar__list">${validationRows}</ul>
        </section>
      </div>`;
}

describe('GalleryFilter', () => {
    let filter;

    /** @returns {string} The path + query the page has pushed to the address bar. */
    const currentUrl = () => window.location.pathname + window.location.search;
    /** @returns {HTMLInputElement} A label type's radio. */
    const typeRadio = (type) => document.querySelector(`#${type}-checkbox`);
    /** @returns {HTMLElement} A severity toggle. */
    const sevBtn = (severity) => document.querySelector(`.severity-button[data-severity="${severity}"]`);
    /** @returns {HTMLElement} The severity section. */
    const severitySection = () => document.querySelector('[data-filter-section="severity"]');
    /** @returns {HTMLElement} The clear-filters button. */
    const clearBtn = () => document.getElementById('clear-filters');

    /**
     * Builds the filter over the fixture.
     * @param {object} [initialFilters] Overrides for the filters the server parsed out of the URL.
     * @returns {GalleryFilter} The filter under test.
     */
    function build(initialFilters = {}) {
        buildFixture();
        return new window.GalleryFilter(document.getElementById('card-filter'), clearBtn(), {
            labelType: 'Assorted', neighborhoods: [], aiValidationOptions: [], ...initialFilters,
        });
    }

    beforeAll(() => {
        window.i18next = { t: (key) => key, language: 'en' };
        // Mirrors util.misc's rating rules (public/js/common/utilitiesSidewalk.js), which the real page supplies.
        window.util = {
            misc: {
                labelTypeHasSeverity: (t) => !['NoSidewalk', 'Signal', 'Occlusion'].includes(t),
                isPositiveLabelType: (t) => ['CurbRamp', 'Crosswalk'].includes(t),
                getRatingLevelKeys: (t) => (['CurbRamp', 'Crosswalk'].includes(t)
                    ? { 1: 'good', 2: 'okay', 3: 'bad' }
                    : { 1: 'low', 2: 'medium', 3: 'high' }),
                getSmileyIconPath: (severity, labelType, selected) => {
                    const set = severity === 0 || !['CurbRamp', 'Crosswalk'].includes(labelType)
                        ? 'negative' : 'positive';
                    return `sev-${severity}-${set}${selected ? '-filled' : ''}.svg`;
                },
            },
        };
        window.eval(`${FILTER_SIDEBAR_SRC}\nwindow.FilterSidebar = FilterSidebar;`);
        window.eval(`${GALLERY_FILTER_SRC}\nwindow.GalleryFilter = GalleryFilter;`);
    });

    beforeEach(() => {
        window.history.replaceState({}, '', '/gallery');
        window.sg = { tracker: { push: jest.fn() }, cardContainer: { updateCardsByFilter: jest.fn() } };
        filter = build();
    });

    describe('the card query', () => {
        it('leaves the URL bare while every filter is at its default', () => {
            expect(currentUrl()).toBe('/gallery');
            expect(clearBtn().hidden).toBe(true);
        });

        it('names the label type it switches to, and refetches the cards', () => {
            typeRadio('Obstacle').click();

            expect(currentUrl()).toBe('/gallery?labelType=Obstacle');
            expect(filter.getStatus().currentLabelType).toBe('Obstacle');
            expect(sg.cardContainer.updateCardsByFilter).toHaveBeenCalled();
            expect(clearBtn().hidden).toBe(false);
        });

        it('carries the tags of the selected type, spelled out unencoded', () => {
            typeRadio('Obstacle').click();
            document.querySelector('.tag-pill[data-label-type="Obstacle"]').click();

            expect(currentUrl()).toBe('/gallery?labelType=Obstacle&tags=obstacle-tag');
            expect(filter.getAppliedTagNames()).toEqual(['obstacle-tag']);
        });

        it('lists the severities that are left, with "null" for the N/A bucket', () => {
            sevBtn(0).click();

            expect(filter.getAppliedSeverities()).toEqual(['1', '2', '3']);
            expect(currentUrl()).toBe('/gallery?severities=1,2,3');
        });

        it('reports validation options sorted, and only once they leave the default', () => {
            expect(filter.getAppliedValidationOptions()).toEqual(DEFAULT_VALIDATIONS);
            expect(currentUrl()).toBe('/gallery');

            document.querySelector('#incorrect').click();

            expect(currentUrl()).toBe('/gallery?validationOptions=correct,incorrect,unvalidated');
        });

        it('keeps reporting the filters that have no UI of their own', () => {
            filter = build({ neighborhoods: [7, 9], aiValidationOptions: ['correct'] });

            expect(currentUrl()).toBe('/gallery?neighborhoods=7,9&aiValidationOptions=correct');
        });
    });

    describe('the severity block', () => {
        it('disappears for a label type that carries no rating', () => {
            typeRadio('NoSidewalk').click();

            expect(severitySection().hidden).toBe(true);
        });

        it('reads as "Quality" for a positive type, with that type\'s smileys and level names', () => {
            typeRadio('CurbRamp').click();

            const heading = severitySection().querySelector('.filter-sidebar__heading');
            expect(heading.textContent).toBe('common:quality');
            expect(heading.dataset.i18n).toBe('common:quality');
            expect(sevBtn(3).querySelector('.severity-button__label').textContent).toBe('common:bad');
            expect(sevBtn(3).querySelector('.severity-button__icon').src).toContain('sev-3-positive-filled.svg');
        });

        it('reads as "Severity" for a negative type', () => {
            typeRadio('CurbRamp').click();
            typeRadio('Obstacle').click();

            expect(severitySection().hidden).toBe(false);
            expect(severitySection().querySelector('.filter-sidebar__heading').textContent).toBe('common:severity');
            expect(sevBtn(3).querySelector('.severity-button__label').textContent).toBe('common:high');
        });

        it('leaves a deselected toggle looking deselected when the icon set changes', () => {
            sevBtn(2).click();
            typeRadio('CurbRamp').click();

            expect(sevBtn(2).querySelector('.severity-button__icon').src).toContain('sev-2-positive.svg');
        });
    });

    describe('logging', () => {
        it('logs each kind of filter interaction under its existing event name', () => {
            typeRadio('Obstacle').click();
            expect(sg.tracker.push).toHaveBeenCalledWith('Filter_LabelType=Obstacle');

            sevBtn(0).click();
            expect(sg.tracker.push).toHaveBeenCalledWith('SeverityUnapply', null, { Severity: 'null' });

            document.querySelector('#incorrect').click();
            expect(sg.tracker.push)
                .toHaveBeenCalledWith('ValidationOptionApply', null, { ValidationOption: 'incorrect' });

            document.querySelector('.tag-pill[data-label-type="Obstacle"]').click();
            expect(sg.tracker.push)
                .toHaveBeenCalledWith('TagApply', null, { Tag: 'obstacle-tag', Label_Type: 'Obstacle' });
        });

        it('logs the batch actions the shared sidebar adds', () => {
            document.querySelector('.filter-sidebar__only[data-section="severity"][data-value="2"]').click();
            expect(sg.tracker.push).toHaveBeenCalledWith('SeverityOnly', null, { Severity: '2' });

            document.querySelector('.filter-sidebar__deselect-all[data-section="label-validations"]').click();
            expect(sg.tracker.push).toHaveBeenCalledWith('ValidationOptionSelectAll');
        });
    });

    describe('clearing', () => {
        it('puts every filter back to its default', () => {
            typeRadio('Obstacle').click();
            document.querySelector('.tag-pill[data-label-type="Obstacle"]').click();
            sevBtn(1).click();
            document.querySelector('#unsure').click();
            expect(currentUrl()).not.toBe('/gallery');

            clearBtn().click();

            expect(filter.getStatus().currentLabelType).toBe('Assorted');
            expect(filter.getAppliedSeverities()).toEqual(['null', '1', '2', '3']);
            expect(filter.getAppliedValidationOptions()).toEqual(DEFAULT_VALIDATIONS);
            expect(filter.getAppliedTagNames()).toEqual([]);
            expect(currentUrl()).toBe('/gallery');
            expect(clearBtn().hidden).toBe(true);
        });
    });

    describe('loading state', () => {
        it('blocks and restores interaction while cards load', () => {
            filter.disable();
            expect(document.getElementById('card-filter').classList.contains('filter-sidebar--loading')).toBe(true);
            expect(typeRadio('Obstacle').disabled).toBe(true);

            filter.enable();

            expect(document.getElementById('card-filter').classList.contains('filter-sidebar--loading')).toBe(false);
            expect(typeRadio('Obstacle').disabled).toBe(false);
        });
    });
});
