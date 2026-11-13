/** Tests for the admin Coverage page: its KPIs, views, and the selection shared by map, charts and table (#5840). */

import { loadModules, mockModule, useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { fakeVegaEmbed, stubMapbox } from './support/adminMapHarness.js';
import { flush, routeFetch, textOf } from './support/routeFetch.js';

useUtil(metricDistanceUtil);

const mapboxgl = {};
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));
let vega = fakeVegaEmbed();
mockModule('vega-embed', () => ({ default: (...args) => vega.embed(...args) }));
const { CoveragePage } = await loadModules('frontend/js/admin-dashboard/CoveragePage.js');

const REGIONS_URL = '/v3/api/regions?filetype=geojson';

// The markup app/views/admin/dashboard/coverage.scala.html renders.
const MARKUP = `
  <span id="kpi-city-coverage">—</span><span id="kpi-city-coverage-note"></span>
  <span id="kpi-regions">—</span><span id="kpi-fully-audited">—</span><span id="kpi-needs-reaudit">—</span>
  <div class="coverage-status" id="coverage-status" role="status">Loading coverage data…</div>
  <div id="coverage-choropleth"></div>
  <div class="coverage-legend" id="coverage-legend"></div>
  <button type="button" class="coverage-toggle-btn" data-view="bars" aria-pressed="false">Per region</button>
  <button type="button" class="coverage-toggle-btn" data-view="distribution" aria-pressed="false">Distribution</button>
  <div id="coverage-bars-view">
    <button type="button" class="coverage-sort-btn is-active" data-sort="coverage" aria-pressed="true">Coverage</button>
    <button type="button" class="coverage-sort-btn" data-sort="name" aria-pressed="false">Name</button>
    <div id="coverage-bars"></div>
  </div>
  <div id="coverage-distribution-view" hidden>
    <div id="coverage-histogram"></div>
    <input type="search" id="coverage-table-search">
    <table id="coverage-table"></table>
  </div>`;

/** @returns {object} A region feature shaped like /v3/api/regions?filetype=geojson returns. */
function region(id, name, rate, { total = 1000, outdated = 0 } = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[id, 0], [id + 1, 0], [id + 1, 1], [id, 0]]] },
    properties: {
      region_id: id, name, label_count: 10 * id, street_count: id, user_count: 2, audit_count: 3,
      total_distance_m: total, audited_distance_m: rate === null ? 0 : rate * total, outdated_distance_m: outdated,
      completion_rate: rate, first_label_date: null, last_label_date: null,
    },
  };
}

/** @returns {Array<object>} `count` regions with coverage spread from 0 up. */
const manyRegions = (count) => Array.from({ length: count }, (_, i) => region(i + 1, `Region ${i + 1}`, i / count));

let map;

/** @returns {Promise<void>} Resolves once the page has started on `answer` and its map has loaded. */
async function load(answer, { markup = MARKUP } = {}) {
  document.body.innerHTML = markup;
  routeFetch({ [REGIONS_URL]: answer });
  map = stubMapbox(mapboxgl);
  const done = new CoveragePage({ mapboxToken: 'pk.test', regionsUrl: REGIONS_URL }).init();
  await flush();
  map.load();
  await done;
}

const status = () => document.getElementById('coverage-status');
const button = (selector) => document.querySelector(selector);
const lastChart = () => vega.charts.at(-1);
/** @returns {number[]} Region ids the map currently outlines. */
const mapSelected = () => {
  const latest = new Map();
  for (const { target, value } of map.featureStates) if ('selected' in value) latest.set(target.id, value.selected);
  return [...latest].filter(([, on]) => on).map(([id]) => id).sort((a, b) => a - b);
};

