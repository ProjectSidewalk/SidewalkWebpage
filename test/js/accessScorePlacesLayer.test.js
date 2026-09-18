/**
 * Tests for AccessScorePlacesLayer (public/js/access-score/src/AccessScorePlacesLayer.js, #5311): the place
 * markers beside the scores. A fake Mapbox map records what the layer adds, so the suite pins one symbol layer per
 * category at its zoom, the visibility of the master toggle and the category set, the data buffered until the icons
 * are drawn, the remount after a basemap swap, and the lookups the page uses (counts, a place by id, the marker
 * nearest a link's position). Icon drawing is stubbed: jsdom has neither image loading nor a canvas.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const CATEGORIES = ['school', 'health', 'transit'];

/** A place feature at (lng, lat). */
function place(id, category, lng, lat, name = `Place ${id}`) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { place_id: id, category, name },
    };
}

/** A Mapbox map stand-in that records sources, layers, images, and layout changes. */
function fakeMap() {
    const sources = new Map();
    const layers = new Map();
    const images = new Map();
    const handlers = [];
    return {
        sources, layers, images, handlers,
        addSource: jest.fn((id, spec) => sources.set(id, { ...spec, setData: jest.fn() })),
        getSource: (id) => sources.get(id),
        removeSource: jest.fn((id) => sources.delete(id)),
        addLayer: jest.fn((spec) => layers.set(spec.id, spec)),
        getLayer: (id) => layers.get(id),
        removeLayer: jest.fn((id) => layers.delete(id)),
        setLayoutProperty: jest.fn((id, name, value) => {
            layers.get(id).layout[name] = value;
        }),
        hasImage: (id) => images.has(id),
        addImage: jest.fn((id, pixels, opts) => images.set(id, { pixels, opts })),
        removeImage: jest.fn((id) => images.delete(id)),
        on: jest.fn((event, layerIds, handler) => handlers.push({ event, layerIds, handler })),
        queryRenderedFeatures: jest.fn(() => []),
        setFeatureState: jest.fn(),
        getCanvas: () => ({ style: {} }),
    };
}

