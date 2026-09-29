/**
 * Tests for PannellumViewer loading from a PanoImageCache (public/js/common/pano-viewer/src/PannellumViewer.js,
 * issue #5562).
 *
 * The viewer's first attempt at a pano is the URL its width ladder (#5256) puts at rung 0, and that is the URL a
 * prefetch was keyed by, so a held copy stands in for exactly that attempt. The later rungs stay network URLs: a held
 * copy that fails is the same bytes failing to decode or texture, and the right retry is a smaller copy, not the
 * download that produced them. The entry is released once the load has settled either way, and the viewer records
 * whether the load was served from the cache, which is what Validate logs as `PanoPrefetch`.
 *
 * Pannellum itself is a fake that settles each scene's load by whether its URL is on a failing list, so the
 * assertions read the URLs it was handed, in order.
 */

const fs = require('fs');
const path = require('path');

const VIEWER_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src/PannellumViewer.js');

const NATIVE_URL = '/backupImage/p1';
const NEXT_URL = '/backupImage/p2';

/**
 * Installs a fake `pannellum` whose viewers settle a scene's load on the next microtask.
 * @param {Set<string>} [failingUrls] - Panorama URLs whose load fires `error` instead of `load`.
 * @returns {{attempted: string[], loaded: string[]}} Every URL a load was tried for, and the ones that succeeded.
 */
function installFakePannellum(failingUrls = new Set()) {
    const attempted = [];
    const loaded = [];
    global.pannellum = {
        viewer: jest.fn((_el, config) => {
            const handlers = { load: new Set(), error: new Set() };
            const scenes = { ...config.scenes };
            const settle = (url) => Promise.resolve().then(() => {
                attempted.push(url);
                if (failingUrls.has(url)) {
                    [...handlers.error].forEach((h) => h('load failed'));
                } else {
                    loaded.push(url);
                    [...handlers.load].forEach((h) => h());
                }
            });
            settle(scenes[config.default.firstScene].panorama);
            return {
                on: (event, handler) => handlers[event].add(handler),
                off: (event, handler) => handlers[event].delete(handler),
                addScene: (id, scene) => { scenes[id] = scene; },
                loadScene: (id) => settle(scenes[id].panorama),
                removeScene: jest.fn(() => true),
                destroy: jest.fn(),
                resize: jest.fn(),
                getYaw: () => 0,
                getPitch: () => 0,
                getHfov: () => 90,
                setYaw: jest.fn(),
                setPitch: jest.fn(),
                setHfov: jest.fn(),
            };
        }),
    };
    return { attempted, loaded };
}

/**
 * A cache holding the given network URL -> blob URL entries, recording what the viewer releases.
 * @param {Object<string, string>} held
 * @returns {{resolve: jest.Mock, release: jest.Mock}}
 */
function fakeCache(held) {
    return {
        resolve: jest.fn((url) => held[url]),
        release: jest.fn((url) => { delete held[url]; }),
    };
}

