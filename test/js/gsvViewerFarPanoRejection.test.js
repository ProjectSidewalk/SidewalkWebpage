/**
 * GsvViewer holding Google's location-search replies to the radius it asked for (#5114).
 *
 * Google's `radius` is a hint, not a bound: a 25 m query in Seattle came back with a user photosphere in Syracuse, NY,
 * about 3,590 km away. These tests pin that such a reply is treated exactly like ZERO_RESULTS by both consumers of the
 * search — setLocation() rejects with a NoImageryError, so Explore's existing no-imagery paths take over, and
 * findPanoNear() resolves null, so no minimap crumb is drawn there — and that each distinct far pano is reported once
 * through the `FarPanoRejected` diagnostic.
 *
 * The viewer source is eval'd into the jsdom global scope over the real PanoViewer base, as in
 * panoViewerFindPanoNear.test.js, with the real util.math.haversine doing the distance math.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'public/js/common/pano-viewer/src');
const readSrc = (name) => fs.readFileSync(path.join(SRC_DIR, name), 'utf8');

// utilities.js builds a Bowser parser at load time; nothing here consults it.
window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
loadGlobalScript('public/js/common/utilities.js');
loadGlobalScript('public/js/common/utilitiesMath.js');
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');
window.turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));
window.svl = { STREETVIEW_MAX_DISTANCE: 25 };

const { turf } = window;

/**
 * Loads the real PanoViewer and GsvViewer fresh into the jsdom global scope.
 * @returns {{GsvViewer: Function, NoImageryError: Function}}
 */
function loadGsvViewer() {
    const stubs = ['MapillaryViewer', 'Infra3dViewer', 'PannellumViewer', 'PanoramaxViewer']
        .map((name) => `class ${name} {}`).join('\n');
    window.eval(`
        ${stubs}
        ${readSrc('NoImageryError.js')}
        ${readSrc('PanoViewer.js')}
        ${readSrc('GsvViewer.js')}
        window.GsvViewer = GsvViewer;
        window.NoImageryError = NoImageryError;
    `);
    return { GsvViewer: window.GsvViewer, NoImageryError: window.NoImageryError };
}

// The #5114 reproduction: Seattle street 7208's second endpoint, and where Google's answer to it actually was.
const SEATTLE_QUERY = { lat: 47.6196811, lng: -122.3100703 };
const SYRACUSE_PANO = { lat: 43.0917906, lng: -76.1720131 };

/** A point `meters` from SEATTLE_QUERY along `bearing` (degrees clockwise from north). */
function metersFromQuery(meters, bearing = 90) {
    const origin = turf.point([SEATTLE_QUERY.lng, SEATTLE_QUERY.lat]);
    const [lng, lat] = turf.destination(origin, meters / 1000, bearing).geometry.coordinates;
    return { lat, lng };
}

/** google.maps.LatLng as the viewer reads it: accessor methods, not fields. */
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

/**
 * A getPanorama() reply with the fields #updateCurrPanoData reads.
 * @param {string} pano - Pano id.
 * @param {{lat: number, lng: number}} position - Where the pano is.
 * @param {string} [copyright='© 2024 Google'] - The reply's attribution; a person's name marks a user photosphere.
 */
const reply = (pano, { lat, lng }, copyright = '© 2024 Google') => ({
    data: {
        location: { pano, latLng: new FakeLatLng(lat, lng), shortDescription: '' },
        copyright,
        imageDate: '2024-05',
        links: [],
        time: [],
        tiles: {
            worldSize: { width: 16384, height: 8192 },
            tileSize: { width: 512, height: 512 },
            originHeading: 0,
            originPitch: 0,
        },
    },
});

describe('GsvViewer.isWithinSearchRadius', () => {
    const { GsvViewer } = loadGsvViewer();

    test('rejects the #5114 photosphere about 3,590 km from its 25 m query', () => {
        expect(GsvViewer.isWithinSearchRadius(SEATTLE_QUERY, SYRACUSE_PANO, 25)).toBe(false);
    });

    test('rejects the 77 m pano a 25 m query returned in Teaneck', () => {
        expect(GsvViewer.isWithinSearchRadius(SEATTLE_QUERY, metersFromQuery(77), 25)).toBe(false);
    });

    test('accepts a pano inside the radius, and one at its edge', () => {
        expect(GsvViewer.isWithinSearchRadius(SEATTLE_QUERY, metersFromQuery(8), 25)).toBe(true);
        expect(GsvViewer.isWithinSearchRadius(SEATTLE_QUERY, metersFromQuery(24.9, 200), 25)).toBe(true);
        expect(GsvViewer.isWithinSearchRadius(SEATTLE_QUERY, SEATTLE_QUERY, 25)).toBe(true);
    });

    test('rejects a pano just past the edge', () => {
        expect(GsvViewer.isWithinSearchRadius(SEATTLE_QUERY, metersFromQuery(25.5, 200), 25)).toBe(false);
    });
});

