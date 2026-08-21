/**
 * Tests for the "Most active cities" table on /admin/across-cities (#4758).
 *
 * The table ranks deployments by rolling-7-day activity and re-ranks on whichever numeric column is sorted, so the
 * contract worth pinning is the ranking itself: top-N by the sorted column (not a fixed five reordered), a name sort
 * ordering the busiest five rather than re-ranking, zero-activity cities excluded, counts read from the per-city
 * rolling windows (as are the cities-active / top-city tiles above the table), and week-over-week deltas colored by
 * direction. The same generalized sort machinery now drives the Activity table, so its headers are covered here too.
 *
 * Runs under jsdom (jest.config.js). AcrossCitiesPage is a bare top-level class in a concatenated bundle, so it is
 * eval'd into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard');

/** Load AcrossCitiesPage.js, plus the AdminShell helpers every dashboard page reads, and return the class binding. */
function loadPage() {
  const shell = fs.readFileSync(path.join(JS_DIR, 'AdminShell.js'), 'utf8');
  const src = fs.readFileSync(path.join(JS_DIR, 'AcrossCitiesPage.js'), 'utf8');
  return (0, eval)(`${shell}\nglobalThis.AdminShell = AdminShell;\n${src}\nAcrossCitiesPage;`);
}

/**
 * Builds one scorecard row plus its rolling window.
 *
 * @param {string} id - City id, also used as the display name.
 * @param {object} w - Window counts: labels/labelsPrior/validations/validationsPrior/contributors/contributorsPrior.
 * @returns {{city: object, window: object}} The scorecard row and the window_by_city entry for that city.
 */
function makeCity(id, w) {
  return {
    city: {
      city_id: id,
      city_name: id,
      lifecycle: 'active',
      // The scorecard's own 7d fields deliberately differ from the window's, so a test failure tells us which source
      // a cell actually read.
      labels_7d: 999,
      labels_30d: 999,
      validations_7d: 999,
      validations_30d: 999,
      audits_7d: 7,
      audits_30d: 30,
      days_since_activity: 1,
      last_activity: '2026-08-03T00:00:00Z',
      weekly_trend: [{ week_start: '2026-07-27', labels: 3 }],
    },
    window: {
      labels_7d: w.labels,
      labels_prior_7d: w.labelsPrior,
      validations_7d: w.validations,
      validations_prior_7d: w.validationsPrior,
      contributors_7d: w.contributors,
      contributors_prior_7d: w.contributorsPrior,
    },
  };
}

// activity = labels + validations. foxtrot ranks 6th on activity but 2nd on contributors, so a contributor sort must
// pull it into the table — the difference between re-ranking and merely reordering a fixed five.
const FIXTURE = [
  makeCity('alpha', { labels: 100, labelsPrior: 50, validations: 20, validationsPrior: 20, contributors: 5, contributorsPrior: 4 }),
  makeCity('bravo', { labels: 10, labelsPrior: 40, validations: 200, validationsPrior: 100, contributors: 3, contributorsPrior: 3 }),
  makeCity('charlie', { labels: 50, labelsPrior: 50, validations: 50, validationsPrior: 10, contributors: 20, contributorsPrior: 2 }),
  makeCity('delta', { labels: 30, labelsPrior: 10, validations: 30, validationsPrior: 10, contributors: 2, contributorsPrior: 1 }),
  makeCity('echo', { labels: 20, labelsPrior: 10, validations: 20, validationsPrior: 10, contributors: 1, contributorsPrior: 0 }),
  makeCity('foxtrot', { labels: 5, labelsPrior: 1, validations: 5, validationsPrior: 1, contributors: 7, contributorsPrior: 1 }),
  makeCity('ghost', { labels: 0, labelsPrior: 0, validations: 0, validationsPrior: 0, contributors: 0, contributorsPrior: 0 }),
];

