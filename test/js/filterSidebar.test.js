/**
 * Tests for the shared FilterSidebar controller (public/js/common/filter-sidebar/FilterSidebar.js, issue #4585).
 *
 * FilterSidebar is the host-agnostic half of the filter sidebar: it owns the controls and their interaction rules,
 * while hosts (LabelMap's MapSidebarFilter today, the Gallery next) apply the resulting state. These tests pin the
 * rules that the hosts depend on — what a click does to the DOM, what `getState()` reports, and what the change
 * descriptor carries — so the Gallery adoption can't silently redefine them.
 *
 * Like ShareWidget, it's a top-level `class` declaration written for Grunt concatenation, so the source is eval'd
 * into the jsdom global scope rather than require()d.
 */

const fs = require('fs');
const path = require('path');

const SIDEBAR_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/filter-sidebar/FilterSidebar.js'), 'utf8'
);

/** Label types the fixture renders, mirroring the real sidebar's ids (`<LabelType>-checkbox`). */
const LABEL_TYPES = ['CurbRamp', 'NoCurbRamp', 'Obstacle'];

/** Builds sidebar markup with the same hooks the Twirl partial emits. */
function buildFixture() {
    const labelTypeRows = LABEL_TYPES.map((type) => `
        <li class="filter-sidebar__item filter-sidebar__item--expandable">
          <div class="filter-sidebar__item-row">
            <input type="checkbox" id="${type}-checkbox" class="filter-sidebar__checkbox" checked
                   data-filter-type="label-type" disabled>
            <label class="filter-sidebar__item-label" for="${type}-checkbox">
              <span class="filter-sidebar__item-name">${type}</span>
            </label>
            <span class="filter-sidebar__right-slot">
              <span class="filter-sidebar__count" data-count-for="${type}"></span>
              <button type="button" class="filter-sidebar__only" data-section="label-type" data-value="${type}">
                Only
              </button>
            </span>
            <button type="button" class="filter-sidebar__tag-toggle" aria-expanded="false">
              <img src="down.svg" data-down-src="down.svg" data-up-src="up.svg" alt="">
            </button>
          </div>
          <div class="filter-sidebar__tag-pills" hidden>
            <button type="button" class="tag-pill" data-tag="${type.toLowerCase()}-tag" data-label-type="${type}">
              <span class="tag-pill__label">tag</span>
            </button>
          </div>
        </li>`).join('');

    const severityCells = [0, 1, 2, 3].map((severity) => `
        <div class="filter-sidebar__severity-cell">
          <button type="button" class="severity-button" data-severity="${severity}" aria-pressed="true">
            <img class="severity-button__icon" src="sev-${severity}-filled.svg"
                 data-selected-src="sev-${severity}-filled.svg" data-unselected-src="sev-${severity}.svg" alt="">
            <span class="severity-button__label">sev ${severity}</span>
          </button>
          <button type="button" class="filter-sidebar__only" data-section="severity" data-value="${severity}">
            Only
          </button>
        </div>`).join('');

    document.body.innerHTML = `
      <div id="filter-sidebar" class="filter-sidebar filter-sidebar--loading">
        <section class="filter-sidebar__section">
          <button type="button" class="filter-sidebar__deselect-all" data-section="severity">Deselect all</button>
          <div class="filter-sidebar__severity-toggles">${severityCells}</div>
        </section>
        <section class="filter-sidebar__section">
          <button type="button" class="filter-sidebar__deselect-all" data-section="label-type">Deselect all</button>
          <ul class="filter-sidebar__list">${labelTypeRows}</ul>
        </section>
        <section class="filter-sidebar__section">
          <button type="button" class="filter-sidebar__deselect-all" data-section="label-validations">Deselect all</button>
          <ul class="filter-sidebar__list">
            <li class="filter-sidebar__item">
              <input type="checkbox" id="correct" class="filter-sidebar__checkbox" checked
                     data-filter-type="label-validations" disabled>
              <label class="filter-sidebar__item-label" for="correct">
                <span class="filter-sidebar__item-name">Validated correct</span>
              </label>
              <span class="filter-sidebar__right-slot">
                <span class="filter-sidebar__count" data-count-for="correct"></span>
                <button type="button" class="filter-sidebar__only" data-section="label-validations" data-value="correct">
                  Only
                </button>
              </span>
            </li>
            <li class="filter-sidebar__item">
              <input type="checkbox" id="incorrect" class="filter-sidebar__checkbox"
                     data-filter-type="label-validations" disabled>
              <label class="filter-sidebar__item-label" for="incorrect">
                <span class="filter-sidebar__item-name">Validated incorrect</span>
              </label>
              <span class="filter-sidebar__right-slot">
                <span class="filter-sidebar__count" data-count-for="incorrect"></span>
                <button type="button" class="filter-sidebar__only" data-section="label-validations" data-value="incorrect">
                  Only
                </button>
              </span>
            </li>
          </ul>
        </section>
      </div>`;
    return document.getElementById('filter-sidebar');
}


