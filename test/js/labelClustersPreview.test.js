/**
 * The /v3/api-docs/labelClusters preview (#5840): a map of the busiest region's label clusters, colored by label type
 * and sized by how many labels each holds, with a count, a legend of the types drawn, and a popup per cluster.
 */

import { loadModules } from './loader.js';
import {
  flush, regionFeature, resetWorld, routeFetch, stampColorTokens, stubApiDocsLibraries, textOf, world,
} from './support/apiDocsHarness.js';

stubApiDocsLibraries();

const LABEL_TYPES = {
  label_types: [
    { name: 'CurbRamp', color: '#90C31F', display_name: 'Curb Ramp', description: 'A ramp onto the street.' },
    { name: 'Obstacle', color: '#78B0EA', display_name: 'Obstacle', description: 'Something in the way.' },
  ],
};

function cluster(id, properties = {}) {
  return {
    type: 'Feature',
    properties: {
      label_cluster_id: id, label_type: 'CurbRamp', cluster_size: 2, agree_count: 0, disagree_count: 0,
      unsure_count: 0, ...properties,
    },
    geometry: { type: 'Point', coordinates: [0.002, 0.003] },
  };
}

/** Loads the preview onto a page with its container, and runs it against the given responses. */
async function renderPreview({
  clusters = { type: 'FeatureCollection', features: [cluster(1), cluster(2, { label_type: 'Obstacle' })] },
  routes = {},
} = {}) {
  document.body.innerHTML = '<div id="label-clusters-preview"></div>';
  const fetchStub = routeFetch({
    '/v3/api/labelTypes': LABEL_TYPES,
    '/v3/api/regionWithMostLabels': regionFeature(),
    '/v3/api/labelClusters?regionId=7': clusters,
    ...routes,
  });
  const { LabelClustersPreview } = await loadModules('frontend/js/api-docs/labelClustersPreview.js');
  await LabelClustersPreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { fetchStub, container: document.getElementById('label-clusters-preview') };
}

/** Clicks a cluster on the map and returns its popup. */
function clickCluster(properties) {
  world.maps[0].fireOn('label-clusters', 'click', [cluster(9, properties)]);
  return world.popups.at(-1);
}

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a region with clusters', () => {
  it('frames the map on the region, names it, and counts the clusters', async () => {
    const { container } = await renderPreview();
    const map = world.maps[0];
    expect(map.options.bounds.toArray()).toEqual([[0, 0], [0.01, 0.01]]);
    expect([...container.querySelectorAll('.map-chip')].map(textOf)).toEqual(
      ['Region: Fremont', 'Showing 2 clusters']);
    expect(map.layers['region-fill'].source).toBe('preview-region');
  });

  it('colors each cluster by type and lists the drawn types in the legend', async () => {
    const { container } = await renderPreview();
    const paint = world.maps[0].layers['label-clusters'].paint;
    expect(paint['circle-color'].slice(0, 6)).toEqual(
      ['match', ['get', 'label_type'], 'CurbRamp', '#90C31F', 'Obstacle', '#78B0EA']);
    expect([...container.querySelectorAll('.map-legend-item')].map(textOf)).toEqual(['Curb Ramp', 'Obstacle']);
  });

  it('shows a pointer over a cluster, and the arrow again off it', async () => {
    await renderPreview();
    const map = world.maps[0];
    map.fire('mouseenter', {}, 'label-clusters');
    expect(map.canvas.style.cursor).toBe('pointer');
    map.fire('mouseleave', {}, 'label-clusters');
    expect(map.canvas.style.cursor).toBe('');
  });

  it('says so when the region has no clusters, drawing none', async () => {
    const { container } = await renderPreview({ clusters: { type: 'FeatureCollection', features: [] } });
    const message = container.querySelector('.map-message');
    expect(message.getAttribute('role')).toBe('status');
    expect(textOf(message)).toBe('No label clusters found in this region.');
    expect(world.maps[0].layers['label-clusters']).toBeUndefined();
  });

  it('treats a response with no features list as no clusters', async () => {
    const { container } = await renderPreview({ clusters: {} });
    expect(textOf(container.querySelector('.map-message'))).toBe('No label clusters found in this region.');
  });

  it('calls the region "Sample Region" when it has no name, and lists an unknown type by its name', async () => {
    const { container } = await renderPreview({
      clusters: { type: 'FeatureCollection', features: [cluster(1, { label_type: 'Mystery' })] },
      routes: { '/v3/api/regionWithMostLabels': regionFeature({ region_id: 7 }) },
    });
    expect(textOf(container.querySelector('.map-chip'))).toBe('Region: Sample Region');
    expect(textOf(container.querySelector('.map-legend'))).toBe('Label Types Mystery');
  });
});

describe("a cluster's popup", () => {
  it('names its type, severity, size, date, votes and id', async () => {
    await renderPreview();
    const popup = clickCluster({
      median_severity: 2, cluster_size: 5, avg_label_date: '2023-06-01T12:00:00Z',
      agree_count: 3, disagree_count: 1, unsure_count: 2,
    });
    expect(popup.lngLat).toEqual([0.002, 0.003]);
    expect(popup.text()).toBe([
      'Curb Ramp', 'A ramp onto the street.', 'Median Severity: 2', 'Cluster Size: 5 labels',
      `Avg. Label Date: ${new Date('2023-06-01T12:00:00Z').toLocaleDateString()}`,
      'Validation: 3 agree, 1 disagree, 2 unsure', 'Cluster ID: 9',
    ].join(' '));
  });

  it('says what an unrated, undated cluster lacks, and uses the raw name of an unknown type', async () => {
    await renderPreview();
    const popup = clickCluster({ label_type: 'Mystery' });
    expect(popup.text()).toContain('Mystery');
    expect(popup.text()).toContain('No severity rating');
    expect(popup.text()).toContain('Unknown date');
  });
});

describe('when something fails', () => {
  it('shows the label types request failing in the preview', async () => {
    const { container } = await renderPreview({ routes: { '/v3/api/labelTypes': { status: 500 } } });
    expect(textOf(container)).toBe('Failed to load label clusters: HTTP error! Status: 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('shows the region lookup failing in the preview', async () => {
    const { container } = await renderPreview({ routes: { '/v3/api/regionWithMostLabels': { status: 404 } } });
    expect(textOf(container)).toBe('Failed to load label clusters: Failed to fetch region with most labels');
  });

  it('replaces the map with the error when the clusters request fails', async () => {
    const { container } = await renderPreview({ routes: { '/v3/api/labelClusters?regionId=7': { status: 503 } } });
    expect(textOf(container)).toBe('Failed to load label clusters: HTTP error! Status: 503');
  });

  it('rejects, fetching nothing, when the page lacks its container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    const { LabelClustersPreview } = await loadModules('frontend/js/api-docs/labelClustersPreview.js');
    await expect(LabelClustersPreview.init()).rejects.toThrow('Container element not found');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
