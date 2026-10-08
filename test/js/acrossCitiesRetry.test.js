/**
 * How /admin/across-cities waits out a cold server (#5432).
 *
 * On a cold JVM the scorecards endpoint answers `503` + `Retry-After` rather than hold the request past the proxy's
 * 60 s timeout, where the page would get a `502` and render no numbers. Pinned here: the page waits as long as the
 * server says, says so in its live pulse line, and renders once the retry lands. The backoff and non-retry statuses
 * are the helper's own contract, in fetchWithRetry.test.js.
 *
 * Timers are faked so a 30 s wait runs in milliseconds. Runs under jsdom.
 */

const { loadModules, realUtil } = require('./loadGlobalScript');

window.util = realUtil();

const MARKUP = `
  <div id="ac-pulse" role="status" aria-live="polite">Loading cities…</div>
  <div id="ac-status" role="status" aria-live="polite"></div>
  <div id="ac-attention"></div>
  <p id="ac-stories-summary">Loading stories…</p>`;

/** A scorecards payload with no cities, so only the load path is at work. */
const PAYLOAD = {
  cities: [], stories: [], summary: {}, over_time_all_time: [], over_time_daily: [], window_by_city: {},
};

/**
 * A minimal `Response` stand-in: status, headers and a JSON body.
 *
 * @param {number} status - HTTP status.
 * @param {object} [options]
 * @param {object} [options.body] - What `json()` resolves to.
 * @param {Record<string, string>} [options.headers] - Response headers.
 * @returns {{ok: boolean, status: number, headers: {get: (name: string) => ?string}, json: () => Promise<object>}}
 */
function response(status, { body = {}, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  };
}

describe('Across Cities — cold-server retry', () => {
  const pulse = () => document.getElementById('ac-pulse').textContent;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = MARKUP;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete global.fetch;
  });

  it('waits out a 503 for exactly its Retry-After, says so, then renders', async () => {
    const { AcrossCitiesPage } = loadModules('frontend/js/admin-dashboard/AcrossCitiesPage.js');
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(503, { headers: { 'Retry-After': '30' } }))
      .mockResolvedValueOnce(response(200, { body: PAYLOAD }));

    const done = new AcrossCitiesPage({ scorecardsUrl: '/adminapi/cityScorecards' }).init();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pulse()).toBe('Still gathering figures from every city; trying again in 30 s…');

    await jest.advanceTimersByTimeAsync(29_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    await done;

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(pulse()).toBe('Comparing 0 cities.');
    expect(document.getElementById('ac-status').textContent).not.toContain('Could not load');
  });
});