beforeEach(() => {
  vega = fakeVegaEmbed();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loading', () => {
  test('sums city-wide coverage, fully audited regions and re-audit distance into the KPIs', async () => {
    await load({ type: 'FeatureCollection', features: [
      region(1, 'Downtown', 1, { total: 3000, outdated: 500 }),
      region(2, 'Ballard', 0.25, { total: 1000, outdated: 1500 }),
    ] });

    expect(textOf(document.getElementById('kpi-city-coverage'))).toBe('81%');
    expect(textOf(document.getElementById('kpi-city-coverage-note'))).toBe('3.3 km of 4.0 km');
    expect(textOf(document.getElementById('kpi-regions'))).toBe('2');
    expect(textOf(document.getElementById('kpi-fully-audited'))).toBe('1');
    expect(textOf(document.getElementById('kpi-needs-reaudit'))).toBe('2.0 km');
    const legend = [...document.querySelectorAll('#coverage-legend span')].map(textOf);
    expect(legend).toEqual(['0%', '', '100%', 'audit coverage']);
    expect(status().classList.contains('ps-hidden')).toBe(true);
  });

  test('reads regions with no street length or no rate as 0% instead of dividing by zero', async () => {
    const empty = region(1, 'Harbor', null, { total: 0 });
    delete empty.properties.outdated_distance_m;
    await load({ type: 'FeatureCollection', features: [empty] });

    expect(textOf(document.getElementById('kpi-city-coverage'))).toBe('0%');
    expect(textOf(document.getElementById('kpi-fully-audited'))).toBe('0');
    expect(textOf(document.getElementById('kpi-needs-reaudit'))).toBe('0.0 km');
  });

  test('says so when the city has no regions, and draws no map', async () => {
    await load({ type: 'FeatureCollection' });
    expect(textOf(status())).toBe('No region data available for this city yet.');
    expect(status().classList.contains('error')).toBe(false);
    expect(map.options).toBeNull();
  });

  test('reports a failed regions request as an error', async () => {
    await load({ status: 500 });
    expect(textOf(status())).toBe('Could not load coverage data. Please try again.');
    expect(status().classList.contains('error')).toBe(true);
    expect(textOf(document.getElementById('kpi-city-coverage'))).toBe('—');
  });

  test('still loads when the page has no status line to update', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 0.5)] },
      { markup: MARKUP.replace(/<div class="coverage-status"[^]*?<\/div>/, '') });
    expect(textOf(document.getElementById('kpi-regions'))).toBe('1');
  });
});

describe('choosing a view', () => {
  test('a small city opens on per-region bars colored to match the map', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 1), region(2, 'Ballard', 0)] });

    expect(document.getElementById('coverage-bars-view').hidden).toBe(false);
    expect(document.getElementById('coverage-distribution-view').hidden).toBe(true);
    expect(button('[data-view="bars"]').getAttribute('aria-pressed')).toBe('true');
    expect(lastChart().target).toBe('#coverage-bars');
    const rows = lastChart().spec.data.values;
    expect(rows.map((r) => [r.region_id, r.color, r.audited_distance_text])).toEqual([
      [1, 'rgb(33, 113, 181)', '1.0 km'],
      [2, 'rgb(239, 243, 255)', '0.0 km'],
    ]);
  });

  test('a city of more than 40 regions opens on the histogram and region table instead', async () => {
    await load({ type: 'FeatureCollection', features: manyRegions(41) });

    expect(document.getElementById('coverage-bars-view').hidden).toBe(true);
    expect(document.getElementById('coverage-distribution-view').hidden).toBe(false);
    expect(lastChart().target).toBe('#coverage-histogram');
    const buckets = lastChart().spec.data.values;
    expect(buckets).toHaveLength(10);
    expect(buckets[0]).toMatchObject({ label: '0–10%', count: 5 });
    expect(buckets[9]).toMatchObject({ label: '90–100%', count: 4 });
    expect(document.querySelectorAll('#coverage-table tbody tr')).toHaveLength(41);
  });

  test('a fully covered region lands in the top bucket rather than an eleventh one', async () => {
    await load({ type: 'FeatureCollection', features: [...manyRegions(40), region(99, 'Done', 1)] });
    expect(lastChart().spec.data.values[9].count).toBe(5);
  });

  test('switching views redraws the chart and leaves the table built only once', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 0.5)] });

    button('[data-view="distribution"]').click();
    await flush();
    expect(document.getElementById('coverage-distribution-view').hidden).toBe(false);
    expect(lastChart().target).toBe('#coverage-histogram');

    const firstRow = document.querySelector('#coverage-table tbody tr');
    button('[data-view="bars"]').click();
    await flush();
    button('[data-view="distribution"]').click();
    await flush();
    expect(document.querySelector('#coverage-table tbody tr')).toBe(firstRow);
    expect(vega.charts.map((c) => c.target)).toEqual(
      ['#coverage-bars', '#coverage-histogram', '#coverage-bars', '#coverage-histogram']);
  });

  test('clicking the view already shown does nothing', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 0.5)] });
    button('[data-view="bars"]').click();
    await flush();
    expect(vega.charts).toHaveLength(1);
  });

  test('a chart that fails to draw after a switch is reported', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 0.5)] });
    vega.embed.mockRejectedValueOnce(new Error('boom'));
    button('[data-view="distribution"]').click();
    await flush();
    expect(textOf(status())).toBe('Could not draw the chart. Please try again.');
    expect(status().classList.contains('error')).toBe(true);
  });

  test('sorting the bars by name redraws them once, and keeps a pinned region highlighted', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 0.5), region(2, 'Ballard', 0.2)] });
    lastChart().fire('click', { region_id: 2 });

    const byName = button('[data-sort="name"]');
    byName.click();
    await flush();
    expect(byName.classList.contains('is-active')).toBe(true);
    expect(button('[data-sort="coverage"]').getAttribute('aria-pressed')).toBe('false');
    expect(lastChart().spec.encoding.y.sort).toBe('ascending');
    expect(lastChart().signals.at(-1)).toEqual({ name: 'externalSelect', value: [2] });

    byName.click();
    await flush();
    expect(vega.charts).toHaveLength(2);
  });
});

