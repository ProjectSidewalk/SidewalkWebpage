/**
 * Tests for AccessScoreClusterLayer (frontend/js/access-score/AccessScoreClusterLayer.js, #5217): the hover that
 * the street panel shares with the map (#5748). A dot under the pointer reports its parsed properties outward and
 * takes the hover feature-state; the panel can light a dot the same way from a tile, and put it out, without the
 * tooltip coming up.
 */

import { loadModules, mockModule } from './loader.js';

/** A Mapbox map stand-in that records sources, layers, handlers and feature state. */
function fakeMap() {
  const sources = new Map();
  const layers = new Map();
  const handlers = [];
  return {
    sources, layers, handlers,
    addSource: vi.fn((id, spec) => sources.set(id, { ...spec, setData: vi.fn() })),
    getSource: (id) => sources.get(id),
    removeSource: vi.fn((id) => sources.delete(id)),
    addLayer: vi.fn((spec) => layers.set(spec.id, spec)),
    getLayer: (id) => layers.get(id),
    removeLayer: vi.fn((id) => layers.delete(id)),
    setLayoutProperty: vi.fn(),
    on: vi.fn((event, layerIds, handler) => handlers.push({ event, layerIds, handler })),
    queryRenderedFeatures: vi.fn(() => []),
    setFeatureState: vi.fn(),
    getCanvas: () => ({ style: {} }),
  };
}

describe('AccessScoreClusterLayer', () => {
  let AccessScoreClusterLayer;
  const popup = { setLngLat: vi.fn(), setHTML: vi.fn(), addTo: vi.fn(), remove: vi.fn() };

  beforeAll(async () => {
    popup.setLngLat.mockReturnValue(popup);
    popup.setHTML.mockReturnValue(popup);
    mockModule('frontend/js/common/mapboxgl.js', () => ({
      default: { Popup: class { constructor() { return popup; } } },
    }));
    ({ AccessScoreClusterLayer } = await loadModules('frontend/js/access-score/AccessScoreClusterLayer.js'));
  });

  const feature = (id, type, size = 2) => ({
    id,
    layer: { id: `acs-clusters-${type}` },
    properties: {
      label_cluster_id: id, label_type: type, cluster_size: size, street_edge_id: 1,
      label_ids: JSON.stringify([10, 11]), users: JSON.stringify(['u']), tag_counts: JSON.stringify({ narrow: 1 }),
    },
  });

  test('a dot under the pointer reports its parsed properties and takes the hover state; leaving clears both', () => {
    const map = fakeMap();
    const onHover = vi.fn();
    const layer = new AccessScoreClusterLayer(map, {
      types: ['CurbRamp', 'Obstacle'], tooltipHtml: () => '<b>tip</b>', onSelect: vi.fn(), onHover,
    });
    expect(layer).toBeTruthy();
    const move = map.handlers.find((h) => h.event === 'mousemove').handler;
    move({ features: [feature(5, 'Obstacle')], lngLat: { lng: 0, lat: 0 } });
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'acs-clusters-Obstacle', id: 5 }, { hover: true });
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0][0]).toMatchObject({ label_cluster_id: 5, label_ids: [10, 11], tag_counts: { narrow: 1 } });
    // The same dot again is the same hover: no second report.
    move({ features: [feature(5, 'Obstacle')], lngLat: { lng: 0, lat: 0 } });
    expect(onHover).toHaveBeenCalledTimes(1);
    map.handlers.find((h) => h.event === 'mouseleave').handler();
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'acs-clusters-Obstacle', id: 5 }, { hover: false });
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  test('setHovered lights a dot from outside without a tooltip, and puts it out; hidden layers take no hover', () => {
    const map = fakeMap();
    const onHover = vi.fn();
    const layer = new AccessScoreClusterLayer(map, {
      types: ['CurbRamp'], tooltipHtml: () => null, onSelect: vi.fn(), onHover,
    });
    popup.addTo.mockClear();
    layer.setHovered({ label_cluster_id: 9, label_type: 'CurbRamp' });
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: 'acs-clusters-CurbRamp', id: 9 }, { hover: true });
    expect(popup.addTo).not.toHaveBeenCalled();
    // A hover that starts in the panel is not reported back to it.
    expect(onHover).not.toHaveBeenCalled();
    layer.setHovered(null);
    expect(map.setFeatureState).toHaveBeenLastCalledWith({ source: 'acs-clusters-CurbRamp', id: 9 }, { hover: false });
    map.setFeatureState.mockClear();
    layer.setVisible(false);
    layer.setHovered({ label_cluster_id: 9, label_type: 'CurbRamp' });
    expect(map.setFeatureState).not.toHaveBeenCalledWith(expect.anything(), { hover: true });
  });
});
