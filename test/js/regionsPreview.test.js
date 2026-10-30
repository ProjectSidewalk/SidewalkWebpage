/**
 * The /v3/api-docs/regions preview (#5840): one map of every region in the city, colored by the metric the reader
 * picks, with a legend that follows the pick and a popup per region.
 */

import { loadModules } from './loader.js';
import {
  flush, regionFeature, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

/** Two regions: one well labeled, one nobody has touched. */
function regions() {
  return {
    type: 'FeatureCollection',
    features: [
      regionFeature({
        region_id: 7, name: 'Fremont', label_count: 1200, audit_count: 30, user_count: 5, street_count: 80,
        first_label_date: '2024-01-02T12:00:00Z', last_label_date: '2025-06-03T12:00:00Z',
      }),
      regionFeature({ region_id: 8, name: '', label_count: 0, audit_count: 0, user_count: 0, street_count: 12 }),
    ],
  };
}

/** Loads the preview onto a page with its container, and runs it against the given regions response. */
async function renderPreview(answer = regions()) {
  document.body.innerHTML = '<div id="regions-preview"></div>';
  const fetchStub = routeFetch({ '/v3/api/regions?inline=true': answer });
  const { RegionsPreview } = await loadModules('frontend/js/api-docs/regionsPreview.js');
  await RegionsPreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { fetchStub, map: world.maps[0], container: document.getElementById('regions-preview') };
}

/** @returns {string[]} The text of each of an element's direct children. */
const rows = (el) => [...el.children].map(textOf);

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a city with regions', () => {
  it('draws every region on a map framed on them all, with a count of how many', async () => {
    const { map, container } = await renderPreview();
    expect(container.querySelector('.loading-message')).toBeNull();
    expect(map.options.bounds.toArray()).toEqual([[0, 0], [0.01, 0.01]]);
    expect(map.sources.regions.data.features).toHaveLength(2);
    expect(map.layerOrder).toEqual(expect.arrayContaining(['region-fill', 'region-outline']));
    expect(textOf(container.querySelector('.map-chip'))).toBe('2 regions');
  });

  it('colors by label count at first, ramping from 1 to the busiest region', async () => {
    const { container } = await renderPreview();
    expect(container.querySelector('#region-metric-select').value).toBe('label_count');
    const legend = container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('Labels per region');
    expect(rows(legend.querySelector('.map-legend-ticks'))).toEqual(['1', '1,200']);
    expect(textOf(legend.querySelector('.map-legend-item'))).toBe('No labels');
  });

  it('recolors the regions and rewrites the legend when the reader picks another metric', async () => {
    const { map, container } = await renderPreview();
    const select = container.querySelector('#region-metric-select');
    select.value = 'user_count';
    select.dispatchEvent(new Event('change'));

    const color = map.paint['region-fill.fill-color'];
    expect(color[1][1]).toEqual(['coalesce', ['get', 'user_count'], 0]);
    const legend = container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('Contributors per region');
    expect(rows(legend.querySelector('.map-legend-ticks'))).toEqual(['1', '5']);
    expect(textOf(legend.querySelector('.map-legend-item'))).toBe('No contributors');
  });

  it("says '1 region' for a city of one, and keeps the legend from running 1 down to 0", async () => {
    const { container } = await renderPreview({ type: 'FeatureCollection', features: [regions().features[1]] });
    expect(textOf(container.querySelector('.map-chip'))).toBe('1 region');
    expect(rows(container.querySelector('.map-legend-ticks'))).toEqual(['1', '1']);
  });

  it("opens a region's statistics on click, with a link to it on the label map", async () => {
    const { map } = await renderPreview();
    map.fireOn('region-fill', 'click', [{ properties: regions().features[0].properties }], { lng: 1, lat: 2 });
    const popup = world.popups.at(-1);
    expect(popup.lngLat).toEqual({ lng: 1, lat: 2 });
    expect(popup.text())
      .toContain('Fremont Region ID: 7 Labels: 1200 Streets: 80 Contributors: 5 Completed audits: 30');
    expect(popup.text()).toContain(`First Label: ${new Date('2024-01-02T12:00:00Z').toLocaleDateString()}`);
    expect(popup.element.querySelector('a[href="/labelmap?regions=7"]')).not.toBeNull();
  });

  it('names an unnamed region by its id, and gives no dates when it has no labels', async () => {
    const { map } = await renderPreview();
    map.fireOn('region-fill', 'click', [{ properties: regions().features[1].properties }]);
    const popup = world.popups.at(-1);
    expect(textOf(popup.element.querySelector('h4'))).toBe('Region 8');
    expect(popup.text()).toContain('First Label: No labels Last Label: No labels');
  });

  it('marks the region under the pointer as hovered', async () => {
    const { map } = await renderPreview();
    map.fireOn('region-fill', 'mousemove', [{ id: 7 }]);
    expect(map.stateOf('regions', 7)).toEqual({ hover: true });
  });
});

describe('a city with no regions', () => {
  it('shows the whole world and says there are no regions, with no layers or legend', async () => {
    const { map, container } = await renderPreview({ type: 'FeatureCollection' });
    expect(map.options.center).toEqual([0, 0]);
    expect(map.options.zoom).toBe(1);
    const message = container.querySelector('.map-message');
    expect(message.getAttribute('role')).toBe('status');
    expect(textOf(message)).toBe('No regions found for this city.');
    expect(map.layerOrder).not.toContain('region-fill');
    expect(container.querySelector('.map-legend')).toBeNull();
  });
});

describe('when something fails', () => {
  it('shows an alert in place of the map when the regions request fails', async () => {
    const { container } = await renderPreview({ status: 500 });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(textOf(container)).toBe('Unable to load region data for the preview.');
    expect(world.maps).toHaveLength(0);
  });

  it('shows the same alert when the map never loads', async () => {
    resetWorld({ mapError: new Error('bad token') });
    const { container } = await renderPreview();
    expect(textOf(container)).toBe('Unable to load region data for the preview.');
  });

  it('does nothing but report it when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    const { RegionsPreview } = await loadModules('frontend/js/api-docs/regionsPreview.js');
    await RegionsPreview.init();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Regions preview container element not found.');
  });
});
