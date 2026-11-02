/** Tests for the admin Data Quality page: its KPIs, per-type scorecards, tag charts and agreement trend (#5840). */

import { loadModules, mockModule } from './loader.js';
import { routeFetch, textOf } from './support/routeFetch.js';

// The chart draws SVG this suite doesn't read; what it was asked to draw is the page's part.
const MiniLineChart = { renderInto: vi.fn() };
mockModule('frontend/js/admin-dashboard/MiniLineChart.js', () => ({ MiniLineChart }));

const { DataQualityPage } = await loadModules('frontend/js/admin-dashboard/DataQualityPage.js');

// The page's elements, as quality.scala.html serves them.
const MARKUP = `
  <span id="kpi-total-labels">—</span>
  <span id="kpi-with-severity">—</span><span id="kpi-with-severity-note"></span>
  <span id="kpi-agreement">—</span><span id="kpi-agreement-note"></span>
  <span id="kpi-total-validations">—</span>
  <span id="kpi-image-age">—</span>
  <div class="coverage-status" id="dq-status">Loading data quality…</div>
  <div class="dq-rows" id="dq-labels"></div>
  <div class="dq-sevlegend" id="dq-sevlegend-positive"></div>
  <div class="dq-rows" id="dq-severity-positive"></div>
  <div class="dq-sevlegend" id="dq-sevlegend-negative"></div>
  <div class="dq-rows" id="dq-severity-negative"></div>
  <div class="dq-rows" id="dq-coverage"></div>
  <div class="coverage-toggle" role="group" aria-label="Validator">
    <button type="button" class="dq-validator-btn is-active" data-validator="combined"
      aria-pressed="true">Combined</button>
    <button type="button" class="dq-validator-btn" data-validator="human" aria-pressed="false">Human</button>
    <button type="button" class="dq-validator-btn" data-validator="ai" aria-pressed="false">AI</button>
  </div>
  <div class="dq-rows" id="dq-validation"></div>
  <div id="dq-trend" class="dq-trend"></div>
  <div id="dq-tags"></div>
  <div id="dq-tag-severity"></div>`;

const LABEL_TYPES = {
  label_types: [
    { name: 'CurbRamp', display_name: 'Curb Ramp', color: '#90C31F', small_icon_url: '/icons/CurbRamp.png' },
    { name: 'NoCurbRamp', display_name: 'Missing Curb Ramp', color: '#E679B6',
      small_icon_url: '/icons/NoCurbRamp.png' },
    { name: 'Obstacle', display_name: 'Obstacle', color: '#78B0EA', small_icon_url: '/icons/Obstacle.png' },
    { name: 'Crosswalk', color: '#FABF1C' },
    { name: 'Signal', display_name: 'Signal' },
  ],
};

/** /v3/api/overallStats, cut down to what the page reads. */
const STATS = {
  labels: {
    count: 1300,
    avg_age_of_image_when_labeled: '730.5 days',
    CurbRamp: { count: 800, count_with_severity: 600, severity_mean: 1.4, severity_stddev: 0.5 },
    NoCurbRamp: { count: 300, count_with_severity: 100, severity_mean: 2.6, severity_stddev: 0.3 },
    Obstacle: { count: 100, count_with_severity: 100, severity_mean: 1.9, severity_stddev: null },
    Signal: { count: 100, count_with_severity: 0, severity_mean: null },
  },
  validations: {
    combined: {
      total_validations: 2500,
      Overall: { validated: 400, agreed: 300 },
      CurbRamp: { has_a_validation: 400, validated: 200, agreed: 180, disagreed: 20 },
      NoCurbRamp: { has_a_validation: 30, validated: 100, agreed: 50, disagreed: 50 },
      Signal: { has_a_validation: 100, validated: 100, agreed: 70, disagreed: 30 },
    },
    human: { CurbRamp: { validated: 10, agreed: 9, disagreed: 1 } },
    ai: {},
  },
};

const TAGS = [
  { label_type: 'CurbRamp', tag: 'narrow', count: 10 },
  { label_type: 'CurbRamp', tag: 'steep', count: 40 },
  { label_type: 'Obstacle', tag: '<i>pole</i>', count: 5 },
  // A type the labelTypes list doesn't have is left out.
  { label_type: 'Ghost', tag: 'boo', count: 99 },
];

