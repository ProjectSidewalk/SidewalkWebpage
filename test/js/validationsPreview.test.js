/** The /v3/api-docs/validations preview (#5840): overall rates, and an agree/disagree/unsure chart per type. */

import { loadModules } from './loader.js';
import {
  flush, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

const LABEL_TYPES = {
  label_types: [
    { name: 'CurbRamp', color: '#90C31F', display_name: 'Curb Ramp' },
    { name: 'Obstacle', color: '#78B0EA', display_name: 'Obstacle in Path' },
  ],
};

const validations = (labelType, result, count) => Array.from(
  { length: count }, () => ({ label_type: labelType, validation_result: result }));

/**
 * CurbRamp: 6 agree, 2 disagree, 2 unsure. Signal, which the label types list lacks: 4 agree, 1 disagree. Obstacle:
 * 3 agree, too few to chart by default, plus one result the preview doesn't know, which counts in the total only.
 */
function data() {
  return [
    ...validations('CurbRamp', 'Agree', 6),
    ...validations('CurbRamp', 'Disagree', 2),
    ...validations('CurbRamp', 'Unsure', 2),
    ...validations('Signal', 'Agree', 4),
    ...validations('Signal', 'Disagree', 1),
    ...validations('Obstacle', 'Agree', 3),
    ...validations('Obstacle', 'Skip', 1),
  ];
}

async function renderPreview({ routes = {}, setup = {} } = {}) {
  document.body.innerHTML = '<div id="validations-preview"></div>';
  const fetchStub = routeFetch({ '/v3/api/labelTypes': LABEL_TYPES, '/v3/api/validations': data(), ...routes });
  const { ValidationsPreview } = await loadModules('frontend/js/api-docs/validationsPreview.js');
  await ValidationsPreview.setup(setup).init();
  await flush();
  return { fetchStub, ValidationsPreview };
}

const container = () => document.getElementById('validations-preview');

const cards = () => Object.fromEntries([...container().querySelectorAll('.summary-stat-item')].map((stat) => [
  textOf(stat.querySelector('.summary-stat-label')), textOf(stat.querySelector('.summary-stat-value')),
]));

const chartTitles = () => [...container().querySelectorAll('.chart-title')].map(textOf);

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () { return { canvas: this }; });
});

describe('the overview', () => {
  it('gives the overall rates across every validation', async () => {
    await renderPreview();
    expect(textOf(container().querySelector('.validation-summary h3'))).toBe('Validation Results Overview');
    expect(cards()).toEqual({
      'Total Validations': '19',
      'Agree Rate': '68.4%',
      'Disagree Rate': '15.8%',
      'Unsure Rate': '10.5%',
      'Label Types Shown': '2',
    });
  });

  it('gives no rates for a city with no validations yet', async () => {
    await renderPreview({ routes: { '/v3/api/validations': [] } });
    expect(cards()).toEqual({
      'Total Validations': '0',
      'Agree Rate': 'N/A',
      'Disagree Rate': 'N/A',
      'Unsure Rate': 'N/A',
      'Label Types Shown': '0',
    });
  });

  it('says how many label types were left out for having too few validations', async () => {
    await renderPreview();
    expect(textOf(container().lastElementChild)).toBe('Showing validation result distributions for 2 label types '
      + 'with the most validations (1 types with fewer validations not shown). Total: 19 validations.');
  });

  it('mentions nothing left out when every type is charted', async () => {
    await renderPreview({ setup: { minValidationsToShow: 1 } });
    expect(textOf(container().lastElementChild)).toBe(
      'Showing validation result distributions for 3 label types with the most validations. Total: 19 validations.');
  });
});

describe('the per-type charts', () => {
  it('charts the most-validated types first, named as the label types API gives them', async () => {
    await renderPreview();
    expect(chartTitles()).toEqual(['Curb Ramp', 'Signal']);
    expect(world.charts.map((chart) => chart.data.datasets[0].data)).toEqual([[6, 2, 2], [4, 1, 0]]);
    expect(world.charts[0].data.labels).toEqual(['Agree', 'Disagree', 'Unsure']);
  });

  it("shades the type's own color lighter for agree and darker for unsure", async () => {
    await renderPreview();
    const [curbRamp, signal] = world.charts.map((chart) => chart.data.datasets[0]);
    expect(curbRamp.backgroundColor).toEqual(['#aee13d', '#90C31F', '#72a501']);
    expect(curbRamp.borderColor).toEqual(['#9acd29', '#7caf0b', '#5e9100']);
    // Signal isn't in the label types list, so it starts from the neutral token.
    expect(signal.backgroundColor).toEqual(['#626262', '#444444', '#262626']);
  });

  it('lightens a short hex color, stopping each channel at white', async () => {
    const { ValidationsPreview } = await renderPreview();
    expect(ValidationsPreview.lightenColor('#abc', 16)).toBe('#bacbdc');
    expect(ValidationsPreview.lightenColor('f0e0d0', 32)).toBe('#fffff0');
    expect(ValidationsPreview.darkenColor('#abc', 16)).toBe('#9aabbc');
  });

  it('gives each bar its count and share of that type in the tooltip', async () => {
    await renderPreview();
    const { label } = world.charts[0].options.plugins.tooltip.callbacks;
    expect(label({ parsed: { y: 6 } })).toEqual(['Count: 6', 'Percentage: 60.0%']);
  });

  it('shows no more charts than configured', async () => {
    await renderPreview({ setup: { maxChartsToShow: 1 } });
    expect(chartTitles()).toEqual(['Curb Ramp']);
    expect(cards()['Label Types Shown']).toBe('1');
  });

  it('falls back to machine names when the label types API lists none', async () => {
    await renderPreview({ routes: { '/v3/api/labelTypes': {} } });
    expect(chartTitles()).toEqual(['CurbRamp', 'Signal']);
  });
});

describe('when something fails', () => {
  it('shows the label types request failing, and asks for no validations', async () => {
    const { fetchStub } = await renderPreview({ routes: { '/v3/api/labelTypes': { status: 500 } } });
    expect(textOf(container().querySelector('[role="alert"]')))
      .toBe('Failed to load validation data: Failed to fetch label types: HTTP 500');
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('shows the validations request failing', async () => {
    await renderPreview({ routes: { '/v3/api/validations': { status: 504 } } });
    expect(textOf(container())).toBe('Failed to load validation data: Failed to fetch validations: HTTP 504');
    expect(world.charts).toHaveLength(0);
  });

  it('rejects, and reports it, when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const { ValidationsPreview } = await loadModules('frontend/js/api-docs/validationsPreview.js');
    await expect(ValidationsPreview.setup({ containerId: 'nowhere' }).init()).rejects.toThrow(
      'Container element not found');
    expect(console.error).toHaveBeenCalledWith("Container element with id 'nowhere' not found.");
  });
});
