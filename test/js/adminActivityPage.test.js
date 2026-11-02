/** Tests for the admin Activity page: its totals, charts, range and bucket toggles, banner and feed (#5840). */

import { loadModules, mockModule, useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { flush, routeFetch, textOf } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { language: 'en' } }));
useUtil(metricDistanceUtil);

const { ActivityPage } = await loadModules('frontend/js/admin-dashboard/ActivityPage.js');

const URLS = {
  seriesUrl: '/adminapi/activityByDay',
  recentUrl: '/adminapi/recentActivity',
  contributionTimeUrl: '/adminapi/getContributionTimeStats',
};

// A Friday; the week it falls in starts Monday Oct 26.
const NOW = new Date(2026, 9, 30, 12, 0, 0);

/** The ids activity.scala.html gives the page, without the layout around them. */
const MARKUP = `
  <button type="button" class="act-range-btn" data-range="30" aria-pressed="false">30 days</button>
  <button type="button" class="act-range-btn is-active" data-range="90" aria-pressed="true">90 days</button>
  <button type="button" class="act-range-btn" data-range="all" aria-pressed="false">All time</button>
  ${['labels', 'validations', 'distance', 'missions', 'newusers'].map((k) => `
    <span id="kpi-${k}">—</span><span id="kpi-${k}-note"></span>`).join('')}
  <div class="coverage-status" id="activity-status">Loading activity…</div>
  <div class="activity-latest" id="activity-latest"></div>
  <span id="kpi-explore-time">—</span><span id="kpi-validate-time">—</span><span id="kpi-explore-pace">—</span>
  <button type="button" class="act-gran-btn is-active" data-gran="day" aria-pressed="true">Daily</button>
  <button type="button" class="act-gran-btn" data-gran="week" aria-pressed="false">Weekly</button>
  <div class="activity-smallmultiples" id="activity-volume"></div>
  <div class="activity-chart-card" id="activity-active"></div>
  <div class="activity-feed" id="activity-feed"></div>`;

/** @returns {string} The local `YYYY-MM-DD` of the day `n` days before NOW. */
const daysAgo = (n) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** @returns {string} An ISO timestamp `minutes` before NOW. */
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60000).toISOString();

// One busy day well outside the 90-day window, and two inside it.
const SERIES = [
  { date: daysAgo(200), labels: 100, validations: 0, audits: 3, explored_distance_m: 0, missions: 0,
    signins_registered: 0, signins_anon: 0, active_registered: 1, active_anon: 0, new_users: 4 },
  { date: daysAgo(10), labels: 5, validations: 2, audits: 1, explored_distance_m: 1500, missions: 1,
    signins_registered: 2, signins_anon: 3, active_registered: 2, active_anon: 4, new_users: 1 },
  { date: daysAgo(1), labels: 7, validations: 1, explored_distance_m: 500, missions: 2, signins_registered: 1 },
];

const TIME_STATS = [
  { time: 12.34, stat: 'explore_total', time_interval: 'all_time' },
  { time: 1234.5, stat: 'validate_total', time_interval: 'all_time' },
  { time: 2.34, stat: 'explore_per_100m', time_interval: 'all_time' },
  { time: 99, stat: 'explore_total', time_interval: 'today' },
];

/**
 * Starts the page against the given endpoint answers.
 * @param {object} [answers] - Per endpoint (`series`, `recent`, `time`), what it answers.
 * @returns {Promise<ActivityPage>} The started page, once it has rendered.
 */
async function load(answers = {}) {
  document.body.innerHTML = MARKUP;
  routeFetch({
    [URLS.seriesUrl]: answers.series ?? { series: SERIES },
    [URLS.recentUrl]: answers.recent ?? { activity: [] },
    [URLS.contributionTimeUrl]: answers.time ?? TIME_STATS,
  });
  const page = new ActivityPage(URLS);
  page.init();
  await flush();
  return page;
}

const text = (id) => textOf(document.getElementById(id));
const click = (selector) => document.querySelector(selector).click();

