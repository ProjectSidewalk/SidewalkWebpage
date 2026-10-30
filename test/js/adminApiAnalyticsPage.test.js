/** Tests for the admin API Analytics page: KPIs, the usage trend, the ranked bars and the range switch (#5840). */

import { loadModules, mockModule } from './loader.js';
import { routeFetch, flush, textOf } from './support/routeFetch.js';

// The chart's drawing has its own suite; here it's what the page hands it that matters.
const MiniLineChart = { renderInto: vi.fn() };
mockModule('frontend/js/admin-dashboard/MiniLineChart.js', () => ({ MiniLineChart }));

const { ApiAnalyticsPage } = await loadModules('frontend/js/admin-dashboard/ApiAnalyticsPage.js');

const DATA_URL = '/adminapi/apiAnalyticsBySource';

const docsToggle = (chart) => `
  <div class="api-docs-control">
    <span class="api-range-caption" id="api-${chart}-range"></span>
    <label class="api-toggle" for="api-toggle-${chart}">
      <input type="checkbox" role="switch" id="api-toggle-${chart}" class="api-docs-toggle" data-chart="${chart}">
    </label>
    <span class="api-docs-legend ps-hidden" aria-hidden="true"></span>
  </div>
  <div class="dq-rows" id="api-${chart}"></div>`;

const MARKUP = `
  <div class="coverage-toggle" role="group" aria-label="Time range">
    <button type="button" class="api-range-btn is-active" data-days="30" aria-pressed="true">30 days</button>
    <button type="button" class="api-range-btn" data-days="90" aria-pressed="false">90 days</button>
    <button type="button" class="api-range-btn" data-days="0" aria-pressed="false">All time</button>
  </div>
  <span id="kpi-external-calls">—</span><span id="kpi-external-calls-note"></span>
  <span id="kpi-external-clients">—</span>
  <span id="kpi-busiest">—</span><span id="kpi-busiest-note"></span>
  <span id="kpi-pct-external">—</span><span id="kpi-pct-external-note"></span>
  <div class="coverage-status" id="api-status" role="status" aria-live="polite">Loading API analytics…</div>
  <div id="api-trend-range"></div>
  <div id="api-trend" class="dq-trend"></div>
  ${docsToggle('endpoints')}
  ${docsToggle('formats')}`;

/** A payload shaped like getApiAnalyticsBySource's, busy unless overridden. */
function payload(overrides = {}) {
  return {
    days: 30,
    total_calls: 1500,
    total_unique_ips: 12,
    last_api_call: '2026-06-25',
    sources: { external: { calls: 1200, unique_ips: 10 }, api_docs: { calls: 300, unique_ips: 2 } },
    endpoints: [
      { endpoint: '/v3/api/labelClusters', external: 1000, api_docs: 100 },
      { endpoint: '/v3/api/streets', external: 200, api_docs: 150 },
      { endpoint: '/v3/api/regions', external: 0, api_docs: 50 },
      { endpoint: '/v3/api/neverUsed', external: 0, api_docs: 0 },
    ],
    daily: [
      { date: '2026-06-01', external: 700, api_docs: 100 },
      { date: '2026-06-20', external: 500, api_docs: 200 },
    ],
    formats: [
      { format: 'geojson', external: 900, api_docs: 300 },
      { format: '<csv>', external: 300, api_docs: 0 },
    ],
    ...overrides,
  };
}

/**
 * Builds the view and starts the page.
 * @param {Record<number, any> | any} answers - Reply per `days` value, or one reply for every range.
 * @returns {Promise<import('vitest').Mock>} The fetch stub.
 */
async function load(answers) {
  document.body.innerHTML = MARKUP;
  const fetchStub = routeFetch({ [DATA_URL]: (url) => {
    const days = Number(new URL(url, 'http://x').searchParams.get('days'));
    return answers && Object.hasOwn(answers, days) ? answers[days] : answers;
  } });
  new ApiAnalyticsPage({ dataUrl: DATA_URL }).init();
  await flush();
  return fetchStub;
}

