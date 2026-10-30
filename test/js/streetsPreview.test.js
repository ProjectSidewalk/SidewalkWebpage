/** The /v3/api-docs/streets previews (#5840): three street maps, colored by users, audit age and label count. */

import { loadModules } from './loader.js';
import {
  FakeMap, flush, regionFeature, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

const DAY_MS = 24 * 60 * 60 * 1000;
const CONTAINERS = ['streets-user-count-preview', 'streets-audit-age-preview', 'streets-label-count-preview'];

const daysAgo = (days) => new Date(Date.now() - days * DAY_MS).toISOString();

function street(id, properties = {}) {
  return {
    type: 'Feature',
    properties: { street_edge_id: id, way_type: 'residential', user_count: 0, label_count: 0, ...properties },
    geometry: { type: 'LineString', coordinates: [[0, 0], [0.001, 0]] },
  };
}

/** A region of three streets: one unaudited, one labeled by a user 10 days ago, one by four users 400 days ago. */
function streets() {
  return {
    type: 'FeatureCollection',
    features: [
      street(1),
      street(2, { user_count: 1, label_count: 3, first_label_date: daysAgo(20), last_label_date: daysAgo(10) }),
      street(3, {
        user_count: 4, label_count: 12, way_type: 'primary', last_label_date: daysAgo(400), osm_way_id: 55,
      }),
    ],
  };
}

async function renderPreview({ region = regionFeature(), streetData = streets(), routes = {} } = {}) {
  document.body.innerHTML = CONTAINERS.map((id) => `<div id="${id}"></div>`).join('');
  const fetchStub = routeFetch({
    '/v3/api/regionWithMostLabels': region,
    '/v3/api/streets?regionId=7': streetData,
    ...routes,
  });
  const { StreetsPreview } = await loadModules('frontend/js/api-docs/streetsPreview.js');
  await StreetsPreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { fetchStub, StreetsPreview };
}

const container = (i) => document.getElementById(CONTAINERS[i]);

const rows = (el) => [...el.children].map(textOf);

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a region with streets', () => {
  it('draws one map per metric, framed on the region, with the region named on each', async () => {
    await renderPreview();
    expect(world.maps).toHaveLength(3);
    world.maps.forEach((map, i) => {
      expect(map.container).toBe(container(i));
      expect(map.options.bounds.toArray()).toEqual([[0, 0], [0.01, 0.01]]);
      expect(textOf(map.container.querySelector('.map-chip'))).toBe('Region: Fremont');
      expect(map.container.querySelector('.loading-message')).toBeNull();
    });
  });

  it('stamps each street with how many days ago it was last labeled, null for one never labeled', async () => {
    await renderPreview();
    const ages = world.maps[0].sources.streets.data.features.map((f) => f.properties.days_since_label);
    expect(ages[0]).toBeNull();
    expect(ages[1]).toBeCloseTo(10, 3);
    expect(ages[2]).toBeCloseTo(400, 3);
  });

  it('summarizes contributors on the first map, ramping from one user to the most any street has', async () => {
    await renderPreview();
    const map = world.maps[0];
    expect(rows(map.container.querySelector('.map-stats'))).toEqual(
      ['Summary', 'Total Streets: 3', 'Audited: 67%', 'Total Labels: 15', 'Way Types: 2']);
    const legend = map.container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('Users per Street');
    expect(rows(legend.querySelector('.map-legend-ticks'))).toEqual(['1', '4']);
    // Zero contributors is its own swatch, not the bottom of the ramp.
    expect(textOf(legend.querySelector('.map-legend-item'))).toBe('Unaudited');
    const color = map.layers['street-lines'].paint['line-color'];
    expect(color[1]).toEqual(['<=', ['coalesce', ['get', 'user_count'], 0], 0]);
  });

  it('ramps audit age from today to the oldest street, and gives the average age in years once past one', async () => {
    await renderPreview();
    const map = world.maps[1];
    expect(rows(map.container.querySelector('.map-legend-ticks'))).toEqual(['Today', '7m', '1y']);
    expect(rows(map.container.querySelector('.map-stats'))).toContain('Avg. Age: 7 months');
    expect(textOf(map.container.querySelector('.map-legend-item'))).toBe('Never audited');
  });

  it('averages labels over the audited streets on the third map', async () => {
    await renderPreview();
    const map = world.maps[2];
    expect(rows(map.container.querySelector('.map-stats'))).toContain('Avg. Labels: 8');
    // A span of 11 labels is wide enough for a midpoint tick.
    expect(rows(map.container.querySelector('.map-legend-ticks'))).toEqual(['1', '7', '12']);
  });

  it('marks the street under the pointer as hovered, and lets it go when the pointer leaves', async () => {
    await renderPreview();
    const map = world.maps[0];
    map.fireOn('street-lines', 'mousemove', [{ id: 2 }]);
    expect(map.stateOf('streets', 2)).toEqual({ hover: true });
    expect(map.canvas.style.cursor).toBe('pointer');

    map.fireOn('street-lines', 'mousemove', [{ id: 3 }]);
    expect(map.stateOf('streets', 2)).toEqual({ hover: false });
    expect(map.stateOf('streets', 3)).toEqual({ hover: true });

    map.fire('mouseleave', {}, 'street-lines');
    expect(map.stateOf('streets', 3)).toEqual({ hover: false });
    expect(map.canvas.style.cursor).toBe('');
  });
});

