/** Tests for the admin Street Status page: its KPIs, legend, and the region selection map and table share (#5840). */

import { loadModules, mockModule } from './loader.js';
import { stubMapbox } from './support/adminMapHarness.js';
import { flush, routeFetch, textOf } from './support/routeFetch.js';

const mapboxgl = {};
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));

// The trend section has suites of its own; here it only matters what the page hands it and how it fails.
let trends = [];
let trendInit = () => Promise.resolve();
mockModule('frontend/js/admin-dashboard/StreetStatusTrend.js', () => ({
  StreetStatusTrend: class {
    constructor(opts) { this.opts = opts; trends.push(this); }

    init() { return trendInit(); }
  },
}));
const { StreetStatusPage } = await loadModules('frontend/js/admin-dashboard/StreetStatusPage.js');

const STREETS_URL = '/v3/api/streets?filetype=geojson';

// The parts of app/views/admin/dashboard/streetStatus.scala.html this page fills.
const MARKUP = `
  <span id="kpi-total-streets">—</span><span id="kpi-no-imagery">—</span>
  <span id="kpi-closed">—</span><span id="kpi-disabled">—</span>
  <div class="coverage-status" id="street-status-status" role="status">Loading street data…</div>
  <div class="page-section" id="street-status-map-section">
    <div id="street-status-choropleth"></div>
    <div class="street-status-legend" id="street-status-legend"></div>
  </div>
  <input type="search" id="street-status-table-search">
  <table id="street-status-table"></table>`;

/** @returns {object} A street feature shaped like /v3/api/streets?filetype=geojson returns. */
function street(id, regionId, regionName, status) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[-122 - id / 4, 47.5], [-122 - id / 4, 47.75]] },
    properties: { street_edge_id: id, region_id: regionId, region_name: regionName, status, way_type: 'residential',
      audit_count: 1, label_count: 2, user_count: 1 },
  };
}

const STREETS = { type: 'FeatureCollection', features: [
  street(1, 10, 'Downtown', 'open'),
  street(2, 10, 'Downtown', 'no_imagery'),
  street(3, 10, 'Downtown', 'no_imagery'),
  street(4, 20, 'Ballard', 'closed'),
  street(5, 20, 'Ballard', 'disabled'),
  street(6, 20, 'Ballard', 'open'),
  street(7, 20, 'Ballard', 'open'),
  street(8, 30, 'Fremont', 'retired'),
] };

let map;
let scrolled;

/**
 * Starts the page against the given streets answer and lets its map finish loading.
 * @returns {Promise<void>} Resolves once init() has.
 */
async function load(answer, { markup = MARKUP, trendUrl = '/adminapi/streetStatusTrend' } = {}) {
  document.body.innerHTML = markup;
  routeFetch({ [STREETS_URL]: answer });
  map = stubMapbox(mapboxgl);
  const done = new StreetStatusPage({ mapboxToken: 'pk.test', streetsUrl: STREETS_URL, trendUrl, trendWeeks: 12 })
    .init();
  await flush();
  if (map.loadCallbacks.length) map.load();
  await done;
}

const status = () => document.getElementById('street-status-status');
const text = (id) => textOf(document.getElementById(id));
const row = (id) => document.querySelector(`#street-status-table tr[data-region-id="${id}"]`);
/** @returns {number[]} Street ids the map currently outlines. */
const mapSelected = () => {
  const latest = new Map();
  for (const { target, value } of map.featureStates) if ('selected' in value) latest.set(target.id, value.selected);
  return [...latest].filter(([, on]) => on).map(([id]) => id).sort((a, b) => a - b);
};
const highlightedRows = () => [...document.querySelectorAll('#street-status-table tr.is-highlighted')]
  .map((tr) => Number(tr.dataset.regionId));

beforeEach(() => {
  trends = [];
  trendInit = () => Promise.resolve();
  scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView(opts) { scrolled.push([this.id, opts]); };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loading', () => {
  test('counts every street and shows each problem status as a share of them', async () => {
    await load(STREETS);
    expect(text('kpi-total-streets')).toBe('8');
    expect(text('kpi-no-imagery')).toBe('25%');
    expect(text('kpi-closed')).toBe('13%');
    expect(text('kpi-disabled')).toBe('13%');
    expect(status().classList.contains('ps-hidden')).toBe(true);
  });

  test('the legend names each status beside its swatch, in the map\'s colors', async () => {
    await load(STREETS);
    const items = [...document.querySelectorAll('.street-status-legend-item')];
    expect(items.map(textOf)).toEqual(['Open', 'No imagery', 'Closed', 'Disabled']);
    expect(items[1].querySelector('.street-status-swatch').getAttribute('style')).toBe('background:#EB724E');
  });

  test('the region table breaks each region down by status, with unknown statuses only in the total', async () => {
    await load(STREETS);
    expect([...row(10).cells].slice(0, 6).map(textOf)).toEqual(['Downtown', '1', '2', '0', '0', '3']);
    expect([...row(20).cells].slice(0, 6).map(textOf)).toEqual(['Ballard', '2', '0', '1', '1', '4']);
    expect([...row(30).cells].slice(0, 6).map(textOf)).toEqual(['Fremont', '0', '0', '0', '0', '1']);
  });

  test('says so when the city has no streets, and draws no map', async () => {
    await load({ type: 'FeatureCollection' });
    expect(textOf(status())).toBe('No street data available for this city yet.');
    expect(status().classList.contains('error')).toBe(false);
    expect(map.options).toBeNull();
  });

  test('reports a failed streets request as an error', async () => {
    await load({ status: 503 });
    expect(textOf(status())).toBe('Could not load street data. Please try again.');
    expect(status().classList.contains('error')).toBe(true);
    expect(text('kpi-total-streets')).toBe('—');
  });

  test('still loads when the page has no status line to update', async () => {
    await load(STREETS, { markup: MARKUP.replace(/<div class="coverage-status"[^]*?<\/div>/, '') });
    expect(text('kpi-total-streets')).toBe('8');
  });
});

