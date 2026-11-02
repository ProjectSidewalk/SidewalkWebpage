/** Tests for the Coverage page's choropleth, its color scale and its hover popup (#5840). */

import { loadModules, mockModule, useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { stubMapbox } from './support/adminMapHarness.js';

useUtil(metricDistanceUtil);

const mapboxgl = {};
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: mapboxgl }));
const { CoverageColors, CoverageFormat, CoverageMap } =
  await loadModules('frontend/js/admin-dashboard/CoverageMap.js');

const REGIONS = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.4, 47.5] }, properties: { region_id: 1 } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.3, 47.7] }, properties: { region_id: 2 } },
  ],
};

/** @returns {{state: object, events: string[], map: object}} A loaded map whose callbacks log into `events`. */
async function loadMap() {
  const state = stubMapbox(mapboxgl);
  const events = [];
  const map = new CoverageMap('coverage-choropleth', {
    mapboxToken: 'pk.test',
    onRegionClick: (id) => events.push(`click ${id}`),
    onRegionHover: (id) => events.push(`hover ${id}`),
    onRegionHoverEnd: () => events.push('hover end'),
  });
  const ready = map.init(REGIONS);
  state.load();
  await ready;
  return { state, events, map };
}

/** @returns {object} A map mouse event over one region, with the properties the regions API sends. */
const over = (id, props = {}) => ({
  lngLat: { lng: -122.35, lat: 47.6 },
  features: [{ id, properties: { name: 'Downtown', completion_rate: 0.426, audited_distance_m: 1500,
    total_distance_m: 4000, street_count: 1200, audit_count: 30, label_count: 4500, user_count: 7, ...props } }],
});

describe('CoverageColors', () => {
  test('runs from the palest blue at 0% to the darkest at 100%, blending between stops', () => {
    expect(CoverageColors.forRate(0)).toBe('rgb(239, 243, 255)');
    expect(CoverageColors.forRate(1)).toBe('rgb(33, 113, 181)');
    expect(CoverageColors.forRate(0.33)).toBe('rgb(189, 215, 231)');
    expect(CoverageColors.forRate(0.165)).toBe('rgb(214, 229, 243)');
  });

  test('clamps rates outside 0..1 and treats a missing rate as 0%', () => {
    expect(CoverageColors.forRate(1.4)).toBe(CoverageColors.forRate(1));
    expect(CoverageColors.forRate(-0.2)).toBe(CoverageColors.forRate(0));
    expect(CoverageColors.forRate(null)).toBe(CoverageColors.forRate(0));
    expect(CoverageColors.forRate(NaN)).toBe(CoverageColors.forRate(0));
  });

  test('hands Mapbox the same stops the bars and legend use', () => {
    expect(CoverageColors.mapboxExpression()).toEqual(['interpolate', ['linear'], ['get', 'completion_rate'],
      0, '#eff3ff', 0.33, '#bdd7e7', 0.66, '#6baed6', 1, '#2171b5']);
  });
});

describe('CoverageFormat.pct', () => {
  test('rounds to a whole percent and reads a missing rate as 0%', () => {
    expect(CoverageFormat.pct(0.426)).toBe('43%');
    expect(CoverageFormat.pct(undefined)).toBe('0%');
  });
});

describe('CoverageMap', () => {
  test('refuses to start without a Mapbox token', () => {
    stubMapbox(mapboxgl);
    expect(() => new CoverageMap('coverage-choropleth', {}).init(REGIONS)).toThrow(/missing Mapbox access token/);
  });

  test('opens on the regions, filled by coverage, keyed by region id', async () => {
    const { state } = await loadMap();
    expect(mapboxgl.accessToken).toBe('pk.test');
    expect(state.options.bounds.toArray()).toEqual([[-122.4, 47.5], [-122.3, 47.7]]);
    expect(state.sources['coverage-regions']).toMatchObject({ data: REGIONS, promoteId: 'region_id' });
    expect(Object.keys(state.layers)).toEqual(['coverage-fill', 'coverage-outline', 'coverage-selected']);
    expect(state.layers['coverage-fill'].paint['fill-color']).toEqual(CoverageColors.mapboxExpression());
  });

  test('hovering a region shows its coverage details and brushes it', async () => {
    const { state, events } = await loadMap();
    state.fire('mousemove', 'coverage-fill', over(1));

    expect(state.cursor).toBe('pointer');
    expect(state.stateOf(1)).toEqual({ hover: true });
    expect(events).toEqual(['hover 1']);
    const popup = document.createElement('div');
    popup.innerHTML = state.popup.html;
    expect(popup.querySelector('.coverage-popup-name').textContent).toBe('Downtown');
    expect([...popup.querySelectorAll('dd')].map((dd) => dd.textContent))
      .toEqual(['43%', '1.5 km / 4.0 km', '1,200', '30', '4,500', '7']);
    expect(state.popup.open).toBe(true);
  });

  test('a region with no activity yet shows zeros rather than blanks', async () => {
    const { state } = await loadMap();
    state.fire('mousemove', 'coverage-fill',
      over(1, { street_count: null, audit_count: null, label_count: null, user_count: null }));
    expect(state.popup.html).not.toContain('null');
    expect(state.popup.html.match(/<dd>0<\/dd>/g)).toHaveLength(4);
  });

  test('moving within one region fires its hover once; moving to the next unhovers the first', async () => {
    const { state, events } = await loadMap();
    state.fire('mousemove', 'coverage-fill', over(1));
    state.fire('mousemove', 'coverage-fill', over(1));
    state.fire('mousemove', 'coverage-fill', over(2));
    expect(events).toEqual(['hover 1', 'hover 2']);
    expect(state.stateOf(1)).toEqual({ hover: false });
    expect(state.stateOf(2)).toEqual({ hover: true });
  });

  test('a mouse event that hits no region is ignored', async () => {
    const { state, events } = await loadMap();
    state.fire('mousemove', 'coverage-fill', { features: [] });
    state.fire('click', 'coverage-fill', { features: [] });
    expect(events).toEqual([]);
    expect(state.popup.open).toBe(false);
  });

  test('leaving the map clears the hover and closes the popup', async () => {
    const { state, events } = await loadMap();
    state.fire('mousemove', 'coverage-fill', over(1));
    state.fire('mouseleave', 'coverage-fill');
    expect(state.cursor).toBe('');
    expect(state.stateOf(1)).toEqual({ hover: false });
    expect(state.popup.open).toBe(false);
    expect(events).toEqual(['hover 1', 'hover end']);
  });

  test('clicking a region reports its id as a number', async () => {
    const { state, events } = await loadMap();
    state.fire('click', 'coverage-fill', { features: [{ id: '2' }] });
    expect(events).toEqual(['click 2']);
  });

  test('a new highlight outlines only its regions, touching just the ones that changed', async () => {
    const { state, map } = await loadMap();
    map.highlightRegions([1, 2]);
    state.featureStates.length = 0;
    map.highlightRegion(2);
    expect(state.featureStates)
      .toEqual([{ target: { source: 'coverage-regions', id: 1 }, value: { selected: false } }]);

    map.clearHighlight();
    expect(state.stateOf(2)).toEqual({ selected: false });
  });
});
