/** The /v3/api-docs/userStats preview (#5840): top labelers, their label types, and accuracy against volume. */

import { loadModules } from './loader.js';
import { flush, resetWorld, routeFetch, stubApiDocsLibraries, textOf, world } from './support/apiDocsHarness.js';

stubApiDocsLibraries();

const LABEL_TYPES = {
  label_types: [
    { name: 'CurbRamp', color: '#90C31F', display_name: 'Curb Ramp' },
    { name: 'Obstacle', color: '#78B0EA', display_name: 'Obstacle in Path' },
  ],
};

/** A distinct color per accuracy tier, so a test can tell which tier a bubble got. */
const TIER_TOKENS = {
  '--color-jade-400': '#110000',
  '--color-jade-700': '#120000',
  '--color-banana-600': '#002200',
  '--color-banana-800': '#002300',
  '--color-orange-500': '#000033',
  '--color-orange-700': '#000034',
  '--color-neutral-500': '#555555',
};

function user(id, labels, overrides = {}) {
  return {
    user_id: id,
    labels,
    meters_explored: 1234.6,
    validations_given: 0,
    label_accuracy: null,
    validated_labels: 0,
    stats_by_label_type: {
      CurbRamp: { labels: Math.ceil(labels / 2) },
      Obstacle: { labels: Math.floor(labels / 2) },
      Signal: { labels: 0 },
      Other: { labels: labels > 20 ? 1 : 0 },
    },
    ...overrides,
  };
}

/** Four users: one accurate, one middling, one poor (all validated enough to plot), and one with no labels. */
function users() {
  return [
    user('aaaaaaaa-1111', 40, { label_accuracy: 0.8, validated_labels: 25, validations_given: 5 }),
    user('bbbbbbbb-2222', 100, { label_accuracy: 0.95, validated_labels: 900 }),
    user('cccccccc-3333', 12, { label_accuracy: 0.5, validated_labels: 6 }),
    user('dddddddd-4444', 11, { label_accuracy: 1, validated_labels: 5 }),
    user('eeeeeeee-5555', 0),
  ];
}

async function renderPreview({ routes = {}, setup = {} } = {}) {
  document.body.innerHTML = '<div id="user-stats-preview"></div>';
  const fetchStub = routeFetch({
    '/v3/api/labelTypes': LABEL_TYPES,
    '/v3/api/userStats?minLabels=10': users(),
    ...routes,
  });
  const { UserStatsPreview } = await loadModules('frontend/js/api-docs/userStatsPreview.js');
  await UserStatsPreview.setup({ apiBaseUrl: '/v3/api', cityName: 'Seattle', ...setup }).init();
  await flush();
  return fetchStub;
}

const container = () => document.getElementById('user-stats-preview');

const section = (title) => [...container().querySelectorAll('.preview-section')]
  .find((s) => s.querySelector('.preview-title').textContent === title);

/** A chart is drawn on the 2D context stand-in, whose `canvas` is the real element. */
const chartTitled = (title) => world.charts.find((chart) => chart.canvas.canvas.closest('.preview-section')
  === section(title));

const tooltip = (chart, i) => {
  const { callbacks } = chart.options.plugins.tooltip;
  return { title: callbacks.title([{ dataIndex: i }]), label: callbacks.label?.({ dataIndex: i }) };
};

beforeEach(() => {
  resetWorld();
  Object.entries(TIER_TOKENS).forEach(([token, value]) => document.documentElement.style.setProperty(token, value));
  document.documentElement.removeAttribute('data-api-base-url');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return { canvas: this }; });
});

describe('the top labelers', () => {
  it('ranks users by labels, most first, under abbreviated IDs, leaving out anyone with none', async () => {
    await renderPreview();
    const chart = chartTitled('Top Labelers in Seattle');
    expect(chart.data.labels).toEqual(['bbbbbbbb...', 'aaaaaaaa...', 'cccccccc...', 'dddddddd...']);
    expect(chart.data.datasets[0].data).toEqual([100, 40, 12, 11]);
    expect(tooltip(chart, 1))
      .toEqual({ title: 'User: aaaaaaaa-1111', label: ['Labels: 40', 'Meters explored: 1235'] });
    expect(textOf(container().querySelector('.preview-note')))
      .toBe('Showing data for 4 users with at least 10 labels.');
  });

  it('shows no more users than configured', async () => {
    await renderPreview({ setup: { maxUsers: 2 } });
    expect(chartTitled('Top Labelers in Seattle').data.labels).toEqual(['bbbbbbbb...', 'aaaaaaaa...']);
  });

  it("asks only for users past the configured label minimum", async () => {
    const fetchStub = await renderPreview(
      { setup: { minLabels: 25 }, routes: { '/v3/api/userStats?minLabels=25': [] } });
    expect(fetchStub.mock.calls.map(([url]) => url)).toContain('/v3/api/userStats?minLabels=25&utm_source=apiDocs');
  });
});

