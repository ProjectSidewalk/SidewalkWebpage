/** Tests for the admin Overview page: its cards, trends, attention list, activity strip and pulse line (#5840). */

import { loadModules, useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { flush, routeFetch, textOf } from './support/routeFetch.js';

// A stand-in color lookup that throws on one made-up type and has no color for another, to reach the fallbacks.
const getLabelColors = (type) => {
  if (type === 'Mystery') throw new TypeError('no such type');
  return { CurbRamp: '#90C31F', Obstacle: '#78B0EA' }[type];
};
useUtil({ ...metricDistanceUtil, misc: { getLabelColors } });

const { OverviewPage } = await loadModules('frontend/js/admin-dashboard/OverviewPage.js');

const URLS = {
  summaryUrl: '/adminapi/overviewSummary',
  activityByDayUrl: '/adminapi/activityByDay',
  recentActivityUrl: '/adminapi/recentActivity?n=6',
  labelTypesUrl: '/v3/api/labelTypes',
};

// Friday afternoon, local time; "this week" is Oct 24-30 and "last week" Oct 17-23.
const NOW = new Date(2026, 9, 30, 12, 0, 0);

/** The ids overview.scala.html gives the page, without the layout around them. */
const MARKUP = `
  <div class="ov-pulse" id="ov-pulse">Loading snapshot…</div>
  <div class="ov-attention" id="ov-attention"></div>
  <div class="ov-cards" id="ov-cards">
    ${['coverage', 'quality', 'contributors', 'activity'].map((key) => `
      <a class="ov-card" id="ov-card-${key}">
        <span class="ov-card-value" id="ov-${key}-value">—</span>
        <span class="ov-card-trend" id="ov-${key}-trend"></span>
        <span class="ov-card-sub" id="ov-${key}-sub"></span>
        <div class="ov-card-spark" id="ov-${key}-spark"></div>
      </a>`).join('')}
    ${['hva', 'api'].map((key) => `
      <a class="ov-card" id="ov-card-${key}">
        <span class="ov-card-value" id="ov-${key}-value">—</span>
        <span class="ov-card-sub" id="ov-${key}-sub"></span>
      </a>`).join('')}
  </div>
  <div class="coverage-status" id="ov-status"></div>
  <div class="ov-recent" id="ov-recent"></div>`;

/** @returns {object} An /adminapi/overviewSummary payload for a busy city, with any fields replaced. */
function summary(overrides = {}) {
  return {
    total_streets: 400,
    audited_streets: 120,
    reaudit_streets: 5,
    total_distance_m: 40000,
    audited_distance_m: 12000,
    reaudit_distance_m: 3000,
    total_labels: 1234567,
    total_validations: 317000,
    labels_past_week: 842,
    validations_past_week: 15000,
    audits_past_week: 12,
    contributors: 4321,
    human_labels: 900,
    ai_labels: 100,
    human_validations: 600,
    ai_validations: 400,
    ai_assessments: 0,
    api_calls_external: 25000,
    api_unique_clients: 14,
    api_window_days: 7,
    labels_awaiting_validation: 0,
    low_quality_users: 0,
    last_activity: null,
    ...overrides,
  };
}

const LABEL_TYPES = {
  label_types: [
    { name: 'CurbRamp', display_name: 'Curb Ramp', color: '#90C31F' },
    { name: 'Obstacle', color: '#78B0EA' },
    { name: 'Mystery', display_name: 'Mystery Type' },
    { name: 'Blank', display_name: 'Blank Type', color: '#123456' },
  ],
};

/** @returns {string} The local `YYYY-MM-DD` of the day `n` days before NOW. */
const daysAgo = (n) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Starts the page against the given endpoint answers.
 * @param {object} [answers] - Per endpoint (`summary`, `activity`, `recent`, `labelTypes`), what it answers.
 * @returns {Promise<void>} Resolves once the page has rendered.
 */
async function load(answers = {}) {
  document.body.innerHTML = MARKUP;
  routeFetch({
    [URLS.summaryUrl]: answers.summary ?? summary(),
    [URLS.activityByDayUrl]: answers.activity ?? { series: [] },
    [URLS.recentActivityUrl]: answers.recent ?? { activity: [] },
    [URLS.labelTypesUrl]: answers.labelTypes ?? LABEL_TYPES,
  });
  await new OverviewPage(URLS).init();
  await flush();
}

const text = (id) => textOf(document.getElementById(id));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the key-number cards', () => {
  test('show coverage as a share of street length, with the distances and street counts behind it', async () => {
    await load();
    expect(text('ov-coverage-value')).toBe('30%');
    expect(text('ov-coverage-sub')).toBe('12 of 40 km · 120 of 400 streets · 5 need re-audit');
  });

  test('leave out the re-audit note when no street needs one', async () => {
    await load({ summary: summary({ reaudit_streets: 0 }) });
    expect(text('ov-coverage-sub')).toBe('12 of 40 km · 120 of 400 streets');
  });

  test('say no streets are loaded rather than dividing by a zero-length network', async () => {
    await load({ summary: summary({ total_distance_m: 0, audited_distance_m: 0 }) });
    expect(text('ov-coverage-value')).toBe('0%');
    expect(text('ov-coverage-sub')).toBe('no streets loaded');
  });

  test('abbreviate big headline numbers and keep the exact figure in the hover title', async () => {
    await load();
    const quality = document.getElementById('ov-quality-value');
    expect(quality.textContent).toBe('1.2M');
    expect(quality.title).toBe('1,234,567');
    expect(text('ov-quality-sub')).toBe('labels · 317k validations');
    expect(text('ov-contributors-value')).toBe('4,321');
    expect(text('ov-activity-value')).toBe('842');
    expect(text('ov-activity-sub')).toBe('labels · 15k validations · 12 streets (last 7 days)');
  });

  test('drop a trailing ".0" from a round million', async () => {
    await load({ summary: summary({ total_labels: 2000000 }) });
    expect(text('ov-quality-value')).toBe('2M');
  });

  test('read missing counts as zero', async () => {
    await load({ summary: summary({ total_labels: undefined, total_validations: null, contributors: undefined }) });
    expect(text('ov-quality-value')).toBe('0');
    expect(text('ov-quality-sub')).toBe('labels · 0 validations');
    expect(text('ov-contributors-value')).toBe('0');
  });

  test('report API use over the window the server names', async () => {
    await load();
    expect(text('ov-api-value')).toBe('25k');
    expect(text('ov-api-sub')).toBe('external calls · 14 clients (last 7 days)');
  });

  test('fall back to a 30-day API window when the server names none', async () => {
    await load({ summary: summary({ api_window_days: undefined, api_unique_clients: undefined }) });
    expect(text('ov-api-sub')).toBe('external calls · 0 clients (last 30 days)');
  });
});

