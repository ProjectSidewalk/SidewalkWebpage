/**
 * The /v3/api-docs/aggregateStatsByDay preview (#5840): the summary cards and three daily charts (human and AI labels,
 * human validations by result, labels by type) summed across every deployment, built from a canned
 * /v3/api/aggregateStatsByDay response.
 */

import { loadModules } from './loader.js';
import { flush, resetWorld, routeFetch, stubApiDocsLibraries, textOf, world } from './support/apiDocsHarness.js';

stubApiDocsLibraries();

/** One row of the endpoint's flat data: a label type's activity on one day, across all cities. */
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

/** Two days: CurbRamp on both, Obstacle only on the second, with some AI validations mixed in. */
const TWO_DAYS = [
  row('2026-10-02', 'CurbRamp', { human_labels: 5, ai_labels: 2, human_validations_agree: 6, ai_validations_agree: 4 }),
  row('2026-10-01', 'CurbRamp', {
    human_labels: 3, human_validations_disagree: 2, human_validations_unsure: 1, ai_validations_unsure: 1,
  }),
  row('2026-10-02', 'Obstacle', {
    human_labels: 4, ai_labels: 1, human_validations_agree: 1, ai_validations_disagree: 2,
  }),
];

/** @returns {string[]} `count` consecutive days ending 2026-10-31, ascending. */
function days(count) {
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 9, 31 - (count - 1) + i))
    .toISOString().slice(0, 10));
}

/** Loads the preview and runs it against the given response. */
async function renderPreview(response = { data: TWO_DAYS }) {
  document.body.innerHTML = '<div id="aggregate-stats-by-day-preview"></div>';
  routeFetch({ '/v3/api/aggregateStatsByDay': response });
  const { AggregateStatsByDayPreview } = await loadModules('frontend/js/api-docs/statsByDayPreview.js');
  await AggregateStatsByDayPreview.setup({ apiBaseUrl: '/v3/api' }).init();
  await flush();
}

const container = () => document.getElementById('aggregate-stats-by-day-preview');

/** @returns {Record<string, string>} Each summary card's label to its value. */
const cards = () => Object.fromEntries([...container().querySelectorAll('.preview-stat')].map((stat) => [
  textOf(stat.querySelector('.preview-stat-label')), textOf(stat.querySelector('.preview-stat-value')),
]));

/** @returns {Record<string, number[]>} A chart's datasets, by legend label. */
const series = (chart) => Object.fromEntries(chart.data.datasets.map((d) => [d.label, d.data]));

beforeEach(() => {
  resetWorld();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return { canvas: this }; });
});

describe('activity across deployments', () => {
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

  it('charts human and AI labels per day side by side, oldest day first', async () => {
    await renderPreview();
    const [labels] = world.charts;
    expect(labels.data.labels).toEqual(['2026-10-01', '2026-10-02']);
    expect(series(labels)).toEqual({ 'Human Labels': [3, 9], 'AI Labels': [0, 3] });
    expect(labels.data.datasets.map((d) => d.pointRadius)).toEqual([3, 3]);
    expect(textOf(container().querySelector('.preview-section:nth-child(2) .preview-title')))
      .toBe('Labels per Day (All Deployments)');
  });

  it("stacks each day's human validations by result", async () => {
    await renderPreview();
    const validations = world.charts[1];
    expect(series(validations)).toEqual({ Agree: [0, 7], Disagree: [2, 0], Unsure: [1, 0] });
    expect(validations.options.scales.y).toMatchObject({ stacked: true, title: { text: 'Validations' } });
  });

  it('draws a line per label type in its label color, at zero on days it had nothing', async () => {
    await renderPreview();
    const byType = world.charts[2];
    expect(series(byType)).toEqual({ CurbRamp: [3, 5], Obstacle: [0, 4] });
    expect(byType.data.datasets.map((d) => d.borderColor)).toEqual(['#90C31F', '#78B0EA']);
    expect(byType.data.datasets[0].pointRadius).toBe(2);
    expect(byType.options.scales.y.stacked).toBe(false);
  });
});

describe('the period shown', () => {
  it('keeps the most recent 90 days with data, and drops the points once there are that many', async () => {
    await renderPreview({ data: days(95).map((date) => row(date, 'CurbRamp', { human_labels: 1 })) });
    const [labels, , byType] = world.charts;
    expect(labels.data.labels).toEqual(days(90));
    expect(labels.data.datasets.map((d) => d.pointRadius)).toEqual([0, 0]);
    expect(byType.data.datasets[0].pointRadius).toBe(0);
  });

  it('gives no agreement rate when no human validated anything', async () => {
    await renderPreview({ data: [row('2026-10-01', 'CurbRamp', { ai_validations_agree: 3 })] });
    expect(cards()['Human agreement rate']).toBe('N/A');
    expect(cards()['Total validations']).toBe('3');
  });

  it.each([
    ['an empty list', { data: [] }],
    ['no data field', {}],
  ])('says there is nothing to show for %s', async (_, response) => {
    await renderPreview(response);
    expect(textOf(container().querySelector('[role="status"]'))).toBe('No data available for this period.');
    expect(world.charts).toHaveLength(0);
  });
});

describe('when something fails', () => {
  it('shows the request failing', async () => {
    await renderPreview({ status: 502 });
    expect(textOf(container().querySelector('[role="alert"]'))).toBe('Failed to load preview: HTTP 502');
  });

  it('rejects when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const { AggregateStatsByDayPreview } = await loadModules('frontend/js/api-docs/statsByDayPreview.js');
    await expect(AggregateStatsByDayPreview.init()).rejects.toThrow('Container not found');
  });
});
