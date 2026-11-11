/**
 * The label dots on every Project Sidewalk map (frontend/js/ps-map/addLabelsToMap.js) (#5840): one layer per label
 * type, the hover ring and click-to-open popup, a viewport refetch swapping the dots in place, and the label card's
 * type edit and delete/restore reaching the map without a refetch. Mapbox needs WebGL, which jsdom lacks, so the map
 * is a stand-in that keeps the sources, layers, filters and handlers it is given.
 */

import { loadModules } from './loader.js';

/** A Mapbox map stand-in that records what the module asks of it. */
class FakeMap {
  constructor() {
    this.sources = new Map();
    this.layers = new Map();
    this.filters = {};
    this.handlers = {};
    this.featureStates = [];
  }

  /**
   * Keeps a source with a `setData` that remembers what it was last handed.
   * @param {string} id - Source id.
   * @param {object} spec - The source spec.
   */
  addSource(id, spec) {
    const source = { spec, data: spec.data, setData: (data) => { source.data = data; } };
    this.sources.set(id, source);
  }

  getSource(id) { return this.sources.get(id); }

  addLayer(layer) { this.layers.set(layer.id, layer); }

  getLayer(id) { return this.layers.get(id); }

  setFilter(id, expr) { this.filters[id] = expr; }

  /**
   * Keeps a layer-scoped handler under its event name; the module always names every label layer at once.
   * @param {string} event - Event name.
   * @param {Array<string>} layers - Layer ids.
   * @param {Function} handler - The handler.
   */
  on(event, layers, handler) { this.handlers[event] = { layers, handler }; }

  setFeatureState(target, value) { this.featureStates.push({ ...target, ...value }); }

  /**
   * The ids shown by one label type's layer.
   * @param {string} type - Label type.
   * @returns {Array<number>} The label ids in that layer's source data.
   */
  idsIn(type) { return this.sources.get(`labels-${type}`).data.features.map((f) => f.properties.label_id); }
}

/**
 * A label in the shape /v3/api/labels returns as GeoJSON.
 * @param {number} id - label_id.
 * @param {string} type - label_type.
 * @param {object} [extra] - Further properties.
 * @returns {GeoJSON.Feature<GeoJSON.Point>} The feature.
 */
const label = (id, type, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-122.3 + id / 1000, 47.6] },
  properties: {
    label_id: id, label_type: type, severity: 2, correct: null, has_validations: false, expired: false,
    has_backup: true, high_quality_user: true, tags: [], ...extra,
  },
});

const collection = (features) => ({ type: 'FeatureCollection', features });