const TAG_SEVERITY = {
  tag_severity: [
    { label_type: 'NoCurbRamp', tag: 'alternate route present', severity: 1, count: 8 },
    { label_type: 'NoCurbRamp', tag: 'alternate route present', severity: 3, count: 2 },
    { label_type: 'NoCurbRamp', tag: 'no alternate route', severity: 3, count: 30 },
    // Signal carries no severity, so it gets no grid.
    { label_type: 'Signal', tag: 'has button', severity: 2, count: 4 },
  ],
};

const BY_DAY = {
  data: [
    { date: '2026-06-03', human_validations_agree: 6, human_validations_disagree: 2 },
    { date: '2026-06-20', human_validations_agree: 2, human_validations_disagree: 0 },
    { date: '2026-08-01', human_validations_agree: 1, human_validations_disagree: 1 },
    // A day with no votes doesn't make a month count as having data.
    { date: '2026-09-01' },
  ],
};

const URLS = {
  statsUrl: '/v3/api/overallStats', tagsUrl: '/adminapi/labelTags', labelTypesUrl: '/v3/api/labelTypes',
  byDayUrl: '/v3/api/overallStatsByDay', tagSeverityUrl: '/adminapi/tagSeverity',
};

/**
 * Builds the page with the given answers (each defaulting to the fixtures above) and lets it load.
 * @param {object} [answers] - Bodies keyed `stats`, `tags`, `labelTypes`, `byDay`, `tagSeverity`.
 * @returns {Promise<import('vitest').Mock>} The fetch stub.
 */
async function render({ stats = STATS, tags = TAGS, labelTypes = LABEL_TYPES, byDay = BY_DAY,
  tagSeverity = TAG_SEVERITY } = {}) {
  document.body.innerHTML = MARKUP;
  const fetch = routeFetch({
    [URLS.statsUrl]: stats,
    // Longer prefixes win, so this one isn't swallowed by overallStats.
    [URLS.byDayUrl]: byDay,
    [URLS.tagsUrl]: tags,
    [URLS.labelTypesUrl]: labelTypes,
    [URLS.tagSeverityUrl]: tagSeverity,
  });
  await new DataQualityPage(URLS).init();
  return fetch;
}

const text = (id) => textOf(document.getElementById(id));

/** @returns {Array<string>} The words of a smiley legend. */
const legend = (id) => [...document.querySelectorAll(`#${id} .dq-smiley`)].map(textOf);

/** @returns {Array<string>} Each scorecard row in a container, as read: name, then value. */
const rowTexts = (id) => [...document.querySelectorAll(`#${id} .dq-row`)]
  .map((row) => `${textOf(row.querySelector('.dq-name'))}: ${textOf(row.querySelector('.dq-value'))}`);

beforeEach(() => {
  MiniLineChart.renderInto.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15));
});

describe('Data Quality — KPIs and loading', () => {
  test('fills the headline numbers', async () => {
    await render();
    expect(text('kpi-total-labels')).toBe('1,300');
    // Signal can't carry a rating, so its 100 labels stay out of the denominator.
    expect(text('kpi-with-severity')).toBe('67%');
    expect(text('kpi-with-severity-note')).toBe('800 of 1,200 eligible labels');
    expect(text('kpi-agreement')).toBe('75%');
    expect(text('kpi-agreement-note')).toBe('300 of 400 validated');
    expect(text('kpi-total-validations')).toBe('2,500');
    expect(text('kpi-image-age')).toBe('2.0 yr');
  });

  test('shows dashes rather than 0% or NaN when nothing has been labeled or validated', async () => {
    await render({ stats: {} });
    expect(text('kpi-total-labels')).toBe('0');
    expect(text('kpi-with-severity')).toBe('—');
    expect(text('kpi-with-severity-note')).toBe('0 of 0 eligible labels');
    expect(text('kpi-agreement')).toBe('—');
    expect(text('kpi-agreement-note')).toBe('0 of 0 validated');
    expect(text('kpi-total-validations')).toBe('0');
    expect(text('kpi-image-age')).toBe('—');
  });

  test('requests all five endpoints and hides the loading line once they answer', async () => {
    const fetch = await render();
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(Object.values(URLS).sort());
    const status = document.getElementById('dq-status');
    expect(status.textContent).toBe('');
    expect(status.classList.contains('ps-hidden')).toBe(true);
    expect(status.classList.contains('error')).toBe(false);
  });

  test('reports a failed request instead of leaving the page loading', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render({ tags: { status: 503 } });
    const status = document.getElementById('dq-status');
    expect(status.textContent).toBe('Could not load data quality metrics. Please try again.');
    expect(status.classList.contains('error')).toBe(true);
    expect(status.classList.contains('ps-hidden')).toBe(false);
  });

  test('survives a page without the KPIs, status line or tag-severity section', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = MARKUP;
    for (const id of ['kpi-total-labels', 'dq-status', 'dq-tag-severity']) document.getElementById(id).remove();
    routeFetch({ [URLS.statsUrl]: STATS, [URLS.byDayUrl]: BY_DAY, [URLS.tagsUrl]: TAGS,
      [URLS.labelTypesUrl]: LABEL_TYPES, [URLS.tagSeverityUrl]: TAG_SEVERITY });
    await new DataQualityPage(URLS).init();
    expect(console.error).not.toHaveBeenCalled();
    expect(rowTexts('dq-labels')).toHaveLength(4);
  });
});

