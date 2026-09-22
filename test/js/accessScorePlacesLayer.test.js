/**
 * Tests for AccessScorePlacesLayer (public/js/access-score/src/AccessScorePlacesLayer.js, #5311): the place
 * markers beside the scores. A fake Mapbox map records what the layer adds, so the suite pins one symbol layer per
 * category at its zoom, the visibility of the master toggle and the category set, the data buffered until the icons
 * are drawn, the remount after a basemap swap, and the lookups the page uses (counts, a place by id, the marker
 * nearest a link's position), plus the score-colored discs: one image per category and score bin, the `score_bin`
 * each place is stamped with, and the per-frame restamp a reweighting asks for. Icon drawing is stubbed: jsdom has
 * neither image loading nor a canvas.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');

const CATEGORIES = ['school', 'health', 'transit'];
/** Two score bins keep the image lists short; the page passes the model's ten. */
const BINS = 2;

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
    /** The ramp the stubbed ScoreRamp hands out: worst first. The light middle is what flips the glyph dark. */
    const RAMP = { light: ['#a74d32', '#fabf1c'], dark: ['#eb724e', '#5fb38a'] };

    beforeAll(() => {
        window.util = { assetPath: (p) => `/assets/${p}` };
        window.mapboxgl = { Popup: class { setLngLat() { return this; } setHTML() { return this; } addTo() { return this; } remove() {} } };
        // `at` is read at the two bin centers (0.25, 0.75); with two stops those are the stops' colors blended, so
        // the stub returns the stop nearest the center instead, which is all the discs' identity needs.
        window.ScoreRamp = { at: jest.fn((score, { mode } = {}) => RAMP[mode ?? 'light'][score < 0.5 ? 0 : 1]) };
        // The tokens the discs read: the marker ink, its halo, and the two unaudited-street greys.
        const tokens = {
            '--color-place-marker': '#121119', '--color-place-marker-halo': '#ffffff', '--color-neutral-white': '#ffffff',
            '--color-neutral-700': '#6b6b6b', '--color-neutral-400': '#c2c2c2',
        };
        window.getComputedStyle = () => ({ getPropertyValue: (name) => tokens[name] ?? '' });
        window.requestAnimationFrame = jest.fn((cb) => { cb(); return 1; });
        window.eval(`${read('public/js/common/PlaceCategoryIcons.js')}\nwindow.PlaceCategoryIcons = PlaceCategoryIcons;`);
        window.eval(`${read('public/js/access-score/src/AccessScorePlacesLayer.js')}\nwindow.AccessScorePlacesLayer = AccessScorePlacesLayer;`);
        AccessScorePlacesLayer = window.AccessScorePlacesLayer;
        AccessScorePlacesLayer.loadGlyph = jest.fn(async (url) => ({ src: url }));
        AccessScorePlacesLayer.rasterize = jest.fn(() => pixels);
    });

    beforeEach(() => {
        AccessScorePlacesLayer.loadGlyph.mockClear();
        AccessScorePlacesLayer.rasterize.mockClear();
    });

    function mount(options = {}) {
        const map = fakeMap();
        const layer = new AccessScorePlacesLayer(map, {
            categories: CATEGORIES, tooltipHtml: () => '', onSelect: jest.fn(), bins: BINS, ...options,
        });
        return { map, layer };
    }

    /** The image ids a category gets: one per bin, worst first, then the no-score disc. */
    const imagesOf = (category) => [`acs-place-${category}-0`, `acs-place-${category}-1`, `acs-place-${category}-none`];

    test('draws one marker image per category and score bin, and one symbol layer per category', async () => {
        const { map, layer } = mount();
        await layer.ready;
        expect([...map.images.keys()].sort()).toEqual(CATEGORIES.flatMap(imagesOf).sort());
        expect(map.images.get('acs-place-school-0').opts).toEqual({ pixelRatio: 2 });
        expect(map.images.get('acs-place-school-0').pixels).toBe(pixels);
        // The glyph is decoded once per category, not once per disc.
        expect(AccessScorePlacesLayer.loadGlyph).toHaveBeenCalledTimes(CATEGORIES.length);
        expect(AccessScorePlacesLayer.loadGlyph).toHaveBeenCalledWith('/assets/images/icons/school-white-lucide.svg');
        // Each disc is the ramp at its bin, then the unaudited-street grey; the glyph flips to the marker ink on the
        // light yellow, where white would not read, and stays white on the dark red and the grey.
        const discs = AccessScorePlacesLayer.rasterize.mock.calls
            .filter(([glyph]) => glyph.src.endsWith('school-white-lucide.svg')).map(([, colors]) => colors);
        expect(discs).toEqual([
            { fill: '#a74d32', halo: '#ffffff', glyph: '#ffffff' },
            { fill: '#fabf1c', halo: '#ffffff', glyph: '#121119' },
            { fill: '#6b6b6b', halo: '#ffffff', glyph: '#ffffff' },
        ]);

        expect([...map.layers.keys()]).toEqual(['acs-places-school', 'acs-places-health', 'acs-places-transit']);
        const school = map.layers.get('acs-places-school');
        expect(school.type).toBe('symbol');
        // No zoom gate: a category a reader turns on is drawn at whatever zoom they are at.
        expect(school.minzoom).toBeUndefined();
        // The disc is picked per place by its stamped bin; an unstamped place wears the no-score disc.
        expect(school.layout['icon-image']).toEqual(['concat', 'acs-place-school-', ['coalesce', ['get', 'score_bin'], 'none']]);
        expect(school.layout['icon-allow-overlap']).toBe(false);
        expect(school.layout['text-optional']).toBe(true);
        // Named places win collisions within a category: a null name must sort last, not read as present.
        expect(school.layout['symbol-sort-key']).toEqual(['case', ['to-boolean', ['coalesce', ['get', 'name'], '']], 0, 1]);
        expect(map.sources.get('acs-places-school').promoteId).toBe('place_id');
    });

    test('falls back to a plain pin for a category the backend added before this file learned it', async () => {
        const { map, layer } = mount({ categories: ['school', 'skatepark'] });
        await layer.ready;
        expect(AccessScorePlacesLayer.presentation('skatepark')).toEqual({ icon: window.PlaceCategoryIcons.DEFAULT_FILE });
        expect(AccessScorePlacesLayer.loadGlyph).toHaveBeenCalledWith('/assets/images/icons/map-pin-white-lucide.svg');
        expect([...map.images.keys()]).toEqual(expect.arrayContaining(imagesOf('skatepark')));
        expect(map.layers.get('acs-places-skatepark').layout['icon-image'][1]).toBe('acs-place-skatepark-');
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

    test('stamps each place with its nearest street\'s bin, and restamps once per frame on a rescore', async () => {
        const bins = { 10: 1, 11: null };
        const binOf = jest.fn((props) => bins[props.nearest_street_edge_id] ?? null);
        const { map, layer } = mount({ binOf });
        await layer.ready;
        const scored = (id, street) => {
            const feature = place(id, 'school', -74.01, 40.88);
            feature.properties.nearest_street_edge_id = street;
            return feature;
        };
        layer.setData({ type: 'FeatureCollection', features: [scored(1, 10), scored(2, 11), scored(3, null)] });
        const stamped = () => map.sources.get('acs-places-school').setData.mock.calls.at(-1)[0].features.map((f) => f.properties.score_bin);
        // A bin as a string, since it is glued into an image id; no street, or an unaudited one, is the no-score disc.
        expect(stamped()).toEqual(['1', 'none', 'none']);

        // The sliders moved the street into the other bin: the next frame restamps, and two asks in one frame draw once.
        bins[10] = 0;
        const uploads = map.sources.get('acs-places-school').setData.mock.calls.length;
        let frame = null;
        window.requestAnimationFrame.mockImplementation((cb) => { frame = cb; return 1; });
        layer.rescore();
        layer.rescore();
        expect(stamped()).toEqual(['1', 'none', 'none']);
        frame();
        window.requestAnimationFrame.mockImplementation((cb) => { cb(); return 1; });
        expect(stamped()).toEqual(['0', 'none', 'none']);
        expect(map.sources.get('acs-places-school').setData.mock.calls.length).toBe(uploads + 1);
    });

    test('draws the dark ramp\'s discs after a swap to the dark basemap', async () => {
        const { layer } = mount();
        await layer.ready;
        AccessScorePlacesLayer.rasterize.mockClear();
        layer.setDark(true);
        await layer.remount();
        const fills = AccessScorePlacesLayer.rasterize.mock.calls
            .filter(([glyph]) => glyph.src.endsWith('school-white-lucide.svg')).map(([, colors]) => colors.fill);
        expect(fills).toEqual([...RAMP.dark, '#c2c2c2']);
        expect(window.ScoreRamp.at).toHaveBeenCalledWith(0.25, { mode: 'dark' });
    });

    test('shows and hides by the category set', async () => {
        const { map, layer } = mount();
        await layer.ready;
        const visibility = () => Object.fromEntries(CATEGORIES.map((c) => [c, map.layers.get(`acs-places-${c}`).layout.visibility]));
        expect(visibility()).toEqual({ school: 'visible', health: 'visible', transit: 'visible' });

        layer.setCategories(['transit']);
        expect(visibility()).toEqual({ school: 'none', health: 'none', transit: 'visible' });

        // "Deselect all": an empty set, distinct from null.
        layer.setCategories([]);
        expect(visibility()).toEqual({ school: 'none', health: 'none', transit: 'none' });

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
        expect([...map.images.keys()].sort()).toEqual(CATEGORIES.flatMap(imagesOf).sort());
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