describe('addLabelsToMap', () => {
  let addLabelsToMap;
  let setLabelData;
  let map;

  beforeEach(async () => {
    document.body.innerHTML = '<canvas class="mapboxgl-canvas"></canvas>';
    ({ addLabelsToMap, setLabelData } = await loadModules('frontend/js/ps-map/addLabelsToMap.js'));
    map = new FakeMap();
  });

  test('every label type gets its own layer, colored with that type\'s canonical color', async () => {
    await addLabelsToMap(map, collection([]), {});

    for (const lt of window.labelTypes) {
      const layer = map.getLayer(`labels-${lt.name}`);
      expect(layer.source).toBe(`labels-${lt.name}`);
      expect(layer.paint['circle-color'].at(-1)).toBe(lt.color);
    }
  });

  test('each label lands in its own type\'s layer, and an unknown type is dropped', async () => {
    const mapData = await addLabelsToMap(map, collection([
      label(1, 'CurbRamp'), label(2, 'Obstacle'), label(3, 'CurbRamp'), label(4, 'NotAType'),
    ]), {});

    expect(map.idsIn('CurbRamp')).toEqual([1, 3]);
    expect(map.idsIn('Obstacle')).toEqual([2]);
    expect(mapData.sortedLabels.CurbRamp).toHaveLength(2);
  });

  test('incorrect labels start hidden, and low-quality users only when the page asks for that', async () => {
    await addLabelsToMap(map, collection([]), {});
    const plain = JSON.stringify(map.filters['labels-CurbRamp']);
    expect(plain).toContain('["all",false,["==",["get","correct"],false]]');
    expect(plain).not.toContain('high_quality_user');

    map = new FakeMap();
    await addLabelsToMap(map, collection([]), { highQualityFilter: true });
    expect(JSON.stringify(map.filters['labels-CurbRamp'])).toContain('high_quality_user');
  });

  test('a viewport refetch swaps the dots in the same arrays everyone else holds', async () => {
    const mapData = await addLabelsToMap(map, collection([label(1, 'CurbRamp')]), {});
    const held = mapData.sortedLabels.CurbRamp;

    setLabelData(map, mapData, collection([label(5, 'CurbRamp'), label(6, 'Signal')]));

    expect(mapData.sortedLabels.CurbRamp).toBe(held);
    expect(held.map((f) => f.properties.label_id)).toEqual([5]);
    expect(map.idsIn('CurbRamp')).toEqual([5]);
    expect(map.idsIn('Signal')).toEqual([6]);
  });

  describe('with a popup', () => {
    let popupLabelViewer;
    let canvas;

    /**
     * A map event over one label's dot, as Mapbox hands a layer-scoped handler.
     * @param {number} id - label_id.
     * @param {string} type - label_type.
     * @returns {object} The event.
     */
    const over = (id, type) => ({ features: [{ layer: { id: `labels-${type}` }, properties: { label_id: id } }] });

    beforeEach(async () => {
      popupLabelViewer = { showLabel: vi.fn(async () => {}) };
      await addLabelsToMap(map, collection([label(1, 'CurbRamp'), label(2, 'Obstacle')]), {
        popupLabelViewer, uiSource: 'LabelMap',
      });
      canvas = document.querySelector('.mapboxgl-canvas');
    });

    test('clicking a dot opens that label in the popup, naming the page it came from', async () => {
      expect(map.handlers.click.layers).toContain('labels-Obstacle');

      await map.handlers.click.handler(over(2, 'Obstacle'));

      expect(popupLabelViewer.showLabel).toHaveBeenCalledWith(2, 'LabelMap');
    });

    test('hovering rings the dot under the pointer and moves the ring when the pointer moves on', () => {
      map.handlers.mousemove.handler(over(1, 'CurbRamp'));
      expect(map.featureStates).toEqual([{ source: 'labels-CurbRamp', id: 1, hover: true }]);
      expect(canvas.style.cursor).toBe('pointer');

      map.handlers.mousemove.handler(over(1, 'CurbRamp'));
      expect(map.featureStates).toHaveLength(1); // Still on the same dot: nothing to change.

      map.handlers.mousemove.handler(over(2, 'Obstacle'));
      expect(map.featureStates.slice(1)).toEqual([
        { source: 'labels-CurbRamp', id: 1, hover: false },
        { source: 'labels-Obstacle', id: 2, hover: true },
      ]);
    });

    test('leaving the dots clears the ring and the pointer cursor, once', () => {
      map.handlers.mousemove.handler(over(1, 'CurbRamp'));
      map.handlers.mouseleave.handler();

      expect(map.featureStates.at(-1)).toEqual({ source: 'labels-CurbRamp', id: 1, hover: false });
      expect(canvas.style.cursor).toBe('');

      map.handlers.mouseleave.handler();
      expect(map.featureStates).toHaveLength(2);
    });
  });

  test('a map without a popup listens for no clicks or hovers', async () => {
    await addLabelsToMap(map, collection([label(1, 'CurbRamp')]), {});

    expect(map.handlers).toEqual({});
  });

  describe('edits from the label card', () => {
    let mapData;

    beforeEach(async () => {
      mapData = await addLabelsToMap(map, collection([label(1, 'CurbRamp'), label(2, 'CurbRamp')]), {});
    });

    test('changing a label\'s type moves its dot to the new type\'s layer', () => {
      mapData.updateLabelType(1, 'NoCurbRamp');

      expect(map.idsIn('CurbRamp')).toEqual([2]);
      expect(map.idsIn('NoCurbRamp')).toEqual([1]);
      expect(mapData.sortedLabels.NoCurbRamp[0].properties.label_type).toBe('NoCurbRamp');
    });

    test('a type change the map can\'t act on leaves every layer as it was', () => {
      const before = map.getSource('labels-CurbRamp').data;

      mapData.updateLabelType(1, 'CurbRamp'); // Same type.
      mapData.updateLabelType(1, 'NotAType'); // A type this map has no layer for.
      mapData.updateLabelType(99, 'Obstacle'); // A label this map hasn't loaded.

      expect(map.getSource('labels-CurbRamp').data).toBe(before);
      expect(map.idsIn('Obstacle')).toEqual([]);
    });

    test('deleting a label takes its dot off, and restoring it puts the same dot back', () => {
      mapData.setLabelDeleted(1, true);
      expect(map.idsIn('CurbRamp')).toEqual([2]);

      mapData.setLabelDeleted(1, false);
      expect(map.idsIn('CurbRamp')).toEqual([2, 1]);

      mapData.setLabelDeleted(1, false); // A second restore has nothing left to put back.
      expect(map.idsIn('CurbRamp')).toEqual([2, 1]);
    });

    test('deleting a label the map hasn\'t loaded changes nothing', () => {
      const before = map.getSource('labels-CurbRamp').data;

      mapData.setLabelDeleted(99, true);

      expect(map.getSource('labels-CurbRamp').data).toBe(before);
      expect(mapData.deletedFeatures.size).toBe(0);
    });

    test('a restore after a refetch already brought the label back doesn\'t draw it twice', () => {
      mapData.setLabelDeleted(1, true);
      setLabelData(map, mapData, collection([label(1, 'CurbRamp'), label(2, 'CurbRamp')]));

      mapData.setLabelDeleted(1, false);

      expect(map.idsIn('CurbRamp')).toEqual([1, 2]);
    });
  });
});