/** Loads a fresh FilterSidebar class into the jsdom global scope. */
function loadFilterSidebar() {
    window.eval(`${SIDEBAR_SRC}\nwindow.FilterSidebar = FilterSidebar;`);
    return window.FilterSidebar;
}

describe('FilterSidebar', () => {
    let FilterSidebar;
    let root;
    let changes;

    /** @returns {HTMLInputElement} The checkbox for a label type. */
    const typeBox = (type) => root.querySelector(`#${type}-checkbox`);
    /** @returns {HTMLElement} A section's "Deselect all"/"Select all" action. */
    const sectionAction = (section) => root.querySelector(`.filter-sidebar__deselect-all[data-section="${section}"]`);
    /** @returns {HTMLElement} A row's "Only" button. */
    const onlyBtn = (section, value) =>
        root.querySelector(`.filter-sidebar__only[data-section="${section}"][data-value="${value}"]`);
    /** @returns {HTMLElement} A label type's single tag pill. */
    const tagPill = (type) => root.querySelector(`.tag-pill[data-label-type="${type}"]`);
    /** @returns {HTMLElement} A severity toggle. */
    const sevBtn = (severity) => root.querySelector(`.severity-button[data-severity="${severity}"]`);

    /**
     * Builds a sidebar over the fixture, recording every change descriptor it emits. The controls render disabled
     * (the real markup waits for the host's data), so enable() runs by default — a disabled input ignores clicks.
     */
    function build({ enable = true } = {}) {
        changes = [];
        const sidebar = new FilterSidebar(root, { onChange: (change) => changes.push(change) });
        if (enable) sidebar.enable();
        return sidebar;
    }

    beforeAll(() => {
        // i18next is a page-level global in the app; the controller only reads t() and language.
        window.i18next = { t: (key) => key, language: 'en' };
    });

    beforeEach(() => {
        root = buildFixture();
        FilterSidebar = loadFilterSidebar();
    });

    describe('getState', () => {
        it('reports the default state read off the markup', () => {
            const state = build().getState();

            expect(state.severities).toEqual([0, 1, 2, 3]);
            expect(state.sections['label-type']).toEqual(LABEL_TYPES);
            expect(state.sections['label-validations']).toEqual(['correct']);
        });

        it('includes every label type in tags, so hosts can clear ones with no selection', () => {
            const sidebar = build();
            tagPill('Obstacle').click();

            expect(sidebar.getState().tags).toEqual({
                CurbRamp: [], NoCurbRamp: [], Obstacle: ['obstacle-tag'],
            });
        });

        it('drops a label type from the state when its checkbox is unchecked', () => {
            const sidebar = build();
            typeBox('NoCurbRamp').click();

            expect(sidebar.getState().sections['label-type']).toEqual(['CurbRamp', 'Obstacle']);
        });
    });

    describe('option toggles', () => {
        it('emits a change carrying the section, semantic value, and new state', () => {
            build();
            typeBox('CurbRamp').click();

            expect(changes).toEqual([
                { kind: 'option', section: 'label-type', value: 'CurbRamp', checked: false },
            ]);
        });

        it('reports validation options by their control id', () => {
            build();
            root.querySelector('#incorrect').click();

            expect(changes[0]).toMatchObject({ section: 'label-validations', value: 'incorrect', checked: true });
        });

        it('carries the severity as a number, with 0 for the no-severity toggle', () => {
            build();
            sevBtn(0).click();

            expect(changes[0]).toEqual({ kind: 'option', section: 'severity', value: 0, checked: false });
            expect(sevBtn(0).getAttribute('aria-pressed')).toBe('false');
            expect(sevBtn(0).querySelector('.severity-button__icon').src).toContain('sev-0.svg');
        });

        it('clears a label type\'s tag filters when the type is hidden', () => {
            const sidebar = build();
            tagPill('CurbRamp').click();
            expect(tagPill('CurbRamp').classList.contains('tag-pill--active')).toBe(true);

            typeBox('CurbRamp').click();

            expect(tagPill('CurbRamp').classList.contains('tag-pill--active')).toBe(false);
            expect(typeBox('CurbRamp').classList.contains('checkbox--partial')).toBe(false);
            expect(sidebar.getState().tags.CurbRamp).toEqual([]);
        });
    });

    describe('section actions', () => {
        it('deselects the whole section and relabels itself "Select all"', () => {
            const sidebar = build();
            sectionAction('label-type').click();

            expect(sidebar.getState().sections['label-type']).toEqual([]);
            expect(sectionAction('label-type').textContent).toBe('labelmap:select-all');
            expect(changes).toEqual([{ kind: 'selectAll', section: 'label-type', checked: false }]);
        });

        it('reselects the whole section on a second click', () => {
            const sidebar = build();
            sectionAction('label-type').click();
            sectionAction('label-type').click();

            expect(sidebar.getState().sections['label-type']).toEqual(LABEL_TYPES);
            expect(sectionAction('label-type').textContent).toBe('labelmap:deselect-all');
        });

        it('clears every tag filter when deselecting all label types', () => {
            const sidebar = build();
            tagPill('CurbRamp').click();
            tagPill('Obstacle').click();

            sectionAction('label-type').click();

            expect(root.querySelectorAll('.tag-pill--active')).toHaveLength(0);
            expect(root.querySelectorAll('.checkbox--partial')).toHaveLength(0);
            expect(sidebar.getState().tags).toEqual({ CurbRamp: [], NoCurbRamp: [], Obstacle: [] });
        });

        it('leaves the section fully selected with no tags after deselect-all then select-all', () => {
            const sidebar = build();
            tagPill('CurbRamp').click();

            sectionAction('label-type').click(); // Deselect all, which also clears the tag filters.
            sectionAction('label-type').click(); // Select all: the cleared tags do not come back.

            expect(sidebar.getState().sections['label-type']).toEqual(LABEL_TYPES);
            expect(sidebar.getState().tags.CurbRamp).toEqual([]);
            expect(root.querySelectorAll('.checkbox--partial')).toHaveLength(0);
        });

        it('offers "Select all" as soon as anything in the section is off', () => {
            build();
            expect(sectionAction('label-type').textContent).toBe('labelmap:deselect-all');

            typeBox('NoCurbRamp').click();

            expect(sectionAction('label-type').textContent).toBe('labelmap:select-all');
        });

        it('offers "Select all" after "Only" leaves one option standing', () => {
            build();
            onlyBtn('label-type', 'Obstacle').click();

            expect(sectionAction('label-type').textContent).toBe('labelmap:select-all');
        });

        it('restores the whole section from a partial state rather than clearing it', () => {
            const sidebar = build();
            onlyBtn('label-type', 'Obstacle').click();

            sectionAction('label-type').click();

            expect(sidebar.getState().sections['label-type']).toEqual(LABEL_TYPES);
            expect(changes.at(-1)).toEqual({ kind: 'selectAll', section: 'label-type', checked: true });
        });

        it('starts as "Select all" for a section whose defaults are not all on', () => {
            build();

            // "Validated incorrect" ships unchecked, so the validations section is partial from the first paint.
            expect(sectionAction('label-validations').textContent).toBe('labelmap:select-all');
        });

        it('turns every severity toggle off together', () => {
            const sidebar = build();
            sectionAction('severity').click();

            expect(sidebar.getState().severities).toEqual([]);
            expect(sevBtn(2).getAttribute('aria-pressed')).toBe('false');
        });
    });

    describe('"Only"', () => {
        it('isolates one label type within its section', () => {
            const sidebar = build();
            onlyBtn('label-type', 'Obstacle').click();

            expect(sidebar.getState().sections['label-type']).toEqual(['Obstacle']);
            expect(changes).toEqual([{ kind: 'only', section: 'label-type', value: 'Obstacle' }]);
        });

        it('clears the tag filters of the types it turns off', () => {
            const sidebar = build();
            tagPill('CurbRamp').click();

            onlyBtn('label-type', 'Obstacle').click();

            expect(sidebar.getState().tags.CurbRamp).toEqual([]);
            expect(typeBox('CurbRamp').classList.contains('checkbox--partial')).toBe(false);
        });

        it('keeps the isolated type\'s own tags, and its partial glyph with them', () => {
            const sidebar = build();
            tagPill('CurbRamp').click();

            onlyBtn('label-type', 'CurbRamp').click();

            expect(sidebar.getState().tags.CurbRamp).toEqual(['curbramp-tag']);
            expect(typeBox('CurbRamp').classList.contains('checkbox--partial')).toBe(true);
        });

        it('isolates one severity, comparing values as strings from the dataset', () => {
            const sidebar = build();
            onlyBtn('severity', '2').click();

            expect(sidebar.getState().severities).toEqual([2]);
            expect(sevBtn(0).getAttribute('aria-pressed')).toBe('false');
        });

        it('names its row for screen readers', () => {
            build();

            expect(onlyBtn('label-type', 'Obstacle').getAttribute('aria-label')).toBe('common:only: Obstacle');
        });
    });

    describe('tags', () => {
        it('marks the type partially filtered and reports the tag', () => {
            const sidebar = build();
            tagPill('CurbRamp').click();

            expect(typeBox('CurbRamp').classList.contains('checkbox--partial')).toBe(true);
            expect(sidebar.getState().tags.CurbRamp).toEqual(['curbramp-tag']);
            expect(changes[0]).toMatchObject({
                kind: 'tag', labelType: 'CurbRamp', tag: 'curbramp-tag', checked: true, typeTurnedOn: false,
            });
        });

        it('turns a hidden label type back on, and says so in the change', () => {
            const sidebar = build();
            typeBox('CurbRamp').click();
            changes.length = 0;

            tagPill('CurbRamp').click();

            expect(typeBox('CurbRamp').checked).toBe(true);
            expect(changes[0]).toMatchObject({ typeTurnedOn: true });
            expect(sidebar.getState().sections['label-type']).toContain('CurbRamp');
        });

        it('shows the partial glyph on a type that arrives already tagged', () => {
            // The Gallery renders the URL's tags as applied, so the glyph has to say so from the first paint.
            tagPill('CurbRamp').classList.add('tag-pill--active');

            new FilterSidebar(root, {});

            expect(typeBox('CurbRamp').classList.contains('checkbox--partial')).toBe(true);
            expect(typeBox('Obstacle').classList.contains('checkbox--partial')).toBe(false);
        });

        it('drops the partial glyph when the last tag is deselected', () => {
            build();
            tagPill('CurbRamp').click();
            tagPill('CurbRamp').click();

            expect(typeBox('CurbRamp').classList.contains('checkbox--partial')).toBe(false);
        });

        it('expands and collapses the drawer, swapping the chevron', () => {
            build();
            const toggle = root.querySelector('.filter-sidebar__tag-toggle');
            const pills = root.querySelector('.filter-sidebar__tag-pills');

            toggle.click();
            expect(toggle.getAttribute('aria-expanded')).toBe('true');
            expect(pills.hidden).toBe(false);
            expect(toggle.querySelector('img').src).toContain('up.svg');

            toggle.click();
            expect(pills.hidden).toBe(true);
            expect(toggle.querySelector('img').src).toContain('down.svg');
        });
    });

    describe('counts and loading', () => {
        it('renders counts into the slots that ask for them, localized', () => {
            const sidebar = build();
            sidebar.setCounts({ CurbRamp: 5088, correct: 202 });

            expect(root.querySelector('[data-count-for="CurbRamp"]').textContent).toBe('5,088');
            expect(root.querySelector('[data-count-for="correct"]').textContent).toBe('202');
        });

        it('leaves a slot alone when the host reports no count for it', () => {
            const sidebar = build();
            sidebar.setCounts({ CurbRamp: 1 });

            expect(root.querySelector('[data-count-for="Obstacle"]').textContent).toBe('');
        });

        it('enables the controls and drops the loading class', () => {
            const sidebar = build({ enable: false });
            expect(typeBox('CurbRamp').disabled).toBe(true);

            sidebar.enable();

            expect(root.classList.contains('filter-sidebar--loading')).toBe(false);
            expect(typeBox('CurbRamp').disabled).toBe(false);
        });
    });

    describe('applyTags', () => {
        it('activates the pill, opens its drawer, and marks the type partially filtered', () => {
            const sidebar = build();
            sidebar.applyTags([{ labelType: 'CurbRamp', tag: 'curbramp-tag' }]);

            expect(tagPill('CurbRamp').classList.contains('tag-pill--active')).toBe(true);
            expect(typeBox('CurbRamp').classList.contains('checkbox--partial')).toBe(true);
            const item = tagPill('CurbRamp').closest('.filter-sidebar__item');
            expect(item.querySelector('.filter-sidebar__tag-pills').hidden).toBe(false);
            expect(item.querySelector('.filter-sidebar__tag-toggle').getAttribute('aria-expanded')).toBe('true');
        });

        it('skips pills whose label type is unchecked, rather than implying the type on', () => {
            const sidebar = build();
            typeBox('Obstacle').click();

            sidebar.applyTags([{ labelType: 'Obstacle', tag: 'obstacle-tag' }]);

            expect(tagPill('Obstacle').classList.contains('tag-pill--active')).toBe(false);
            expect(typeBox('Obstacle').checked).toBe(false);
            expect(sidebar.getState().tags.Obstacle).toEqual([]);
        });

        it('activates a tag name only on the type it was paired with', () => {
            // The same name on two types: activating one must leave the other's pill alone.
            tagPill('Obstacle').dataset.tag = 'curbramp-tag';
            const sidebar = build();

            sidebar.applyTags([{ labelType: 'CurbRamp', tag: 'curbramp-tag' }]);

            expect(tagPill('CurbRamp').classList.contains('tag-pill--active')).toBe(true);
            expect(tagPill('Obstacle').classList.contains('tag-pill--active')).toBe(false);
            expect(sidebar.getState().tags.Obstacle).toEqual([]);
        });

        it('does not fire onChange', () => {
            build().applyTags([
                { labelType: 'CurbRamp', tag: 'curbramp-tag' },
                { labelType: 'Obstacle', tag: 'obstacle-tag' },
            ]);

            expect(changes).toEqual([]);
        });

        it('handles tag names that need CSS escaping in the selector', () => {
            // Real tag names can carry a colon (e.g. "parallel lines:yes"), which would break a raw selector.
            tagPill('CurbRamp').dataset.tag = 'parallel lines:yes';
            const sidebar = build();

            sidebar.applyTags([{ labelType: 'CurbRamp', tag: 'parallel lines:yes' }]);

            expect(tagPill('CurbRamp').classList.contains('tag-pill--active')).toBe(true);
        });
    });
});