const text = (id) => textOf(document.getElementById(id));
const status = () => document.getElementById('api-status');
/** Each bar row as [label, value text]. */
const barRows = (chart) => [...document.querySelectorAll(`#api-${chart} .api-ep-row`)]
  .map((row) => [row.querySelector('.api-ep-label').textContent, textOf(row.querySelector('.api-ep-value'))]);
/** Each bar's width(s) in a chart, as written into its style. */
const barWidths = (chart) => [...document.querySelectorAll(`#api-${chart} .api-ep-row`)]
  .map((row) => [...row.querySelectorAll('[style]')].map((el) => el.style.width));
const flip = (chart, on) => {
  const input = document.getElementById(`api-toggle-${chart}`);
  input.checked = on;
  input.dispatchEvent(new Event('change'));
};
const range = (days) => document.querySelector(`.api-range-btn[data-days="${days}"]`);

beforeEach(() => {
  // "Today" is a fixed local date so the date captions and the trend's axis can be written out.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 5, 26, 12));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  MiniLineChart.renderInto = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the KPIs', () => {
  test('lead with external calls and clients, the busiest external endpoint, and the external share', async () => {
    await load(payload());
    expect(text('kpi-external-calls')).toBe('1,200');
    expect(text('kpi-external-calls-note')).toBe('+ 300 from docs');
    expect(text('kpi-external-clients')).toBe('10');
    expect(text('kpi-busiest')).toBe('labelClusters');
    expect(text('kpi-busiest-note')).toBe('1,000 external calls');
    expect(text('kpi-pct-external')).toBe('80%');
    expect(text('kpi-pct-external-note')).toBe('1,500 total calls');
    expect(status().classList.contains('ps-hidden')).toBe(true);
  });

  test('read as zeros and dashes for an unused API, with no divide-by-zero share', async () => {
    await load({ days: 30, total_calls: 0, last_api_call: null, sources: null, endpoints: null, daily: null,
      formats: null });
    expect(text('kpi-external-calls')).toBe('0');
    expect(text('kpi-external-calls-note')).toBe('+ 0 from docs');
    expect(text('kpi-external-clients')).toBe('0');
    expect(text('kpi-busiest')).toBe('—');
    expect(text('kpi-busiest-note')).toBe('');
    expect(text('kpi-pct-external')).toBe('—');
    expect(text('kpi-pct-external-note')).toBe('0 total calls');
  });

  test('name no busiest endpoint when every call came from the docs', async () => {
    await load(payload({
      sources: { external: {}, api_docs: { calls: 50 } },
      endpoints: [{ endpoint: '/v3/api/regions', api_docs: 50 }],
    }));
    expect(text('kpi-busiest')).toBe('—');
    expect(text('kpi-pct-external')).toBe('0%');
  });
});

describe('loading', () => {
  test('says so in red when the data does not load', async () => {
    await load({ status: 500 });
    expect(status().textContent).toBe('Could not load API analytics. Please try again.');
    expect(status().classList.contains('error')).toBe(true);
  });
});

describe('switching ranges quickly', () => {
  test('drops a slow reply for an earlier range instead of drawing it under the newer one', async () => {
    let answer90;
    await load({ 30: payload(), 90: new Promise((resolve) => { answer90 = resolve; }), 0: payload() });
    range(90).click();
    range(0).click();
    await flush();
    answer90(payload({ sources: { external: { calls: 9, unique_ips: 1 }, api_docs: { calls: 0, unique_ips: 0 } } }));
    await flush();
    expect(text('kpi-external-calls')).toBe('1,200');
  });
});