describe('the Humans vs AI card', () => {
  test('shows an empty state when the AI has done nothing here', async () => {
    await load({ summary: summary({ ai_labels: 0, ai_validations: 0, ai_assessments: 0 }) });
    expect(text('ov-hva-value')).toBe('—');
    expect(text('ov-hva-sub')).toBe('no AI activity in this city');
  });

  test('leads with validations when the AI does a bigger share of those', async () => {
    await load();
    expect(text('ov-hva-value')).toBe('40%');
    expect(text('ov-hva-sub')).toBe('of validations are AI · 10% of labels');
  });

  test('leads with labels when the AI does a bigger share of those, and counts what it tagged', async () => {
    await load({ summary: summary({ ai_labels: 900, human_labels: 100, ai_validations: 1, ai_assessments: 12000 }) });
    expect(text('ov-hva-value')).toBe('90%');
    expect(text('ov-hva-sub')).toBe('of labels are AI · 0% of validations · 12k tagged');
  });

  test('names only the AI role when nobody has done the other', async () => {
    await load({ summary: summary({ ai_labels: 5, human_labels: 5, ai_validations: 0, human_validations: 0 }) });
    expect(text('ov-hva-sub')).toBe('of labels are AI');
    await load({ summary: summary({ ai_labels: 0, human_labels: 0, ai_validations: 3, human_validations: 1 }) });
    expect(text('ov-hva-value')).toBe('75%');
    expect(text('ov-hva-sub')).toBe('of validations are AI');
  });

  test('reads a tagger-only AI as 0% of labels rather than dividing by nothing', async () => {
    await load({ summary: summary({
      ai_labels: undefined, human_labels: undefined, ai_validations: undefined, human_validations: undefined,
      ai_assessments: 40,
    }) });
    expect(text('ov-hva-value')).toBe('0%');
    expect(text('ov-hva-sub')).toBe('of labels are AI · 40 tagged');
  });
});

