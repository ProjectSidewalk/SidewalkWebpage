/** Tests for the Website traffic section on the admin Activity page: numbers, sources, and the no-data note (#5996). */

import { loadModules } from './loader.js';
import { routeFetch, textOf } from './support/routeFetch.js';

const { TrafficSection } = await loadModules('frontend/js/admin-dashboard/TrafficSection.js');

/** The traffic section of activity.scala.html. */
const MARKUP = `
  <div id="traffic-body">
    <div class="ps-kpis" data-traffic="kpis"></div>
    <div data-traffic="weekly"></div>
    <div data-traffic="sources"></div>
  </div>
  <div id="traffic-status"></div>`;

const TRAFFIC = {
  city_id: 'alpha',
  sessions_7d: 1200,
  sessions_prior_7d: 1000,
  active_users_7d: 900,
  active_users_prior_7d: 900,
  engaged_sessions_7d: 300,
  engagement_rate_7d: 0.25,
  mobile_share_30d: 0.04,
  new_visitors_30d: 3400,
  new_visitors_90d: 9000,
  weekly_sessions: [800, 1000, 1200],
};

/**
 * Starts the section against one /adminapi/traffic answer.
 * @param {any} answer - The endpoint's JSON, an error spec, or an Error.
 */
async function load(answer) {
  document.body.innerHTML = MARKUP;
  routeFetch({ '/adminapi/traffic': answer });
  await new TrafficSection({ trafficUrl: '/adminapi/traffic', bodyId: 'traffic-body', statusId: 'traffic-status' })
    .init();
}

const status = () => textOf(document.getElementById('traffic-status'));
const kpis = () => Array.from(document.querySelectorAll('.ps-kpi')).map(textOf);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});

describe('the Website traffic section', () => {
  test('shows the headline numbers, each with its window', async () => {
    await load({ available: true, fetched_at: '2026-11-16T20:00:00Z', traffic: TRAFFIC, top_sources: [] });
    expect(kpis()).toEqual([
      '1,200Sessionslast 7 days, up 20%',
      '900Visitorslast 7 days, same as the week before',
      '25%Engaged sessionslast 7 days',
      '3,400New visitorslast 30 days',
      '4%On mobile or tabletlast 30 days',
    ]);
    expect(status()).toMatch(/^Data as of /);
  });

  test('leaves the comparison out when the week before had nothing', async () => {
    await load({ available: true, fetched_at: '2026-11-16T20:00:00Z',
      traffic: { ...TRAFFIC, sessions_prior_7d: 0 }, top_sources: [] });
    expect(kpis()[0]).toBe('1,200Sessionslast 7 days');
  });

  test('lists sources busiest first as sent, escaping their names', async () => {
    await load({ available: true, fetched_at: '2026-11-16T20:00:00Z', traffic: TRAFFIC, top_sources: [
      { source: 'google', medium: 'organic', sessions: 1500 },
      { source: '<b>news</b>.example', medium: 'referral', sessions: 40 },
    ] });
    const rows = Array.from(document.querySelectorAll('[data-traffic="sources"] tbody tr'))
      .map((tr) => Array.from(tr.cells).map((td) => td.textContent.trim()));
    expect(rows).toEqual([['google', 'organic', '1,500'], ['<b>news</b>.example', 'referral', '40']]);
  });

  test('says so when there are no sources or too little history to chart', async () => {
    await load({ available: true, fetched_at: '2026-11-16T20:00:00Z',
      traffic: { ...TRAFFIC, weekly_sessions: [5] }, top_sources: [] });
    expect(textOf(document.querySelector('[data-traffic="sources"]'))).toBe('No sessions in the last 30 days.');
    expect(textOf(document.querySelector('[data-traffic="weekly"]')))
      .toBe('Not enough traffic history to chart yet.');
  });

  test('collapses to a note when traffic is unavailable or the request fails', async () => {
    await load({ available: false });
    expect(document.getElementById('traffic-body').hidden).toBe(true);
    expect(status()).toBe('Traffic data unavailable.');

    await load({ status: 500, body: 'boom' });
    expect(document.getElementById('traffic-body').hidden).toBe(true);
    expect(status()).toBe('Traffic data unavailable.');
  });
});