describe('selection', () => {
  test('clicking a region on the map pins it on the map and the bars; clicking again unpins it', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 0.5), region(2, 'Ballard', 0.2)] });

    map.fire('click', 'coverage-fill', { features: [{ id: 2 }] });
    expect(mapSelected()).toEqual([2]);
    expect(lastChart().signals.at(-1).value).toEqual([2]);

    map.fire('click', 'coverage-fill', { features: [{ id: 2 }] });
    expect(mapSelected()).toEqual([]);
    expect(lastChart().signals.at(-1).value).toBeNull();
  });

  test('hovering a bar brushes its region over a pin, and leaving it goes back to the pin', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 0.5), region(2, 'Ballard', 0.2)] });
    lastChart().fire('click', { region_id: 1 });

    lastChart().fire('pointermove', { region_id: 2 });
    expect(mapSelected()).toEqual([2]);
    lastChart().fire('pointerout');
    expect(mapSelected()).toEqual([1]);
  });

  test('hovering a region on the map brushes its bar', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 0.5), region(2, 'Ballard', 0.2)] });
    const { properties } = region(1, 'Downtown', 0.5);
    map.fire('mousemove', 'coverage-fill', { features: [{ id: 1, properties }] });
    expect(lastChart().signals.at(-1).value).toEqual([1]);
    map.fire('mouseleave', 'coverage-fill');
    expect(lastChart().signals.at(-1).value).toBeNull();
  });

  test('a histogram bucket brushes every region in that range on the map and in the table', async () => {
    await load({ type: 'FeatureCollection', features: manyRegions(50) });
    const histogram = lastChart();

    histogram.fire('pointermove', { index: 0 });
    expect(mapSelected()).toEqual([1, 2, 3, 4, 5]);
    const highlighted = [...document.querySelectorAll('#coverage-table tr.is-highlighted')];
    expect(highlighted.map((tr) => Number(tr.dataset.regionId)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);

    histogram.fire('pointerout');
    expect(mapSelected()).toEqual([]);
    expect(document.querySelectorAll('#coverage-table tr.is-highlighted')).toHaveLength(0);

    histogram.fire('click', { index: 9 });
    expect(mapSelected()).toEqual([46, 47, 48, 49, 50]);
  });

  test('hovering and clicking table rows brushes and pins their regions on the map', async () => {
    await load({ type: 'FeatureCollection', features: manyRegions(41) });
    const row = document.querySelector('#coverage-table tr[data-region-id="7"]');

    row.firstElementChild.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(mapSelected()).toEqual([7]);
    document.querySelector('#coverage-table tbody').dispatchEvent(new Event('pointerleave'));
    expect(mapSelected()).toEqual([]);

    row.firstElementChild.click();
    expect(mapSelected()).toEqual([7]);
    expect(row.classList.contains('is-highlighted')).toBe(true);
  });

  test('switching views drops any pinned region', async () => {
    await load({ type: 'FeatureCollection', features: [region(1, 'Downtown', 0.5)] });
    map.fire('click', 'coverage-fill', { features: [{ id: 1 }] });
    button('[data-view="distribution"]').click();
    await flush();
    expect(mapSelected()).toEqual([]);
  });
});
