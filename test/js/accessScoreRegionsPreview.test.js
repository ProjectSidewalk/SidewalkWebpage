/**
 * The /v3/api-docs/accessScoreRegions preview (#5840): regions colored by AccessScore or coverage, with a "still
 * computing" note instead of an error while the server builds its cache (#5418).
 */

import { loadModules } from './loader.js';
import {
  flush, regionFeature, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

const ENDPOINT = '/v3/api/accessScoreRegions?inline=true';

/** A scored region, and one with nothing audited. */
function regions() {
  return {
    type: 'FeatureCollection',
    features: [
      regionFeature({
        region_id: 7, name: 'Fremont', score: 0.81234, coverage: 0.456, audited_street_count: 41,
        total_street_count: 90,
      }),
      regionFeature({
        region_id: 8, name: '', score: null, coverage: 0, audited_street_count: 0, total_street_count: 3,
      }),
    ],
  };
}

async function renderPreview(answer = regions()) {
  document.body.innerHTML = '<div id="access-score-regions-preview"></div>';
  routeFetch({ [ENDPOINT]: answer });
  const { AccessScoreRegionsPreview } = await loadModules('frontend/js/api-docs/accessScoreRegionsPreview.js');
  await AccessScoreRegionsPreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { map: world.maps[0], container: document.getElementById('access-score-regions-preview') };
}

function clickRegion(map, properties) {
  map.fireOn('access-score-region-fill', 'click', [{ properties }], { lng: 1, lat: 2 });
  return world.popups.at(-1);
}

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a city with scored regions', () => {
  it('draws every region on a map framed on them all, colored by AccessScore', async () => {
    const { map, container } = await renderPreview();
    expect(container.querySelector('.loading-message')).toBeNull();
    expect(map.options.bounds.toArray()).toEqual([[0, 0], [0.01, 0.01]]);
    expect(map.sources['access-score-regions'].data.features).toHaveLength(2);
    expect(map.layerOrder).toEqual(['basemap-dim', 'access-score-region-fill', 'access-score-region-outline']);
    expect(textOf(container.querySelector('.map-chip'))).toBe('2 regions');
    expect(container.querySelector('#as-region-metric-select').value).toBe('score');
    // A missing score is drawn in the "none" gray, below the color ramp.
    const color = map.layers['access-score-region-fill'].paint['fill-color'];
    expect(color[1]).toEqual(['<=', ['coalesce', ['get', 'score'], -1], -1]);
  });

  it('labels the legend 0 to 1, with a swatch for regions with no audited streets', async () => {
    const { container } = await renderPreview();
    const legend = container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('AccessScore (0 = low, 1 = high)');
    expect([...legend.querySelector('.map-legend-ticks').children].map(textOf)).toEqual(['0', '1']);
    expect(textOf(legend.querySelector('.map-legend-item'))).toBe('No audited streets');
  });

  it('recolors by coverage when picked, with zero coverage as the "none" category', async () => {
    const { map, container } = await renderPreview();
    const select = container.querySelector('#as-region-metric-select');
    select.value = 'coverage';
    select.dispatchEvent(new Event('change'));
    const color = map.paint['access-score-region-fill.fill-color'];
    expect(color[1]).toEqual(['<=', ['coalesce', ['get', 'coverage'], -1], 0]);
    expect(textOf(container.querySelector('.map-legend h4'))).toBe('Fraction of streets audited');
  });

  it("says '1 region' for a city of one", async () => {
    const { container } = await renderPreview({ type: 'FeatureCollection', features: [regions().features[0]] });
    expect(textOf(container.querySelector('.map-chip'))).toBe('1 region');
  });

  it("opens a region's score, coverage and street counts on click, with a link to its JSON", async () => {
    const { map } = await renderPreview();
    const popup = clickRegion(map, regions().features[0].properties);
    expect(popup.lngLat).toEqual({ lng: 1, lat: 2 });
    expect(popup.text()).toBe(
      "Fremont 0.812 AccessScore Coverage: 46% (41 of 90 streets audited) Region ID: 7 View this region's JSON");
    expect(popup.element.querySelector('a[href="/v3/api/accessScoreRegions?regionId=7&inline=true"]')).not.toBeNull();
  });

  it('names an unnamed region by its id, and says why it has no score', async () => {
    const { map } = await renderPreview();
    const popup = clickRegion(map, regions().features[1].properties);
    expect(textOf(popup.element.querySelector('h4'))).toBe('Region 8');
    expect(popup.text()).toContain('N/A (no audited streets) AccessScore Coverage: 0%');
    // Same for a region the API sent with no score field at all.
    const bare = regions().features[1].properties;
    delete bare.score;
    delete bare.coverage;
    expect(clickRegion(map, bare).text()).toContain('N/A (no audited streets) AccessScore Coverage: 0%');
  });

  it('marks the region under the pointer as hovered', async () => {
    const { map } = await renderPreview();
    map.fireOn('access-score-region-fill', 'mousemove', [{ id: 7 }]);
    expect(map.stateOf('access-score-regions', 7)).toEqual({ hover: true });
  });
});

describe('a city with no regions', () => {
  it('shows the whole world and says there are no regions, with no layers or legend', async () => {
    const { map, container } = await renderPreview({ type: 'FeatureCollection' });
    expect(map.options).toMatchObject({ center: [0, 0], zoom: 1 });
    expect(textOf(container.querySelector('.map-message[role="status"]'))).toBe('No regions found for this city.');
    expect(map.layers['access-score-region-fill']).toBeUndefined();
    expect(container.querySelector('.map-legend')).toBeNull();
  });
});

describe('when the scores are not there', () => {
  it('says the scores are still being computed when the server is warming its cache, without an error', async () => {
    const { container } = await renderPreview({ status: 503, body: { code: 'STILL_COMPUTING' } });
    const note = container.querySelector('.map-message');
    expect(note.getAttribute('role')).toBe('status');
    expect(textOf(note)).toBe("This city's AccessScores are still being computed on the server. "
      + 'Reload the page in a moment to see the preview.');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('shows an alert for any other failure', async () => {
    const { container } = await renderPreview({ status: 500 });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(textOf(container)).toBe('Unable to load AccessScore data for the preview.');
    expect(console.error).toHaveBeenCalled();
  });

  it('does nothing but report it when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    const { AccessScoreRegionsPreview } = await loadModules('frontend/js/api-docs/accessScoreRegionsPreview.js');
    await AccessScoreRegionsPreview.init();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('AccessScore regions preview container not found.');
  });
});