describe('the trend section', () => {
  test('starts with the trend endpoint and window the page was given', async () => {
    await load(STREETS);
    expect(trends).toHaveLength(1);
    expect(trends[0].opts).toMatchObject({ trendUrl: '/adminapi/streetStatusTrend', weeks: 12 });
  });

  test('is skipped when the page has no trend endpoint', async () => {
    await load(STREETS, { trendUrl: '' });
    expect(trends).toHaveLength(0);
  });

  test('failing to start is logged without stopping the map and table', async () => {
    trendInit = () => Promise.reject(new Error('trend down'));
    await load(STREETS);
    expect(console.error).toHaveBeenCalledWith('Could not initialize the street-status trend section.',
      expect.any(Error));
    expect(text('kpi-total-streets')).toBe('8');
  });

  test('a street it names is zoomed to and outlined alone, clearing any region pin', async () => {
    await load(STREETS);
    row(20).click();
    expect(trends[0].opts.onShowStreet(2)).toBe(true);

    expect(mapSelected()).toEqual([2]);
    expect(highlightedRows()).toEqual([]);
    expect(map.fits.at(-1)).toEqual({ bounds: [[-122.5, 47.5], [-122.5, 47.75]],
      options: { padding: 140, maxZoom: 16, duration: 700 } });
    expect(scrolled).toEqual([['street-status-map-section', { behavior: 'smooth', block: 'start' }]]);
  });

  test('a street the map does not know is refused, so the trend shows a plain id instead', async () => {
    await load(STREETS);
    expect(trends[0].opts.onShowStreet(999)).toBe(false);
    expect(map.fits).toEqual([]);
  });

  test('a street asked for before the map has loaded is refused', async () => {
    document.body.innerHTML = MARKUP;
    routeFetch({ [STREETS_URL]: STREETS });
    map = stubMapbox(mapboxgl);
    const done = new StreetStatusPage({ mapboxToken: 'pk.test', streetsUrl: STREETS_URL, trendUrl: '/t' }).init();
    expect(trends[0].opts.onShowStreet(1)).toBe(false);
    await flush();
    map.load();
    await done;
    expect(trends[0].opts.onShowStreet(1)).toBe(true);
  });

  test('showing a street still works on a page without the map section to scroll to', async () => {
    await load(STREETS, { markup: MARKUP.replace('id="street-status-map-section"', 'id="elsewhere"') });
    expect(trends[0].opts.onShowStreet('5')).toBe(true);
    expect(scrolled).toEqual([]);
  });
});

describe('selection', () => {
  test('clicking a street pins its whole region on the map and in the table; clicking again unpins', async () => {
    await load(STREETS);
    map.fire('click', 'street-status-line', { features: [STREETS.features[0]] });
    expect(mapSelected()).toEqual([1, 2, 3]);
    expect(highlightedRows()).toEqual([10]);

    map.fire('click', 'street-status-line', { features: [STREETS.features[2]] });
    expect(mapSelected()).toEqual([]);
    expect(highlightedRows()).toEqual([]);
  });

  test('hovering a street brushes its region over a pin, and leaving it goes back to the pin', async () => {
    await load(STREETS);
    row(10).click();
    map.fire('mousemove', 'street-status-line', { lngLat: {}, features: [{ id: 4, ...STREETS.features[3] }] });
    expect(mapSelected()).toEqual([4, 5, 6, 7]);
    expect(highlightedRows()).toEqual([20]);

    map.fire('mouseleave', 'street-status-line');
    expect(mapSelected()).toEqual([1, 2, 3]);
    expect(highlightedRows()).toEqual([10]);
  });

  test('hovering a table row brushes that region\'s streets, and leaving the table clears it', async () => {
    await load(STREETS);
    row(30).cells[0].dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(mapSelected()).toEqual([8]);
    document.querySelector('#street-status-table tbody').dispatchEvent(new Event('pointerleave'));
    expect(mapSelected()).toEqual([]);
  });
});
