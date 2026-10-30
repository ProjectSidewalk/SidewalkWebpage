/** The /v3/api-docs/accessScoreStreets preview (#5840): streets colored by AccessScore, unaudited ones gray. */

import { loadModules } from './loader.js';
import {
  flush, regionFeature, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

function street(id, properties = {}) {
  return {
    type: 'Feature',
    properties: { street_edge_id: id, score: null, audit_count: 0, label_count: 0, ...properties },
    geometry: { type: 'LineString', coordinates: [[0, 0], [0.002, 0.001]] },
  };
}

/** A scored street and an unaudited one. */
function streets() {
  return {
    type: 'FeatureCollection',
    features: [street(1, { score: 0.5, audit_count: 2, label_count: 9 }), street(2)],
  };
}

async function renderPreview(routes = {}) {
  document.body.innerHTML = '<div id="access-score-streets-preview"></div>';
  const fetchStub = routeFetch({
    '/v3/api/regionWithMostLabels': regionFeature(),
    '/v3/api/accessScoreStreets?inline=true&regionId=7': streets(),
    ...routes,
  });
  const { AccessScoreStreetsPreview } = await loadModules('frontend/js/api-docs/accessScoreStreetsPreview.js');
  await AccessScoreStreetsPreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { fetchStub, map: world.maps[0], container: document.getElementById('access-score-streets-preview') };
}

/** Clicks a street and returns its popup's text. */
function popupText(map, properties) {
  map.fireOn('access-score-street-lines', 'click', [{ properties }]);
  return world.popups.at(-1).text();
}

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe("the busiest region's streets", () => {
  it('draws them framed, with a count and a 0-to-1 legend that has a swatch for unaudited streets', async () => {
    const { map, container } = await renderPreview();
    expect(container.querySelector('.loading-message')).toBeNull();
    expect(map.options.bounds.toArray()).toEqual([[0, 0], [0.002, 0.001]]);
    expect(map.sources['access-score-streets'].data.features).toHaveLength(2);
    expect(textOf(container.querySelector('.map-chip'))).toBe('2 streets');
    const legend = container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('AccessScore (0 = low, 1 = high)');
    expect(textOf(legend.querySelector('.map-legend-item'))).toBe('Unaudited');
  });

  it("says '1 street' for a region of one", async () => {
    const { container } = await renderPreview({
      '/v3/api/accessScoreStreets?inline=true&regionId=7': { type: 'FeatureCollection', features: [street(1)] },
    });
    expect(textOf(container.querySelector('.map-chip'))).toBe('1 street');
  });

  it('marks the street under the pointer as hovered', async () => {
    const { map } = await renderPreview();
    map.fireOn('access-score-street-lines', 'mousemove', [{ id: 1 }]);
    expect(map.stateOf('access-score-streets', 1)).toEqual({ hover: true });
  });
});

describe("a street's popup", () => {
  it('gives its name, score, audits, labels, slope, and the cluster types it has', async () => {
    const { map } = await renderPreview();
    // Mapbox hands back an object property as a JSON string.
    const clusters = JSON.stringify({ CurbRamp: 3, Obstacle: 0, NoSidewalk: 1 });
    expect(popupText(map, {
      ...streets().features[0].properties, street_name: 'Main <St>', mean_grade: 0.0123, max_grade: 0.08,
      cluster_counts: clusters,
    })).toBe('Main <St> · Street 1 0.500 AccessScore Audits: 2 Labels: 9 Slope: mean 1.2%, max 8.0% '
      + 'Clusters: CurbRamp: 3, NoSidewalk: 1');
  });

  it('says an unaudited street has no score and no clusters, and leaves out a slope it lacks', async () => {
    const { map } = await renderPreview();
    expect(popupText(map, streets().features[1].properties))
      .toBe('Street 2 N/A (unaudited) AccessScore Audits: 0 Labels: 0 Clusters: no scored features');
    const bare = streets().features[1].properties;
    delete bare.score;
    expect(popupText(map, bare)).toContain('N/A (unaudited)');
  });
});

describe('the region the preview is scoped to', () => {
  it('falls back to the whole city when the region lookup fails', async () => {
    const { fetchStub, map } = await renderPreview({
      '/v3/api/regionWithMostLabels': { status: 500 },
      '/v3/api/accessScoreStreets?inline=true': streets(),
    });
    expect(fetchStub.mock.calls.at(-1)[0]).toBe('/v3/api/accessScoreStreets?inline=true&utm_source=apiDocs');
    expect(map.sources['access-score-streets'].data.features).toHaveLength(2);
  });

  it('falls back to the whole city when the city has no region with labels', async () => {
    const { fetchStub } = await renderPreview({
      '/v3/api/regionWithMostLabels': null,
      '/v3/api/accessScoreStreets?inline=true': streets(),
    });
    expect(fetchStub.mock.calls.at(-1)[0]).toBe('/v3/api/accessScoreStreets?inline=true&utm_source=apiDocs');
  });
});

describe('when there is nothing to draw', () => {
  it('shows the whole world and says there are no streets', async () => {
    const { map, container } = await renderPreview({
      '/v3/api/accessScoreStreets?inline=true&regionId=7': { type: 'FeatureCollection' },
    });
    expect(map.options).toMatchObject({ center: [0, 0], zoom: 1 });
    expect(textOf(container.querySelector('.map-message[role="status"]'))).toBe('No streets found for this city.');
    expect(map.layers['access-score-street-lines']).toBeUndefined();
  });

  it('shows an alert when the streets request fails', async () => {
    const { container } = await renderPreview({ '/v3/api/accessScoreStreets?inline=true&regionId=7': { status: 500 } });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(textOf(container)).toBe('Unable to load AccessScore data for the preview.');
  });

  it('does nothing but report it when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    const { AccessScoreStreetsPreview } = await loadModules('frontend/js/api-docs/accessScoreStreetsPreview.js');
    await AccessScoreStreetsPreview.init();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('AccessScore streets preview container not found.');
  });
});
