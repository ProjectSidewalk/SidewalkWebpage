/**
 * Tests for the over-time charts on /admin/across-cities (#4686), and for a failed load. Cumulative users must sum
 * first-activity weeks, since summing weekly active users would re-count returning people.
 */

import { useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { makeCity, renderAcrossCities } from './support/acrossCitiesHarness.js';

useUtil(metricDistanceUtil);

const MARKUP = `
  <div id="ac-pulse"></div><div id="ac-status"></div><div id="ac-stories-summary"></div>
  <div id="ac-trend-toggle">
    <button class="ac-toggle-btn is-active" data-range="recent">12 weeks</button>
    <button class="ac-toggle-btn" data-range="all">All time</button>
  </div>
  <div class="mini-chart" id="ac-chart-labels"></div>
  <div class="mini-chart" id="ac-chart-validations"></div>
  <div class="mini-chart" id="ac-chart-users"></div>
  <div class="mini-chart" id="ac-chart-cum-labels"></div>
  <div class="mini-chart" id="ac-chart-cum-validations"></div>
  <div class="mini-chart" id="ac-chart-cum-users"></div>`;

const CITIES = [
  makeCity('a', { weekly_trend: [
    { week_start: '2026-06-08', labels: 5, validations: 1, active_users: 2 },
    { week_start: '2026-06-01', labels: 10, validations: 2, active_users: 3 },
  ] }),
  makeCity('b', { weekly_trend: [{ week_start: '2026-06-08', labels: 7, active_users: 1 }] }),
];

const ALL_TIME = [
  { week_start: '2019-06-03', labels: 100, validations: 10, active_users: 9, new_users: 9 },
  { week_start: '2020-01-06', labels: 50, validations: 20, active_users: 9, new_users: 1 },
  { week_start: '2026-06-08', labels: 25, validations: 5, active_users: 9, new_users: 2 },
];

/**
 * @returns {Promise<(id: string) => {cats: string[], values: number[], opts: object}>} The last MiniLineChart draw
 *   into a host.
 */
async function render() {
  let spy;
  await renderAcrossCities({
    markup: MARKUP,
    scorecards: { cities: CITIES, over_time_all_time: ALL_TIME },
    beforeInit: ({ MiniLineChart }) => { spy = vi.spyOn(MiniLineChart, 'renderInto'); },
  });
  return (id) => {
    const [, cats, series, opts] = spy.mock.calls.findLast(([host]) => host.id === id);
    return { cats, values: series[0].values, opts };
  };
}

describe('Across Cities — over-time charts', () => {
  let drawn;

  beforeEach(async () => {
    drawn = await render();
  });

  it('sums every city’s weeks into one series, in week order', () => {
    const labels = drawn('ac-chart-labels');
    expect(labels.cats).toEqual(['Jun 1', 'Jun 8']);
    expect(labels.values).toEqual([10, 12]);
    expect(drawn('ac-chart-validations').values).toEqual([2, 1]);
    expect(drawn('ac-chart-users').values).toEqual([3, 3]);
    expect(labels.opts.dotRadius).toBe(2);
  });

  it('redraws from the all-time series, with the year on the axis, when the toggle says so', () => {
    document.querySelector('#ac-trend-toggle [data-range="all"]').click();
    const labels = drawn('ac-chart-labels');
    expect(labels.cats).toEqual(['Jun \'19', 'Jan \'20', 'Jun \'26']);
    expect(labels.values).toEqual([100, 50, 25]);
    expect(document.querySelector('#ac-trend-toggle [data-range="all"]').classList).toContain('is-active');
    expect(document.querySelector('#ac-trend-toggle [data-range="recent"]').classList).not.toContain('is-active');
  });

  it('accumulates labels and validations, and users by the week each first appeared', () => {
    expect(drawn('ac-chart-cum-labels').values).toEqual([100, 150, 175]);
    expect(drawn('ac-chart-cum-validations').values).toEqual([10, 30, 35]);
    expect(drawn('ac-chart-cum-users').values).toEqual([9, 10, 12]);
  });
});

describe('Across Cities — load failure', () => {
  it('says the data could not load where the data would have been', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderAcrossCities({ markup: MARKUP, scorecards: new Error('down') });
    expect(document.getElementById('ac-pulse').textContent).toBe('Could not load city data. Please try again.');
    expect(document.getElementById('ac-status').textContent).toBe('Could not load city data. Please try again.');
    expect(document.getElementById('ac-stories-summary').textContent).toBe('Could not load story counts.');
    expect(error).toHaveBeenCalled();
  });
});

describe('Across Cities — over-time charts, uneven data', () => {
  /**
   * @param {object} scorecards - Fields of the scorecards body.
   * @returns {Promise<(id: string) => {cats: string[], values: number[], opts: object}>} The last draw into a host.
   */
  async function drawWith(scorecards) {
    let spy;
    await renderAcrossCities({
      markup: MARKUP, scorecards,
      beforeInit: ({ MiniLineChart }) => { spy = vi.spyOn(MiniLineChart, 'renderInto'); },
    });
    return (id) => {
      const [, cats, series, opts] = spy.mock.calls.findLast(([host]) => host.id === id);
      return { cats, values: series[0].values, opts };
    };
  }

  it('orders weeks however they arrive, counts a missing figure as zero, and skips a city with no trend', async () => {
    const drawn = await drawWith({ cities: [
      makeCity('a', { weekly_trend: [
        { week_start: '2026-06-15', labels: 1 }, { week_start: '2026-06-01', labels: 2 },
        { week_start: '2026-06-08', validations: 3 },
      ] }),
      makeCity('b', { weekly_trend: undefined }),
    ] });
    expect(drawn('ac-chart-labels').values).toEqual([2, 0, 1]);
    expect(drawn('ac-chart-validations').values).toEqual([0, 3, 0]);
  });

  it('drops the dots on an all-time view longer than 30 weeks, and counts a week without new users as none',
    async () => {
      const weeks = Array.from({ length: 31 }, (_, i) => ({
        week_start: new Date(Date.UTC(2020, 0, 6 + 7 * i)).toISOString().slice(0, 10), labels: 1,
        ...(i === 0 ? { new_users: 4 } : {}),
      }));
      const drawn = await drawWith({ over_time_all_time: weeks });
      document.querySelector('#ac-trend-toggle [data-range="all"]').click();
      expect(drawn('ac-chart-labels').opts.dotRadius).toBe(0);
      expect(new Set(drawn('ac-chart-cum-users').values)).toEqual(new Set([4]));
    });

  it('labels a week it can’t read as a date with the text as sent', async () => {
    const drawn = await drawWith({
      cities: [makeCity('a', { weekly_trend: [{ week_start: 'bad', labels: 1 }] })],
      over_time_all_time: [{ week_start: 'unknown', labels: 1 }],
    });
    expect(drawn('ac-chart-labels').cats).toEqual(['bad']);
    expect(drawn('ac-chart-cum-labels').cats).toEqual(['unknown']);
  });
});
