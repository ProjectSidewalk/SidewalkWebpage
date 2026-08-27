/**
 * Tests for the Traffic section on /admin/across-cities (Planning#8).
 *
 * The section joins GA-derived traffic onto the scorecard rows from its own endpoint, after the main render. The
 * contracts worth pinning: rows come only from cities with traffic data (sessions-first by default, re-sortable),
 * week-over-week chips read the traffic windows and color by direction, anomaly flags mark the row and feed the
 * "needs attention" panel with a baseline-relative reason, and every unavailability path — `available: false` or a
 * failed request — collapses the section to a note without disturbing the already-rendered page.
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

/** A minimal scorecard row; the traffic section only reads identity/lifecycle from it. */
function makeCity(id) {
  return { city_id: id, city_name: id, lifecycle: 'active', anomalies: [], weekly_trend: [] };
}

/**
 * Builds one traffic_by_city entry.
 *
 * @param {object} [overrides] - Fields to override on the defaults.
 * @returns {object} The endpoint-shaped traffic entry.
 */
function makeTraffic(overrides = {}) {
  return {
    sessions_7d: 100,
    sessions_prior_7d: 100,
    active_users_7d: 80,
    active_users_prior_7d: 80,
    engaged_sessions_7d: 40,
    engagement_rate_7d: 0.4,
    mobile_share_28d: 0.05,
    weekly_sessions: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    baseline_median: 100,
    sessions_all_time: 32494,
    visitors_all_time: 17690,
    mobile_share_all_time: 0.116,
    ga_since: '2021-10-27',
    anomaly: null,
    ...overrides,
  };
}

const MARKUP = `
  <div id="ac-attention"></div>
  <div id="ac-traffic-wrap">
    <table id="ac-traffic-table">
      <thead>
        <tr>
          <th data-sort="city_name">City</th>
          <th data-sort="traffic.sessions_7d">Sessions 7d</th>
          <th data-sort="traffic.active_users_7d">Visitors 7d</th>
          <th data-sort="traffic.engagement_rate_7d">Engagement</th>
          <th data-sort="traffic.mobile_share_28d">Mobile share</th>
          <th data-sort="traffic.sessions_all_time">Sessions</th>
          <th data-sort="traffic.visitors_all_time">Visitors</th>
          <th data-sort="traffic.mobile_share_all_time">Mobile share</th>
          <th>Trend</th>
        </tr>
      </thead>
      <tbody id="ac-traffic-tbody"></tbody>
    </table>
  </div>
  <div id="ac-traffic-status"></div>`;

