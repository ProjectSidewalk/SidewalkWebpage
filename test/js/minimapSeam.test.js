/**
 * The contract between Minimap and everything that draws on it (#5429).
 *
 * Minimap is the only class that names the map library; the peg, label icons, crumbs, flags, and Task's street lines
 * all reach the map through a handful of methods. These tests pin the parts of that seam a caller relies on but can't
 * see:
 *
 * - what a marker is to assistive tech and to the pointer, which follows from the options it was given. A marker with
 *   neither a handler nor a title must be click-through: the peg sits on top of the crumbs nearest the user (#2561).
 * - that however many streets change in a frame, the map receives one upload. A region's worth of Task.render() calls
 *   on load would otherwise re-tile the source once per street.
 * - that creating the minimap never waits on the tile host, a third party Explore must be able to start without.
 *
 * The sources are top-level `class` declarations written for the Grunt-concatenation world, so they are eval'd into
 * the jsdom global scope against a stand-in for the MapLibre global.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const NAVIGATION_DIR = 'public/js/explore/src/navigation';
const SOURCES = ['MinimapStyle', 'MinimapBasemapStyle', 'Minimap'];

/** Stands in for maplibregl.Map: records what was added to it, and fires 'style.load' but never 'load'. */
class FakeMap {
    static instances = [];

    constructor(options) {
        this.options = options;
        this.layers = [];
        this.source = { setData: jest.fn() };
        this.handlers = {};
        FakeMap.instances.push(this);
    }

    addControl() {}

    getContainer() {
        return document.createElement('div');
    }

    addImage() {}

    addSource() {}

    getSource() {
        return this.source;
    }

    addLayer(layer, beforeId) {
        this.layers.push({ id: layer.id, beforeId });
    }

    on(name, handler) {
        (this.handlers[name] ??= []).push(handler);
    }

    // Only the style ever becomes ready: a test that awaited tiles ('load', 'idle') would hang, as Explore would.
    once(name, handler) {
        if (name === 'style.load') setTimeout(handler, 0);
    }
}

/** Stands in for maplibregl.Marker. */
class FakeMarker {
    constructor(options) {
        this.options = options;
    }

    setLngLat(lngLat) {
        this.lngLat = lngLat;
        return this;
    }

    addTo() {
        return this;
    }

    remove() {
        this.removed = true;
    }
}

