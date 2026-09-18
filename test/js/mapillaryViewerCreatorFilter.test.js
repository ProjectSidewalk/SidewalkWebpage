/**
 * Tests for MapillaryViewer's creator restriction (issue #5407): a deployment restricted to chosen Mapillary creators
 * must only ever discover their imagery, and an unrestricted deployment must behave exactly as before.
 *
 * Two surfaces carry the restriction. The SDK filter governs the SDK's own navigation graph -- the spatial edges
 * behind Explore's arrows -- and the location search queries the Graph API directly, so it is scoped separately: one
 * creator-scoped request per allowed creator, because the API's `creator_username` filter takes a single username.
 * Scoping the request matters beyond tidiness: over dense coverage an unscoped box exceeds the API's size limit and
 * the search shrinks its radius, possibly to the point where it no longer reaches the allowed imagery.
 *
 * MapillaryViewer is a top-level `class` declaration written for the Grunt-concatenation world, so the source is
 * eval'd into the jsdom global scope with stub siblings, and the Mapillary SDK is replaced by a recorder.
 */

const fs = require('fs');
const path = require('path');

const { loadGlobalScript } = require('./loadGlobalScript');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'public/js/common/pano-viewer/src');

// utilities.js builds a Bowser parser at load time; nothing here consults it.
window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
loadGlobalScript('public/js/common/utilities.js');
loadGlobalScript('public/js/common/utilitiesMath.js');
// The real ranking weights, stamped onto <html> the way main.scala.html does it (minus the file's own `_`-prefixed
// documentation), so "would win on score" below means it would win in production.
const scoringConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'conf/pano-scoring.json'), 'utf8'));
document.documentElement.dataset.panoScoring = JSON.stringify(
    Object.fromEntries(Object.entries(scoringConfig).filter(([key]) => !key.startsWith('_'))),
);
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');
window.turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));

const TARGET = { lat: 47.6601, lng: -122.2885 };

/** A Graph API image a few meters from TARGET, by the given creator. */
function image(id, username, overrides = {}) {
    return {
        id,
        geometry: { type: 'Point', coordinates: [TARGET.lng, TARGET.lat] },
        captured_at: Date.UTC(2026, 0, 19),
        sequence: 'seq',
        width: 7680,
        creator: { username, id: `${username}-id` },
        ...overrides,
    };
}

/**
 * Builds a MapillaryViewer whose SDK viewer is a recorder, initialized with the given panoOptions but without a start
 * location, so initialize() itself makes no search.
 *
 * @param {Record<string, any>} panoOptions - Options under test (notably `allowedCreators`).
 * @returns {Promise<{viewer: object, sdk: object}>} The viewer and its recording SDK stand-in.
 */
async function buildViewer(panoOptions) {
    const sdk = {
        setFilter: jest.fn(),
        on: jest.fn(),
        moveTo: jest.fn((id) => Promise.resolve({ id })),
        _navigator: {
            _api: { _data: { _accessToken: 'token' } },
            stateService: { getCenter: () => ({ subscribe: jest.fn() }) },
        },
        _container: { renderService: { renderCamera$: { subscribe: jest.fn() } } },
    };
    window.mapillary = { Viewer: jest.fn(() => sdk) };
    window.createMapillaryChunkedDataProvider = jest.fn(() => ({}));
    window.svl = { STREETVIEW_MAX_DISTANCE: 50 };
    window.eval(`
        class GsvViewer {}
        class Infra3dViewer {}
        class PannellumViewer {}
        class PanoramaxViewer {}
        ${fs.readFileSync(path.join(SRC_DIR, 'NoImageryError.js'), 'utf8')}
        ${fs.readFileSync(path.join(SRC_DIR, 'PanoViewer.js'), 'utf8')}
        ${fs.readFileSync(path.join(SRC_DIR, 'MapillaryViewer.js'), 'utf8')}
        window.MapillaryViewer = MapillaryViewer;
        window.NoImageryError = NoImageryError;
    `);
    const viewer = new window.MapillaryViewer();
    // The pano-loaded callback reads SDK internals that have no bearing on which pano was chosen.
    viewer._getPanoramaCallback = (img) => img;
    viewer._moveToInitialLocation = jest.fn(() => Promise.resolve());
    await viewer.initialize({ id: 'pano-canvas' }, { accessToken: 'token', ...panoOptions });
    return { viewer, sdk };
}

