/**
 * The /v3/api-docs/overallStatsByDay preview (#5840): the summary cards and three daily charts (human labels,
 * validations by result, labels by type) built from a canned /v3/api/overallStatsByDay response.
 */

import { loadModules } from './loader.js';
import { flush, resetWorld, routeFetch, stubApiDocsLibraries, textOf, world } from './support/apiDocsHarness.js';

stubApiDocsLibraries();

/** One row of the endpoint's flat data: a label type's activity on one day. */
function row(date, labelType, overrides = {}) {
  return {
    date,
    label_type: labelType,
    human_labels: 0,
    ai_labels: 0,
    human_validations_agree: 0,
    human_validations_disagree: 0,
    human_validations_unsure: 0,
    ...overrides,
  };
}

/** Two days: CurbRamp on both, Obstacle only on the second. */
const TWO_DAYS = [
  row('2026-10-02', 'CurbRamp', { human_labels: 5, ai_labels: 2, human_validations_agree: 6 }),
  row('2026-10-01', 'CurbRamp', { human_labels: 3, human_validations_disagree: 2, human_validations_unsure: 1 }),
  row('2026-10-02', 'Obstacle', { human_labels: 4, ai_labels: 1, human_validations_agree: 1 }),
];

/** @returns {string[]} `count` consecutive days ending 2026-10-31 (some reach back into earlier months), ascending. */
function days(count) {
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 9, 31 - (count - 1) + i))
    .toISOString().slice(0, 10));
}

/** Loads the preview and runs it against the given response. */
async function renderPreview(response = { data: TWO_DAYS }, setup = {}) {
  document.body.innerHTML = '<div id="overall-stats-by-day-preview"></div>';
  const fetchStub = routeFetch({ '/v3/api/overallStatsByDay': response });
  const { OverallStatsByDayPreview } = await loadModules('frontend/js/api-docs/overallStatsByDayPreview.js');
  await OverallStatsByDayPreview.setup({ apiBaseUrl: '/v3/api', ...setup }).init();
  await flush();
  return fetchStub;
}

const container = () => document.getElementById('overall-stats-by-day-preview');

/** @returns {Record<string, string>} Each summary card's label to its value. */
const cards = () => Object.fromEntries([...container().querySelectorAll('.preview-stat')].map((stat) => [
  textOf(stat.querySelector('.preview-stat-label')), textOf(stat.querySelector('.preview-stat-value')),
]));

/** @returns {string[]} Each chart section's title and description. */
const sections = () => [...container().querySelectorAll('.preview-section:not(.preview-stat-grid)')]
  .map((section) => `${textOf(section.querySelector('.preview-title'))}: ${textOf(section.querySelector('.preview-desc'))}`);

/** @returns {Record<string, number[]>} A chart's datasets, by legend label. */
const series = (chart) => Object.fromEntries(chart.data.datasets.map((d) => [d.label, d.data]));

beforeEach(() => {
  resetWorld();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return { canvas: this }; });
});

describe('a city with activity', () => {
  it('sums the period into the summary cards', async () => {
    await renderPreview();
    expect(cards()).toEqual({
      'Days shown': '2',
      'Human labels': '12',
      'AI labels': '3',
      Validations: '10',
      'Agreement rate': '70.0%',
    });
  });

  it("titles each chart, naming the city", async () => {
    await renderPreview(undefined, { cityName: 'Seattle <WA>' });
    expect(sections()).toEqual([
      'Human Labels per Day: Daily new labels placed by human contributors in Seattle <WA>',
      'Validations per Day: Daily validation activity breakdown in Seattle <WA>',
      'Human Labels per Day by Label Type: Each line represents one label type',
    ]);
  });

  it('charts human labels per day, summed across label types, oldest day first', async () => {
    await renderPreview();
    const [labels] = world.charts;
    expect(labels.data.labels).toEqual(['2026-10-01', '2026-10-02']);
    expect(series(labels)).toEqual({ 'Human Labels': [3, 9] });
    expect(labels.data.datasets[0].pointRadius).toBe(3);
    expect(labels.options.scales.y.title.text).toBe('Labels placed');
  });

  it('stacks each day\'s validations by result', async () => {
    await renderPreview();
    const validations = world.charts[1];
    expect(series(validations)).toEqual({ Agree: [0, 7], Disagree: [2, 0], Unsure: [1, 0] });
    expect(validations.options.scales.x.stacked).toBe(true);
    expect(validations.options.scales.y).toMatchObject({ stacked: true, title: { text: 'Validations' } });
  });

  it('draws a line per label type in its label color, at zero on days it had nothing', async () => {
    await renderPreview();
    const byType = world.charts[2];
    expect(series(byType)).toEqual({ CurbRamp: [3, 5], Obstacle: [0, 4] });
    expect(byType.data.datasets.map((d) => d.borderColor)).toEqual(['#90C31F', '#78B0EA']);
    expect(world.charts[0].options.scales.x.stacked).toBe(false);
  });
});

describe('the period shown', () => {
  it('keeps the most recent 90 days with data, and drops the points once there are that many', async () => {
    const data = days(95).map((date) => row(date, 'CurbRamp', { human_labels: 1 }));
    await renderPreview({ data });
    const [labels, , byType] = world.charts;
    expect(labels.data.labels).toHaveLength(90);
    expect(labels.data.labels[0]).toBe(days(90)[0]);
    expect(cards()['Days shown']).toBe('90');
    expect(labels.data.datasets[0].pointRadius).toBe(0);
    expect(byType.data.datasets[0].pointRadius).toBe(0);
  });

  it('gives no agreement rate when nothing was validated', async () => {
    await renderPreview({ data: [row('2026-10-01', 'CurbRamp', { human_labels: 2 })] });
    expect(cards()['Agreement rate']).toBe('N/A%');
    expect(world.charts[2].data.datasets[0].pointRadius).toBe(2);
  });

  it.each([
    ['an empty list', { data: [] }],
    ['no data field', {}],
  ])('says there is nothing to show for %s', async (_, response) => {
    await renderPreview(response);
    const note = container().querySelector('[role="status"]');
    expect(textOf(note)).toBe('No data available for this period.');
    expect(world.charts).toHaveLength(0);
  });
});

describe('when something fails', () => {
  it('shows the request failing', async () => {
    await renderPreview({ status: 500 });
    expect(textOf(container())).toBe('Failed to load preview: HTTP 500');
    expect(container().querySelector('[role="alert"]')).not.toBeNull();
  });

  it('rejects when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const { OverallStatsByDayPreview } = await loadModules('frontend/js/api-docs/overallStatsByDayPreview.js');
    await expect(OverallStatsByDayPreview.init()).rejects.toThrow('Container not found');
  });
});
