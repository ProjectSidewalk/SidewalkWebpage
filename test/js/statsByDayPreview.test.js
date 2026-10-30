/**
 * The two by-day API docs previews (#5840): summary cards and three daily charts, for one city (overallStatsByDay)
 * and for all cities with AI activity counted (aggregateStatsByDay).
 */

import { loadModules } from './loader.js';
import { flush, resetWorld, routeFetch, stubApiDocsLibraries, textOf, world } from './support/apiDocsHarness.js';

stubApiDocsLibraries();

const OVERALL = {
  name: 'OverallStatsByDayPreview',
  endpoint: 'overallStatsByDay',
  containerId: 'overall-stats-by-day-preview',
  agreementCard: 'Agreement rate',
};
const AGGREGATE = {
  name: 'AggregateStatsByDayPreview',
  endpoint: 'aggregateStatsByDay',
  containerId: 'aggregate-stats-by-day-preview',
  agreementCard: 'Human agreement rate',
};

function row(date, labelType, overrides = {}) {
  return {
    date,
    label_type: labelType,
    human_labels: 0,
    ai_labels: 0,
    human_validations_agree: 0,
    human_validations_disagree: 0,
    human_validations_unsure: 0,
    ai_validations_agree: 0,
    ai_validations_disagree: 0,
    ai_validations_unsure: 0,
    ...overrides,
  };
}

/** CurbRamp on both days, Obstacle on the second only, with some AI validations mixed in. */
const TWO_DAYS = [
  row('2026-10-02', 'CurbRamp', { human_labels: 5, ai_labels: 2, human_validations_agree: 6, ai_validations_agree: 4 }),
  row('2026-10-01', 'CurbRamp', {
    human_labels: 3, human_validations_disagree: 2, human_validations_unsure: 1, ai_validations_unsure: 1,
  }),
  row('2026-10-02', 'Obstacle', {
    human_labels: 4, ai_labels: 1, human_validations_agree: 1, ai_validations_disagree: 2,
  }),
];

/** @returns {string[]} The `count` days up to 2026-10-31, oldest first. */
function days(count) {
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 9, 31 - (count - 1) + i))
    .toISOString().slice(0, 10));
}

let variant;

async function renderPreview(response = { data: TWO_DAYS }, setup = {}) {
  document.body.innerHTML = `<div id="${variant.containerId}"></div>`;
  routeFetch({ [`/v3/api/${variant.endpoint}`]: response });
  const previews = await loadModules('frontend/js/api-docs/statsByDayPreview.js');
  await previews[variant.name].setup({ apiBaseUrl: '/v3/api', ...setup }).init();
  await flush();
}

const container = () => document.getElementById(variant.containerId);

const cards = () => Object.fromEntries([...container().querySelectorAll('.preview-stat')].map((stat) => [
  textOf(stat.querySelector('.preview-stat-label')), textOf(stat.querySelector('.preview-stat-value')),
]));

const sections = () => [...container().querySelectorAll('.preview-section:not(.preview-stat-grid)')].map(
  (section) => `${textOf(section.querySelector('.preview-title'))}: ${textOf(section.querySelector('.preview-desc'))}`);

const series = (chart) => Object.fromEntries(chart.data.datasets.map((d) => [d.label, d.data]));

beforeEach(() => {
  resetWorld();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return { canvas: this }; });
});

describe('one city, by day', () => {
  beforeEach(() => {
    variant = OVERALL;
  });

  it('sums the period into the summary cards, counting human validations only', async () => {
    await renderPreview();
    expect(cards()).toEqual({
      'Days shown': '2',
      'Human labels': '12',
      'AI labels': '3',
      Validations: '10',
      'Agreement rate': '70.0%',
    });
  });

  it('titles each chart, naming the city', async () => {
    await renderPreview(undefined, { cityName: 'Seattle <WA>' });
    expect(sections()).toEqual([
      'Human Labels per Day: Daily new labels placed by human contributors in Seattle <WA>',
      'Validations per Day: Daily validation activity breakdown in Seattle <WA>',
      'Human Labels per Day by Label Type: Each line represents one label type',
    ]);
  });

  it('charts human labels per day alone', async () => {
    await renderPreview();
    expect(series(world.charts[0])).toEqual({ 'Human Labels': [3, 9] });
  });
});

