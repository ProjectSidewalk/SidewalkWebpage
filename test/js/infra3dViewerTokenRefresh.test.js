/**
 * Infra3dViewer's background renewal of its access token, and its one-reload recovery from an initViewer that hangs.
 *
 * Cognito issues Infra3d tokens for an hour and the SDK can't refresh them itself, so a labeling session longer than
 * the token went black at the hour mark with nothing logged. The viewer now reads the expiry from the token, fetches
 * a fresh one from /imageryAccessToken five minutes ahead, and hands it to the SDK via manager.setTokens(). This suite
 * pins the schedule, the SDK call's shape, the retry ladder, and what gets logged when it all fails.
 *
 * Infra3dViewer is a top-level `class` written for the Grunt-concatenation world, so we eval the source in the jsdom
 * global scope over the real PanoViewer base (for _fireDiagnostic and _moveToInitialLocation) and the real
 * panoUtilities (for jwtExpiryMs), with stubs for the SDK and the globals the viewer closes over.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');
const NO_IMAGERY_ERROR_SRC = fs.readFileSync(path.join(SRC_DIR, 'NoImageryError.js'), 'utf8');
const PANO_VIEWER_SRC = fs.readFileSync(path.join(SRC_DIR, 'PanoViewer.js'), 'utf8');
const INFRA3D_SRC = fs.readFileSync(path.join(SRC_DIR, 'Infra3dViewer.js'), 'utf8');

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

function loadInfra3dViewer() {
    window.eval(`
        class GsvViewer {}
        class MapillaryViewer {}
        class PannellumViewer {}
        class PanoramaxViewer {}
        class PanoData {
            constructor(params) { this.params = params; }
            getPanoId() { return this.params.panoId; }
            getProperty(key) { return this.params[key]; }
        }
        const proj4 = () => [0, 0];
        const moment = (timestamp) => timestamp;
        ${NO_IMAGERY_ERROR_SRC}
        ${PANO_VIEWER_SRC}
        ${INFRA3D_SRC}
        window.Infra3dViewer = Infra3dViewer;
    `);
    return window.Infra3dViewer;
}

const MINUTE_MS = 60 * 1000;
const T0 = Date.parse('2026-09-16T12:00:00Z');

/** A JWT-shaped token whose payload carries only the expiry (base64url, unpadded, like Cognito's). */
const jwtExpiringAt = (expiryMs) => {
    const payload = btoa(JSON.stringify({ exp: Math.floor(expiryMs / 1000) }))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `hdr.${payload}.sig`;
};

/** An Infra3d node with the fields #finishRecordingMetadata reads. */
const nodeFor = (id) => ({
    cameraType: 'cubemap',
    frame: {
        id,
        timestamp: 0,
        framedatameta: { imagewidth: 1, imageheight: 1, tilesize: 1 },
        latitude: 47.413137835,
        longitude: 8.4747970537,
        omega: 0,
        phi: 0,
    },
    spatialEdges: { cached: true, edges: [] },
});

/** The SDK surface initialize() touches: a Manager whose initViewer yields a viewer that can load a seed pano. */
function fakeSdk({ initViewerResolves = true } = {}) {
    const sdkViewer = {
        setFilter: async () => {},
        on: () => {},
        moveToKey: async (id) => nodeFor(id),
        movePosition: async () => nodeFor('NEAR'),
        deactivateComponent: () => {},
    };
    const viewer = { _sdk_viewer: sdkViewer, on: () => {}, getCameraView: () => ({ type: 'pano' }) };
    const manager = {
        initViewer: jest.fn(() => (initViewerResolves ? Promise.resolve(viewer) : new Promise(() => {}))),
        setTokens: jest.fn(),
    };
    window.infra3dapi = { init: jest.fn(async () => manager) };
    return manager;
}

/** A fetch that answers /imageryAccessToken with a token expiring at the given time. */
const tokenResponse = (expiryMs) => Promise.resolve({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ source: 'infra3d', token: jwtExpiringAt(expiryMs), expires_at: new Date(expiryMs).toISOString() }),
});

