/**
 * The /v3/api-docs/rawLabels preview (#5840): a map of every label in the busiest region, colored by label type, with
 * a count, a legend of the types drawn, and a popup per label.
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
    { name: 'Signal', color: '#63C0AB', display_name: 'Signal', description: 'A pedestrian signal.' },
  ],
};

function label(id, properties = {}) {
  return {
    type: 'Feature',
    properties: { label_id: id, label_type: 'CurbRamp', agree_count: 0, disagree_count: 0, ...properties },
    geometry: { type: 'Point', coordinates: [0.005, 0.005] },
  };
}

/** Loads the preview onto a page with its container, and runs it against the given responses. */
async function renderPreview({
  labels = { type: 'FeatureCollection', features: [label(1), label(2)] }, routes = {},
} = {}) {
  document.body.innerHTML = '<div id="raw-labels-preview"></div>';
  const fetchStub = routeFetch({
    '/v3/api/labelTypes': LABEL_TYPES,
    '/v3/api/regionWithMostLabels': regionFeature(),
    '/v3/api/rawLabels?regionId=7': labels,
    ...routes,
  });
  const { RawLabelsPreview } = await loadModules('frontend/js/api-docs/rawLabelsPreview.js');
  await RawLabelsPreview.setup({ mapboxApiKey: 'pk.test' }).init();
  await flush();
  return { fetchStub, container: document.getElementById('raw-labels-preview') };
}

/** Clicks a label on the map and returns its popup. */
function clickLabel(properties) {
  world.maps[0].fireOn('raw-labels', 'click', [label(9, properties)]);
  return world.popups.at(-1);
}