describe('every deployment, by day', () => {
  beforeEach(() => {
    variant = AGGREGATE;
  });

  it('counts AI validations in the total, but only human ones in the agreement rate', async () => {
    await renderPreview();
    expect(cards()).toEqual({
      'Days shown': '2',
      'Human labels': '12',
      'AI labels': '3',
      'Total validations': '17',
      'Human agreement rate': '70.0%',
    });
  });

  it('titles each chart as covering every deployment', async () => {
    await renderPreview();
    expect(sections()).toEqual([
      'Labels per Day (All Deployments): Daily new labels placed across all Project Sidewalk cities',
      'Human Validations per Day (All Deployments): Daily validation activity breakdown across all cities',
      'Human Labels per Day by Label Type (All Deployments): Each line represents one label type summed across all '
        + 'cities',
    ]);
  });

  it('charts human and AI labels per day side by side', async () => {
    await renderPreview();
    expect(series(world.charts[0])).toEqual({ 'Human Labels': [3, 9], 'AI Labels': [0, 3] });
    expect(world.charts[0].data.datasets.map((d) => d.pointRadius)).toEqual([3, 3]);
  });

  it('still gives a total when only AI validated anything', async () => {
    await renderPreview({ data: [row('2026-10-01', 'CurbRamp', { ai_validations_agree: 3 })] });
    expect(cards()['Human agreement rate']).toBe('N/A');
    expect(cards()['Total validations']).toBe('3');
  });
});

describe.each([['one city', OVERALL], ['every deployment', AGGREGATE]])('both previews: %s', (_, which) => {
  beforeEach(() => {
    variant = which;
  });

  it('puts the days on the x axis, oldest first, with labels placed on the y axis', async () => {
    await renderPreview();
    const [labels] = world.charts;
    expect(labels.data.labels).toEqual(['2026-10-01', '2026-10-02']);
    expect(labels.options.scales.y.title.text).toBe('Labels placed');
    expect(labels.options.scales.x.stacked).toBe(false);
  });

  it("stacks each day's human validations by result", async () => {
    await renderPreview();
    const validations = world.charts[1];
    expect(series(validations)).toEqual({ Agree: [0, 7], Disagree: [2, 0], Unsure: [1, 0] });
    expect(validations.options.scales.y).toMatchObject({ stacked: true, title: { text: 'Validations' } });
    expect(validations.options.scales.x.stacked).toBe(true);
  });

  it('draws a line per label type in its label color, at zero on days it had nothing', async () => {
    await renderPreview();
    const byType = world.charts[2];
    expect(series(byType)).toEqual({ CurbRamp: [3, 5], Obstacle: [0, 4] });
    expect(byType.data.datasets.map((d) => d.borderColor)).toEqual(['#90C31F', '#78B0EA']);
    expect(byType.data.datasets[0].pointRadius).toBe(2);
  });

  it('keeps the most recent 90 days with data, and drops the points once there are that many', async () => {
    await renderPreview({ data: days(95).map((date) => row(date, 'CurbRamp', { human_labels: 1 })) });
    const [labels, , byType] = world.charts;
    expect(labels.data.labels).toEqual(days(90));
    expect(cards()['Days shown']).toBe('90');
    expect(labels.data.datasets.every((d) => d.pointRadius === 0)).toBe(true);
    expect(byType.data.datasets[0].pointRadius).toBe(0);
  });

  it('gives no agreement rate when no human validated anything', async () => {
    await renderPreview({ data: [row('2026-10-01', 'CurbRamp', { human_labels: 2 })] });
    expect(cards()[which.agreementCard]).toBe('N/A');
  });

  it.each([
    ['an empty list', { data: [] }],
    ['no data field', {}],
  ])('says there is nothing to show for %s', async (__, response) => {
    await renderPreview(response);
    expect(textOf(container().querySelector('[role="status"]'))).toBe('No data available for this period.');
    expect(world.charts).toHaveLength(0);
  });

  it('shows the request failing', async () => {
    await renderPreview({ status: 502 });
    expect(textOf(container().querySelector('[role="alert"]'))).toBe('Failed to load preview: HTTP 502');
    expect(console.error).toHaveBeenCalledWith(`${which.name} error:`, expect.any(Error));
  });

  it('rejects when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const previews = await loadModules('frontend/js/api-docs/statsByDayPreview.js');
    await expect(previews[which.name].init()).rejects.toThrow('Container not found');
  });
});