describe('Infra3dViewer access-token renewal', () => {
    let Infra3dViewer;
    let mount;
    let diagnostics;

    beforeAll(() => {
        Infra3dViewer = loadInfra3dViewer();
    });

    beforeEach(() => {
        jest.useFakeTimers({ now: T0 });
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        global.fetch = jest.fn();
        window.logWebpageActivity = jest.fn();
        mount = document.createElement('div');
        mount.id = 'pano-mount';
        document.body.appendChild(mount);
        diagnostics = jest.fn();
    });

    afterEach(() => {
        mount.remove();
        jest.useRealTimers();
        jest.restoreAllMocks();
        delete global.fetch;
        delete window.logWebpageActivity;
        delete window.infra3dapi;
        window.sessionStorage.clear();
    });

    /** Creates a viewer seeded with a token expiring at `expiryMs` and subscribes the diagnostics spy. */
    async function createViewer(expiryMs, manager = fakeSdk()) {
        const viewer = await Infra3dViewer.create(mount, { accessToken: jwtExpiringAt(expiryMs), startPanoId: 'SEED' });
        viewer.addListener('diagnostic', diagnostics);
        return { viewer, manager };
    }

    it('renews five minutes before expiry and hands the SDK the new token in its own shape', async () => {
        const { manager } = await createViewer(T0 + 60 * MINUTE_MS);
        const renewedExpiry = T0 + 55 * MINUTE_MS + 60 * MINUTE_MS;
        fetch.mockImplementation(() => tokenResponse(renewedExpiry));

        await jest.advanceTimersByTimeAsync(55 * MINUTE_MS - 1);
        expect(fetch).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledWith('/imageryAccessToken', expect.objectContaining({ headers: { Accept: 'application/json' } }));
        expect(manager.setTokens).toHaveBeenCalledWith({
            access_token: jwtExpiringAt(renewedExpiry),
            expires_in: 60 * 60,
            id_token: '',
            refresh_token: '',
            token_type: 'Bearer',
        });
        expect(diagnostics).toHaveBeenCalledWith('TokenRefreshed', { remainingSec: '3600', attempt: '1' });

        // The new token gets its own renewal, again five minutes ahead of its expiry.
        await jest.advanceTimersByTimeAsync(55 * MINUTE_MS - 1);
        expect(fetch).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('renews right away when the page arrived with a token already inside the lead window', async () => {
        fetch.mockImplementation(() => tokenResponse(T0 + 60 * MINUTE_MS));
        const { manager } = await createViewer(T0 + 2 * MINUTE_MS);

        await jest.advanceTimersByTimeAsync(0);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(manager.setTokens).toHaveBeenCalledTimes(1);
    });

    it('retries a failed renewal with backoff and reports the token expired once the retries run out', async () => {
        const { manager } = await createViewer(T0 + 60 * MINUTE_MS);
        fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 503 }));

        await jest.advanceTimersByTimeAsync(55 * MINUTE_MS); // attempt 1 at T+55:00
        await jest.advanceTimersByTimeAsync(30 * 1000); // attempt 2 at T+55:30
        await jest.advanceTimersByTimeAsync(60 * 1000); // attempt 3 at T+56:30
        expect(fetch).toHaveBeenCalledTimes(3);
        expect(diagnostics).toHaveBeenNthCalledWith(1, 'TokenRefreshFailed', { attempt: '1', reason: 'HTTP 503' });
        expect(diagnostics).toHaveBeenNthCalledWith(3, 'TokenRefreshFailed', { attempt: '3', reason: 'HTTP 503' });
        expect(diagnostics).not.toHaveBeenCalledWith('TokenExpired', expect.anything());

        // The last wait repeats (T+58:30), then is cut to land at the expiry itself (T+60:00), where the failure is
        // final: the SDK's requests are already being refused, so there is nothing left to retry for.
        await jest.advanceTimersByTimeAsync(120 * 1000);
        expect(fetch).toHaveBeenCalledTimes(4);
        await jest.advanceTimersByTimeAsync(90 * 1000);
        expect(fetch).toHaveBeenCalledTimes(5);
        expect(diagnostics).toHaveBeenLastCalledWith('TokenExpired', { attempts: '5' });
        expect(manager.setTokens).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(10 * MINUTE_MS);
        expect(fetch).toHaveBeenCalledTimes(5);
    });

    it('recovers from a failed attempt on the next one and resets the attempt count', async () => {
        const { manager } = await createViewer(T0 + 60 * MINUTE_MS);
        fetch
            .mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
            .mockImplementation(() => tokenResponse(T0 + 120 * MINUTE_MS));

        await jest.advanceTimersByTimeAsync(55 * MINUTE_MS + 30 * 1000);

        expect(diagnostics).toHaveBeenNthCalledWith(1, 'TokenRefreshFailed', { attempt: '1', reason: 'Failed to fetch' });
        expect(diagnostics).toHaveBeenNthCalledWith(2, 'TokenRefreshed', expect.objectContaining({ attempt: '2' }));
        expect(manager.setTokens).toHaveBeenCalledTimes(1);
    });

    it('renews on demand through refreshAccessTokenNow(), replacing the scheduled renewal', async () => {
        const { viewer, manager } = await createViewer(T0 + 60 * MINUTE_MS);
        const renewedExpiry = T0 + 60 * MINUTE_MS;
        fetch.mockImplementation(() => tokenResponse(renewedExpiry));

        await viewer.refreshAccessTokenNow();

        expect(manager.setTokens).toHaveBeenCalledTimes(1);
        expect(diagnostics).toHaveBeenCalledWith('TokenRefreshed', expect.objectContaining({ attempt: '1' }));
        // The old schedule is gone; the next renewal is five minutes before the renewed token's expiry.
        await jest.advanceTimersByTimeAsync(55 * MINUTE_MS - 1);
        expect(fetch).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('lets a viewer whose mount has left the page lapse instead of renewing for nobody', async () => {
        await createViewer(T0 + 60 * MINUTE_MS);
        mount.remove();

        await jest.advanceTimersByTimeAsync(60 * MINUTE_MS);

        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not spin when an on-demand refresh of an unreadable token fails', async () => {
        fakeSdk();
        const viewer = await Infra3dViewer.create(mount, { accessToken: 'not-a-jwt', startPanoId: 'SEED' });
        viewer.addListener('diagnostic', diagnostics);
        fetch.mockImplementation(() => Promise.resolve({ ok: false, status: 503 }));

        await viewer.refreshAccessTokenNow();
        await jest.advanceTimersByTimeAsync(10 * MINUTE_MS);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(diagnostics).toHaveBeenLastCalledWith('TokenExpired', { attempts: '1' });
    });

    it('treats a token without a readable expiry as a failed renewal rather than handing the SDK NaN', async () => {
        const { manager } = await createViewer(T0 + 60 * MINUTE_MS);
        fetch.mockImplementation(() => Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ source: 'gsv', token: 'static-key', expires_at: null }),
        }));

        await jest.advanceTimersByTimeAsync(55 * MINUTE_MS);

        expect(manager.setTokens).not.toHaveBeenCalled();
        expect(diagnostics).toHaveBeenCalledWith('TokenRefreshFailed',
            expect.objectContaining({ reason: 'token without a readable expiry' }));
    });

    it('treats a 200 that is not JSON (a sign-in page) as a failed renewal with a readable reason', async () => {
        const { manager } = await createViewer(T0 + 60 * MINUTE_MS);
        fetch.mockImplementation(() => Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'text/html' }),
            json: async () => { throw new SyntaxError('Unexpected token <'); },
        }));

        await jest.advanceTimersByTimeAsync(55 * MINUTE_MS);

        expect(manager.setTokens).not.toHaveBeenCalled();
        expect(diagnostics).toHaveBeenCalledWith('TokenRefreshFailed',
            expect.objectContaining({ reason: 'non-JSON response' }));
    });

    it('says so, once, when the token is not a JWT it can read', async () => {
        fakeSdk();
        const viewer = await Infra3dViewer.create(mount, { accessToken: 'not-a-jwt', startPanoId: 'SEED' });
        viewer.addListener('diagnostic', diagnostics);

        await jest.advanceTimersByTimeAsync(60 * MINUTE_MS);

        expect(window.logWebpageActivity).toHaveBeenCalledWith('PanoViewer_TokenUnreadable', true);
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('Infra3dViewer initViewer timeout', () => {
    let Infra3dViewer;
    let mount;

    beforeAll(() => {
        Infra3dViewer = loadInfra3dViewer();
    });

    beforeEach(() => {
        jest.useFakeTimers({ now: T0 });
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {}); // jsdom logs reload() as "not implemented".
        window.logWebpageActivity = jest.fn();
        mount = document.createElement('div');
        mount.id = 'pano-mount';
        document.body.appendChild(mount);
    });

    afterEach(() => {
        mount.remove();
        jest.useRealTimers();
        jest.restoreAllMocks();
        delete window.logWebpageActivity;
        delete window.infra3dapi;
        window.sessionStorage.clear();
    });

    it('logs the timeout and reloads once, remembering that it did', async () => {
        fakeSdk({ initViewerResolves: false });
        const created = Infra3dViewer.create(mount, { accessToken: jwtExpiringAt(T0 + 60 * MINUTE_MS) });
        created.catch(() => {});

        await jest.advanceTimersByTimeAsync(Infra3dViewer.INIT_TIMEOUT_MS);

        expect(window.logWebpageActivity).toHaveBeenCalledWith('PanoViewer_InitTimeout_source=infra3d_reloading=true');
        expect(window.sessionStorage.getItem('infra3dViewerInitReloaded')).toBe('1');
    });

    it('gives up instead of reloading again when the previous reload did not help', async () => {
        window.sessionStorage.setItem('infra3dViewerInitReloaded', '1');
        fakeSdk({ initViewerResolves: false });
        const created = Infra3dViewer.create(mount, { accessToken: jwtExpiringAt(T0 + 60 * MINUTE_MS) });
        const settled = expect(created).rejects.toThrow(/initViewer did not finish/);

        await jest.advanceTimersByTimeAsync(Infra3dViewer.INIT_TIMEOUT_MS);

        await settled;
        expect(window.logWebpageActivity).toHaveBeenCalledWith('PanoViewer_InitTimeout_source=infra3d_reloading=false');
        expect(window.sessionStorage.getItem('infra3dViewerInitReloaded')).toBeNull();
    });

    it('clears the reload memory once a viewer comes up, so a later hang gets its own reload', async () => {
        window.sessionStorage.setItem('infra3dViewerInitReloaded', '1');
        fakeSdk();

        await Infra3dViewer.create(mount, { accessToken: jwtExpiringAt(T0 + 60 * MINUTE_MS), startPanoId: 'SEED' });

        expect(window.sessionStorage.getItem('infra3dViewerInitReloaded')).toBeNull();
    });
});