describe('Across Cities — traffic section', () => {
  let AcrossCitiesPage;

  /**
   * Renders the page against fixtures and returns the initialized instance.
   *
   * @param {Array} cities - Scorecard rows from makeCity().
   * @param {object|Error} traffic - The /adminapi/cityTraffic response body, or an Error to reject the request with.
   * @returns {Promise<object>} The initialized AcrossCitiesPage.
   */
  async function render(cities, traffic) {
    document.body.innerHTML = MARKUP;
    global.fetch = jest.fn((url) => {
      if (url === '/adminapi/cityScorecards') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            cities, summary: {}, over_time_all_time: [], over_time_daily: [], window_summary: null, window_by_city: {},
          }),
        });
      }
      if (url === '/adminapi/cityTraffic') {
        if (traffic instanceof Error) return Promise.reject(traffic);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(traffic) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    const page = new AcrossCitiesPage({ scorecardsUrl: '/adminapi/cityScorecards', trafficUrl: '/adminapi/cityTraffic' });
    await page.init();
    return page;
  }

  /** City names in the traffic table, in display order. */
  function trafficCityOrder() {
    return [...document.querySelectorAll('#ac-traffic-tbody tr')].map((tr) => tr.cells[0].textContent.trim());
  }

  beforeEach(() => {
    AcrossCitiesPage = loadPage();
  });

  it('rows only cities with traffic data, busiest sessions first', async () => {
    await render([makeCity('alpha'), makeCity('bravo'), makeCity('charlie')], {
      available: true,
      traffic_by_city: {
        alpha: makeTraffic({ sessions_7d: 50 }),
        charlie: makeTraffic({ sessions_7d: 500 }),
      },
    });
    expect(trafficCityOrder()).toEqual(['charlie', 'alpha']);
    expect(document.getElementById('ac-traffic-status').textContent).toBe('2 of 3 cities with traffic data.');
  });

  it('reads counts from the traffic windows and colors the week-over-week chip by direction', async () => {
    await render([makeCity('alpha')], {
      available: true,
      traffic_by_city: { alpha: makeTraffic({ sessions_7d: 200, sessions_prior_7d: 100, active_users_7d: 30, active_users_prior_7d: 60 }) },
    });
    const row = document.querySelector('#ac-traffic-tbody tr');
    expect(row.cells[1].textContent).toContain('200');
    expect(row.cells[1].querySelector('.ac-cell-delta--up')).not.toBeNull();
    expect(row.cells[2].textContent).toContain('30');
    expect(row.cells[2].querySelector('.ac-cell-delta--down')).not.toBeNull();
    expect(row.cells[3].textContent).toContain('40%');
    expect(row.cells[4].textContent).toContain('5%');
  });

  it('re-ranks when a header is clicked', async () => {
    await render([makeCity('alpha'), makeCity('bravo')], {
      available: true,
      traffic_by_city: {
        alpha: makeTraffic({ sessions_7d: 500, mobile_share_28d: 0.02 }),
        bravo: makeTraffic({ sessions_7d: 50, mobile_share_28d: 0.4 }),
      },
    });
    expect(trafficCityOrder()).toEqual(['alpha', 'bravo']);
    document.querySelector('#ac-traffic-table thead th[data-sort="traffic.mobile_share_28d"]').click();
    expect(trafficCityOrder()).toEqual(['bravo', 'alpha']);
  });

  it('flags an anomalous row and feeds the needs-attention panel with a baseline-relative reason', async () => {
    await render([makeCity('alpha')], {
      available: true,
      traffic_by_city: {
        alpha: makeTraffic({
          sessions_7d: 30,
          anomaly: 'traffic_drop',
          baseline_median: 90,
          weekly_sessions: [90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 28],
        }),
      },
    });
    const row = document.querySelector('#ac-traffic-tbody tr');
    expect(row.classList.contains('ac-row--flagged')).toBe(true);
    expect(row.cells[0].textContent).toContain('Traffic drop');
    const attention = document.getElementById('ac-attention').textContent;
    expect(attention).toContain('alpha');
    // The row's own sessions figure and the server's baseline — never the newest bucket (28 here).
    expect(attention).toContain('30 sessions in the last 7 days, down from a typical 90');
    expect(attention).not.toContain('28');
  });

  it('keeps the loading note when a header is clicked before the traffic fetch lands', async () => {
    document.body.innerHTML = MARKUP;
    let releaseTraffic;
    global.fetch = jest.fn((url) => {
      if (url === '/adminapi/cityScorecards') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            cities: [makeCity('alpha')], summary: {}, over_time_all_time: [], over_time_daily: [],
            window_summary: null, window_by_city: {},
          }),
        });
      }
      return new Promise((resolve) => { releaseTraffic = resolve; });
    });
    const page = new AcrossCitiesPage({
      scorecardsUrl: '/adminapi/cityScorecards', trafficUrl: '/adminapi/cityTraffic',
    });
    const initing = page.init();
    // init finishes the scorecards fetch and main render first, so wait for the request rather than count microtasks.
    while (!releaseTraffic) await new Promise((resolve) => { setTimeout(resolve, 0); });
    document.querySelector('#ac-traffic-table th[data-sort="traffic.sessions_7d"]').click();
    expect(document.getElementById('ac-traffic-status').textContent).toBe('Loading traffic…');
    expect(document.querySelectorAll('#ac-traffic-tbody tr')).toHaveLength(0);

    releaseTraffic({
      ok: true,
      json: () => Promise.resolve({ available: true, traffic_by_city: { alpha: makeTraffic() } }),
    });
    await initing;
    expect(trafficCityOrder()).toEqual(['alpha']);
  });

  it('shows all-time totals and dates their window from the property, not the city launch', async () => {
    await render([makeCity('alpha')], {
      available: true,
      traffic_by_city: { alpha: makeTraffic() },
    });
    const cells = document.querySelector('#ac-traffic-tbody tr').cells;
    expect(cells[5].textContent.trim()).toBe('32,494');
    expect(cells[6].textContent.trim()).toBe('17,690');
    expect(cells[7].textContent.trim()).toBe('12%');
    // The window isn't the city's lifetime, so the cell has to date itself.
    expect(cells[5].getAttribute('title')).toContain('2021');
    expect(cells[5].getAttribute('title')).toContain("earlier traffic isn't included");
  });

  it('sorts by an all-time column independently of the recent ones', async () => {
    await render([makeCity('alpha'), makeCity('bravo')], {
      available: true,
      traffic_by_city: {
        // bravo leads on the last 7 days but trails over all time, so the two orderings must differ.
        alpha: makeTraffic({ sessions_7d: 10, sessions_all_time: 90000 }),
        bravo: makeTraffic({ sessions_7d: 900, sessions_all_time: 10 }),
      },
    });
    expect(trafficCityOrder()).toEqual(['bravo', 'alpha']);
    document.querySelector('#ac-traffic-table th[data-sort="traffic.sessions_all_time"]').click();
    expect(trafficCityOrder()).toEqual(['alpha', 'bravo']);
  });

  it('falls back to a generic all-time tooltip when the property start date is missing', async () => {
    await render([makeCity('alpha')], {
      available: true,
      traffic_by_city: { alpha: makeTraffic({ ga_since: null }) },
    });
    const title = document.querySelector('#ac-traffic-tbody tr').cells[5].getAttribute('title');
    expect(title).toBe("Covers this property's whole GA4 history.");
  });

  it('says so when the server reached some cities but not others', async () => {
    await render([makeCity('alpha'), makeCity('bravo')], {
      available: true,
      traffic_by_city: { alpha: makeTraffic() },
      failed_city_ids: ['bravo'],
    });
    const status = document.getElementById('ac-traffic-status').textContent;
    expect(status).toContain('1 of 2 cities with traffic data.');
    expect(status).toContain('1 could not be fetched this round.');
  });

  it('collapses to an unavailable note when the deployment has no GA configured', async () => {
    await render([makeCity('alpha')], { available: false });
    expect(document.getElementById('ac-traffic-wrap').style.display).toBe('none');
    expect(document.getElementById('ac-traffic-status').textContent).toBe('Traffic data unavailable.');
  });

  it('collapses the same way when the traffic request fails, leaving the page intact', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await render([makeCity('alpha')], new Error('boom'));
    expect(document.getElementById('ac-traffic-wrap').style.display).toBe('none');
    expect(document.getElementById('ac-traffic-status').textContent).toBe('Traffic data unavailable.');
    console.error.mockRestore();
  });
});