describe('the weekly trends', () => {
  const SERIES = [
    { date: daysAgo(0), labels: 10, validations: 4, audits: 2, new_users: 1 },
    { date: daysAgo(3), labels: 5, validations: 1, audits: 3 },
    { date: daysAgo(8), labels: 30, validations: 2, audits: 5, new_users: 1 },
    { date: daysAgo(20), audits: 1 },
    { date: daysAgo(40), labels: 7 },
  ];

  test('compare this week with last and point the arrow the way it moved', async () => {
    await load({ activity: { series: SERIES } });
    const quality = document.getElementById('ov-quality-trend');
    expect(quality.textContent).toBe('▼ 15 labels this week');
    expect(quality.className).toBe('ov-card-trend ov-trend--down');
    expect(quality.title).toBe('15 this week vs 30 last week');
    const coverage = document.getElementById('ov-coverage-trend');
    expect(coverage.textContent).toBe('→ 5 streets this week');
    expect(coverage.className).toBe('ov-card-trend ov-trend--flat');
    expect(text('ov-contributors-trend')).toBe('→ 1 new this week');
    // 15 labels + 5 validations + 5 streets this week, against 30 + 2 + 5.
    expect(text('ov-activity-trend')).toBe('▼ 25 actions this week');
  });

  test('mark a rising week as up', async () => {
    await load({ activity: { series: [{ date: daysAgo(1), labels: 3 }] } });
    expect(document.getElementById('ov-quality-trend').className).toBe('ov-card-trend ov-trend--up');
    expect(text('ov-quality-trend')).toBe('▲ 3 labels this week');
  });

  test('draw a twelve-week sparkline with a dot on this week', async () => {
    await load({ activity: { series: SERIES } });
    const svg = document.querySelector('#ov-quality-spark svg');
    expect(svg).not.toBeNull();
    const points = svg.querySelector('path').getAttribute('d').split(' ');
    expect(points).toHaveLength(12);
    expect(points[0]).toMatch(/^M/);
    expect(svg.querySelectorAll('circle.ov-spark-dot')).toHaveLength(1);
  });

  test('draw a flat sparkline along the floor for a city with no flow at all', async () => {
    await load({ activity: { series: [{ date: daysAgo(100), labels: 9 }] } });
    const d = document.querySelector('#ov-quality-spark path').getAttribute('d');
    expect(new Set(d.split(' ').map((p) => p.split(',')[1]))).toEqual(new Set(['33.0']));
    expect(text('ov-quality-trend')).toBe('→ 0 labels this week');
  });

  test('leave the cards without trends when the daily series is empty, missing or fails', async () => {
    await load();
    expect(document.getElementById('ov-quality-spark').innerHTML).toBe('');
    expect(text('ov-quality-trend')).toBe('');
    await load({ activity: {} });
    expect(text('ov-quality-trend')).toBe('');
    await load({ activity: { status: 500 } });
    expect(document.getElementById('ov-quality-spark').innerHTML).toBe('');
    expect(text('ov-quality-value')).toBe('1.2M');
  });
});