describe('the date range captions', () => {
  test('span the last 30 days, ending today, on every chart', async () => {
    await load(payload());
    const expected = `Date range: ${new Date(2026, 4, 28).toLocaleDateString(undefined, { month: 'short',
      day: 'numeric' })} – ${new Date(2026, 5, 26).toLocaleDateString(undefined, { month: 'short', day: 'numeric',
      year: 'numeric' })}`;
    expect(text('api-trend-range')).toBe(expected);
    expect(text('api-endpoints-range')).toBe(expected);
    expect(text('api-formats-range')).toBe(expected);
  });

  test('start All time at the first day with data, giving its year when it differs', async () => {
    await load({ 30: payload(), 0: payload({ daily: [{ date: '2025-05-21', external: 1 },
      { date: '2026-06-01', external: 2 }] }) });
    range(0).click();
    await flush();
    const withYear = { month: 'short', day: 'numeric', year: 'numeric' };
    expect(text('api-trend-range')).toBe(`Date range: ${new Date(2025, 4, 21).toLocaleDateString(undefined, withYear)}`
      + ` – ${new Date(2026, 5, 26).toLocaleDateString(undefined, withYear)}`);
  });

  test('say there is no activity yet for an empty All time', async () => {
    await load({ 30: payload(), 0: payload({ total_calls: 0, daily: [] }) });
    range(0).click();
    await flush();
    expect(text('api-trend-range')).toBe('Date range: all time (no API activity yet)');
  });
});