describe("a street's popup", () => {
  /** Renders the preview, then clicks a street on the first map and returns its popup. */
  async function popupFor(properties) {
    await renderPreview();
    world.maps[0].fireOn('street-lines', 'click', [{ properties }], { lng: 1, lat: 2 });
    return world.popups.at(-1);
  }

  it('says a street nobody has labeled is unaudited, with no dates, age, or OSM link', async () => {
    const popup = await popupFor(street(1).properties);
    expect(popup.lngLat).toEqual({ lng: 1, lat: 2 });
    expect(popup.text()).toContain('Street Segment 1');
    expect(popup.text()).toContain('Status: Unaudited');
    expect(popup.text()).toContain('First Label: No labels Last Label: No labels Audit Age: Never audited');
    expect(popup.text()).toContain('OSM ID: N/A');
    expect(popup.element.querySelector('a[href="/explore?streetEdgeId=1"]')).not.toBeNull();
  });

  it('names how many users labeled it, and links its OSM way', async () => {
    const popup = await popupFor({ ...street(3).properties, user_count: 4, osm_way_id: 55 });
    expect(popup.text()).toContain('Status: Labeled by 4 users');
    expect(popup.element.querySelector('a[href="https://www.openstreetmap.org/way/55"]')).not.toBeNull();
    expect(popup.text()).not.toContain('All OSM ways');
  });

  it('lists every OSM way of a street built from several, with the stretch each covers', async () => {
    // Mapbox hands back an array property as a JSON string.
    const osmWays = JSON.stringify([
      { osm_way_id: 55, street_from_frac: 0, street_to_frac: 0.4, same_direction: true },
      { osm_way_id: 56, street_from_frac: 0.4, street_to_frac: 1, same_direction: false },
      { osm_way_id: 57, street_from_frac: null },
    ]);
    const popup = await popupFor({ ...street(3).properties, user_count: 1, osm_way_id: 55, osm_ways: osmWays });
    expect(popup.text()).toContain('Status: Labeled by 1 user ');
    expect(popup.text()).toContain(
      'All OSM ways: 55 (0–40% of the street); 56 (40–100% of the street, drawn the other way); 57');
  });

  it.each([
    [0.5, 'Today'],
    [1.5, '1 day ago'],
    [3.5, '3 days ago'],
    [8, '1 week ago'],
    [15, '2 weeks ago'],
    [45, '1 month ago'],
    [100, '3 months ago'],
    [400, '1 year ago'],
    [800, '2 years ago'],
  ])('gives a street last labeled %s days ago an audit age of "%s"', async (days, age) => {
    const popup = await popupFor({ ...street(2).properties, last_label_date: daysAgo(days) });
    expect(popup.text()).toContain(`Audit Age: ${age} `);
  });
});