describe("the top labelers' label types", () => {
  it('stacks each type the top users placed, largest first, dropping types none of them used', async () => {
    await renderPreview();
    const chart = chartTitled('Top Labelers with Label Type in Seattle');
    expect(chart.data.datasets.map((d) => [d.label, d.data, d.backgroundColor])).toEqual([
      ['Curb Ramp', [50, 20, 6, 6], '#90C31F'],
      ['Obstacle in Path', [50, 20, 6, 5], '#78B0EA'],
      // Not in the API's list, so it shows its raw name in the neutral color.
      ['Other', [1, 1, 0, 0], '#555555'],
    ]);
    expect(chart.options.scales.y.stacked).toBe(true);
    expect(tooltip(chart, 0).title).toBe('User: bbbbbbbb-2222');
  });

  it('says the data is malformed when a user row lacks its label-type breakdown', async () => {
    const malformed = user('aaaaaaaa', 40, { stats_by_label_type: undefined });
    await renderPreview({ routes: { '/v3/api/userStats?minLabels=10': [malformed] } });
    const alert = section('Top Labelers with Label Type in Seattle').querySelector('[role="alert"]');
    expect(textOf(alert)).toBe('Unable to render chart: Invalid data structure');
    expect(console.error).toHaveBeenCalledWith("User data doesn't have the expected structure for label types");
  });
});

describe('accuracy against volume', () => {
  it('plots only users with more than five validated labels, sized by how many, on a log scale', async () => {
    await renderPreview();
    const chart = chartTitled('Label Accuracy vs. Contribution Volume');
    const points = chart.data.datasets[0].data;
    expect(points.map(({ x, y }) => [x, y])).toEqual([[100, 0.95], [40, 0.8], [12, 0.5]]);
    // Bubble size grows with validated labels, held between 5 and 20.
    expect(points.map((p) => p.r)).toEqual([20, 5, 5]);
    expect(chart.options.scales.x.type).toBe('logarithmic');
  });

  it('colors accuracy above 90% good, above 75% middling, and the rest poor', async () => {
    await renderPreview();
    const dataset = chartTitled('Label Accuracy vs. Contribution Volume').data.datasets[0];
    expect(dataset.backgroundColor).toEqual(
      ['rgba(17, 0, 0, 0.6)', 'rgba(0, 34, 0, 0.6)', 'rgba(0, 0, 51, 0.6)']);
    expect(dataset.borderColor).toEqual(['#120000', '#002300', '#000034']);
  });

  it("gives each user's accuracy, volume and distance in the tooltip", async () => {
    await renderPreview();
    expect(tooltip(chartTitled('Label Accuracy vs. Contribution Volume'), 0)).toEqual({
      title: 'User: bbbbbbbb-2222',
      label: ['Accuracy: 95.0%', 'Total Labels: 100', 'Validated Labels: 900', 'Meters Explored: 1235'],
    });
  });

  it('labels the accuracy axis in quarter steps up to 100%, and nothing above', async () => {
    await renderPreview();
    const { callback } = chartTitled('Label Accuracy vs. Contribution Volume').options.scales.y.ticks;
    expect([0, 0.25, 0.5, 0.75, 1, 1.1].map((v) => callback(v))).toEqual(['0%', '25%', '50%', '75%', '100%', '']);
  });

  it('says so when no user has enough validated labels to plot', async () => {
    await renderPreview({ routes: { '/v3/api/userStats?minLabels=10': [user('aaaaaaaa', 40)] } });
    const note = section('Label Accuracy vs. Contribution Volume').querySelector('[role="status"]');
    expect(textOf(note)).toBe('No users with sufficient validation data available');
  });
});

describe('a city with no contributors yet', () => {
  it('says so in place of both user charts, rather than drawing empty axes', async () => {
    await renderPreview({ routes: { '/v3/api/userStats?minLabels=10': [user('eeeeeeee', 0)] } });
    ['Top Labelers in Seattle', 'Top Labelers with Label Type in Seattle'].forEach((title) => {
      expect(textOf(section(title).querySelector('[role="status"]'))).toBe('No user contributions yet.');
    });
    expect(world.charts).toHaveLength(0);
    expect(textOf(container().lastElementChild))
      .toBe('Showing data for 0 users with at least 10 labels.');
  });
});

describe('where it fetches from', () => {
  it("prefers the page's API base URL, and still draws with no label types listed", async () => {
    document.documentElement.setAttribute('data-api-base-url', '/other/api');
    document.body.innerHTML = '<div id="user-stats-preview"></div>';
    routeFetch({ '/other/api/labelTypes': null, '/other/api/userStats?minLabels=10': users() });
    const { UserStatsPreview } = await loadModules('frontend/js/api-docs/userStatsPreview.js');
    await UserStatsPreview.setup({ cityName: 'Seattle' }).init();
    const chart = chartTitled('Top Labelers with Label Type in Seattle');
    expect(chart.data.datasets.map((d) => d.label)).toEqual(['CurbRamp', 'Obstacle', 'Other']);
  });
});

describe('when something fails', () => {
  it('shows the label types request failing', async () => {
    await renderPreview({ routes: { '/v3/api/labelTypes': { status: 500 } } });
    expect(textOf(container().querySelector('[role="alert"]'))).toBe('Failed to load data: HTTP error! Status: 500');
  });

  it('shows the user stats request failing', async () => {
    await renderPreview({ routes: { '/v3/api/userStats?minLabels=10': { status: 503 } } });
    expect(textOf(container())).toBe('Failed to load data: HTTP error! Status: 503');
    expect(world.charts).toHaveLength(0);
  });

  it('rejects, and reports it, when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const { UserStatsPreview } = await loadModules('frontend/js/api-docs/userStatsPreview.js');
    await expect(UserStatsPreview.setup({ containerId: 'nowhere' }).init()).rejects.toThrow(
      'Container element not found');
    expect(console.error).toHaveBeenCalledWith("Container element with id 'nowhere' not found.");
  });
});
