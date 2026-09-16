/**
 * The pano viewers' metadata-only lookup, PanoViewer.findPanoNear() (#4669): what each provider answers when asked
 * where the nearest usable pano is, without moving.
 *
 * The contract under test is the one the minimap's forward crumbs depend on: the answer is the pano setLocation()
 * would land on (same search, same scoring, same exclusions); nothing about the viewer's current pano changes; a
 * search that completed and found nothing resolves null while a search that never got an answer rejects, since the
 * caller must not read "unknown" as "empty" (#4918); and a lookup that never settles is given up on rather than left
 * to hang a sampler.
 *
 * The viewers are top-level `class` declarations written for the Grunt-concatenation world, so each provider's
 * source is eval'd into the jsdom global scope over the real PanoViewer base, with stub declarations for the sibling
 * viewer classes PanoViewer's constructor compares `new.target` against. Real turf and the real pano utilities run
 * the distance and scoring math, so the pick is the production pick.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'public/js/common/pano-viewer/src');
const readSrc = (name) => fs.readFileSync(path.join(SRC_DIR, name), 'utf8');

const VIEWER_NAMES = ['GsvViewer', 'MapillaryViewer', 'Infra3dViewer', 'PannellumViewer', 'PanoramaxViewer'];

// utilities.js builds a Bowser parser at load time; nothing here consults it.
window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
loadGlobalScript('public/js/common/utilities.js');
loadGlobalScript('public/js/common/utilitiesMath.js');
// The ranking weights the providers score candidates with, stamped onto <html> the way main.scala.html does it
// (minus the file's own `_`-prefixed documentation), so the pick here is the production pick.
const scoringConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'conf/pano-scoring.json'), 'utf8'));
document.documentElement.dataset.panoScoring = JSON.stringify(
    Object.fromEntries(Object.entries(scoringConfig).filter(([key]) => !key.startsWith('_'))),
);
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');
window.turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));
window.svl = { STREETVIEW_MAX_DISTANCE: 25 };

const { turf } = window;

/**
 * Loads the real PanoViewer plus one provider fresh into the jsdom global scope.
 * @param {string} name - The provider class to load, e.g. 'GsvViewer'.
 * @returns {{PanoViewer: Function, Viewer: Function, NoImageryError: Function}}
 */
function loadViewer(name) {
    const stubs = VIEWER_NAMES.filter((other) => other !== name).map((other) => `class ${other} {}`).join('\n');
    window.eval(`
        ${stubs}
        ${readSrc('NoImageryError.js')}
        ${readSrc('PanoViewer.js')}
        ${readSrc(`${name}.js`)}
        window.PanoViewer = PanoViewer;
        window.NoImageryError = NoImageryError;
        window.__viewerUnderTest = ${name};
    `);
    return { PanoViewer: window.PanoViewer, Viewer: window.__viewerUnderTest, NoImageryError: window.NoImageryError };
}

const HERE = { lat: 47.61, lng: -122.33 };

/** A point `meters` from HERE along `bearing` (degrees clockwise from north). */
function metersFromHere(meters, bearing = 90) {
    const [lng, lat] = turf.destination(turf.point([HERE.lng, HERE.lat]), meters / 1000, bearing).geometry.coordinates;
    return { lat, lng };
}

/** The slice of PanoData the exclusion checks read. */
const excludedPano = (panoId, capturedAt = 0) => ({
    getPanoId: () => panoId,
    getProperty: (key) => (key === 'captureDate' ? { valueOf: () => capturedAt } : null),
});