describe('Data Quality — labels by type', () => {
  test('lists types with labels, most first, with their share of all labels', async () => {
    await render();
    expect(rowTexts('dq-labels')).toEqual([
      'Curb Ramp: 800 (62%)', 'Missing Curb Ramp: 300 (23%)', 'Obstacle: 100 (8%)', 'Signal: 100 (8%)',
    ]);
    const bars = [...document.querySelectorAll('#dq-labels .dq-bar')].map((b) => b.style.width);
    expect(bars).toEqual(['100%', '37.5%', '12.5%', '12.5%']);
  });

  test('uses the type’s icon and color, with a grey swatch for a type without one', async () => {
    await render();
    const rows = document.querySelectorAll('#dq-labels .dq-row');
    expect(rows[0].querySelector('.dq-icon').getAttribute('src')).toBe('/icons/CurbRamp.png');
    expect(rows[0].querySelector('.dq-swatch').style.background).toBe('rgb(144, 195, 31)');
    expect(rows[3].querySelector('.dq-swatch').style.background).toBe('rgb(136, 136, 136)');
  });

  test('is empty when no type has labels', async () => {
    await render({ stats: { labels: { count: 0 } } });
    expect(document.getElementById('dq-labels').innerHTML).toBe('');
  });
});

describe('Data Quality — severity and quality ratings', () => {
  test('splits ratings into quality and severity, worst mean first, with the level in words', async () => {
    await render();
    expect(rowTexts('dq-severity-positive')).toEqual(['Curb Ramp: 1.40 Good · ±0.50']);
    // Obstacle sent no spread, so it reads as ±0.
    expect(rowTexts('dq-severity-negative')).toEqual([
      'Missing Curb Ramp: 2.60 High · ±0.30', 'Obstacle: 1.90 Medium · ±0.00',
    ]);
  });

  test('places the mean marker and its ± band on the 1-to-3 track', async () => {
    await render();
    const row = document.querySelector('#dq-severity-negative .dq-row');
    expect(parseFloat(row.querySelector('.dq-sev-marker').style.left)).toBeCloseTo(80);
    const band = row.querySelector('.dq-sev-band');
    expect(parseFloat(band.style.left)).toBeCloseTo(65);
    expect(parseFloat(band.style.width)).toBeCloseTo(30);
  });

  test('stops the ± band at the end of the scale rather than running past it', async () => {
    await render();
    // Curb Ramp's 1.40 ± 0.50 would start below 1.
    const band = document.querySelector('#dq-severity-positive .dq-sev-band');
    expect(parseFloat(band.style.left)).toBe(0);
    expect(parseFloat(band.style.width)).toBeCloseTo(45);
  });

  test('draws each scale’s smiley legend in its own words', async () => {
    await render();
    expect(legend('dq-sevlegend-positive')).toEqual(['Good', 'Okay', 'Bad']);
    expect(legend('dq-sevlegend-negative')).toEqual(['Low', 'Medium', 'High']);
    expect(document.querySelector('#dq-sevlegend-positive img').getAttribute('src'))
      .toContain('sev-1-positive-filled.svg');
  });

  test('says no ratings yet, but keeps the legend, when a scale has none', async () => {
    await render({ stats: { labels: { CurbRamp: { count: 5, count_with_severity: 0, severity_mean: null } } } });
    expect(text('dq-severity-positive')).toBe('No ratings recorded yet.');
    expect(text('dq-severity-negative')).toBe('No ratings recorded yet.');
    expect(legend('dq-sevlegend-positive')).toEqual(['Good', 'Okay', 'Bad']);
    expect(legend('dq-sevlegend-negative')).toEqual(['Low', 'Medium', 'High']);
  });

  test('draws no legend when the city has no type on that scale', async () => {
    await render({ labelTypes: { label_types: [{ name: 'Signal' }] } });
    expect(document.getElementById('dq-sevlegend-positive').innerHTML).toBe('');
    expect(document.getElementById('dq-sevlegend-negative').innerHTML).toBe('');
  });
});

