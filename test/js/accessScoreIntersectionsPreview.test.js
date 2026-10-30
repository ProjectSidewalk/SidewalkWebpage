/**
 * The /v3/api-docs/accessScoreIntersections preview (#5840): one map of the busiest region's intersections colored by
 * AccessScore, grade-separated crossings drawn hollow, with a popup giving an intersection's score and cluster counts
 * and, on a desktop, a link into Explore at that corner.
 */

import { loadModules, useUtil } from './loader.js';
import {
  flush, regionFeature, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

function intersection(id, [lng, lat], properties = {}) {
  return {
    type: 'Feature',
    properties: { intersection_id: id, score: null, degree: 4, audit_count: 0, label_count: 0, ...properties },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  };
}

/** A scored intersection, an unscored one, and a grade-separated crossing. */
function intersections() {
  return {
    type: 'FeatureCollection',
    features: [
      intersection(1, [0.001, 0.002], { score: 0.25, audit_count: 3, label_count: 6 }),
      intersection(2, [0.003, 0.004]),
      intersection(3, [0.002, 0.003], { grade_separated: true, degree: 2 }),
    ],
  };
}

/** Loads the preview onto a page with its container, and runs it against the given responses. */
async function renderPreview(routes = {}) {
  document.body.innerHTML = '<div id="access-score-intersections-preview"></div>';
  const fetchStub = routeFetch({
    '/v3/api/regionWithMostLabels': regionFeature(),
    '/v3/api/accessScoreIntersections?inline=true&regionId=7': intersections(),
    ...routes,
  });
  const { AccessScoreIntersectionsPreview } =
    await loadModules('frontend/js/api-docs/accessScoreIntersectionsPreview.js');
  await AccessScoreIntersectionsPreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { fetchStub, map: world.maps[0], container: document.getElementById('access-score-intersections-preview') };
}

/** Clicks an intersection and returns its popup. */
function clickIntersection(map, feature) {
  map.fireOn('access-score-intersection-points', 'click', [feature], { lng: 9, lat: 9 });
  return world.popups.at(-1);
}

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  useUtil({ isMobile: () => false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe("the busiest region's intersections", () => {
  it('draws them, framed on them, with a count and a 0-to-1 legend that has a swatch for unscored ones', async () => {
    const { map, container } = await renderPreview();
    expect(container.querySelector('.loading-message')).toBeNull();
    expect(map.options.bounds.toArray()).toEqual([[0.001, 0.002], [0.003, 0.004]]);
    expect(map.sources['access-score-intersections'].data.features).toHaveLength(3);
    expect(textOf(container.querySelector('.map-chip'))).toBe('3 intersections');
    const legend = container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('AccessScore (0 = low, 1 = high)');
    expect(textOf(legend.querySelector('.map-legend-item'))).toBe('Unscored');
  });

  it('draws a grade-separated crossing as a hollow ring', async () => {
    const { map } = await renderPreview();
    const fill = map.layers['access-score-intersection-points'].paint['circle-color'];
    expect(fill.slice(0, 3)).toEqual(['case', ['==', ['get', 'grade_separated'], true], 'rgba(0, 0, 0, 0)']);
  });

  it("says '1 intersection' for a region of one", async () => {
    const { container } = await renderPreview({
      '/v3/api/accessScoreIntersections?inline=true&regionId=7': {
        type: 'FeatureCollection', features: [intersections().features[0]],
      },
    });
    expect(textOf(container.querySelector('.map-chip'))).toBe('1 intersection');
  });

  it('marks the intersection under the pointer as hovered', async () => {
    const { map } = await renderPreview();
    map.fireOn('access-score-intersection-points', 'mousemove', [{ id: 2 }]);
    expect(map.stateOf('access-score-intersections', 2)).toEqual({ hover: true });
  });
});

describe("an intersection's popup", () => {
  it('gives its score, streets, audits, labels and clusters, and opens Explore at its own center', async () => {
    const { map } = await renderPreview();
    const feature = intersections().features[0];
    // Mapbox hands back an object property as a JSON string.
    feature.properties.cluster_counts = JSON.stringify({ CurbRamp: 2, NoCurbRamp: 0, Signal: 1 });
    const popup = clickIntersection(map, feature);
    expect(popup.lngLat).toEqual({ lng: 9, lat: 9 });
    expect(popup.text()).toBe('Intersection 1 0.250 AccessScore Streets: 4 Audits: 3 Labels: 6 '
      + 'Clusters: CurbRamp: 2, Signal: 1 Explore here (opens in a new tab)');
    // The intersection's centroid, not where in the circle the click landed.
    expect(popup.element.querySelector('a').getAttribute('href')).toBe('/explore?lat=0.002&lng=0.001');
  });

  it('says an unscored intersection has no score or clusters, and names a grade-separated crossing', async () => {
    const { map } = await renderPreview();
    expect(clickIntersection(map, intersections().features[1]).text())
      .toContain('Intersection 2 N/A (unscored) AccessScore');
    const crossing = clickIntersection(map, intersections().features[2]).text();
    expect(crossing).toContain('Intersection 3 (grade-separated crossing) N/A (unscored)');
    expect(crossing).toContain('Clusters: no scored features');
    const bare = intersection(4, [0, 0]);
    delete bare.properties.score;
    expect(clickIntersection(map, bare).text()).toContain('N/A (unscored)');
  });

  it('leaves out the Explore link on a phone, where /explore would send the reader elsewhere', async () => {
    useUtil({ isMobile: () => true });
    const { map } = await renderPreview();
    const popup = clickIntersection(map, intersections().features[0]);
    expect(popup.element.querySelector('a')).toBeNull();
    expect(popup.text()).not.toContain('Explore here');
  });
});

describe('the region the preview is scoped to', () => {
  it('falls back to the whole city when the region lookup fails or finds nothing', async () => {
    for (const region of [{ status: 500 }, null]) {
      resetWorld();
      const { fetchStub, map } = await renderPreview({
        '/v3/api/regionWithMostLabels': region,
        '/v3/api/accessScoreIntersections?inline=true': intersections(),
      });
      expect(fetchStub.mock.calls.at(-1)[0]).toBe('/v3/api/accessScoreIntersections?inline=true&utm_source=apiDocs');
      expect(map.sources['access-score-intersections'].data.features).toHaveLength(3);
    }
  });
});

describe('when there is nothing to draw', () => {
  it('shows the whole world and says there are no intersections', async () => {
    const { map, container } = await renderPreview({
      '/v3/api/accessScoreIntersections?inline=true&regionId=7': { type: 'FeatureCollection' },
    });
    expect(map.options).toMatchObject({ center: [0, 0], zoom: 1 });
    expect(textOf(container.querySelector('.map-message[role="status"]')))
      .toBe('No intersections found for this city.');
    expect(map.layers['access-score-intersection-points']).toBeUndefined();
  });

  it('shows an alert when the intersections request fails', async () => {
    const { container } = await renderPreview({
      '/v3/api/accessScoreIntersections?inline=true&regionId=7': { status: 500 },
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(textOf(container)).toBe('Unable to load AccessScore data for the preview.');
  });

  it('does nothing but report it when the page lacks the container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    const { AccessScoreIntersectionsPreview } =
      await loadModules('frontend/js/api-docs/accessScoreIntersectionsPreview.js');
    await AccessScoreIntersectionsPreview.init();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('AccessScore intersections preview container not found.');
  });
});