describe('the usage trend', () => {
  test('draws every day of the window through today, zero-filling days with no calls', async () => {
    await load(payload());
    const [el, labels, series, opts] = MiniLineChart.renderInto.mock.calls[0];
    expect(el.id).toBe('api-trend');
    expect(labels).toHaveLength(30);
    expect(labels[0]).toBe(new Date(2026, 4, 28).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    expect(labels.at(-1)).toBe(new Date(2026, 5, 26).toLocaleDateString(undefined,
      { month: 'short', day: 'numeric' }));
    const [external, docs] = series;
    expect(external.name).toBe('External');
    expect(docs.name).toBe('Docs');
    // Jun 1 is the fifth day of the window, Jun 20 the 24th.
    expect(external.values[4]).toBe(700);
    expect(external.values[23]).toBe(500);
    expect(docs.values[23]).toBe(200);
    expect(external.values.reduce((a, b) => a + b)).toBe(1200);
    expect(opts.valueFormat(1234.4)).toBe('1,234 calls');
  });

  test('reaches back past the window for a day that predates it', async () => {
    await load(payload({ daily: [{ date: '2026-05-20', external: 5 }, { date: '2026-06-01', api_docs: 3 }] }));
    const [, labels, [external, docs]] = MiniLineChart.renderInto.mock.calls[0];
    expect(labels).toHaveLength(38);
    expect(external.values[0]).toBe(5);
    expect(docs.values[12]).toBe(3);
  });

  test('buckets All time by month, through the current month', async () => {
    await load({ 30: payload(), 0: payload({ daily: [
      { date: '2025-11-03', external: 4, api_docs: 1 },
      { date: '2025-11-20', external: 6 },
      { date: '2026-02-01', api_docs: 9 },
    ] }) });
    range(0).click();
    await flush();
    const [, labels, [external, docs]] = MiniLineChart.renderInto.mock.calls.at(-1);
    const month = (y, m) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    expect(labels).toEqual([month(2025, 10), month(2025, 11), month(2026, 0), month(2026, 1), month(2026, 2),
      month(2026, 3), month(2026, 4), month(2026, 5)]);
    expect(external.values).toEqual([10, 0, 0, 0, 0, 0, 0, 0]);
    expect(docs.values).toEqual([1, 0, 0, 9, 0, 0, 0, 0]);
  });

  test('says there is no trend yet when all of All time falls in this month', async () => {
    await load({ 30: payload(), 0: payload({ daily: [{ date: '2026-06-02', external: 3 }] }) });
    range(0).click();
    await flush();
    expect(MiniLineChart.renderInto).toHaveBeenCalledTimes(1);
    expect(text('api-trend')).toBe('Only one month of API activity so far; no trend to plot yet.');
  });

  test('says when the last call was, when the range has none', async () => {
    await load(payload({ total_calls: 0, last_api_call: '2026-06-16', daily: [] }));
    const lastDate = new Date(2026, 5, 16).toLocaleDateString(undefined, { dateStyle: 'long' });
    expect(text('api-trend')).toBe(
      `No API calls in the past 30 days. The last was on ${lastDate} (10 days ago). Try a longer range.`);
    expect(MiniLineChart.renderInto).not.toHaveBeenCalled();
  });

  test('says "1 day ago", and "over all time" on the All time range', async () => {
    const quiet = payload({ total_calls: 0, last_api_call: '2026-06-25', daily: [] });
    await load(quiet);
    expect(text('api-trend')).toContain('(1 day ago)');
    range(0).click();
    await flush();
    expect(text('api-trend')).toMatch(/^No API calls over all time\./);
  });

  test('says no calls have ever been made when there is no last call', async () => {
    await load(payload({ total_calls: 0, last_api_call: null, daily: [] }));
    expect(text('api-trend')).toBe('No v3 API calls have been recorded yet.');
  });
});

describe('the endpoint and format bars', () => {
  test('rank by external calls and drop rows nobody called', async () => {
    await load(payload());
    expect(barRows('endpoints')).toEqual([['labelClusters', '1,000'], ['streets', '200'], ['regions', '0']]);
    // Bars are scaled to the biggest external count, so the leader fills its track.
    expect(barWidths('endpoints')).toEqual([['100%'], ['20%'], ['0%']]);
    expect(barRows('formats')).toEqual([['geojson', '900'], ['<csv>', '300']]);
    expect(document.querySelector('#api-formats .api-ep-label').innerHTML).toBe('geojson');
  });

  test('stack docs calls on and rescale when the switch is on, without a refetch', async () => {
    const fetchStub = await load(payload());
    flip('endpoints', true);
    expect(barRows('endpoints')).toEqual([
      ['labelClusters', '1,000 · 100 docs'], ['streets', '200 · 150 docs'], ['regions', '0 · 50 docs'],
    ]);
    expect(barWidths('endpoints')[0]).toEqual(['90.9090909090909%', '9.090909090909092%']);
    const legend = (chart) => document.getElementById(`api-toggle-${chart}`).closest('.api-docs-control')
      .querySelector('.api-docs-legend');
    expect(legend('endpoints').classList.contains('ps-hidden')).toBe(false);
    expect(legend('formats').classList.contains('ps-hidden')).toBe(true);
    // The other chart keeps its own setting.
    expect(barRows('formats')[0]).toEqual(['geojson', '900']);
    expect(fetchStub).toHaveBeenCalledTimes(1);

    flip('formats', true);
    expect(barRows('formats')[1]).toEqual(['<csv>', '300 · 0 docs']);
    flip('endpoints', false);
    expect(barRows('endpoints')[0]).toEqual(['labelClusters', '1,000']);
  });

  test('say so when nothing was called in the range', async () => {
    await load(payload({ endpoints: [{ endpoint: '/v3/api/streets', external: 0, api_docs: 0 }], formats: [] }));
    expect(text('api-endpoints')).toBe('No API calls recorded for this range.');
    expect(text('api-formats')).toBe('No format data for this range.');
  });

  test('a switch flipped before the data arrives takes effect once it does', async () => {
    document.body.innerHTML = MARKUP;
    let release;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, json: async () => payload() });
    })));
    new ApiAnalyticsPage({ dataUrl: DATA_URL }).init();
    flip('formats', true);
    expect(document.getElementById('api-formats').innerHTML).toBe('');
    release();
    await flush();
    expect(barRows('formats')[0]).toEqual(['geojson', '900 · 300 docs']);
  });
});

describe('the range switch', () => {
  test('refetches for the picked range and marks it pressed', async () => {
    const fetchStub = await load(payload());
    range(90).click();
    await flush();
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual([`${DATA_URL}?days=30`, `${DATA_URL}?days=90`]);
    expect(range(90).getAttribute('aria-pressed')).toBe('true');
    expect(range(90).classList.contains('is-active')).toBe(true);
    expect(range(30).getAttribute('aria-pressed')).toBe('false');
    expect(MiniLineChart.renderInto.mock.calls.at(-1)[1]).toHaveLength(90);
  });

  test('does not refetch when the current range is clicked again', async () => {
    const fetchStub = await load(payload());
    range(30).click();
    await flush();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