describe('the needs-attention list', () => {
  /** @returns {Array<{text: string, href: string, action: string, sev: string}>} The list's items. */
  const items = () => Array.from(document.querySelectorAll('.ov-attention-item')).map((a) => ({
    text: textOf(a.querySelector('.ov-attention-text')),
    href: a.getAttribute('href'),
    action: textOf(a.querySelector('.ov-attention-go')),
    sev: a.className.includes('ov-attention--warn') ? 'warn' : 'info',
  }));

  test('lists each problem with a link to the page that fixes it', async () => {
    await load({ summary: summary({ labels_awaiting_validation: 1500, low_quality_users: 3 }) });
    expect(items()).toEqual([
      { text: '1,500 labels haven\'t been validated yet', href: '/adminValidate', action: 'Validate →', sev: 'warn' },
      { text: '3 contributors are flagged low-quality', href: '/admin/contributors', action: 'Review →', sev: 'warn' },
      { text: '280 streets not yet audited (70% of all streets)', href: '/admin/coverage', action: 'Coverage →',
        sev: 'info' },
      { text: '5 audited streets (3 km) have newer imagery and need re-auditing', href: '/admin/imagery',
        action: 'Imagery →', sev: 'info' },
    ]);
  });

  test('leaves the distance out of the re-audit item when the server has none', async () => {
    await load({ summary: summary({ reaudit_distance_m: 0 }) });
    expect(items().find((i) => i.action === 'Imagery →').text)
      .toBe('5 audited streets have newer imagery and need re-auditing');
  });

  test('flags a week with no streets audited, ahead of one with no labels', async () => {
    await load({ summary: summary({ audits_past_week: 0, labels_past_week: 0 }) });
    const activity = items().filter((i) => i.action === 'Activity →');
    expect(activity).toEqual([{ text: 'No streets have been audited in the past 7 days', href: '/admin/activity',
      action: 'Activity →', sev: 'warn' }]);
  });

  test('flags a week with streets audited but no labels placed', async () => {
    await load({ summary: summary({ labels_past_week: 0 }) });
    expect(items().filter((i) => i.action === 'Activity →').map((i) => i.text))
      .toEqual(['No labels have been placed in the past 7 days']);
  });

  test('says all is clear when nothing is flagged', async () => {
    await load({ summary: summary({ audited_streets: 400, reaudit_streets: 0 }) });
    expect(items()).toEqual([]);
    expect(text('ov-attention')).toBe('Nothing needs attention. ✅');
  });

  test('treats missing street counts as nothing left to audit', async () => {
    await load({ summary: summary({ total_streets: undefined, audited_streets: undefined, reaudit_streets: 0 }) });
    expect(text('ov-attention')).toBe('Nothing needs attention. ✅');
  });
});

describe('the latest-activity strip', () => {
  const RECENT = [
    { activity_type: 'label', username: 'ada', timestamp: new Date(NOW - 5 * 60000).toISOString(),
      label_id: 1, label_type: 'CurbRamp', thumbnail_url: '/crops/CurbRamp/crop_1.png' },
    { activity_type: 'validation', username: 'bo', timestamp: new Date(NOW - 3 * 3600000).toISOString(),
      label_id: 2, label_type: 'Obstacle', validation_result: 'Disagree', thumbnail_url: null },
    { activity_type: 'validation', username: null, timestamp: new Date(NOW - 2 * 86400000).toISOString(),
      label_id: 3, label_type: null, validation_result: 'Maybe' },
    { activity_type: 'validation', username: 'cyd', timestamp: new Date(NOW - 60000).toISOString(),
      label_id: 4, label_type: 'Obstacle', validation_result: null },
    { activity_type: 'comment', username: 'dee', timestamp: new Date(NOW - 10000).toISOString(),
      comment: 'Curb <b>cut</b> missing' },
    { activity_type: 'comment', username: 'eve', timestamp: new Date(NOW - 10000).toISOString(), comment: null },
  ];

  /** @returns {Array<{text: string, meta: string}>} Each strip item's action line and who/when line. */
  const strip = () => Array.from(document.querySelectorAll('.ov-recent-item')).map((el) => ({
    text: textOf(el.querySelector('.ov-recent-text')),
    meta: textOf(el.querySelector('.ov-recent-meta')),
  }));

  test('says what each person did and when, with the label type by its display name', async () => {
    await load({ recent: { activity: RECENT } });
    expect(strip()).toEqual([
      { text: 'Placed Curb Ramp', meta: 'ada · 5m ago' },
      { text: 'Validated Obstacle — disagreed', meta: 'bo · 3h ago' },
      { text: 'Validated a label — maybe', meta: 'someone · 2d ago' },
      { text: 'Validated Obstacle —', meta: 'cyd · 1m ago' },
      { text: '“Curb <b>cut</b> missing”', meta: 'dee · just now' },
      { text: '“”', meta: 'eve · just now' },
    ]);
  });

  test('shows a thumbnail where there is one, and a placeholder where there is not', async () => {
    await load({ recent: { activity: RECENT } });
    const first = document.querySelectorAll('.ov-recent-item')[0];
    expect(first.querySelector('img').getAttribute('src')).toBe('/crops/CurbRamp/crop_1.png');
    expect(document.querySelectorAll('.ov-recent-thumb--none')).toHaveLength(RECENT.length - 1);
  });

  test('hides a thumbnail that fails to load', async () => {
    await load({ recent: { activity: RECENT } });
    const img = document.querySelector('img.ov-recent-thumb');
    img.dispatchEvent(new Event('error'));
    expect(img.classList.contains('is-broken')).toBe(true);
  });

  test('says so when there is no recent activity, or the feed fails to load', async () => {
    await load();
    expect(text('ov-recent')).toBe('No recent activity.');
    await load({ recent: {} });
    expect(text('ov-recent')).toBe('No recent activity.');
    await load({ recent: { status: 503 } });
    expect(text('ov-recent')).toBe('No recent activity.');
  });
});