describe('PannellumViewer loads from the image cache first (issue #5562)', () => {
    let PannellumViewer;
    let canvas;

    beforeEach(() => {
        canvas = document.createElement('div');
        document.body.appendChild(canvas);

        // No WebGL in jsdom, so the width cap is unknown and rung 0 is the native file; a desktop page.
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        global.util = {
            isMobile: () => false,
            pano: { zoomToFov: (zoom) => 126.5 - zoom * 36.75, fovToZoom: (fov) => (126.5 - fov) / 36.75 },
        };
        global.PanoViewer = class PanoViewer {
            constructor() {
                this.panoChangedListeners = [];
                this.povChangedListeners = [];
            }

            getViewerType() { return 'pannellum'; }
        };
        global.PanoData = class PanoData {
            constructor(props) { Object.assign(this, props); }

            getPanoId() { return this.panoId; }

            getProperty(key) { return this[key]; }
        };
        global.moment = function moment() { return {}; };

        const src = fs.readFileSync(VIEWER_PATH, 'utf8');
        PannellumViewer = (0, eval)('(() => {\n' + src + '\nreturn PannellumViewer;\n})()');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        document.body.innerHTML = '';
        for (const name of ['util', 'PanoViewer', 'PanoData', 'moment', 'pannellum']) delete global[name];
    });

    const metadata = (panoId, imageUrl) => ({ panoId, imageUrl, width: 16384, height: 8192, cameraHeading: 0 });

    /**
     * Creates a viewer on the first pano.
     * @param {?object} imageCache - The cache to attach, or null for none.
     * @returns {Promise<PannellumViewer>}
     */
    async function viewerWith(imageCache) {
        const viewer = new PannellumViewer();
        await viewer.initialize(canvas, { panoMetadata: metadata('p1', NATIVE_URL), imageCache });
        return viewer;
    }

    test('a held copy is loaded in place of the network URL, and released once it has loaded', async () => {
        const { attempted } = installFakePannellum();
        const cache = fakeCache({ [NATIVE_URL]: 'blob:p1' });

        const viewer = await viewerWith(cache);

        expect(attempted).toEqual(['blob:p1']);
        expect(cache.release).toHaveBeenCalledWith(NATIVE_URL);
        expect(viewer.lastLoadPrefetched).toBe(true);
    });

    test('with nothing held the network URL is loaded, and the miss is recorded', async () => {
        const { attempted } = installFakePannellum();
        const cache = fakeCache({});

        const viewer = await viewerWith(cache);

        expect(attempted).toEqual([NATIVE_URL]);
        expect(viewer.lastLoadPrefetched).toBe(false);
    });

    test('a held copy that fails steps down to a smaller network copy rather than the same bytes again', async () => {
        const { attempted, loaded } = installFakePannellum(new Set(['blob:p1']));
        const cache = fakeCache({ [NATIVE_URL]: 'blob:p1' });

        await viewerWith(cache);

        expect(attempted).toEqual(['blob:p1', `${NATIVE_URL}?maxWidth=8192`]);
        expect(loaded).toEqual([`${NATIVE_URL}?maxWidth=8192`]);
        expect(cache.release).toHaveBeenCalledWith(NATIVE_URL);
    });

    test('the next pano is looked up the same way', async () => {
        const { attempted } = installFakePannellum();
        const cache = fakeCache({ [NEXT_URL]: 'blob:p2' });
        const viewer = await viewerWith(cache);

        await viewer.loadPano('p2', metadata('p2', NEXT_URL), { heading: 0, pitch: 0, zoom: 1 });

        expect(attempted).toEqual([NATIVE_URL, 'blob:p2']);
        expect(cache.release).toHaveBeenLastCalledWith(NEXT_URL);
        expect(viewer.lastLoadPrefetched).toBe(true);
        expect(viewer.getPanoId()).toBe('p2');
    });

    test('asking for the pano already shown fetches nothing and reports no prefetch outcome', async () => {
        const { attempted } = installFakePannellum();
        const cache = fakeCache({});
        const viewer = await viewerWith(cache);
        expect(viewer.lastLoadPrefetched).toBe(false);

        await viewer.loadPano('p1', metadata('p1', NATIVE_URL), { heading: 0, pitch: 0, zoom: 1 });

        expect(attempted).toEqual([NATIVE_URL]);
        expect(viewer.lastLoadPrefetched).toBeNull();
    });

    test('a next pano that fails even at the smallest copy is still released', async () => {
        const failing = new Set(['blob:p2', `${NEXT_URL}?maxWidth=8192`, `${NEXT_URL}?maxWidth=4096`]);
        installFakePannellum(failing);
        const cache = fakeCache({ [NEXT_URL]: 'blob:p2' });
        const viewer = await viewerWith(cache);

        await expect(viewer.loadPano('p2', metadata('p2', NEXT_URL), { heading: 0, pitch: 0, zoom: 1 }))
            .rejects.toThrow();

        expect(cache.release).toHaveBeenLastCalledWith(NEXT_URL);
    });

    test('a viewer with no cache loads from the network and reports the question as not applicable', async () => {
        const { attempted } = installFakePannellum();

        const viewer = await viewerWith(null);

        expect(attempted).toEqual([NATIVE_URL]);
        expect(viewer.lastLoadPrefetched).toBeNull();
    });
});