describe('Data Quality — validation coverage', () => {
  test('lists the least-validated type first, with a link to validate it', async () => {
    await render();
    expect(rowTexts('dq-coverage')).toEqual([
      'Obstacle: 0% (0/100)', 'Missing Curb Ramp: 10% (30/300)', 'Curb Ramp: 50% (400/800)', 'Signal: 100% (100/100)',
    ]);
    const links = [...document.querySelectorAll('#dq-coverage .dq-validate-btn')].map((a) => a.getAttribute('href'));
    expect(links[0]).toBe('/adminValidate?labelType=Obstacle');
    expect(document.querySelector('#dq-coverage .dq-row').classList.contains('dq-row--action')).toBe(true);
  });
});

describe('Data Quality — validation agreement', () => {
  test('starts on all validators, best agreement first', async () => {
    await render();
    expect(rowTexts('dq-validation')).toEqual([
      'Curb Ramp: 90% (180/200)', 'Signal: 70% (70/100)', 'Missing Curb Ramp: 50% (50/100)',
    ]);
    const [agree, disagree] = document.querySelectorAll('#dq-validation .dq-row .dq-stack > div');
    expect([agree.style.width, disagree.style.width]).toEqual(['90%', '10%']);
  });

  test('switches to one validator group on a click, and marks which is pressed', async () => {
    await render();
    const [combined, human] = document.querySelectorAll('.dq-validator-btn');
    human.click();
    expect(rowTexts('dq-validation')).toEqual(['Curb Ramp: 90% (9/10)']);
    expect(human.classList.contains('is-active')).toBe(true);
    expect(human.getAttribute('aria-pressed')).toBe('true');
    expect(combined.classList.contains('is-active')).toBe(false);
    expect(combined.getAttribute('aria-pressed')).toBe('false');
  });

  test('says when a validator group has no votes', async () => {
    await render();
    document.querySelector('.dq-validator-btn[data-validator="ai"]').click();
    expect(text('dq-validation')).toBe('No validations from this validator group.');
  });

  test('does nothing when the active button is clicked again', async () => {
    await render();
    const combined = document.querySelector('.dq-validator-btn[data-validator="combined"]');
    document.getElementById('dq-validation').innerHTML = 'untouched';
    combined.click();
    expect(text('dq-validation')).toBe('untouched');
  });

  test('treats a group missing from the response as having no votes', async () => {
    await render({ stats: { labels: STATS.labels, validations: { combined: STATS.validations.combined } } });
    document.querySelector('.dq-validator-btn[data-validator="human"]').click();
    expect(text('dq-validation')).toBe('No validations from this validator group.');
  });
});

describe('Data Quality — tag usage', () => {
  test('shows each type’s top tags in label-type order, scaled within the type', async () => {
    await render();
    const groups = [...document.querySelectorAll('#dq-tags .dq-tag-group')];
    expect(groups.map((g) => textOf(g.querySelector('.dq-name')))).toEqual(['Curb Ramp', 'Obstacle']);
    const rows = [...groups[0].querySelectorAll('.dq-tag-row')];
    expect(rows.map(textOf)).toEqual(['steep 40', 'narrow 10']);
    expect(rows.map((r) => r.querySelector('.dq-bar').style.width)).toEqual(['100%', '25%']);
  });

  test('shows a tag’s markup as text', async () => {
    await render();
    const obstacle = document.querySelectorAll('#dq-tags .dq-tag-group')[1];
    expect(obstacle.querySelector('i')).toBeNull();
    expect(textOf(obstacle.querySelector('.dq-tag-name'))).toBe('<i>pole</i>');
  });

  test('keeps only the eight most-used tags per type', async () => {
    const tags = Array.from({ length: 10 }, (_, i) => ({ label_type: 'Obstacle', tag: `t${i}`, count: i + 1 }));
    await render({ tags });
    const names = [...document.querySelectorAll('#dq-tags .dq-tag-name')].map(textOf);
    expect(names).toEqual(['t9', 't8', 't7', 't6', 't5', 't4', 't3', 't2']);
  });

  test('says no tags yet when there are none, or the response isn’t a list', async () => {
    await render({ tags: { error: 'nope' } });
    expect(text('dq-tags')).toBe('No tags recorded yet.');
  });

  test('gives zero-count tags empty bars rather than dividing by zero', async () => {
    await render({ tags: [{ label_type: 'Obstacle', tag: 'unused', count: 0 }] });
    expect(document.querySelector('#dq-tags .dq-bar').style.width).toBe('0%');
  });
});