describe('the pulse line', () => {
  const at = new Date(NOW - 2 * 3600000).toISOString();

  test('names the latest label with a dot in its type color', async () => {
    await load({ summary: summary({ last_activity: { activity_type: 'label', username: 'ada', timestamp: at,
      label_type: 'CurbRamp' } }) });
    expect(text('ov-pulse')).toBe('Most recent: ada placed a Curb Ramp label · 2h ago');
    expect(document.querySelector('.ov-pulse-dot').getAttribute('style')).toContain('#90C31F');
  });

  test('falls back to the type\'s API color when the color lookup fails on it', async () => {
    await load({ summary: summary({ last_activity: { activity_type: 'validation', username: 'bo', timestamp: at,
      label_type: 'Mystery', validation_result: 'Agree' } }) });
    expect(text('ov-pulse')).toBe('Most recent: bo validated a Mystery Type (agree) · 2h ago');
    expect(document.querySelector('.ov-pulse-dot').getAttribute('style')).toContain('#999999');
  });

  test('keeps the API color for a type the lookup has no color for, and the name for one without a display name',
    async () => {
      await load({ summary: summary({ last_activity: { activity_type: 'label', username: 'ada', timestamp: at,
        label_type: 'Blank' } }) });
      expect(document.querySelector('.ov-pulse-dot').getAttribute('style')).toContain('#123456');
      await load({ summary: summary({ last_activity: { activity_type: 'label', username: 'ada', timestamp: at,
        label_type: 'Obstacle' } }) });
      expect(text('ov-pulse')).toBe('Most recent: ada placed a Obstacle label · 2h ago');
    });

  test('draws no dot for a type it has no color for, or when the label types fail to load', async () => {
    await load({ summary: summary({ last_activity: { activity_type: 'validation', username: null, timestamp: at,
      label_type: 'Signal', validation_result: null } }) });
    expect(text('ov-pulse')).toBe('Most recent: someone validated a Signal · 2h ago');
    expect(document.querySelector('.ov-pulse-dot')).toBeNull();
    await load({ labelTypes: { status: 500 }, summary: summary({ last_activity: { activity_type: 'label',
      username: 'ada', timestamp: at, label_type: 'CurbRamp' } }) });
    expect(text('ov-pulse')).toBe('Most recent: ada placed a CurbRamp label · 2h ago');
    expect(document.querySelector('.ov-pulse-dot')).toBeNull();
  });

  test('reads a typeless label or validation as just "label"', async () => {
    await load({ summary: summary({ last_activity: { activity_type: 'label', username: 'ada', timestamp: at } }) });
    expect(text('ov-pulse')).toBe('Most recent: ada placed a label label · 2h ago');
    await load({ summary: summary({ last_activity: { activity_type: 'validation', username: 'ada',
      timestamp: at } }) });
    expect(text('ov-pulse')).toBe('Most recent: ada validated a label · 2h ago');
  });

  test('says someone left a comment', async () => {
    await load({ summary: summary({ last_activity: { activity_type: 'comment', username: '<i>x</i>',
      timestamp: at, comment: 'hi' } }) });
    expect(text('ov-pulse')).toBe('Most recent: <i>x</i> left a comment · 2h ago');
  });

  test('says there is no recent activity when the city has none', async () => {
    await load();
    expect(text('ov-pulse')).toBe('No recent activity.');
  });
});

describe('a failed summary', () => {
  test('reports the failure in the pulse and status lines and leaves the cards blank', async () => {
    await load({ summary: { status: 500 } });
    expect(text('ov-pulse')).toBe('Could not load the snapshot. Please try again.');
    expect(text('ov-status')).toBe('Could not load the snapshot. Please try again.');
    expect(text('ov-quality-value')).toBe('—');
    expect(console.error).toHaveBeenCalled();
  });
});