/** @returns {Array<{title: string, total: string}>} Each volume card's title and range total. */
const cards = () => Array.from(document.querySelectorAll('.activity-card')).map((card) => ({
  title: textOf(card.querySelector('.activity-card-title')),
  total: textOf(card.querySelector('.activity-card-total')),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the range totals', () => {
  test('add up the last 90 days by default, and say so', async () => {
    await load();
    expect(text('kpi-labels')).toBe('12');
    expect(text('kpi-validations')).toBe('3');
    expect(text('kpi-missions')).toBe('3');
    expect(text('kpi-newusers')).toBe('1');
    expect(text('kpi-distance')).toBe('2.0 km');
    expect(text('kpi-labels-note')).toBe('in the last 90 days');
    expect(text('kpi-distance-note')).toBe('in the last 90 days');
  });

  test('cover every day once the range is all time', async () => {
    await load();
    click('.act-range-btn[data-range="all"]');
    expect(text('kpi-labels')).toBe('112');
    expect(text('kpi-newusers')).toBe('5');
    expect(text('kpi-labels-note')).toBe('all time');
  });

  test('narrow to 30 days, and mark only that button pressed', async () => {
    await load();
    click('.act-range-btn[data-range="30"]');
    expect(text('kpi-labels-note')).toBe('in the last 30 days');
    const pressed = Array.from(document.querySelectorAll('.act-range-btn'))
      .map((b) => [b.dataset.range, b.getAttribute('aria-pressed'), b.classList.contains('is-active')]);
    expect(pressed).toEqual([['30', 'true', true], ['90', 'false', false], ['all', 'false', false]]);
  });

  test('leave the page alone when the range already chosen is clicked again', async () => {
    await load();
    const before = document.querySelector('.activity-card');
    click('.act-range-btn[data-range="90"]');
    expect(document.querySelector('.activity-card')).toBe(before);
  });
});

describe('the time-spent tiles', () => {
  test('show all-time hours, with a decimal only under 100, and the median pace', async () => {
    await load();
    expect(text('kpi-explore-time')).toBe('12.3 hr');
    expect(text('kpi-validate-time')).toBe('1,235 hr');
    expect(text('kpi-explore-pace')).toBe('2.3 min');
  });

  test('show N/A for a stat the server has no value for', async () => {
    await load({ time: [{ time: null, stat: 'explore_total', time_interval: 'all_time' }] });
    expect(text('kpi-explore-time')).toBe('N/A');
    expect(text('kpi-validate-time')).toBe('N/A');
    expect(text('kpi-explore-pace')).toBe('N/A');
  });

  test('show N/A when the stats fail to load, without failing the rest of the page', async () => {
    await load({ time: { status: 500 } });
    expect(text('kpi-explore-time')).toBe('N/A');
    expect(text('kpi-labels')).toBe('12');
    expect(document.getElementById('activity-status').classList.contains('ps-hidden')).toBe(true);
  });

  test('show N/A when the stats come back in a shape it does not know', async () => {
    await load({ time: { explore_total: 3 } });
    expect(text('kpi-explore-time')).toBe('N/A');
  });
});

describe('the volume charts', () => {
  test('draw one card per metric with its range total, sign-ins counting both kinds', async () => {
    await load();
    expect(cards()).toEqual([
      { title: 'Labels', total: '12 labels in the last 90 days' },
      { title: 'Validations', total: '3 validations in the last 90 days' },
      { title: 'Distance explored', total: '2.0 km in the last 90 days' },
      { title: 'Missions', total: '3 missions in the last 90 days' },
      { title: 'Sign-ins', total: '6 sign-ins in the last 90 days' },
      { title: 'New users', total: '1 user in the last 90 days' },
    ]);
  });

  test('plot one point per day, each with a tooltip in the card\'s own units', async () => {
    await load();
    const labels = document.querySelector('.mini-host[data-idx="0"]');
    expect(labels.querySelector('svg').getAttribute('aria-label')).toBe('Labels over time');
    const tips = Array.from(labels.querySelectorAll('circle title')).map((t) => t.textContent);
    expect(tips).toHaveLength(90);
    expect(tips[88]).toBe('Oct 29 · Labels: 7 labels');
  });

  test('label the distance axis in the reader\'s unit', async () => {
    await load();
    const distance = document.querySelector('.mini-host[data-idx="2"]');
    const ticks = Array.from(distance.querySelectorAll('svg > g:first-of-type text')).map((t) => t.textContent);
    expect(ticks.every((t) => t.endsWith(' km'))).toBe(true);
    expect(distance.querySelector('circle title').textContent).toBe('Aug 2 · Distance explored: 0.0 km');
  });

  test('group days into Monday-start weeks when Weekly is chosen', async () => {
    await load();
    click('.act-gran-btn[data-gran="week"]');
    const tips = Array.from(document.querySelectorAll('.mini-host[data-idx="0"] circle title'))
      .map((t) => t.textContent);
    expect(tips).toHaveLength(14);
    expect(tips[0]).toBe('Jul 27 · Labels: 0 labels');
    expect(tips[12]).toBe('Oct 19 · Labels: 5 labels');
    expect(tips[13]).toBe('Oct 26 · Labels: 7 labels');
  });

  test('say there is too little to plot when the whole history is a single day', async () => {
    await load({ series: { series: [{ date: daysAgo(0), labels: 1 }] } });
    click('.act-range-btn[data-range="all"]');
    expect(text('activity-volume')).toBe('Too little activity in this range to plot. Try a longer range.');
    expect(text('activity-active')).toBe('Too little activity in this range to plot. Try a longer range.');
  });

  test('say there is no activity yet for an all-time view of an empty city', async () => {
    await load({ series: { series: [] } });
    click('.act-range-btn[data-range="all"]');
    expect(text('activity-volume')).toBe('No activity yet.');
    expect(text('activity-active')).toBe('No activity yet.');
  });

  test('chart a missing series as an empty one', async () => {
    await load({ series: {} });
    expect(text('kpi-labels')).toBe('0');
    expect(text('activity-latest')).toBe('No activity yet.');
  });
});

describe('the active-contributors chart', () => {
  /** @returns {string[]} The tooltips of the chart's points. */
  const tips = () => Array.from(document.querySelectorAll('#activity-active circle title')).map((t) => t.textContent);

  test('splits registered from anonymous, each a distinct-per-day count', async () => {
    await load();
    const legend = Array.from(document.querySelectorAll('#activity-active .mini-legend-item')).map(textOf);
    expect(legend).toEqual(['Registered', 'Anonymous']);
    expect(tips()).toContain('Oct 20 · Anonymous: 4 users');
    expect(text('activity-active')).not.toContain('Weekly points');
  });

  test('averages each week\'s daily counts when Weekly is chosen, and says so', async () => {
    await load();
    click('.act-gran-btn[data-gran="week"]');
    // Four anonymous users on one day of a seven-day week average out to under one a day.
    expect(tips()).toContain('Oct 19 · Anonymous: 1 avg users/day');
    expect(text('activity-active')).toContain('Weekly points are the average of that week’s daily active-user counts.');
  });
});

describe('the most-recent banner', () => {
  test('names the newest contribution, who made it and when', async () => {
    await load({ recent: { activity: [{ activity_type: 'label', username: 'ada', timestamp: minutesAgo(5),
      label_type: 'CurbRamp', label_id: 1 }] } });
    expect(text('activity-latest')).toBe('Most recent activity: a CurbRamp label by ada 5m ago.');
  });

  test('describes a validation by its verdict', async () => {
    await load({ recent: { activity: [{ activity_type: 'validation', username: 'bo', timestamp: minutesAgo(90),
      label_type: 'Obstacle', validation_result: 'Disagree' }] } });
    expect(text('activity-latest')).toBe('Most recent activity: a Obstacle validation (disagreed) by bo 1h ago.');
    await load({ recent: { activity: [{ activity_type: 'validation', username: null, timestamp: 'not a time',
      label_type: null, validation_result: 'Odd' }] } });
    expect(text('activity-latest')).toBe('Most recent activity: a label validation (validated) by Unknown .');
  });

  test('calls a comment a comment', async () => {
    await load({ recent: { activity: [{ activity_type: 'comment', username: 'cyd', timestamp: minutesAgo(0),
      comment: 'hi' }] } });
    expect(text('activity-latest')).toBe('Most recent activity: a comment by cyd just now.');
  });

  test('falls back to the newest day in the series when there are no labels, validations or comments', async () => {
    await load({ series: { series: [{ date: daysAgo(0), audits: 1 }] } });
    expect(text('activity-latest')).toBe('Most recent activity: October 30, 2026 (today).');
    await load({ series: { series: [{ date: daysAgo(1), audits: 1 }] } });
    expect(text('activity-latest')).toBe('Most recent activity: October 29, 2026 (yesterday).');
    await load({ series: { series: [{ date: daysAgo(1200), audits: 1 }] } });
    expect(text('activity-latest')).toMatch(/^Most recent activity: July 18, 2023 \(1,200 days ago\)\. Nothing/);
  });

  test('warns when nothing happened in the window, and its button switches to all time', async () => {
    await load({ series: { series: [{ date: daysAgo(200), labels: 4 }] } });
    expect(text('activity-latest')).toContain('Nothing in the last 90 days. View all time');
    click('.act-show-all');
    expect(document.querySelector('.act-range-btn[data-range="all"]').classList.contains('is-active')).toBe(true);
    expect(text('kpi-labels')).toBe('4');
    expect(document.querySelector('.act-show-all')).toBeNull();
  });

  test('says there is no activity at all in an empty city', async () => {
    await load({ series: { series: [] } });
    expect(text('activity-latest')).toBe('No activity yet.');
  });
});

describe('the recent-activity feed', () => {
  const ITEMS = [
    { activity_type: 'label', username: 'ada', timestamp: minutesAgo(5), label_id: 11, label_type: 'CurbRamp',
      thumbnail_url: '/crops/CurbRamp/crop_11.png', user_role: 'Registered', user_labels: 1, user_validations: 2 },
    { activity_type: 'validation', username: 'bo', timestamp: minutesAgo(60), label_id: 12, label_type: null,
      validation_result: '<odd>', user_role: null, user_labels: 40, user_validations: 1 },
    { activity_type: 'validation', username: 'bo', timestamp: minutesAgo(61), label_id: 13, label_type: 'Signal',
      validation_result: 'Unsure', user_validations: null },
    { activity_type: 'validation', username: 'bo', timestamp: minutesAgo(62), label_id: 14, label_type: 'Signal',
      validation_result: null },
    { activity_type: 'comment', username: null, timestamp: 'garbage', label_id: null, comment: 'Look <here>' },
    { activity_type: 'audit', username: 'cyd', timestamp: minutesAgo(3000), comment: null },
  ];

  /** @returns {Array<object>} Each feed row's badge, text, meta line, summary line and time. */
  const rows = () => Array.from(document.querySelectorAll('.activity-feed-item')).map((row) => ({
    badge: textOf(row.querySelector('.activity-feed-badge')),
    text: textOf(row.querySelector('.activity-feed-text')),
    meta: textOf(row.querySelector('.activity-feed-meta')),
    sub: row.querySelector('.activity-feed-sub') ? textOf(row.querySelector('.activity-feed-sub')) : null,
    when: textOf(row.querySelector('.activity-feed-time')),
  }));

  test('lists each item with its badge, who did it, the label, and their all-time totals', async () => {
    await load({ recent: { activity: ITEMS } });
    expect(rows()).toEqual([
      { badge: 'Label', text: 'Placed CurbRamp', meta: 'adaRegistered · label #11',
        sub: '1 label · 2 validations all-time', when: '5m ago' },
      { badge: 'Validate', text: 'Validated a label — <odd>', meta: 'bo · label #12',
        sub: '40 labels · 1 validation all-time', when: '1h ago' },
      { badge: 'Validate', text: 'Validated Signal — unsure', meta: 'bo · label #13', sub: null, when: '1h ago' },
      { badge: 'Validate', text: 'Validated Signal —', meta: 'bo · label #14', sub: null, when: '1h ago' },
      { badge: 'Comment', text: '“Look <here>”', meta: 'Unknown', sub: null, when: '' },
      { badge: 'Activity', text: '“”', meta: 'cyd', sub: null, when: '2d ago' },
    ]);
  });

  test('links each username to its admin profile and each label to its admin page', async () => {
    await load({ recent: { activity: ITEMS } });
    const users = Array.from(document.querySelectorAll('.activity-feed-user')).map((a) => a.getAttribute('href'));
    expect(users[0]).toBe('/admin/user/ada');
    expect(users[4]).toBe('/admin/user/');
    expect(document.querySelector('a.activity-label-link').getAttribute('href')).toBe('/admin/label/11');
  });

  test('keeps an unreadable timestamp as the hover text rather than a bad date', async () => {
    await load({ recent: { activity: ITEMS } });
    const times = document.querySelectorAll('.activity-feed-time');
    expect(times[4].getAttribute('title')).toBe('garbage');
    expect(times[0].getAttribute('title')).toContain('2026');
  });

  test('shows a thumbnail where there is one, and hides it if it fails to load', async () => {
    await load({ recent: { activity: ITEMS } });
    const img = document.querySelector('img.activity-feed-thumb');
    expect(img.getAttribute('src')).toBe('/crops/CurbRamp/crop_11.png');
    expect(document.querySelectorAll('.activity-feed-thumb--none')).toHaveLength(ITEMS.length - 1);
    img.dispatchEvent(new Event('error'));
    expect(img.classList.contains('is-broken')).toBe(true);
  });

  test('caps the feed at 20 items and says how many it shows', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ activity_type: 'comment', username: `u${i}`,
      timestamp: minutesAgo(i), comment: `c${i}` }));
    await load({ recent: { activity: many } });
    expect(document.querySelectorAll('.activity-feed-item')).toHaveLength(20);
    expect(textOf(document.querySelector('#activity-feed > p'))).toBe('Showing the 20 most recent items.');
  });

  test('says so when there is nothing recent, or the feed comes back without a list', async () => {
    await load();
    expect(text('activity-feed')).toBe('No recent activity yet.');
    await load({ recent: {} });
    expect(text('activity-feed')).toBe('No recent activity yet.');
  });

  test('opens a label inline once the popup is ready, from its link or its thumbnail', async () => {
    const page = await load({ recent: { activity: ITEMS } });
    const showLabel = vi.fn();
    page.setLabelPopup({ showLabel });
    const link = document.querySelectorAll('a.activity-label-link')[1];
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(showLabel).toHaveBeenCalledWith(12, 'AdminActivity');
    click('img.activity-feed-thumb');
    expect(showLabel).toHaveBeenLastCalledWith(11, 'AdminActivity');
  });

  test('lets a label link navigate when the popup is not ready', async () => {
    await load({ recent: { activity: ITEMS } });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('a.activity-label-link').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  test('ignores clicks in the feed that are not on a label', async () => {
    const page = await load({ recent: { activity: ITEMS } });
    const showLabel = vi.fn();
    page.setLabelPopup({ showLabel });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('.activity-feed-text').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(showLabel).not.toHaveBeenCalled();
  });
});