describe('PanoViewer.findPanoNear (base)', () => {
    test('a provider with no location search has nothing to offer', async () => {
        const { PanoViewer } = loadViewer('PannellumViewer');
        const viewer = new (class Probe extends PanoViewer {})();
        await expect(viewer.findPanoNear(HERE)).resolves.toBeNull();
    });

    test('_withTimeout gives up after the budget and clears its timer when the call settles first', async () => {
        jest.useFakeTimers();
        const { PanoViewer } = loadViewer('PannellumViewer');
        try {
            const hung = PanoViewer._withTimeout(new Promise(() => {}), 1000, 'a hung call');
            jest.advanceTimersByTime(1000);
            await expect(hung).rejects.toThrow('Timed out: a hung call');

            await expect(PanoViewer._withTimeout(Promise.resolve('answer'), 1000, 'a quick call'))
                .resolves.toBe('answer');
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });
});

/** google.maps.LatLng as the viewers read it: accessor methods, not fields. */
class FakeLatLng {
    constructor(lat, lng) {
        this._lat = lat;
        this._lng = lng;
    }

    lat() {
        return this._lat;
    }

    lng() {
        return this._lng;
    }
}

describe('GsvViewer.findPanoNear', () => {
    let viewer;
    let getPanorama;
    let PanoViewer;

    const reply = (pano, { lat, lng }) => ({ data: { location: { pano, latLng: { lat: () => lat, lng: () => lng } } } });

    beforeEach(() => {
        window.google = {
            maps: {
                importLibrary: async () => ({ LatLng: FakeLatLng }),
                LatLng: FakeLatLng,
                Size: class {},
                StreetViewSource: { OUTDOOR: 'outdoor' },
            },
        };
        const loaded = loadViewer('GsvViewer');
        ({ PanoViewer } = loaded);
        viewer = new loaded.Viewer();
        getPanorama = jest.fn();
        viewer.streetViewService = { getPanorama };
        viewer.gsvPano = { setPano: jest.fn() };
    });

    test('answers with the nearest outdoor pano and its position, and leaves the viewer where it is', async () => {
        const there = metersFromHere(8);
        getPanorama.mockResolvedValue(reply('P1', there));

        await expect(viewer.findPanoNear(HERE)).resolves.toEqual({ panoId: 'P1', lat: there.lat, lng: there.lng });

        expect(getPanorama).toHaveBeenCalledWith(expect.objectContaining({ radius: 25, source: 'outdoor' }));
        expect(viewer.currPanoData).toBeUndefined();
        expect(viewer.prevPanoData).toBeUndefined();
        expect(viewer.gsvPano.setPano).not.toHaveBeenCalled();
    });

    test('ZERO_RESULTS is an answer: null, and the point is not asked about again', async () => {
        getPanorama.mockRejectedValue({ code: 'ZERO_RESULTS' });

        await expect(viewer.findPanoNear(HERE)).resolves.toBeNull();
        await expect(viewer.findPanoNear(HERE)).resolves.toBeNull();
        expect(getPanorama).toHaveBeenCalledTimes(1);
    });

    test('any other failure is unknown: rejects, and the next caller asks again', async () => {
        const there = metersFromHere(8);
        getPanorama.mockRejectedValueOnce({ code: 'UNKNOWN_ERROR' }).mockResolvedValueOnce(reply('P1', there));

        await expect(viewer.findPanoNear(HERE)).rejects.toEqual({ code: 'UNKNOWN_ERROR' });
        await expect(viewer.findPanoNear(HERE)).resolves.toEqual({ panoId: 'P1', lat: there.lat, lng: there.lng });
        expect(getPanorama).toHaveBeenCalledTimes(2);
    });

    test('a pano the caller excludes is not offered', async () => {
        getPanorama.mockResolvedValue(reply('P1', metersFromHere(8)));
        await expect(viewer.findPanoNear(HERE, new Set([excludedPano('P1')]))).resolves.toBeNull();
    });

    test('points within a metre share one answer until the cache is cleared', async () => {
        getPanorama.mockResolvedValue(reply('P1', metersFromHere(8)));

        await viewer.findPanoNear(HERE);
        await viewer.findPanoNear({ lat: HERE.lat + 0.000004, lng: HERE.lng - 0.000004 });
        expect(getPanorama).toHaveBeenCalledTimes(1);

        viewer.clearPrefetchCache();
        await viewer.findPanoNear(HERE);
        expect(getPanorama).toHaveBeenCalledTimes(2);
    });

    test('a lookup that never settles rejects after the budget instead of hanging', async () => {
        jest.useFakeTimers();
        try {
            getPanorama.mockReturnValue(new Promise(() => {}));
            const lookup = viewer.findPanoNear(HERE);
            jest.advanceTimersByTime(PanoViewer.FIND_PANO_TIMEOUT_MS);
            await expect(lookup).rejects.toThrow(/Timed out/);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('MapillaryViewer.findPanoNear', () => {
    let viewer;
    let fetchMock;
    let images;

    /** A Mapillary image record as the Graph API returns it, with its SfM-refined position a hair east of the GPS one. */
    const image = (id, { lat, lng }, { capturedAt = Date.now() - 1000, width = 8192, sequence = 's1' } = {}) => ({
        id,
        is_pano: true,
        geometry: { type: 'Point', coordinates: [lng, lat] },
        computed_geometry: { type: 'Point', coordinates: [lng + 0.00001, lat] },
        captured_at: capturedAt,
        sequence,
        width,
    });

    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {}); // #fetchImages logs every reply.
        images = [];
        fetchMock = jest.fn(async () => ({ json: async () => ({ data: images }) }));
        window.fetch = fetchMock;
        viewer = new (loadViewer('MapillaryViewer').Viewer)();
        viewer.viewer = { _navigator: { _api: { _data: { _accessToken: 'token' } } }, moveTo: jest.fn() };
    });

    afterEach(() => {
        console.log.mockRestore();
    });

    test('picks the image setLocation() would pick and reports its refined position', async () => {
        const near = metersFromHere(3);
        images = [image('far', metersFromHere(20)), image('near', near)];

        await expect(viewer.findPanoNear(HERE)).resolves.toEqual({
            panoId: 'near', lat: near.lat, lng: near.lng + 0.00001,
        });
        expect(viewer.viewer.moveTo).not.toHaveBeenCalled();
        expect(viewer.currPanoData).toBeUndefined();
    });

    test('answers from a prefetched search when one covers the point', async () => {
        images = [image('near', metersFromHere(3))];
        viewer.prefetchLocation(HERE);
        await expect(viewer.findPanoNear(HERE)).resolves.toMatchObject({ panoId: 'near' });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await viewer.findPanoNear(metersFromHere(20));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test('honours the exclusions setLocation() honours: by id, and by capture time for duplicate images', async () => {
        const nearAt = Date.now() - 5000;
        images = [image('near', metersFromHere(3), { capturedAt: nearAt }), image('far', metersFromHere(20))];

        await expect(viewer.findPanoNear(HERE, new Set([excludedPano('near')]))).resolves.toMatchObject({ panoId: 'far' });
        await expect(viewer.findPanoNear(HERE, new Set([excludedPano('other-id', nearAt)])))
            .resolves.toMatchObject({ panoId: 'far' });
        await expect(viewer.findPanoNear(HERE, new Set([excludedPano('near'), excludedPano('far')])))
            .resolves.toBeNull();
    });

    test('a search that never got an answer rejects rather than reading as empty ground', async () => {
        fetchMock.mockRejectedValue(new Error('network down'));
        await expect(viewer.findPanoNear(HERE)).rejects.toThrow('network down');
    });
});

describe('PanoramaxViewer.findPanoNear', () => {
    let viewer;
    let fetchMock;
    let items;

    /** A STAC item as the Panoramax search returns it. */
    const item = (id, { lat, lng }) => ({
        id,
        collection: 'seq-1',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
            datetime: '2026-08-11T15:02:33+00:00',
            'pers:interior_orientation': { sensor_array_dimensions: [7680, 3840] },
        },
        assets: {},
    });

    beforeEach(() => {
        items = [];
        fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ features: items }) }));
        window.fetch = fetchMock;
        viewer = new (loadViewer('PanoramaxViewer').Viewer)();
    });

    test('picks the picture setLocation() would pick and reads its GeoJSON position as lat/lng', async () => {
        const near = metersFromHere(3);
        items = [item('far', metersFromHere(20)), item('near', near)];
        await expect(viewer.findPanoNear(HERE)).resolves.toEqual({ panoId: 'near', lat: near.lat, lng: near.lng });
        expect(viewer.currPanoData).toBeUndefined();
    });

    test('answers from a prefetched search when one covers the point', async () => {
        items = [item('near', metersFromHere(3))];
        viewer.prefetchLocation(HERE);
        await expect(viewer.findPanoNear(HERE)).resolves.toMatchObject({ panoId: 'near' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('an excluded picture is not offered; nothing else there means null', async () => {
        items = [item('near', metersFromHere(3))];
        await expect(viewer.findPanoNear(HERE, new Set([excludedPano('near')]))).resolves.toBeNull();
    });

    test('a failed search rejects rather than reading as empty ground', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 503 });
        await expect(viewer.findPanoNear(HERE)).rejects.toThrow('HTTP 503');
    });
});

