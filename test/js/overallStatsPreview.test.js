/**
 * The /v3/api-docs/overallStats preview (#5840): the city's summary cards and three bar charts (label counts, mean
 * severity, accuracy) built from canned /v3/api/overallStats and /v3/api/labelTypes responses.
 */

import { loadModules } from './loader.js';
import { flush, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world } from './support/apiDocsHarness.js';

stubApiDocsLibraries();

const LABEL_TYPES = {
  label_types: [
    { name: 'CurbRamp', color: '#90C31F', display_name: 'Curb Ramp', small_icon_url: '/c.png' },
    { name: 'Obstacle', color: '#78B0EA', display_name: 'Obstacle in Path', small_icon_url: '/o.png' },
  ],
};

/** A city's overall stats: CurbRamp and Obstacle carry severity, Signal has none, and NoSidewalk was never validated. */
function stats() {
  return {
    launch_date: '2019-04-01',
    km_explored: 123.456,
    km_explored_no_overlap: 100.1,
    user_counts: { all_users: 1500, labelers: 300, validators: 200 },
    labels: {
      count: 1000,
      avg_timestamp_last_100_labels: '2026-10-01T12:00:00Z',
      CurbRamp: { count: 600, severity_mean: 1.4, severity_stddev: 0.5, count_with_severity: 590 },
      Obstacle: { count: 300, severity_mean: 2.6, severity_stddev: null, count_with_severity: 1 },
      Signal: { count: 100, severity_mean: null },
    },
    validations: {
      combined: {
        total_validations: 4321,
        Overall: { accuracy: 0.876 },
        CurbRamp: { accuracy: 0.9, validated: 500, agreed: 450, disagreed: 50 },
        Obstacle: { accuracy: 0.75, validated: 40, agreed: 30, disagreed: 10 },
        NoSidewalk: { accuracy: 0, validated: 0, agreed: 0, disagreed: 0 },
        Signal: { validated: 3 },
      },
    },
  };
}

/** Loads the preview and runs it against the given responses. */
async function renderPreview({ routes = {}, setup = {} } = {}) {
  document.body.innerHTML = '<div id="overall-stats-preview"></div>';
  routeFetch({ '/v3/api/labelTypes': LABEL_TYPES, '/v3/api/overallStats': stats(), ...routes });
  const { OverallStatsPreview } = await loadModules('frontend/js/api-docs/overallStatsPreview.js');
  await OverallStatsPreview.setup({ apiBaseUrl: '/v3/api', cityName: 'Seattle', ...setup }).init();
  await flush();
  return OverallStatsPreview;
}

const container = () => document.getElementById('overall-stats-preview');

/** @returns {Record<string, string>} Each summary card's label to its value. */
const cards = () => Object.fromEntries([...container().querySelectorAll('.preview-stat')].map((stat) => [
  textOf(stat.querySelector('.preview-stat-label')), textOf(stat.querySelector('.preview-stat-value')),
]));

/** @returns {FakeChart} The chart drawn under the section with this title. */
const chartTitled = (title) => world.charts.find((chart) => chart.canvas.canvas.closest('.preview-section')
  .querySelector('.preview-title').textContent === title);

/** @returns {string|string[]} What a chart's tooltip shows for one bar. */
const tooltip = (chart, i) => ({
  title: chart.options.plugins.tooltip.callbacks.title([{ dataIndex: i }]),
  label: chart.options.plugins.tooltip.callbacks.label({ dataIndex: i }),
});

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  document.documentElement.removeAttribute('data-api-base-url');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // jsdom has no 2D canvas; the chart double only needs something to be handed.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return { canvas: this }; });
});

describe('the summary', () => {
  it("names the city and lays out its headline figures", async () => {
    await renderPreview();
    expect(textOf(container().querySelector('.preview-title'))).toBe('Summary Statistics in Seattle');
    expect(cards()).toEqual({
      'Launch Date': 'April 1, 2019',
      'Total Labels': '1,000',
      'Total Validations': '4,321',
      'Overall Accuracy': '87.6%',
      'Distance Explored': '123.46 km',
      'Distance Explored (No Overlap)': '100.10 km',
      'Total Users': '1,500',
      'Active Labelers': '300',
      'Active Validators': '200',
    });
    expect(textOf(container().querySelector('.preview-note'))).toMatch(/^Last activity: October 1, 2026 at /);
    expect(container().querySelector('.loading-message')).toBeNull();
  });

  it('says there is no last activity for a city with no recent labels', async () => {
    const data = stats();
    data.labels.avg_timestamp_last_100_labels = null;
    await renderPreview({ routes: { '/v3/api/overallStats': data } });
    expect(textOf(container().querySelector('.preview-note'))).toBe('Last activity: N/A');
  });
});

