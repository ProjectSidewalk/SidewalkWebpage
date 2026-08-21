/**
 * Tests for PanoViewer._moveToInitialLocation's seed ordering (issue #4635) and for what its rejection is allowed to
 * claim about the street (issue #4918): a startPanoId seed is tried first, with startLatLng + backupLatLngs as its
 * fallback, and a street is only declared imagery-less when every one of those candidates answered "nothing here".
 *
 * That second property is the one with teeth. The caller records a NoImageryError rejection against the street, which
 * marks it audited and takes it out of the assignment rotation — so a transport or SDK failure that leaks through as
 * a NoImageryError costs coverage on a street nobody ever looked at.
 *
 * PanoViewer is a top-level `class` declaration written for the Grunt-concatenation world, so we eval the source in
 * the jsdom global scope. Its constructor compares `new.target` against the concrete viewer classes, so stub
 * declarations for those names are eval'd ahead of the source.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');
const NO_IMAGERY_ERROR_SRC = fs.readFileSync(path.join(SRC_DIR, 'NoImageryError.js'), 'utf8');
const VIEWER_SRC = fs.readFileSync(path.join(SRC_DIR, 'PanoViewer.js'), 'utf8');

/** Loads fresh PanoViewer and NoImageryError classes into the jsdom global scope. */
function loadPanoViewer() {
    window.eval(`
        class GsvViewer {}
        class MapillaryViewer {}
        class Infra3dViewer {}
        class PannellumViewer {}
        ${NO_IMAGERY_ERROR_SRC}
        ${VIEWER_SRC}
        window.PanoViewer = PanoViewer;
        window.NoImageryError = NoImageryError;
    `);
    return { PanoViewer: window.PanoViewer, NoImageryError: window.NoImageryError };
}

const START = { lat: 47.61, lng: -122.33 };
const BACKUP_1 = { lat: 47.62, lng: -122.33 };
const BACKUP_2 = { lat: 47.63, lng: -122.33 };

describe('PanoViewer._moveToInitialLocation', () => {
    /** A viewer whose setPano/setLocation record their calls and fail per the dead/broken-set config. */
    let TestViewer;
    let NoImageryError;

    // The classes are stateless, so one eval serves every test (each test builds its own viewer instance).
    beforeAll(() => {
        const loaded = loadPanoViewer();
        NoImageryError = loaded.NoImageryError;
        TestViewer = class extends loaded.PanoViewer {
            calls = [];
            deadPanoIds = new Set();
            /** Locations the provider searched and found empty — the only failure that says anything about a street. */
            deadLatLngs = [];
            /** Locations whose lookup failed for another reason (network, SDK, quota): imagery unknown, not absent. */
            brokenLatLngs = [];

            setPano(panoId) {
                this.calls.push(`pano:${panoId}`);
                return this.deadPanoIds.has(panoId)
                    ? Promise.reject(new Error(`dead pano: ${panoId}`))
                    : Promise.resolve();
            }

            setLocation(latLng) {
                this.calls.push(`loc:${latLng.lat}`);
                if (this.brokenLatLngs.some((broken) => broken.lat === latLng.lat)) {
                    return Promise.reject(new Error(`lookup failed at: ${latLng.lat}`));
                }
                return this.deadLatLngs.some((dead) => dead.lat === latLng.lat)
                    ? Promise.reject(new NoImageryError(`no imagery at: ${latLng.lat}`))
                    : Promise.resolve();
            }
        };
    });

    test('a loadable startPanoId wins and the lat/lngs are never consulted', async () => {
        const viewer = new TestViewer();
        await viewer._moveToInitialLocation({ startPanoId: 'abc', startLatLng: START, backupLatLngs: [BACKUP_1] });
        expect(viewer.calls).toEqual(['pano:abc']);
        expect(viewer.initialSeed).toBe('pano');
    });

    test('a dead startPanoId falls back to startLatLng, then each backup in order', async () => {
        const viewer = new TestViewer();
        viewer.deadPanoIds.add('abc');
        viewer.deadLatLngs.push(START);
        await viewer._moveToInitialLocation({
            startPanoId: 'abc', startLatLng: START, backupLatLngs: [BACKUP_1, BACKUP_2],
        });
        expect(viewer.calls).toEqual(['pano:abc', `loc:${START.lat}`, `loc:${BACKUP_1.lat}`]);
        expect(viewer.initialSeed).toBe('latLng');
    });

    test('a dead startPanoId with no lat/lng seed rejects with the setPano error', async () => {
        const viewer = new TestViewer();
        viewer.deadPanoIds.add('abc');
        await expect(viewer._moveToInitialLocation({ startPanoId: 'abc' })).rejects.toThrow('dead pano: abc');
        expect(viewer.calls).toEqual(['pano:abc']);
        expect(viewer.initialSeed).toBeUndefined();
    });

    test('lat/lng-only seeding tries the candidates in order', async () => {
        const viewer = new TestViewer();
        viewer.deadLatLngs.push(START);
        await viewer._moveToInitialLocation({ startLatLng: START, backupLatLngs: [BACKUP_1] });
        expect(viewer.calls).toEqual([`loc:${START.lat}`, `loc:${BACKUP_1.lat}`]);
        expect(viewer.initialSeed).toBe('latLng');
    });

    describe('what the rejection claims about the street (#4918)', () => {
        test('every candidate empty is the one case that reports the street as imagery-less', async () => {
            const viewer = new TestViewer();
            viewer.deadLatLngs.push(START, BACKUP_1);
            const attempt = viewer._moveToInitialLocation({ startLatLng: START, backupLatLngs: [BACKUP_1] });
            await expect(attempt).rejects.toBeInstanceOf(NoImageryError);
            expect(viewer.initialSeed).toBeUndefined();
        });

        test('a dead startPanoId does not taint an otherwise all-empty verdict', async () => {
            // The pano is a seed we chose, not a place we searched; #4635 already established it says nothing about
            // the street. The lat/lng candidates are what the verdict rests on.
            const viewer = new TestViewer();
            viewer.deadPanoIds.add('abc');
            viewer.deadLatLngs.push(START, BACKUP_1);
            const attempt = viewer._moveToInitialLocation({
                startPanoId: 'abc', startLatLng: START, backupLatLngs: [BACKUP_1],
            });
            await expect(attempt).rejects.toBeInstanceOf(NoImageryError);
        });

        test('one candidate that failed for another reason blocks the imagery-less verdict', async () => {
            // The stretch of street that candidate covered was never actually searched, so the street is unknown
            // rather than empty — reporting it here is how a transient outage becomes permanent lost coverage.
            const viewer = new TestViewer();
            viewer.deadLatLngs.push(START);
            viewer.brokenLatLngs.push(BACKUP_1);
            const attempt = viewer._moveToInitialLocation({ startLatLng: START, backupLatLngs: [BACKUP_1] });
            await expect(attempt).rejects.not.toBeInstanceOf(NoImageryError);
            await expect(attempt).rejects.toThrow(`lookup failed at: ${BACKUP_1.lat}`);
        });

        test('the first non-imagery failure is surfaced, so the root cause stays on top', async () => {
            const viewer = new TestViewer();
            viewer.brokenLatLngs.push(START, BACKUP_1);
            const attempt = viewer._moveToInitialLocation({ startLatLng: START, backupLatLngs: [BACKUP_1] });
            await expect(attempt).rejects.toThrow(`lookup failed at: ${START.lat}`);
        });

        test('a failure on the very first candidate still blocks the verdict when later ones are empty', async () => {
            const viewer = new TestViewer();
            viewer.brokenLatLngs.push(START);
            viewer.deadLatLngs.push(BACKUP_1, BACKUP_2);
            const attempt = viewer._moveToInitialLocation({
                startLatLng: START, backupLatLngs: [BACKUP_1, BACKUP_2],
            });
            await expect(attempt).rejects.not.toBeInstanceOf(NoImageryError);
        });
    });
});