describe('Infra3dViewer.findPanoNear', () => {
    let viewer;
    let imagesByKNN;

    const answers = (result) => ({ subscribe: ({ next }) => next(result) });
    const fails = (err) => ({ subscribe: ({ error }) => error(err) });
    const frame = (key, { lat, lng }, cameraType = 'cubemap') => ({
        key, l: { lat, lon: lng }, camera_projection_type: cameraType,
    });

    beforeEach(() => {
        viewer = new (loadViewer('Infra3dViewer').Viewer)();
        imagesByKNN = jest.fn();
        viewer.viewer = {
            _sdk_viewer: {
                movePosition: jest.fn(),
                moveToKey: jest.fn(),
                _navigator: { _api: { imagesByKNN$: imagesByKNN } },
            },
        };
    });

    test('answers with the nearest 360° frame and its position, and leaves the viewer where it is', async () => {
        const there = metersFromHere(6);
        imagesByKNN.mockReturnValue(answers(frame('F1', there)));

        await expect(viewer.findPanoNear(HERE)).resolves.toEqual({ panoId: 'F1', lat: there.lat, lng: there.lng });
        expect(imagesByKNN).toHaveBeenCalledWith(HERE.lng, HERE.lat, 4326);
        expect(viewer.viewer._sdk_viewer.movePosition).not.toHaveBeenCalled();
        expect(viewer.viewer._sdk_viewer.moveToKey).not.toHaveBeenCalled();
        expect(viewer.currNode).toBeNull();
        expect(viewer.prevNode).toBeNull();
    });

    test('a flat photo is not somewhere Explore can stand', async () => {
        imagesByKNN.mockReturnValue(answers(frame('F1', metersFromHere(6), 'mono')));
        await expect(viewer.findPanoNear(HERE)).resolves.toBeNull();
    });

    test('a frame beyond the search radius does not count, since the SDK query has no radius of its own', async () => {
        imagesByKNN.mockReturnValue(answers(frame('F1', metersFromHere(40))));
        await expect(viewer.findPanoNear(HERE)).resolves.toBeNull();
    });

    test('an excluded frame is not offered', async () => {
        imagesByKNN.mockReturnValue(answers(frame('F1', metersFromHere(6))));
        await expect(viewer.findPanoNear(HERE, new Set([excludedPano('F1')]))).resolves.toBeNull();
    });

    test("the SDK's bare-string 'No frame found' is an answer; any Error is not", async () => {
        imagesByKNN.mockReturnValueOnce(fails('No frame found'));
        await expect(viewer.findPanoNear(HERE)).resolves.toBeNull();

        imagesByKNN.mockReturnValueOnce(fails(new Error('framegate 502')));
        await expect(viewer.findPanoNear(HERE)).rejects.toThrow('framegate 502');

        imagesByKNN.mockReturnValueOnce(fails('some other string'));
        await expect(viewer.findPanoNear(HERE)).rejects.toThrow('some other string');
    });
});