describe('GsvViewer location searches hold replies to the radius', () => {
    let GsvViewer;
    let NoImageryError;
    let viewer;
    let getPanorama;
    let diagnostics;

    beforeEach(() => {
        window.google = {
            maps: {
                importLibrary: async () => ({ LatLng: FakeLatLng }),
                LatLng: FakeLatLng,
                Size: class {},
                StreetViewSource: { OUTDOOR: 'outdoor' },
            },
        };
        // #updateCurrPanoData wraps dates in moment and builds a PanoData; neither matters to the decision under test.
        window.moment = (value) => value;
        window.PanoData = class {
            constructor(params) {
                this.params = params;
            }

            getPanoId() {
                return this.params.panoId;
            }

            getProperty(key) {
                return this.params[key];
            }
        };
        ({ GsvViewer, NoImageryError } = loadGsvViewer());
        viewer = new GsvViewer();
        getPanorama = jest.fn();
        viewer.streetViewService = { getPanorama };
        viewer.gsvPano = { setPano: jest.fn() };
        // Stand in for GSV's own load event: the pano "loads" as soon as it is set.
        viewer._loadPanoWithTimeout = jest.fn(async (_panoId, resolveValue) => resolveValue);
        diagnostics = [];
        viewer.addListener('diagnostic', (name, details) => diagnostics.push({ name, details }));
        jest.spyOn(console, 'warn').mockImplementation(() => {}); // _fireDiagnostic warns on every event.
    });

    afterEach(() => {
        console.warn.mockRestore();
    });

    test('setLocation rejects a far pano as NoImageryError and never loads it', async () => {
        getPanorama.mockResolvedValue(reply('SYRACUSE', SYRACUSE_PANO, '© Carlos Chavez'));

        const move = viewer.setLocation(SEATTLE_QUERY);
        await expect(move).rejects.toBeInstanceOf(NoImageryError);
        expect(viewer._loadPanoWithTimeout).not.toHaveBeenCalled();
        expect(viewer.currPanoData).toBeUndefined();
        expect(getPanorama).toHaveBeenCalledWith(expect.objectContaining({ radius: 25, source: 'outdoor' }));
    });

    test('setLocation moves to a pano inside the radius', async () => {
        const near = metersFromQuery(8);
        getPanorama.mockResolvedValue(reply('NEAR', near));

        const panoData = await viewer.setLocation(SEATTLE_QUERY);
        expect(panoData.getPanoId()).toBe('NEAR');
        expect(viewer._loadPanoWithTimeout).toHaveBeenCalledWith('NEAR', panoData);
        expect(diagnostics).toEqual([]);
    });

    test('a far pano is reported once, with its distance and whether it is Google imagery', async () => {
        getPanorama.mockResolvedValue(reply('SYRACUSE', SYRACUSE_PANO, '© Carlos Chavez'));

        await expect(viewer.setLocation(SEATTLE_QUERY)).rejects.toBeInstanceOf(NoImageryError);
        await expect(viewer.setLocation(metersFromQuery(10))).rejects.toBeInstanceOf(NoImageryError);
        await expect(viewer.findPanoNear(metersFromQuery(20))).resolves.toBeNull();

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].name).toBe('FarPanoRejected');
        expect(diagnostics[0].details).toEqual({ panoId: 'SYRACUSE', distanceM: expect.any(String), radiusM: '25',
            google: 'false' });
        // _fireDiagnostic stringifies details. The #5114 answer is about 3,590 km off by haversine; the issue body's
        // 3,498 km figure doesn't reproduce, while its follow-up measurements (3,596 km) do.
        expect(Number(diagnostics[0].details.distanceM)).toBeGreaterThan(3_550_000);
        expect(Number(diagnostics[0].details.distanceM)).toBeLessThan(3_620_000);
    });

    test('findPanoNear treats a far pano as nothing here, the same null ZERO_RESULTS gives', async () => {
        getPanorama.mockResolvedValue(reply('FAR', metersFromQuery(77)));

        await expect(viewer.findPanoNear(SEATTLE_QUERY)).resolves.toBeNull();
        expect(diagnostics.map((d) => d.details.google)).toEqual(['true']);
    });

    test('a far first seed falls through to the next start-of-street point, like an empty one', async () => {
        const backup = metersFromQuery(10, 0);
        const onStreet = metersFromQuery(12, 0);
        getPanorama
            .mockResolvedValueOnce(reply('SYRACUSE', SYRACUSE_PANO, '© Carlos Chavez'))
            .mockResolvedValueOnce(reply('ON_STREET', onStreet));

        await viewer._moveToInitialLocation({ startLatLng: SEATTLE_QUERY, backupLatLngs: [backup] });
        expect(viewer.initialSeed).toBe('latLng');
        expect(viewer.getPanoId()).toBe('ON_STREET');
    });

    test('a street whose every seed returns a far pano reads as having no imagery, not as a failed request', async () => {
        getPanorama.mockResolvedValue(reply('SYRACUSE', SYRACUSE_PANO, '© Carlos Chavez'));

        const start = viewer._moveToInitialLocation({ startLatLng: SEATTLE_QUERY, backupLatLngs: [metersFromQuery(10)] });
        await expect(start).rejects.toBeInstanceOf(NoImageryError);
    });
});
