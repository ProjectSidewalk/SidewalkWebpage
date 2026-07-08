/**
 * Smoke tests for public/js/api-docs/validation-result-types-preview.js.
 *
 * This is part of the first frontend test layer for Project Sidewalk. The module under test is a dependency-light
 * IIFE that fetches the /v3/api/validationResultTypes endpoint and renders a small table into a container div. These
 * tests pin the *contract* between the snake_case API response and the renderer so that a field-name drift (the kind
 * that broke overall-stats-preview.js when `total_validations` moved under `validations.combined`) fails loudly here
 * instead of silently in the browser.
 *
 * Runs under jsdom (set in jest.config.js via testEnvironment) so `window`/`document` are available.
 */

const { loadGlobalScript } = require('./loadGlobalScript');

const MODULE_PATH = 'public/js/api-docs/validation-result-types-preview.js';
const CONTAINER_ID = 'validation-result-types-preview';

// A realistic, captured-shape API response: snake_case keys, per the v3 API naming convention (issue #3871).
const GOOD_FIXTURE = {
    status: 'OK',
    validation_result_types: [
        { name: 'Agree', count: 100, count_human: 90, count_ai: 10 },
        { name: 'Disagree', count: 40, count_human: 35, count_ai: 5 },
        { name: 'Unsure', count: 12, count_human: 12, count_ai: 0 }
    ]
};

// The pre-migration / wrong shape: camelCase keys and a camelCase top-level array name. The renderer expects
// snake_case, so this should produce no rows (drift the test is designed to surface).
const WRONG_SHAPE_FIXTURE = {
    status: 'OK',
    validationResultTypes: [
        { name: 'Agree', count: 100, countHuman: 90, countAi: 10 }
    ]
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

describe('ValidationResultTypesPreview', () => {
    beforeEach(() => {
        // Fresh container per test.
        document.body.innerHTML = `<div id="${CONTAINER_ID}"></div>`;
        // The module assigns window.ValidationResultTypesPreview as a singleton; load a clean copy each time so that
        // config mutations from setup() in one test don't bleed into the next.
        delete window.ValidationResultTypesPreview;
        loadGlobalScript(MODULE_PATH);
    });

    afterEach(() => {
        delete global.fetch;
        jest.restoreAllMocks();
    });

    test('exposes the expected global surface', () => {
        expect(window.ValidationResultTypesPreview).toBeDefined();
        expect(typeof window.ValidationResultTypesPreview.setup).toBe('function');
        expect(typeof window.ValidationResultTypesPreview.init).toBe('function');
    });

    test('renders the correct (snake_case) fixture without error', async () => {
        stubFetch(GOOD_FIXTURE);

        await expect(
            window.ValidationResultTypesPreview.setup({}).init()
        ).resolves.toBeDefined();

        const container = document.getElementById(CONTAINER_ID);
        // No error banner.
        expect(container.innerHTML).not.toContain('Failed to load');
        // Expected content rendered: a row per result type, with the counts.
        expect(container.textContent).toContain('Agree');
        expect(container.textContent).toContain('Disagree');
        expect(container.textContent).toContain('Unsure');
        expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
        // The human/AI columns came through (snake_case count_human / count_ai), formatted with toLocaleString.
        expect(container.textContent).toContain('90');
        expect(container.textContent).toContain('10');
    });

    test('fetch is called against the expected endpoint, tagged source=apiDocs', async () => {
        stubFetch(GOOD_FIXTURE);
        await window.ValidationResultTypesPreview.setup({}).init();
        // The preview tags its request with source=apiDocs so the API analytics can attribute doc-page traffic.
        expect(global.fetch).toHaveBeenCalledWith('/v3/api/validationResultTypes?source=apiDocs');
    });

    // Documents the drift-detection value of this layer: the wrong (camelCase) shape does not throw — the module is
    // null-safe — but it silently renders an EMPTY table. That empty-table assertion is the signal a future shape
    // change would trip. If a maintainer renames the snake_case fields, the "good" test above goes red; if the API
    // starts returning camelCase, this test documents the (degraded) behavior the user would actually see.
    test('wrong-shape (camelCase) fixture renders an empty table, not the expected rows', async () => {
        stubFetch(WRONG_SHAPE_FIXTURE);

        await window.ValidationResultTypesPreview.setup({}).init();

        const container = document.getElementById(CONTAINER_ID);
        // It does not crash (module guards with `|| []`), so no error banner either.
        expect(container.innerHTML).not.toContain('Failed to load');
        // But because `validation_result_types` is absent, zero rows render — the drift signal.
        expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    });
});