describe('PanoViewer.getLinkedPanoPositions (base)', () => {
    test('passes through links the provider positioned, resolves the rest, and drops what it cannot place', async () => {
        const { PanoViewer } = loadViewer('PannellumViewer');
        const there = metersFromHere(10);
        const viewer = new (class Probe extends PanoViewer {
            getLinkedPanos() {
                return [
                    { panoId: 'placed', heading: 0, lat: there.lat, lng: there.lng },
                    { panoId: 'lookup', heading: 90 },
                    { panoId: 'unknown', heading: 180 },
                    { panoId: 'broken', heading: 270 },
                ];
            }

            lookupPanoPosition(panoId) {
                if (panoId === 'lookup') return Promise.resolve(metersFromHere(12, 90));
                if (panoId === 'broken') return Promise.reject(new Error('provider down'));
                return Promise.resolve(null);
            }
        })();
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const links = await viewer.getLinkedPanoPositions();
            expect(links.map((l) => l.panoId)).toEqual(['placed', 'lookup']);
            expect(links[1]).toMatchObject({ heading: 90, ...metersFromHere(12, 90) });
        } finally {
            console.warn.mockRestore();
        }
    });
});

describe('GsvViewer.lookupPanoPosition', () => {
    let viewer;
    let getPanorama;

    const reply = (pano, { lat, lng }) => ({ data: { location: { pano, latLng: new FakeLatLng(lat, lng) } } });

    beforeEach(() => {
        window.google = {
            maps: {
                importLibrary: async () => ({ LatLng: FakeLatLng }),
                LatLng: FakeLatLng,
                Size: class {},
                StreetViewSource: { OUTDOOR: 'outdoor' },
            },
        };
        window.util = window.util || {};
        window.util.pano = window.util.pano || {};
        window.util.pano.TUTORIAL_PANO_IDS = new Set(['tutorial', 'afterWalkTutorial']);
        viewer = new (loadViewer('GsvViewer').Viewer)();
        getPanorama = jest.fn();
        viewer.streetViewService = { getPanorama };
        viewer.gsvPano = { setPano: jest.fn(), addListener: jest.fn() };
    });

    test('answers with the pano\'s position from the by-id metadata reply, without loading it', async () => {
        const there = metersFromHere(8);
        getPanorama.mockResolvedValue(reply('P1', there));
        await expect(viewer.lookupPanoPosition('P1')).resolves.toEqual({ lat: there.lat, lng: there.lng });
        expect(getPanorama).toHaveBeenCalledWith({ pano: 'P1' });
        expect(viewer.gsvPano.setPano).not.toHaveBeenCalled();
        expect(viewer.currPanoData).toBeUndefined();
    });

    test('a retired id is an answer (null); any other failure rejects and is retried next time', async () => {
        getPanorama.mockRejectedValueOnce({ code: 'ZERO_RESULTS' });
        await expect(viewer.lookupPanoPosition('gone')).resolves.toBeNull();
        getPanorama.mockRejectedValueOnce({ code: 'UNKNOWN_ERROR' }).mockResolvedValueOnce(reply('P2', metersFromHere(8)));
        await expect(viewer.lookupPanoPosition('P2')).rejects.toEqual({ code: 'UNKNOWN_ERROR' });
        await expect(viewer.lookupPanoPosition('P2')).resolves.toMatchObject({ lat: expect.any(Number) });
    });

    test('a lookup is remembered until the cache is cleared', async () => {
        getPanorama.mockResolvedValue(reply('P1', metersFromHere(8)));
        await viewer.lookupPanoPosition('P1');
        await viewer.lookupPanoPosition('P1');
        expect(getPanorama).toHaveBeenCalledTimes(1);
        viewer.clearPrefetchCache();
        await viewer.lookupPanoPosition('P1');
        expect(getPanorama).toHaveBeenCalledTimes(2);
    });

    test('the locally served tutorial panos answer from their stored data, never the network', async () => {
        await expect(viewer.lookupPanoPosition('tutorial')).resolves.toEqual({ lat: 38.94042608, lng: -77.06766133 });
        expect(getPanorama).not.toHaveBeenCalled();
    });
});

