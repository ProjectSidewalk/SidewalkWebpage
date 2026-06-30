/**
 * Smoke tests for public/javascripts/api-docs/aggregate-stats-preview.js.
 *
 * This is the kind of test that would have caught the overall-stats-preview.js regression, where the renderer read
 * `data.validations.total_validations` after the field had moved under `data.validations.combined`, throwing
 * "Cannot read properties of undefined". Here we pin the contract between the snake_case /v3/api/aggregateStats
 * response and the headline cards + per-label-type table.
 *
 * Runs under jsdom (set in jest.config.js via testEnvironment) so `window`/`document` are available.
 */

const { loadGlobalScript } = require('./loadGlobalScript');

const MODULE_PATH = 'public/javascripts/api-docs/aggregate-stats-preview.js';
const CONTAINER_ID = 'aggregate-stats-preview';

// Realistic captured-shape response: flat, snake_case keys per the v3 API naming convention (issue #3871).
const GOOD_FIXTURE = {
    status: 'OK',
    km_explored: 1234,
    km_explored_no_overlap: 1000,
    total_labels: 50000,
    total_validations: 30000,
    total_users: 12345,
    num_cities: 18,
    num_countries: 9,
    num_languages: 7,
    by_label_type: {
        CurbRamp: { labels: 5000, labels_validated: 3000, labels_validated_agree: 2000, labels_validated_disagree: 1000 },
        Obstacle: { labels: 1200, labels_validated: 800, labels_validated_agree: 500, labels_validated_disagree: 300 }
    }
};

// Wrong shape #1: headline totals nested under a sub-object instead of flat — directly analogous to the
// overall-stats-preview.js bug (`validations.total_validations` moving under `validations.combined`).
const WRONG_SHAPE_NESTED = {
    status: 'OK',
    km_explored: 1234,
    total_labels: 50000,
    // total_validations is NOT at the top level anymore — it moved under `validations`.
    validations: { combined: { total_validations: 30000 } },
    num_cities: 18,
    num_countries: 9,
    num_languages: 7,
    by_label_type: {}
};

// Wrong shape #2: camelCase keys (the pre-snake_case-migration shape).
const WRONG_SHAPE_CAMEL = {
    status: 'OK',
    kmExplored: 1234,
    totalLabels: 50000,
    totalValidations: 30000,
    numCities: 18,
    numCountries: 9,
    numLanguages: 7,
    byLabelType: {}
};

/**
 * Install a global `fetch` stub on the jsdom window that resolves to the given JSON body.
 * @param {object} body - The object the stubbed fetch should resolve with as JSON.
 */
function stubFetch(body) {
    global.fetch = jest.fn(() =>
        Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(body)
        })
    );
}

describe('AggregateStatsPreview', () => {
    beforeEach(() => {
        document.body.innerHTML = `<div id="${CONTAINER_ID}"></div>`;
        delete window.AggregateStatsPreview;
        loadGlobalScript(MODULE_PATH);
    });

    afterEach(() => {
        delete global.fetch;
        jest.restoreAllMocks();
    });

    test('exposes the expected global surface', () => {
        expect(window.AggregateStatsPreview).toBeDefined();
        expect(typeof window.AggregateStatsPreview.setup).toBe('function');
        expect(typeof window.AggregateStatsPreview.init).toBe('function');
    });

    test('renders the correct (snake_case) fixture without error', async () => {
        stubFetch(GOOD_FIXTURE);

        await expect(
            window.AggregateStatsPreview.setup({}).init()
        ).resolves.toBeUndefined(); // render() returns nothing on success

        const container = document.getElementById(CONTAINER_ID);
        expect(container.innerHTML).not.toContain('Failed to load');

        // Headline cards show the real numbers (toLocaleString formats 30000 -> "30,000").
        expect(container.textContent).toContain('Cities');
        expect(container.textContent).toContain('18');
        expect(container.textContent).toContain('30,000'); // total_validations
        expect(container.textContent).toContain('50,000'); // total_labels
        expect(container.textContent).toContain('Total Users');
        expect(container.textContent).toContain('12,345'); // total_users

        // Per-label-type table rendered both rows.
        expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
        expect(container.textContent).toContain('CurbRamp');
        expect(container.textContent).toContain('Obstacle');
    });

    test('fetch is called against the expected endpoint, tagged source=apiDocs', async () => {
        stubFetch(GOOD_FIXTURE);
        await window.AggregateStatsPreview.setup({}).init();
        // The preview tags its request with source=apiDocs so the API analytics can attribute doc-page traffic.
        expect(global.fetch).toHaveBeenCalledWith('/v3/api/aggregateStats?source=apiDocs');
    });

    // The renderer is null-safe (every field goes through `fmt()`), so a missing top-level `total_validations` does
    // NOT throw the way the original overall-stats bug did — instead the "Total Validations" card silently shows 0.
    // This test documents/locks that degraded behavior: the promise resolves, there's no error banner, but the real
    // value (30,000) is gone. If a future refactor removes the null-guard, the "renders without error" test above
    // would catch the throw; this one catches the silent data loss.
    test('nested-shape fixture renders 0 for the moved field instead of the real value', async () => {
        stubFetch(WRONG_SHAPE_NESTED);

        await expect(window.AggregateStatsPreview.setup({}).init()).resolves.toBeUndefined();

        const container = document.getElementById(CONTAINER_ID);
        expect(container.innerHTML).not.toContain('Failed to load');
        // total_validations is no longer at the top level, so the card shows the fmt() fallback of 0...
        expect(container.textContent).toContain('Total Validations');
        // ...and crucially the real value is absent.
        expect(container.textContent).not.toContain('30,000');
    });

    test('camelCase-shape fixture loses every headline value (all show 0)', async () => {
        stubFetch(WRONG_SHAPE_CAMEL);

        await expect(window.AggregateStatsPreview.setup({}).init()).resolves.toBeUndefined();

        const container = document.getElementById(CONTAINER_ID);
        expect(container.innerHTML).not.toContain('Failed to load');
        // None of the real numbers survive the snake_case -> camelCase drift.
        expect(container.textContent).not.toContain('30,000');
        expect(container.textContent).not.toContain('50,000');
        expect(container.textContent).not.toContain('18');
    });

    test('shows an error banner when fetch returns a non-OK status', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        );

        await expect(window.AggregateStatsPreview.setup({}).init()).rejects.toThrow();

        const container = document.getElementById(CONTAINER_ID);
        expect(container.innerHTML).toContain('Failed to load');
    });
});