describe('loading', () => {
  test('hides the status line once the page has rendered', async () => {
    await load();
    const status = document.getElementById('activity-status');
    expect(status.classList.contains('ps-hidden')).toBe(true);
    expect(status.classList.contains('error')).toBe(false);
  });

  test('reports a failed load on the status line', async () => {
    await load({ series: { status: 500 } });
    const status = document.getElementById('activity-status');
    expect(status.textContent).toBe('Could not load activity. Please try again.');
    expect(status.classList.contains('error')).toBe(true);
    expect(status.classList.contains('ps-hidden')).toBe(false);
    expect(text('kpi-labels')).toBe('—');
  });

  test('keeps a range picked before the data arrives, and renders with it once it does', async () => {
    document.body.innerHTML = MARKUP;
    let answer;
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === URLS.seriesUrl) return new Promise((resolve) => { answer = resolve; });
      return Promise.resolve({ ok: true, json: async () => (url === URLS.recentUrl ? { activity: [] } : []) });
    }));
    new ActivityPage(URLS).init();
    click('.act-range-btn[data-range="30"]');
    expect(text('kpi-labels')).toBe('—');
    answer({ ok: true, json: async () => ({ series: SERIES }) });
    await flush();
    expect(text('kpi-labels-note')).toBe('in the last 30 days');
  });
});