describe('MapillaryViewer.lookupPanoPosition', () => {
    let viewer;
    let nodes;

    beforeEach(() => {
        nodes = {};
        viewer = new (loadViewer('MapillaryViewer').Viewer)();
        viewer.viewer = {
            _navigator: {
                _api: { _data: { _accessToken: 'token' } },
                graphService: {
                    _graph$: {
                        subscribe: (next) => {
                            next({ hasNode: (id) => id in nodes, getNode: (id) => nodes[id] });
                            return { unsubscribe: jest.fn() };
                        },
                    },
                },
            },
            moveTo: jest.fn(),
        };
    });

    test('reads a link target straight out of the SDK graph, no network', async () => {
        const there = metersFromHere(9);
        nodes.img1 = { lngLat: { lat: there.lat, lng: there.lng } };
        window.fetch = jest.fn();
        await expect(viewer.lookupPanoPosition('img1')).resolves.toEqual({ lat: there.lat, lng: there.lng });
        expect(window.fetch).not.toHaveBeenCalled();
        expect(viewer.viewer.moveTo).not.toHaveBeenCalled();
    });

    test('an image the graph has evicted is fetched once from the Graph API, refined position preferred', async () => {
        const gps = metersFromHere(9);
        const refined = metersFromHere(10);
        window.fetch = jest.fn(async () => ({
            json: async () => ({
                id: 'img2',
                geometry: { type: 'Point', coordinates: [gps.lng, gps.lat] },
                computed_geometry: { type: 'Point', coordinates: [refined.lng, refined.lat] },
            }),
        }));
        await expect(viewer.lookupPanoPosition('img2')).resolves.toEqual({ lat: refined.lat, lng: refined.lng });
        expect(window.fetch.mock.calls[0][0]).toMatch(/^https:\/\/graph\.mapillary\.com\/img2\?fields=/);
    });

    test('a Graph API error rejects rather than reading as "no such image"', async () => {
        window.fetch = jest.fn(async () => ({ json: async () => ({ error: { message: 'bad token' } }) }));
        await expect(viewer.lookupPanoPosition('img3')).rejects.toThrow('bad token');
    });
});