describe('Minimap seam', () => {
    let minimap;
    let map;
    let frames;

    const flushFrame = () => frames.splice(0).forEach((callback) => callback());

    beforeEach(async () => {
        FakeMap.instances = [];
        frames = [];
        window.requestAnimationFrame = (callback) => frames.push(callback);
        window.util = { assetPath: (logicalPath) => logicalPath };
        window.i18next = { t: (key) => key };
        window.maplibregl = { Map: FakeMap, Marker: FakeMarker, AttributionControl: class {} };
        window.svl = {};
        for (const name of SOURCES) {
            window.eval(`${readSrc(`${NAVIGATION_DIR}/${name}.js`)}; window.${name} = ${name};`);
        }
        // jsdom has no 2D canvas; the chevron's pixels aren't under test.
        window.MinimapStyle.chevronImage = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });

        minimap = await window.Minimap.create({ lat: 47.6, lng: -122.33 });
        [map] = FakeMap.instances;
    });

    test('creation resolves once the style is ready, without waiting for basemap tiles', () => {
        // Reaching this line is the assertion: FakeMap never fires 'load' or 'idle'.
        expect(map.options.center).toEqual([-122.33, 47.6]);
        expect(map.options.interactive).toBe(false);
    });

    test('street lines go under the road names, so a street\'s name stays readable over its route line', () => {
        expect(map.layers.length).toBeGreaterThan(0);
        map.layers.forEach((layer) => expect(layer.beforeId).toBe(window.MinimapBasemapStyle.FIRST_LABEL_LAYER_ID));
        // Bottom to top: context streets, then the route's casing, its lines, and the chevrons over everything.
        expect(map.layers.map((layer) => layer.id)).toEqual([
            'street-other', 'street-completed', 'street-casing', 'street-audited', 'street-remaining',
            'street-remaining-chevrons',
        ]);
    });

    describe('addMarker', () => {
        const LAT_LNG = { lat: 47.6, lng: -122.33 };

        test('a marker with a click handler is a named button that Enter and Space activate', () => {
            const onClick = jest.fn();
            const { element } = minimap.addMarker(LAT_LNG, document.createElement('div'), { onClick, title: 'Go' });

            expect(element.getAttribute('role')).toBe('button');
            expect(element.getAttribute('tabindex')).toBe('0');
            expect(element.getAttribute('aria-label')).toBe('Go');

            element.click();
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
            element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
            expect(onClick).toHaveBeenCalledTimes(3);
        });

        test('a marker with only a title is a named image, not a tab stop', () => {
            const { element } = minimap.addMarker(LAT_LNG, document.createElement('img'), { title: 'Route start' });

            expect(element.getAttribute('role')).toBe('img');
            expect(element.getAttribute('aria-label')).toBe('Route start');
            expect(element.hasAttribute('tabindex')).toBe(false);
            expect(element.classList.contains('minimap-marker-decorative')).toBe(false);
        });

        test('a marker with neither is decoration: hidden from assistive tech and click-through', () => {
            const { element } = minimap.addMarker(LAT_LNG, document.createElement('div'));

            expect(element.getAttribute('aria-hidden')).toBe('true');
            expect(element.classList.contains('minimap-marker-decorative')).toBe(true);
            // Every marker states its own role: MapLibre makes one that doesn't a button named "Map marker".
            expect(element.hasAttribute('role')).toBe(true);
            expect(element.hasAttribute('aria-label')).toBe(true);
        });

        test('the map positions a wrapper, leaving the content\'s own transform alone', () => {
            const content = document.createElement('div');
            content.style.transform = 'rotate(90deg)';
            const marker = minimap.addMarker(LAT_LNG, content);

            expect(marker.element).not.toBe(content);
            expect(marker.element.contains(content)).toBe(true);
            expect(marker.content).toBe(content);
        });

        test('setVisible hides a marker without removing it', () => {
            const marker = minimap.addMarker(LAT_LNG, document.createElement('div'));
            marker.setVisible(false);
            expect(marker.element.hidden).toBe(true);
            marker.setVisible(true);
            expect(marker.element.hidden).toBe(false);
        });
    });

    describe('street lines', () => {
        const line = (kind, ...coordinates) => ({ kind, coordinates });
        const uploaded = () => map.source.setData.mock.calls.at(-1)[0].features;

        test('many streets changing in one frame reach the map as a single upload', () => {
            for (let streetEdgeId = 1; streetEdgeId <= 50; streetEdgeId++) {
                minimap.setStreetLines(streetEdgeId, [line('other', [0, 0], [1, 1])]);
            }
            expect(map.source.setData).not.toHaveBeenCalled();

            flushFrame();
            expect(map.source.setData).toHaveBeenCalledTimes(1);
            expect(uploaded()).toHaveLength(50);
        });

        test('setting a street replaces what it drew before', () => {
            minimap.setStreetLines(7, [line('remaining', [0, 0], [1, 1])]);
            minimap.setStreetLines(7, [line('audited', [0, 0], [1, 1]), line('remaining', [1, 1], [2, 2])]);
            flushFrame();

            expect(uploaded().map((feature) => feature.properties.kind)).toEqual(['audited', 'remaining']);
        });

        test('a half sliced down to a single point is dropped rather than sent as a degenerate line', () => {
            minimap.setStreetLines(7, [line('audited', [0, 0]), line('remaining', [0, 0], [1, 1])]);
            flushFrame();

            expect(uploaded().map((feature) => feature.properties.kind)).toEqual(['remaining']);
        });

        test('clearing a street removes it, and clearing one that was never drawn uploads nothing', () => {
            minimap.setStreetLines(7, [line('other', [0, 0], [1, 1])]);
            flushFrame();

            minimap.clearStreetLines(99);
            expect(frames).toHaveLength(0);

            minimap.clearStreetLines(7);
            flushFrame();
            expect(uploaded()).toHaveLength(0);
        });
    });
});