const MARKUP = `
  <span id="now-cities-active">—</span>
  <span id="now-top-city">—</span>
  <span id="now-top-city-count"></span>
  <table id="ac-top-table">
    <thead>
      <tr>
        <th data-sort="city_name">City</th>
        <th data-sort="activity_7d">Activity</th>
        <th data-sort="activity_window.labels_7d">Labels</th>
        <th data-sort="activity_window.validations_7d">Validations</th>
        <th data-sort="activity_window.contributors_7d">Contributors</th>
        <th data-sort="audits_7d">Streets</th>
        <th>Trend</th>
      </tr>
    </thead>
    <tbody id="ac-top-tbody"></tbody>
  </table>
  <div id="ac-top-status"></div>
  <table id="ac-activity-table">
    <thead>
      <tr>
        <th data-sort="city_name">City</th>
        <th data-sort="labels_7d">Labels</th>
        <th data-sort="validations_7d">Validations</th>
        <th data-sort="audits_7d">Streets</th>
        <th data-sort="days_since_activity">Last activity</th>
        <th>Trend</th>
      </tr>
    </thead>
    <tbody id="ac-activity-tbody"></tbody>
  </table>`;

describe('Across Cities — most active cities', () => {
  let AcrossCitiesPage;

  /**
   * Renders the page against a fixture and returns the initialized instance.
   *
   * @param {Array} [cities] - Entries from makeCity(); defaults to the full fixture.
   * @returns {Promise<object>} The initialized AcrossCitiesPage.
   */
  async function render(cities = FIXTURE) {
    document.body.innerHTML = MARKUP;
    const windowByCity = {};
    cities.forEach((c) => { windowByCity[c.city.city_id] = c.window; });
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        cities: cities.map((c) => c.city),
        summary: {},
        over_time_all_time: [],
        over_time_daily: [],
        window_summary: null,
        window_by_city: windowByCity,
      }),
    }));
    const page = new AcrossCitiesPage({ scorecardsUrl: '/adminapi/cityScorecards' });
    await page.init();
    return page;
  }

  /** City names in the top table, in display order. */
  function topCityOrder() {
    return [...document.querySelectorAll('#ac-top-tbody tr')].map((tr) => tr.cells[0].textContent.trim());
  }

  /** Clicks a header by its data-sort key in the given table. */
  function clickHeader(tableId, key) {
    document.querySelector(`#${tableId} thead th[data-sort="${key}"]`).click();
  }

  beforeEach(() => {
    AcrossCitiesPage = loadPage();
  });

  it('ranks by labels + validations and shows only the top five', async () => {
    await render();
    expect(topCityOrder()).toEqual(['bravo', 'alpha', 'charlie', 'delta', 'echo']);
  });

  it('leaves out cities with no activity in either window', async () => {
    await render();
    expect(topCityOrder()).not.toContain('ghost');
  });

  it('re-ranks the top five on the sorted column rather than reordering a fixed set', async () => {
    await render();
    clickHeader('ac-top-table', 'activity_window.contributors_7d');
    expect(topCityOrder()).toEqual(['charlie', 'foxtrot', 'alpha', 'bravo', 'delta']);
  });

  it('flips direction when the active column is clicked again', async () => {
    await render();
    clickHeader('ac-top-table', 'activity_window.contributors_7d');
    clickHeader('ac-top-table', 'activity_window.contributors_7d');
    // Ascending by contributors: the five quietest, least first.
    expect(topCityOrder()).toEqual(['echo', 'delta', 'bravo', 'alpha', 'foxtrot']);
  });

  it('keeps the busiest five when sorting by City, ordered by name', async () => {
    await render();
    clickHeader('ac-top-table', 'city_name');
    expect(topCityOrder()).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo']);
    clickHeader('ac-top-table', 'city_name');
    // Z→A over the same busiest five — foxtrot (6th by activity) must not appear just because it sorts late.
    expect(topCityOrder()).toEqual(['echo', 'delta', 'charlie', 'bravo', 'alpha']);
  });

  it('reads counts from the rolling windows, not the scorecard 7d fields', async () => {
    await render();
    const alpha = [...document.querySelectorAll('#ac-top-tbody tr')].find((tr) => tr.cells[0].textContent.trim() === 'alpha');
    expect(alpha.cells[1].textContent).toContain('120'); // 100 labels + 20 validations
    expect(alpha.cells[2].textContent).toContain('100');
    expect(alpha.cells[2].textContent).not.toContain('999');
  });

  it('derives the cities-active and top-city tiles from the rolling windows', async () => {
    await render();
    // ghost carries (sentinel) scorecard activity but an empty window, so it must not count as active.
    expect(document.getElementById('now-cities-active').textContent).toBe('6 of 7');
    expect(document.getElementById('now-top-city').textContent).toBe('alpha');
    // Window labels, not the scorecard's 999 sentinel — the tile and the table row must show the same number.
    expect(document.getElementById('now-top-city-count').textContent).toBe('100 labels');
  });

  it('colors each delta by direction and omits it where both windows are empty', async () => {
    await render();
    const rows = [...document.querySelectorAll('#ac-top-tbody tr')];
    const cell = (name, i) => rows.find((tr) => tr.cells[0].textContent.trim() === name).cells[i];
    expect(cell('alpha', 2).querySelector('.ac-cell-delta--up')).not.toBeNull();   // 100 vs 50
    expect(cell('bravo', 2).querySelector('.ac-cell-delta--down')).not.toBeNull(); // 10 vs 40
    expect(cell('charlie', 2).querySelector('.ac-cell-delta--flat')).not.toBeNull(); // 50 vs 50
    // Contributors unchanged week over week reads flat, not blank; a truly empty pair is what suppresses the chip.
    expect(cell('bravo', 4).querySelector('.ac-cell-delta--flat')).not.toBeNull();
  });

  it('marks a count that appeared from zero as new rather than a percentage', async () => {
    await render();
    const echo = [...document.querySelectorAll('#ac-top-tbody tr')].find((tr) => tr.cells[0].textContent.trim() === 'echo');
    const chip = echo.cells[4].querySelector('.ac-cell-delta--up');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('new');
  });

  it('marks the sorted column for assistive tech', async () => {
    await render();
    const active = document.querySelector('#ac-top-table thead th[data-sort="activity_7d"]');
    expect(active.getAttribute('aria-sort')).toBe('descending');
    clickHeader('ac-top-table', 'city_name');
    expect(active.hasAttribute('aria-sort')).toBe(false);
    expect(document.querySelector('#ac-top-table thead th[data-sort="city_name"]').getAttribute('aria-sort'))
      .toBe('ascending');
  });

  it('sorts on Enter and Space so the headers are keyboard-operable', async () => {
    await render();
    const th = document.querySelector('#ac-top-table thead th[data-sort="activity_window.contributors_7d"]');
    expect(th.getAttribute('tabindex')).toBe('0');
    th.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(topCityOrder()[0]).toBe('charlie');
    // Space flips the same column, as a native button would.
    th.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(topCityOrder()[0]).toBe('echo');
  });

  it('reports how many cities were active when the table is truncated', async () => {
    await render();
    expect(document.getElementById('ac-top-status').textContent).toBe('Top 5 of 6 cities active in the past 7 days.');
  });

  it('shows an empty state when no city was active', async () => {
    await render([FIXTURE[FIXTURE.length - 1]]);
    expect(document.querySelector('#ac-top-tbody').textContent).toMatch(/No city recorded activity/);
  });

  it('sorts the full Activity table from its own independent state', async () => {
    await render();
    const order = () => [...document.querySelectorAll('#ac-activity-tbody tr')].map((tr) => tr.cells[0].textContent.trim());
    // Every fixture city shares days_since_activity, so the default sort is stable input order.
    expect(order()[0]).toBe('alpha');
    clickHeader('ac-activity-table', 'city_name');
    expect(order()).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'ghost']);
    clickHeader('ac-activity-table', 'city_name');
    expect(order()[0]).toBe('ghost');
    // The top table keeps its own sort while the Activity table moves.
    expect(topCityOrder()).toEqual(['bravo', 'alpha', 'charlie', 'delta', 'echo']);
  });
});