describe('Infra3dViewer.lookupPanoPosition', () => {
    test('reads a link target out of the SDK graph as lat/lon, and answers null for an unknown key', async () => {
        const viewer = new (loadViewer('Infra3dViewer').Viewer)();
        const there = metersFromHere(9);
        const nodes = { f1: { latLon: { lat: there.lat, lon: there.lng } } };
        viewer.viewer = {
            _sdk_viewer: {
                _navigator: {
                    graphService: {
                        _graph$: {
                            subscribe: (next) => {
                                next({ hasNode: (key) => key in nodes, getNode: (key) => nodes[key] });
                                return { unsubscribe: jest.fn() };
                            },
                        },
                    },
                },
            },
        };
        await expect(viewer.lookupPanoPosition('f1')).resolves.toEqual({ lat: there.lat, lng: there.lng });
        await expect(viewer.lookupPanoPosition('f9')).resolves.toBeNull();
    });
});

describe('PanoramaxViewer link positions', () => {
    test('a cached picture answers by id; an unknown one is null', async () => {
        const viewer = new (loadViewer('PanoramaxViewer').Viewer)();
        const there = metersFromHere(9);
        window.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ features: [
            { id: 'pic1', collection: 'c', geometry: { type: 'Point', coordinates: [there.lng, there.lat] },
              properties: { datetime: '2026-08-11T15:02:33+00:00' }, assets: {} },
        ] }) }));
        await viewer.findPanoNear(HERE); // Runs a search, which caches its items.
        await expect(viewer.lookupPanoPosition('pic1')).resolves.toEqual({ lat: there.lat, lng: there.lng });
        await expect(viewer.lookupPanoPosition('nope')).resolves.toBeNull();
    });
});

describe('PannellumViewer.findPanoNear', () => {
    test('cannot search by location, so it has no crumbs to offer', async () => {
        const viewer = new (loadViewer('PannellumViewer').Viewer)();
        await expect(viewer.findPanoNear(HERE)).resolves.toBeNull();
        expect(viewer.supportsLocationSearch()).toBe(false);
    });
});

describe('PanoViewer.supportsLocationSearch', () => {
    test('is a real capability flag: true for every provider with a location search, false otherwise', () => {
        for (const name of ['GsvViewer', 'MapillaryViewer', 'PanoramaxViewer', 'Infra3dViewer']) {
            expect(new (loadViewer(name).Viewer)().supportsLocationSearch()).toBe(true);
        }
        const { PanoViewer } = loadViewer('PannellumViewer');
        expect(new (class Probe extends PanoViewer {})().supportsLocationSearch()).toBe(false);
    });
});
