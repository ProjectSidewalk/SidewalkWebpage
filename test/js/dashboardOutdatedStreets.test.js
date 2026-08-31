/**
 * Tests for the dashboard's "Streets with newer imagery" list (public/js/user-dashboard/OutdatedStreets.js, #4896).
 *
 * Three contracts matter here. The rows are server-rendered and paged client-side, so "show more" must reveal
 * exactly one page, keep its own count honest, and hand keyboard focus somewhere real when it disappears. Because a
 * street has no name to show, a row identifies itself by brushing the contribution map above it — which loads
 * asynchronously and may not load at all, so hovering has to be safe before and without it. And the audited-on date
 * is rendered in UTC by the server and rewritten to the reader's timezone here.
 *
 * OutdatedStreets is a page-global `class` that reaches for globals, so the source is eval'd into jsdom with its
 * collaborators (moment, logWebpageActivity, the map) stubbed.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SECTION_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/user-dashboard/OutdatedStreets.js'), 'utf8');
const DASHBOARD_CSS = fs.readFileSync(path.join(REPO_ROOT, 'public/css/pages/user-dashboard.css'), 'utf8');

const PAGE_SIZE = 5;

/**
 * Renders the server's markup for one row.
 * @param {number} streetEdgeId - The street the row stands for.
 * @param {boolean} hidden - Whether the row starts collapsed behind "show more".
 * @param {string} datetime - The machine-readable audited-on timestamp, as the <time> element carries it.
 * @returns {string} The row's HTML.
 */
function row(streetEdgeId, hidden, datetime = '2026-01-02T03:04:05Z') {
    return `
        <li class="ud-reaudit-row" data-street-edge-id="${streetEdgeId}"${hidden ? ' hidden' : ''}>
          <div class="ud-reaudit-info">
            <span class="ud-reaudit-place">Spec Region</span>
            <span class="ud-reaudit-meta">120 ft</span>
            <span class="ud-reaudit-audited">You mapped it on
              <time class="ud-reaudit-date" datetime="${datetime}">Jan 2, 2026</time>
            </span>
          </div>
          <div class="ud-reaudit-actions">
            <a class="ud-btn-secondary ud-reaudit-explore" data-street-edge-id="${streetEdgeId}"
               href="/explore?streetEdgeId=${streetEdgeId}">Revisit</a>
          </div>
        </li>`;
}

/**
 * Renders the section the way dashboard.scala.html does: every fetched row in the DOM, the ones past the first page
 * collapsed, and a "show more" button whose count lives in its own element.
 * @param {number} total - How many rows the server rendered.
 * @param {string} [datetime] - Timestamp for every row's <time> element.
 */
function renderSection(total, datetime) {
    const rows = Array.from({ length: total }, (_, i) => row(101 + i, i >= PAGE_SIZE, datetime)).join('');
    const remaining = total - PAGE_SIZE;
    document.body.innerHTML = `
        <style>${DASHBOARD_CSS}</style>
        <ul class="ud-reaudit" id="ud-reaudit-list" data-page-size="${PAGE_SIZE}">${rows}</ul>
        ${remaining > 0 ? `
        <p class="ud-reaudit-more">
          <button type="button" id="ud-reaudit-show-more">
            Show <span class="ud-reaudit-more-count">${Math.min(PAGE_SIZE, remaining)}</span> more
          </button>
        </p>` : ''}`;
}