describe('NoImageryError.allNoImagery', () => {
    let NoImageryError;

    beforeAll(() => { NoImageryError = loadPanoViewer().NoImageryError; });

    test('is false for an empty list, because nothing was ever searched', () => {
        expect(NoImageryError.allNoImagery([])).toBe(false);
    });

    test('is true only when every failure is a NoImageryError', () => {
        expect(NoImageryError.allNoImagery([new NoImageryError('a'), new NoImageryError('b')])).toBe(true);
        expect(NoImageryError.allNoImagery([new NoImageryError('a'), new Error('b')])).toBe(false);
        expect(NoImageryError.allNoImagery([new Error('a')])).toBe(false);
    });

    test('carries the provider error as `cause`, so the real failure survives classification', () => {
        const provider = new Error('ZERO_RESULTS');
        expect(new NoImageryError('empty', { cause: provider }).cause).toBe(provider);
    });

    // The verdict that NavigationService.moveForward() builds from a street-long walk before deciding whether the
    // street may be reported as imagery-less. Named cases, because each is a scenario the fix has to get right.
    describe('as the verdict on a walk down a street', () => {
        test('a street whose every sample point came back empty is reportable', () => {
            const walk = [new NoImageryError('10m'), new NoImageryError('20m'), new NoImageryError('30m')];
            expect(NoImageryError.allNoImagery(walk)).toBe(true);
        });

        test('a dead end whose remaining panos the user already visited is still reportable', () => {
            // Exclusion rejections are NoImageryError precisely so this stays true: the provider answered, and what
            // it found is unusable. Were these to disqualify, a real dead end could never be skipped and the user
            // would be stranded on it.
            const walk = [new NoImageryError('Excluded pano: abc'), new NoImageryError('40m')];
            expect(NoImageryError.allNoImagery(walk)).toBe(true);
        });

        test('one provider error anywhere in the walk makes the street unreportable', () => {
            // The blocked-API case from QA: with the maps RPC failing, the walk finds nothing at every point, but
            // none of it is evidence. Before this, a provider outage still spent streets — just fewer of them.
            const walk = [new NoImageryError('10m'), new Error('UNKNOWN_ERROR'), new NoImageryError('30m')];
            expect(NoImageryError.allNoImagery(walk)).toBe(false);
        });

        test('a walk that failed entirely on provider errors is unreportable', () => {
            const walk = [new Error('UNKNOWN_ERROR'), new Error('UNKNOWN_ERROR')];
            expect(NoImageryError.allNoImagery(walk)).toBe(false);
        });
    });
});