/** Stubs fetch with a per-URL responder and returns the list of requested URLs. */
function stubFetch(respond) {
    const urls = [];
    global.fetch = jest.fn((url) => {
        urls.push(new URL(url));
        return Promise.resolve({ json: () => Promise.resolve(respond(new URL(url))) });
    });
    return urls;
}

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
});

describe('SDK filter', () => {
    test('an unrestricted deployment filters on camera type alone', async () => {
        const { sdk } = await buildViewer({});
        expect(sdk.setFilter).toHaveBeenCalledWith(['==', 'cameraType', 'spherical']);
    });

    test('an empty allowlist is unrestricted, not "nobody"', async () => {
        const { sdk } = await buildViewer({ allowedCreators: [] });
        expect(sdk.setFilter).toHaveBeenCalledWith(['==', 'cameraType', 'spherical']);
    });

    test('a restricted deployment also filters the navigation graph to the allowed creators', async () => {
        const { sdk } = await buildViewer({ allowedCreators: ['profjfray', 'alice'] });
        expect(sdk.setFilter).toHaveBeenCalledWith(
            ['all', ['==', 'cameraType', 'spherical'], ['in', 'creatorUsername', 'profjfray', 'alice']],
        );
    });
});

describe('location search', () => {
    test('an unrestricted search asks once, for everyone, and may pick any creator', async () => {
        const { viewer, sdk } = await buildViewer({});
        const urls = stubFetch(() => ({ data: [image('stranger-pano', 'stranger')] }));
        await viewer.setLocation(TARGET);
        expect(urls).toHaveLength(1);
        expect(urls[0].searchParams.has('creator_username')).toBe(false);
        expect(sdk.moveTo).toHaveBeenCalledWith('stranger-pano');
    });

    test('a restricted search asks once per allowed creator, scoped on the server', async () => {
        const { viewer, sdk } = await buildViewer({ allowedCreators: ['profjfray', 'alice'] });
        const urls = stubFetch((url) => (url.searchParams.get('creator_username') === 'profjfray'
            ? { data: [image('our-pano', 'profjfray')] }
            : { data: [] }));
        await viewer.setLocation(TARGET);
        expect(urls.map((url) => url.searchParams.get('creator_username')).sort()).toEqual(['alice', 'profjfray']);
        // The creator has to be requested for the belt-and-braces check below to have anything to read.
        expect(urls.every((url) => url.searchParams.get('fields').split(',').includes('creator'))).toBe(true);
        expect(sdk.moveTo).toHaveBeenCalledWith('our-pano');
    });

    test('another creator\'s pano is never chosen, even if a response carries one', async () => {
        const { viewer, sdk } = await buildViewer({ allowedCreators: ['profjfray'] });
        // Closer and newer than ours, so it would win on score were it not for the restriction.
        stubFetch(() => ({
            data: [
                image('stranger-pano', 'stranger', { captured_at: Date.now() }),
                image('our-pano', 'profjfray'),
            ],
        }));
        await viewer.setLocation(TARGET);
        expect(sdk.moveTo).toHaveBeenCalledWith('our-pano');
        expect(sdk.moveTo).not.toHaveBeenCalledWith('stranger-pano');
    });

    test('a street only other creators covered reads as having no imagery', async () => {
        const { viewer, sdk } = await buildViewer({ allowedCreators: ['profjfray'] });
        stubFetch(() => ({ data: [] }));
        await expect(viewer.setLocation(TARGET)).rejects.toBeInstanceOf(window.NoImageryError);
        expect(sdk.moveTo).not.toHaveBeenCalled();
    });
});