describe('the legends and summaries follow what the region holds', () => {
  it('gives a one-tick ramp when every street shares one count, and short ages in days', async () => {
    const data = { type: 'FeatureCollection', features: [street(1, { user_count: 1, last_label_date: daysAgo(5) })] };
    await renderPreview({ streetData: data });
    expect(rows(world.maps[0].container.querySelector('.map-legend-ticks'))).toEqual(['1']);
    expect(rows(world.maps[1].container.querySelector('.map-legend-ticks'))).toEqual(['Today', '5d']);
    expect(rows(world.maps[1].container.querySelector('.map-stats'))).toContain('Avg. Age: 5 days');
    expect(rows(world.maps[2].container.querySelector('.map-stats'))).toContain('Avg. Labels: 0');
  });

  it('gives no average age when no street has a label date, and years when all are old', async () => {
    await renderPreview({ streetData: { type: 'FeatureCollection', features: [street(1)] } });
    expect(rows(world.maps[1].container.querySelector('.map-stats'))).toContain('Avg. Age: N/A');
    expect(rows(world.maps[0].container.querySelector('.map-stats'))).toContain('Audited: 0%');

    resetWorld();
    const old = { type: 'FeatureCollection', features: [street(1, { last_label_date: daysAgo(800) })] };
    await renderPreview({ streetData: old });
    expect(rows(world.maps[1].container.querySelector('.map-stats'))).toContain('Avg. Age: 2 years');
  });

  it('says so on each map when the region has no streets, and draws no street layer', async () => {
    await renderPreview({ region: regionFeature({ region_id: 7 }), streetData: { type: 'FeatureCollection' } });
    world.maps.forEach((map) => {
      const chips = map.container.querySelectorAll('.map-chip');
      expect(textOf(chips[0])).toBe('Region: Sample Region');
      expect(chips[1].getAttribute('role')).toBe('status');
      expect(textOf(chips[1])).toBe('No streets found in this region.');
      expect(map.layers['street-lines']).toBeUndefined();
    });
  });
});

describe('when something fails', () => {
  it('shows the region lookup failing on all three maps, and fetches no streets', async () => {
    const { fetchStub } = await renderPreview({ routes: { '/v3/api/regionWithMostLabels': { status: 500 } } });
    CONTAINERS.forEach((_, i) => {
      expect(textOf(container(i))).toBe('Failed to load streets: Failed to fetch region with most labels');
      expect(container(i).querySelector('[role="alert"]')).not.toBeNull();
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(world.maps).toHaveLength(0);
  });

  it('shows the streets request failing on all three maps', async () => {
    await renderPreview({ routes: { '/v3/api/streets?regionId=7': { status: 503, body: { code: 'DOWN' } } } });
    CONTAINERS.forEach((_, i) => expect(textOf(container(i))).toBe('Failed to load streets: HTTP error! Status: 503'));
  });

  it('shows one map failing to draw on that map alone, and frees it', async () => {
    const addSource = FakeMap.prototype.addSource;
    vi.spyOn(FakeMap.prototype, 'addSource').mockImplementation(function (id, source) {
      if (this === world.maps[1]) throw new Error('out of contexts');
      return addSource.call(this, id, source);
    });
    await renderPreview();
    expect(textOf(container(1))).toBe('Failed to load streets: out of contexts');
    expect(world.maps[1].removed).toBe(true);
    expect(container(0).querySelector('.map-legend')).not.toBeNull();
    expect(container(2).querySelector('.map-legend')).not.toBeNull();
  });

  it('shows a map that never loads as failed', async () => {
    resetWorld({ mapError: new Error('bad token') });
    await renderPreview();
    CONTAINERS.forEach((_, i) => expect(textOf(container(i))).toBe('Failed to load streets: bad token'));
  });

  it('does nothing but report it when the page lacks a container', async () => {
    document.body.innerHTML = '<div id="streets-user-count-preview"></div>';
    const fetchStub = routeFetch({});
    const { StreetsPreview } = await loadModules('frontend/js/api-docs/streetsPreview.js');
    await StreetsPreview.init();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Streets preview container elements not found.');
  });
});
