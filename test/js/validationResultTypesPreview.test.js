/**
 * Smoke tests for frontend/js/api-docs/validationResultTypesPreview.js.
 *
 * This is part of the first frontend test layer for Project Sidewalk. The module under test is a dependency-light
 * IIFE that fetches the /v3/api/validationResultTypes endpoint and renders a small table into a container div. These
 * tests pin the *contract* between the snake_case API response and the renderer so that a field-name drift (the kind
 * that broke overallStatsPreview.js when `total_validations` moved under `validations.combined`) fails loudly here
 * instead of silently in the browser.
 */

import { loadModules, mockModule, unmockModule } from './loader.js';

const MODULE_PATH = 'frontend/js/api-docs/validationResultTypesPreview.js';
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

/** @param {object} body - What the page's `fetch` resolves with, as JSON. */
function stubFetch(body) {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body)
    })
  ));
}

describe('ValidationResultTypesPreview', () => {
  let ValidationResultTypesPreview;

  beforeEach(async () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}"></div>`;
    // A fresh copy of the module, so one test's setup() can't leak into the next.
    ({ ValidationResultTypesPreview } = await loadModules(MODULE_PATH));
  });

  test('exposes the expected surface', () => {
    expect(ValidationResultTypesPreview).toBeDefined();
    expect(typeof ValidationResultTypesPreview.setup).toBe('function');
    expect(typeof ValidationResultTypesPreview.init).toBe('function');
  });

  test('renders the correct (snake_case) fixture without error', async () => {
    stubFetch(GOOD_FIXTURE);

    await expect(
      ValidationResultTypesPreview.setup({}).init()
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

  test('puts the result-types table inside the shared scroll region', async () => {
    stubFetch(GOOD_FIXTURE);

    await ValidationResultTypesPreview.setup({}).init();

    // The narrow-viewport scroller (#4883) is styled as `.ps-table-wrapper > table`, so the table has to be a
    // direct child; the region needs a focus stop with a role and a name so its off-screen columns are reachable
    // and announced without a pointer (WCAG 2.1.1).
    const container = document.getElementById(CONTAINER_ID);
    expect(container.querySelector('.ps-table-wrapper[role="region"] > table')).not.toBeNull();
    const wrapper = container.querySelector('.ps-table-wrapper');
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    expect(wrapper.getAttribute('aria-label')).toBe('Validation result types');
  });

  // A render-time throw has to land in the banner: init() is fire-and-forget at every call site, so an escaping
  // rejection would leave "Loading..." on screen with nothing to explain it.
  test('a render-time throw reaches the error banner instead of escaping init()', async () => {
    stubFetch(GOOD_FIXTURE);
    mockModule('frontend/js/api-docs/apiTableWrapper.js', () => ({
      createApiTableWrapper: () => { throw new Error('render failed'); },
    }));
    ({ ValidationResultTypesPreview } = await loadModules(MODULE_PATH));
    unmockModule('frontend/js/api-docs/apiTableWrapper.js');

    await expect(ValidationResultTypesPreview.setup({}).init()).resolves.toBeUndefined();

    const container = document.getElementById(CONTAINER_ID);
    expect(container.innerHTML).toContain('Failed to load');
  });

  test('fetch is called against the expected endpoint, tagged utm_source=apiDocs', async () => {
    stubFetch(GOOD_FIXTURE);
    await ValidationResultTypesPreview.setup({}).init();
    // The preview tags its request with utm_source=apiDocs so the API analytics can attribute doc-page traffic.
    expect(window.fetch).toHaveBeenCalledWith('/v3/api/validationResultTypes?utm_source=apiDocs');
  });

  // Documents the drift-detection value of this layer: the wrong (camelCase) shape does not throw — the module is
  // null-safe — but it silently renders an EMPTY table. That empty-table assertion is the signal a future shape
  // change would trip. If a maintainer renames the snake_case fields, the "good" test above goes red; if the API
  // starts returning camelCase, this test documents the (degraded) behavior the user would actually see.
  test('wrong-shape (camelCase) fixture renders an empty table, not the expected rows', async () => {
    stubFetch(WRONG_SHAPE_FIXTURE);

    await ValidationResultTypesPreview.setup({}).init();

    const container = document.getElementById(CONTAINER_ID);
    // It does not crash (module guards with `|| []`), so no error banner either.
    expect(container.innerHTML).not.toContain('Failed to load');
    // But because `validation_result_types` is absent, zero rows render — the drift signal.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  test('colors each result as Validate does, scaling its bar to the most common result', async () => {
    document.documentElement.style.setProperty('--color-pine-500', '#00ff00');
    document.documentElement.style.setProperty('--color-neutral-500', '#808080');
    stubFetch({ validation_result_types: [
      { name: 'Unsure', count: 25, count_human: 25 },
      { name: 'Agree', count: 100, count_human: 90, count_ai: 10 },
      { name: 'Skipped', count: 50, count_human: 50, count_ai: 0 },
    ] });
    await ValidationResultTypesPreview.setup({}).init();
    const rows = [...document.querySelectorAll('tbody tr')];
    expect(rows.map((tr) => [...tr.cells].map((td) => td.textContent))).toEqual([
      ['Agree', '100', '90', '10'],
      ['Skipped', '50', '50', '0'],
      ['Unsure', '25', '25', '0'],
    ]);
    expect(rows.map((tr) => tr.querySelector('.count-bar-fill').style.width)).toEqual(['100%', '50%', '25%']);
    expect(rows[0].querySelector('.api-swatch').style.backgroundColor).toBe('rgb(0, 255, 0)');
    // A result Validate has no color for is drawn in neutral gray.
    expect(rows[1].querySelector('.api-swatch').style.backgroundColor).toBe('rgb(128, 128, 128)');
  });

  test('draws empty bars when no result has any validations', async () => {
    stubFetch({ validation_result_types: [{ name: 'Agree', count: 0, count_human: 0, count_ai: 0 }] });
    await ValidationResultTypesPreview.setup({}).init();
    expect(document.querySelector('.count-bar-fill').style.width).toBe('0%');
  });

  test('says the request failed, with its status', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })));
    await ValidationResultTypesPreview.setup({}).init();
    const container = document.getElementById(CONTAINER_ID);
    expect(container.textContent).toBe('Failed to load validation result types: HTTP error! Status: 503');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  test('caps the width of the preview, or leaves it alone when told to', async () => {
    stubFetch(GOOD_FIXTURE);
    await ValidationResultTypesPreview.setup({ maxWidth: 600 }).init();
    expect(document.getElementById(CONTAINER_ID).style.maxWidth).toBe('600px');

    document.body.innerHTML = `<div id="${CONTAINER_ID}"></div>`;
    await ValidationResultTypesPreview.setup({ maxWidth: 0 }).init();
    expect(document.getElementById(CONTAINER_ID).style.maxWidth).toBe('');
  });

  test('rejects, fetching nothing, when the page lacks its container', async () => {
    document.body.innerHTML = '';
    stubFetch(GOOD_FIXTURE);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(ValidationResultTypesPreview.init()).rejects.toThrow('Container element not found');
    expect(window.fetch).not.toHaveBeenCalled();
  });
});