describe('the charts', () => {
  it('draws label counts largest first, named and colored as the label types API gives them', async () => {
    await renderPreview();
    const chart = chartTitled('Label Counts by Type');
    expect(chart.data.labels).toEqual(['Curb Ramp', 'Obstacle in Path', 'Signal']);
    expect(chart.data.datasets[0].data).toEqual([600, 300, 100]);
    // Signal isn't in the API's list, so it falls back to the neutral token; the border is a shade darker.
    expect(chart.data.datasets[0].backgroundColor).toEqual(['#90C31F', '#78B0EA', '#444444']);
    expect(chart.data.datasets[0].borderColor).toEqual(['#7caf0b', '#649cd6', '#303030']);
    expect(chart.options.scales.y.title.text).toBe('Number of Labels');
    expect(tooltip(chart, 0)).toEqual({ title: 'Curb Ramp', label: ['Count: 600', 'Percentage: 60.0%'] });
    expect(tooltip(chart, 2).title).toBe('Signal');
  });

  it('charts mean severity only for types that have one, most severe first', async () => {
    await renderPreview();
    const chart = chartTitled('Mean Severity by Label Type');
    expect(chart.data.labels).toEqual(['Obstacle in Path', 'Curb Ramp']);
    expect(chart.data.datasets[0].data).toEqual([2.6, 1.4]);
    expect(chart.options.scales.y).toMatchObject({ min: 1, max: 3 });
    // One severity-bearing label has no deviation.
    expect(tooltip(chart, 0).label).toEqual(
      ['Mean Severity: 2.60', 'Standard Deviation: n/a', 'Labels with Severity: 1']);
    expect(tooltip(chart, 1).label).toEqual(
      ['Mean Severity: 1.40', 'Standard Deviation: 0.50', 'Labels with Severity: 590']);
  });

  it('charts accuracy as a percentage for validated types only, most accurate first', async () => {
    await renderPreview();
    const chart = chartTitled('Label Accuracy by Type');
    expect(chart.data.labels).toEqual(['Curb Ramp', 'Obstacle in Path']);
    expect(chart.data.datasets[0].data).toEqual([90, 75]);
    expect(tooltip(chart, 1)).toEqual({
      title: 'Obstacle in Path',
      label: ['Accuracy: 75.0%', 'Validations: 40', 'Agreed: 30', 'Disagreed: 10'],
    });
  });

  it('falls back to machine names when the label types API lists none', async () => {
    await renderPreview({ routes: { '/v3/api/labelTypes': {} } });
    const chart = chartTitled('Mean Severity by Label Type');
    expect(chart.data.labels).toEqual(['Obstacle', 'CurbRamp']);
    expect(tooltip(chart, 0).title).toBe('Obstacle');
    expect(chartTitled('Label Accuracy by Type').data.labels).toEqual(['CurbRamp', 'Obstacle']);
    expect(tooltip(chartTitled('Label Accuracy by Type'), 0).title).toBe('CurbRamp');
  });
});

describe('where it fetches from', () => {
  it("prefers the page's API base URL over the configured one", async () => {
    document.documentElement.setAttribute('data-api-base-url', '/other/api');
    document.body.innerHTML = '<div id="overall-stats-preview"></div>';
    const fetchStub = routeFetch({ '/other/api/labelTypes': LABEL_TYPES, '/other/api/overallStats': stats() });
    const { OverallStatsPreview } = await loadModules('frontend/js/api-docs/overallStatsPreview.js');
    await OverallStatsPreview.setup({ apiBaseUrl: '/v3/api' }).init();
    expect(fetchStub.mock.calls.map(([url]) => url)).toEqual(
      ['/other/api/labelTypes?utm_source=apiDocs', '/other/api/overallStats?utm_source=apiDocs']);
  });
});

describe('darkenColor', () => {
  it('darkens a short hex, and stops each channel at zero', async () => {
    const preview = await renderPreview();
    expect(preview.darkenColor('#abc', 16)).toBe('#9aabbc');
    expect(preview.darkenColor('102030', 32)).toBe('#000010');
  });
});

describe('when something fails', () => {
  it('shows the label types request failing, and asks for no stats', async () => {
    document.body.innerHTML = '<div id="overall-stats-preview"></div>';
    const fetchStub = routeFetch({ '/v3/api/labelTypes': { status: 500 } });
    const { OverallStatsPreview } = await loadModules('frontend/js/api-docs/overallStatsPreview.js');
    await OverallStatsPreview.setup({ apiBaseUrl: '/v3/api' }).init();
    expect(textOf(container())).toBe('Failed to load data: HTTP error! Status: 500');
    expect(container().querySelector('[role="alert"]')).not.toBeNull();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('shows the stats request failing', async () => {
    await renderPreview({ routes: { '/v3/api/overallStats': { status: 404 } } });
    expect(textOf(container())).toBe('Failed to load data: HTTP error! Status: 404');
    expect(world.charts).toHaveLength(0);
  });

  it('rejects, and reports it, when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const { OverallStatsPreview } = await loadModules('frontend/js/api-docs/overallStatsPreview.js');
    await expect(OverallStatsPreview.setup({ containerId: 'nowhere' }).init()).rejects.toThrow(
      'Container element not found');
    expect(console.error).toHaveBeenCalledWith("Container element with id 'nowhere' not found.");
  });
});