describe('the dashboard\'s needs-re-audit list', () => {
    /** @returns {Array<HTMLElement>} Every row, revealed or not, in document order. */
    const rows = () => Array.from(document.querySelectorAll('.ud-reaudit-row'));
    /** @returns {Array<number>} The streets currently revealed to the reader. */
    const shownStreetIds = () =>
        rows().filter((r) => !r.hasAttribute('hidden')).map((r) => Number(r.dataset.streetEdgeId));
    const showMoreButton = () => document.getElementById('ud-reaudit-show-more');
    const moreCount = () => document.querySelector('.ud-reaudit-more-count').textContent;
    /** Drains the microtask queue, so a resolved mapReady promise has reached the section. */
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    let map;

    /**
     * Wires the section over the rendered markup.
     * @param {number} total - How many rows the server rendered.
     * @param {object} [opts] - Options: `mapReady` (defaults to a promise of the stub map), `datetime`.
     * @returns {Promise<object>} The wired section.
     */
    async function init(total, opts = {}) {
        renderSection(total, opts.datetime);
        const section = new window.OutdatedStreets(document.getElementById('ud-reaudit-list'), {
            mapReady: 'mapReady' in opts ? opts.mapReady : Promise.resolve(map),
        });
        section.init();
        await flush();
        return section;
    }

    beforeAll(() => {
        window.moment = (date) => ({ format: () => `local:${date.toISOString()}` });
        window.eval(`${SECTION_SRC}\nwindow.OutdatedStreets = OutdatedStreets;`);
    });

    beforeEach(() => {
        window.logWebpageActivity = jest.fn();
        map = { setFeatureState: jest.fn() };
    });

    describe('paging', () => {
        it('reveals exactly one page per click', async () => {
            await init(15);

            expect(shownStreetIds()).toEqual([101, 102, 103, 104, 105]);
            showMoreButton().click();
            expect(shownStreetIds()).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
        });

        it('counts down to what is actually left, not to a full page', async () => {
            // 13 rows: the second click has only three to give, and saying "5" would promise rows that don't exist.
            await init(13);

            expect(moreCount()).toBe('5');
            showMoreButton().click();
            expect(moreCount()).toBe('3');
            showMoreButton().click();
            expect(shownStreetIds()).toHaveLength(13);
        });

        it('hides the button once the list is exhausted', async () => {
            await init(8);

            showMoreButton().click();

            expect(showMoreButton().hidden).toBe(true);
            expect(shownStreetIds()).toHaveLength(8);
        });

        it('hands focus to the first revealed row when the button disappears', async () => {
            // Focus would otherwise be stranded on a button that is no longer there.
            await init(8);

            showMoreButton().focus();
            showMoreButton().click();

            expect(document.activeElement).toBe(
                document.querySelector('.ud-reaudit-row[data-street-edge-id="106"] .ud-reaudit-explore')
            );
        });

        it('leaves focus alone while there is still a button to hold it', async () => {
            await init(15);

            showMoreButton().focus();
            showMoreButton().click();

            expect(document.activeElement).toBe(showMoreButton());
        });

        it('logs how many rows the reader actually revealed', async () => {
            await init(8);

            showMoreButton().click();

            expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=ReauditShowMore_shown=3');
        });

        it('does nothing at all when every row already fits', async () => {
            await init(3);

            expect(showMoreButton()).toBeNull();
            expect(shownStreetIds()).toEqual([101, 102, 103]);
        });

        it('collapses the rows it holds back, not just in the DOM', async () => {
            // .ud-reaudit-row sets its own display, which beats the UA stylesheet's [hidden] rule -- so the attribute
            // alone leaves every row on screen while the property still reads true.
            await init(15);

            const [firstShown] = rows();
            const firstHidden = rows()[PAGE_SIZE];
            expect(window.getComputedStyle(firstHidden).display).toBe('none');
            expect(window.getComputedStyle(firstShown).display).not.toBe('none');
        });
    });

    describe('brushing the map', () => {
        it('highlights the hovered row\'s street', async () => {
            await init(3);

            rows()[0].dispatchEvent(new window.MouseEvent('mouseenter'));

            expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'streets', id: 101 }, { hover: true });
        });

        it('clears the previous highlight when the pointer moves to another row', async () => {
            await init(3);

            rows()[0].dispatchEvent(new window.MouseEvent('mouseenter'));
            map.setFeatureState.mockClear();
            rows()[1].dispatchEvent(new window.MouseEvent('mouseenter'));

            expect(map.setFeatureState.mock.calls).toEqual([
                [{ source: 'streets', id: 101 }, { hover: false }],
                [{ source: 'streets', id: 102 }, { hover: true }],
            ]);
        });

        it('clears the highlight when the pointer leaves', async () => {
            await init(3);

            rows()[0].dispatchEvent(new window.MouseEvent('mouseenter'));
            map.setFeatureState.mockClear();
            rows()[0].dispatchEvent(new window.MouseEvent('mouseleave'));

            expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'streets', id: 101 }, { hover: false });
        });

        it('brushes on keyboard focus too, so the list is navigable without a pointer', async () => {
            await init(3);

            rows()[0].dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
            expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'streets', id: 101 }, { hover: true });

            map.setFeatureState.mockClear();
            rows()[0].dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
            expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'streets', id: 101 }, { hover: false });
        });

        it('wires the rows behind "show more" as well, so a revealed row brushes without re-init', async () => {
            await init(15);

            showMoreButton().click();
            rows()[PAGE_SIZE].dispatchEvent(new window.MouseEvent('mouseenter'));

            expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'streets', id: 106 }, { hover: true });
        });

        it('is a no-op while the map is still loading', async () => {
            // The section wires itself immediately; a slow map must not make hovering throw in the meantime.
            let resolveMap;
            await init(3, { mapReady: new Promise((resolve) => { resolveMap = resolve; }) });

            expect(() => rows()[0].dispatchEvent(new window.MouseEvent('mouseenter'))).not.toThrow();
            expect(map.setFeatureState).not.toHaveBeenCalled();

            resolveMap(map);
            await flush();
            rows()[1].dispatchEvent(new window.MouseEvent('mouseenter'));
            expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'streets', id: 102 }, { hover: true });
        });

        it('survives a map that failed to load', async () => {
            await init(3, { mapReady: Promise.resolve(null) });

            expect(() => rows()[0].dispatchEvent(new window.MouseEvent('mouseenter'))).not.toThrow();
        });

        it('survives a map promise that rejected', async () => {
            await init(3, { mapReady: Promise.reject(new Error('map blew up')) });

            expect(() => rows()[0].dispatchEvent(new window.MouseEvent('mouseenter'))).not.toThrow();
        });
    });

    describe('dates', () => {
        it('rewrites the server\'s UTC date into the reader\'s timezone', async () => {
            await init(3);

            expect(document.querySelector('.ud-reaudit-date').textContent)
                .toBe(`local:${new Date('2026-01-02T03:04:05Z').toISOString()}`);
        });

        it('leaves the server\'s rendering alone when the timestamp is unparseable', async () => {
            await init(3, { datetime: 'not-a-date' });

            expect(document.querySelector('.ud-reaudit-date').textContent.trim()).toBe('Jan 2, 2026');
        });
    });

    it('logs a revisit with the street it sends the mapper to', async () => {
        await init(3);

        document.querySelector('.ud-reaudit-explore').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=ReauditRevisit_streetEdgeId=101');
    });
});