beforeEach(() => {
  resetWorld();
  stampColorTokens();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('a region with labels', () => {
  it('frames the map on the region, outlines it, and names it', async () => {
    const { container } = await renderPreview();
    const map = world.maps[0];
    expect(map.options.bounds.toArray()).toEqual([[0, 0], [0.01, 0.01]]);
    expect(map.layers['region-outline'].source).toBe('preview-region');
    expect(textOf(container.querySelector('.map-chip'))).toBe('Region: Fremont');
    expect(container.querySelector('.loading-message')).toBeNull();
  });

  it('colors each label by its type, from the label types the API serves', async () => {
    await renderPreview();
    const color = world.maps[0].layers['raw-labels'].paint['circle-color'];
    expect(color.slice(0, 8)).toEqual(
      ['match', ['get', 'label_type'], 'CurbRamp', '#90C31F', 'Obstacle', '#78B0EA', 'Signal', '#63C0AB']);
  });

  it('counts the labels, and lists only the types drawn in the legend', async () => {
    const labels = { type: 'FeatureCollection', features: [label(1), label(2, { label_type: 'Obstacle' }), label(3)] };
    const { container } = await renderPreview({ labels });
    const chips = [...container.querySelectorAll('.map-chip')].map(textOf);
    expect(chips).toContain('Showing 3 labels');
    const legend = container.querySelector('.map-legend');
    expect(textOf(legend.querySelector('h4'))).toBe('Label Types');
    expect([...legend.querySelectorAll('.map-legend-item')].map(textOf)).toEqual(['Curb Ramp', 'Obstacle']);
  });

  it('lists a drawn type the API doesn\'t know by its name, in the gray the map draws it in', async () => {
    const labels = { type: 'FeatureCollection', features: [label(1, { label_type: 'Mystery' })] };
    const { container } = await renderPreview({ labels });
    const item = container.querySelector('.map-legend .map-legend-item');
    expect(textOf(item)).toBe('Mystery');
    expect(item.querySelector('.map-legend-swatch').style.backgroundColor).toBe('rgb(68, 68, 68)');
  });

  it('shows a pointer over a label, and the arrow again off it', async () => {
    await renderPreview();
    const map = world.maps[0];
    map.fire('mouseenter', {}, 'raw-labels');
    expect(map.canvas.style.cursor).toBe('pointer');
    map.fire('mouseleave', {}, 'raw-labels');
    expect(map.canvas.style.cursor).toBe('');
  });

  it('says so, drawing no label layer, when the region has no labels', async () => {
    const { container } = await renderPreview({ labels: { type: 'FeatureCollection', features: [] } });
    const message = container.querySelector('.map-message');
    expect(message.getAttribute('role')).toBe('status');
    expect(textOf(message)).toBe('No labels found in this region.');
    expect(world.maps[0].layers['raw-labels']).toBeUndefined();
  });

  it('treats a response with no features list as no labels', async () => {
    const { container } = await renderPreview({ labels: { type: 'FeatureCollection' } });
    expect(textOf(container.querySelector('.map-message'))).toBe('No labels found in this region.');
  });

  it('calls the region "Sample Region" when it has no name', async () => {
    const { container } = await renderPreview({
      routes: { '/v3/api/regionWithMostLabels': regionFeature({ region_id: 7 }) },
    });
    expect(textOf(container.querySelector('.map-chip'))).toBe('Region: Sample Region');
  });
});

describe("a label's popup", () => {
  it('opens at the label, naming its type, description, severity, tags, date and votes', async () => {
    await renderPreview();
    const popup = clickLabel({
      severity: 3, tags: JSON.stringify(['narrow', 'steep']), time_created: '2024-03-05T12:00:00Z',
      correct: true, agree_count: 4, disagree_count: 1, pano_url: 'https://pano.example/abc',
    });
    expect(popup.lngLat).toEqual([0.005, 0.005]);
    expect(popup.text()).toBe([
      'Curb Ramp', 'A ramp onto the street.', 'Severity: 3', 'Tags: narrow, steep',
      `Created: ${new Date('2024-03-05T12:00:00Z').toLocaleDateString()}`, 'Validated (4 agree, 1 disagree)',
      'Label ID: 9', 'View panorama',
    ].join(' '));
    expect(popup.element.querySelector('a[href="https://pano.example/abc"]').target).toBe('_blank');
  });

  it('says what a bare label lacks, and offers no panorama link without a viewer', async () => {
    await renderPreview();
    const popup = clickLabel({});
    expect(popup.text()).toBe(
      'Curb Ramp A ramp onto the street. No severity rating No tags Created: Unknown date Not validated Label ID: 9');
    expect(popup.element.querySelector('a')).toBeNull();
  });

  it('reads an empty tag list as no tags, and a voted-down label as invalidated', async () => {
    await renderPreview();
    const popup = clickLabel({ tags: '[]', correct: false, agree_count: 0, disagree_count: 3 });
    expect(popup.text()).toContain('No tags');
    expect(popup.text()).toContain('Invalidated (0 agree, 3 disagree)');
  });

  it("falls back to the type's own name when the API doesn't know it", async () => {
    await renderPreview();
    const popup = clickLabel({ label_type: 'Mystery' });
    expect(textOf(popup.element.querySelector('h4'))).toBe('Mystery');
  });
});

describe('when something fails', () => {
  it('shows the label types request failing in the preview', async () => {
    const { container } = await renderPreview({ routes: { '/v3/api/labelTypes': { status: 500 } } });
    expect(textOf(container)).toBe('Failed to load raw labels: HTTP error! Status: 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(world.maps).toHaveLength(0);
  });

  it('shows the region lookup failing in the preview', async () => {
    const { container } = await renderPreview({ routes: { '/v3/api/regionWithMostLabels': { status: 404 } } });
    expect(textOf(container)).toBe('Failed to load raw labels: Failed to fetch region with most labels');
  });

  it('replaces the map with the error when the labels request fails', async () => {
    const { container } = await renderPreview({ routes: { '/v3/api/rawLabels?regionId=7': { status: 503 } } });
    expect(textOf(container)).toBe('Failed to load raw labels: HTTP error! Status: 503');
  });

  it('shows a map that never loads as failed', async () => {
    resetWorld({ mapError: new Error('bad token') });
    const { container } = await renderPreview();
    expect(textOf(container)).toBe('Failed to load raw labels: bad token');
  });

  it('rejects, fetching nothing, when the page lacks its container', async () => {
    document.body.innerHTML = '';
    const fetchStub = routeFetch({});
    const { RawLabelsPreview } = await loadModules('frontend/js/api-docs/rawLabelsPreview.js');
    await expect(RawLabelsPreview.init()).rejects.toThrow('Container element not found');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