describe('AccessScorePlacesLayer', () => {
    let AccessScorePlacesLayer;
    const pixels = { width: 52, height: 52, data: new Uint8ClampedArray(52 * 52 * 4) };

    beforeAll(() => {
        window.util = { assetPath: (p) => `/assets/${p}` };
        window.mapboxgl = { Popup: class { setLngLat() { return this; } setHTML() { return this; } addTo() { return this; } remove() {} } };
        window.eval(`${read('public/js/access-score/src/AccessScorePlacesLayer.js')}\nwindow.AccessScorePlacesLayer = AccessScorePlacesLayer;`);
        AccessScorePlacesLayer = window.AccessScorePlacesLayer;
        AccessScorePlacesLayer.rasterize = jest.fn(async () => pixels);
    });

    function mount(options = {}) {
        const map = fakeMap();
        const layer = new AccessScorePlacesLayer(map, { categories: CATEGORIES, tooltipHtml: () => '', onSelect: jest.fn(), ...options });
        return { map, layer };
    }

    test('draws one marker image and one symbol layer per category, gated at the category zoom', async () => {
        const { map, layer } = mount();
        await layer.ready;
        expect([...map.images.keys()]).toEqual(['acs-place-school', 'acs-place-health', 'acs-place-transit']);
        expect(map.images.get('acs-place-school').opts).toEqual({ pixelRatio: 2 });
        expect(map.images.get('acs-place-school').pixels).toBe(pixels);
        expect(AccessScorePlacesLayer.rasterize).toHaveBeenCalledWith(
            '/assets/images/icons/school-white-lucide.svg', expect.objectContaining({ fill: expect.any(String) }));

        expect([...map.layers.keys()]).toEqual(['acs-places-school', 'acs-places-health', 'acs-places-transit']);
        const school = map.layers.get('acs-places-school');
        expect(school.type).toBe('symbol');
        expect(school.minzoom).toBe(12);
        expect(school.layout['icon-image']).toBe('acs-place-school');
        expect(school.layout['icon-allow-overlap']).toBe(false);
        expect(school.layout['text-optional']).toBe(true);
        // Named places win collisions within a category: a null name must sort last, not read as present.
        expect(school.layout['symbol-sort-key']).toEqual(['case', ['to-boolean', ['coalesce', ['get', 'name'], '']], 0, 1]);
        expect(map.layers.get('acs-places-health').minzoom).toBe(12);
        expect(map.sources.get('acs-places-school').promoteId).toBe('place_id');
    });

    test('falls back to a plain pin for a category the backend added before this file learned it', async () => {
        const { map, layer } = mount({ categories: ['school', 'skatepark'] });
        await layer.ready;
        expect(AccessScorePlacesLayer.presentation('skatepark')).toEqual(AccessScorePlacesLayer.DEFAULT_PRESENTATION);
        expect(AccessScorePlacesLayer.rasterize).toHaveBeenCalledWith(
            '/assets/images/icons/map-pin-white-lucide.svg', expect.anything());
        expect(map.layers.get('acs-places-skatepark').minzoom).toBe(14);
    });

    test('buffers data given before the icons are ready, then splits it by category', async () => {
        const { map, layer } = mount();
        const data = { type: 'FeatureCollection', features: [
            place(1, 'school', -74.01, 40.88), place(2, 'transit', -74.02, 40.88), place(3, 'transit', -74.03, 40.88),
            place(4, 'cafe', -74.04, 40.88),
        ] };
        layer.setData(data);
        expect(map.sources.size).toBe(0);
        await layer.ready;
        const fed = (id) => map.sources.get(id).setData.mock.calls.at(-1)[0].features.map((f) => f.properties.place_id);
        expect(fed('acs-places-school')).toEqual([1]);
        expect(fed('acs-places-health')).toEqual([]);
        expect(fed('acs-places-transit')).toEqual([2, 3]);
        expect(layer.counts()).toEqual({ school: 1, health: 0, transit: 2 });
    });

    test('shows and hides by the category set, and reports the lowest zoom that can draw', async () => {
        const { map, layer } = mount();
        await layer.ready;
        const visibility = () => Object.fromEntries(CATEGORIES.map((c) => [c, map.layers.get(`acs-places-${c}`).layout.visibility]));
        expect(visibility()).toEqual({ school: 'visible', health: 'visible', transit: 'visible' });
        expect(layer.lowestVisibleZoom()).toBe(12);

        layer.setCategories(['transit']);
        expect(visibility()).toEqual({ school: 'none', health: 'none', transit: 'visible' });
        expect(layer.lowestVisibleZoom()).toBe(14);

        // "Deselect all": an empty set, distinct from null.
        layer.setCategories([]);
        expect(visibility()).toEqual({ school: 'none', health: 'none', transit: 'none' });
        expect(layer.lowestVisibleZoom()).toBe(Infinity);

        layer.setCategories(null);
        expect(visibility()).toEqual({ school: 'visible', health: 'visible', transit: 'visible' });
    });

    test('claims a pointer event only when a visible marker is under it', async () => {
        const { map, layer } = mount();
        await layer.ready;
        map.queryRenderedFeatures.mockReturnValueOnce([{ id: 1 }]);
        expect(layer.claims({ point: [1, 1] })).toBe(true);
        expect(map.queryRenderedFeatures).toHaveBeenCalledWith([1, 1], { layers: ['acs-places-school', 'acs-places-health', 'acs-places-transit'] });
        expect(layer.claims({ point: [1, 1] })).toBe(false);
    });

    test('remounts images, sources and layers after a basemap swap with the same data and visibility', async () => {
        const { map, layer } = mount();
        await layer.ready;
        layer.setData({ type: 'FeatureCollection', features: [place(1, 'school', -74.01, 40.88)] });
        layer.setCategories(['school']);
        // A style swap drops everything the tool added.
        map.layers.clear();
        map.sources.clear();
        map.images.clear();
        await layer.remount();
        expect([...map.images.keys()]).toEqual(['acs-place-school', 'acs-place-health', 'acs-place-transit']);
        expect([...map.layers.keys()]).toEqual(['acs-places-school', 'acs-places-health', 'acs-places-transit']);
        expect(map.sources.get('acs-places-school').setData.mock.calls.at(-1)[0].features).toHaveLength(1);
        expect(map.layers.get('acs-places-school').layout.visibility).toBe('visible');
        expect(map.layers.get('acs-places-health').layout.visibility).toBe('none');
        // The handlers were bound once, by layer id, and survive the swap.
        expect(map.on).toHaveBeenCalledTimes(3);
    });

    test('finds a place by id, and the marker nearest a linked position within five meters', async () => {
        const { layer } = mount();
        await layer.ready;
        layer.setData({ type: 'FeatureCollection', features: [
            place(1, 'school', -74.0100, 40.8800, 'Near School'), place(2, 'school', -74.0101, 40.8800, 'Far School'),
        ] });
        expect(layer.place(1)).toEqual(expect.objectContaining({ place_id: 1, name: 'Near School', lngLat: { lng: -74.01, lat: 40.88 } }));
        expect(layer.place(9)).toBeNull();
        // 0.00003 deg of latitude is about 3 m: the near school, not the one 8 m further west.
        expect(layer.placeNear({ lat: 40.88003, lng: -74.01 }).place_id).toBe(1);
        expect(layer.placeNear({ lat: 40.8801, lng: -74.01 })).toBeNull();
    });

    test('hands a click on a marker to the page with its position, and marks the event as handled', async () => {
        const onSelect = jest.fn();
        const { map, layer } = mount({ onSelect });
        await layer.ready;
        const click = map.handlers.find((h) => h.event === 'click');
        const event = { features: [place(7, 'transit', -74.02, 40.88, 'Stop')], preventDefault: jest.fn() };
        click.handler(event);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ place_id: 7, name: 'Stop', lngLat: { lng: -74.02, lat: 40.88 } }));
    });
});