describe('Data Quality — tag severity patterns', () => {
  test('draws one grid per rated type, busiest tag first, with per-cell counts and shares', async () => {
    await render();
    const groups = document.querySelectorAll('#dq-tag-severity .dq-tag-group');
    expect(groups).toHaveLength(1);
    expect(textOf(groups[0].querySelector('.dq-name'))).toBe('Missing Curb Ramp');
    const labels = [...groups[0].querySelectorAll('.dq-heat-rowlabel')].map(textOf);
    expect(labels).toEqual(['no alternate route', 'alternate route present']);
    const cells = [...groups[0].querySelectorAll('.dq-heat-cell')];
    expect(cells[3].getAttribute('aria-label')).toBe('alternate route present · severity 1: 8 (80% of this tag)');
    expect(cells[4].getAttribute('aria-label')).toBe('alternate route present · severity 2: 0 (0% of this tag)');
    // Shaded against the row's own busiest cell.
    expect(cells.slice(3).map((c) => c.style.opacity)).toEqual(['1', '0.1', '0.33']);
    expect([...groups[0].querySelectorAll('.dq-heat-total')].map(textOf)).toEqual(['30', '10']);
  });

  test('says no data yet when nothing comes back', async () => {
    await render({ tagSeverity: {} });
    expect(text('dq-tag-severity')).toBe('No tag-severity data yet.');
  });

  test('shows a zero share, not NaN, for a tag whose counts are all zero', async () => {
    await render({ tagSeverity: { tag_severity: [{ label_type: 'Obstacle', tag: 'idle', severity: 2, count: 0 }] } });
    const cell = document.querySelectorAll('#dq-tag-severity .dq-heat-cell')[1];
    expect(cell.getAttribute('aria-label')).toBe('idle · severity 2: 0 (0% of this tag)');
  });
});

describe('Data Quality — quality over time', () => {
  test('charts monthly agreement from the first month with votes through this month', async () => {
    await render();
    expect(MiniLineChart.renderInto).toHaveBeenCalledTimes(1);
    const [host, months, series, opts] = MiniLineChart.renderInto.mock.calls[0];
    expect(host.classList.contains('mini-host')).toBe(true);
    expect(months).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    // Only the human line: there were no AI votes. Empty months are gaps, not zeros.
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ name: 'Human', key: 'human', values: [0.8, null, 0.5, null, null] });
    expect(series[0].tooltips).toEqual([
      '2026-06 · Human: 80% (10 validations)', '', '2026-08 · Human: 50% (2 validations)', '', '',
    ]);
    expect(opts.tickFormat(0.5)).toBe('50%');
    expect(opts.yMax).toBe(1);
    expect(text('dq-trend')).toMatch(/^Data runs Jun 2026 to Aug 2026; the axis extends to this month\.$/);
  });

  test('adds an AI line when the AI has voted', async () => {
    await render({ byDay: { data: [
      { date: '2026-09-02', human_validations_agree: 1, ai_validations_agree: 3, ai_validations_disagree: 1 },
      { date: '2026-10-02', human_validations_agree: 1 },
    ] } });
    const series = MiniLineChart.renderInto.mock.calls[0][2];
    expect(series.map((s) => s.name)).toEqual(['Human', 'AI']);
    expect(series[1].values).toEqual([0.75, null]);
  });

  test('counts months across a new year', async () => {
    vi.setSystemTime(new Date(2027, 1, 10));
    await render({ byDay: { data: [
      { date: '2026-11-05', human_validations_agree: 1 }, { date: '2026-12-05', human_validations_disagree: 1 },
    ] } });
    expect(MiniLineChart.renderInto.mock.calls[0][1]).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  test.each([
    ['one month of votes', { data: [{ date: '2026-10-01', human_validations_agree: 3 }] }],
    ['no history', {}],
  ])('says there isn’t enough history with %s', async (_, byDay) => {
    await render({ byDay });
    expect(MiniLineChart.renderInto).not.toHaveBeenCalled();
    expect(text('dq-trend')).toBe('Not enough validation history to chart yet.');
  });
});

describe('Data Quality — label types', () => {
  test('draws nothing per type when /v3/api/labelTypes sends no list', async () => {
    await render({ labelTypes: null });
    expect(document.getElementById('dq-labels').innerHTML).toBe('');
    expect(text('dq-tags')).toBe('No tags recorded yet.');
  });
});
