/**
 * Tests for PanoViewer._moveToInitialLocation's seed ordering (issue #4635): a startPanoId seed is tried first, with
 * startLatLng + backupLatLngs as its fallback, and a street is only declared imagery-less when every seed fails.
 *
 * PanoViewer is a top-level `class` declaration written for the Grunt-concatenation world, so we eval the source in
 * the jsdom global scope. Its constructor compares `new.target` against the concrete viewer classes, so stub
 * declarations for those names are eval'd ahead of the source.
 */

const fs = require('fs');
const path = require('path');

const VIEWER_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src/PanoViewer.js'), 'utf8'
);

/** Loads a fresh PanoViewer class into the jsdom global scope and returns it. */
function loadPanoViewer() {
    window.eval(`
        class GsvViewer {}
        class MapillaryViewer {}
        class Infra3dViewer {}
        class PannellumViewer {}
        ${VIEWER_SRC}
        window.PanoViewer = PanoViewer;
    `);
    return window.PanoViewer;
}

const START = { lat: 47.61, lng: -122.33 };
const BACKUP_1 = { lat: 47.62, lng: -122.33 };
const BACKUP_2 = { lat: 47.63, lng: -122.33 };

describe('PanoViewer._moveToInitialLocation', () => {
    /** A viewer whose setPano/setLocation record their calls and fail per the dead-set config. */
    let TestViewer;

    beforeEach(() => {
        const PanoViewer = loadPanoViewer();
        TestViewer = class extends PanoViewer {
            calls = [];
            deadPanoIds = new Set();
            deadLatLngs = [];

            setPano(panoId) {
                this.calls.push(`pano:${panoId}`);
                return this.deadPanoIds.has(panoId)
                    ? Promise.reject(new Error(`dead pano: ${panoId}`))
                    : Promise.resolve();
            }

            setLocation(latLng) {
                this.calls.push(`loc:${latLng.lat}`);
                return this.deadLatLngs.some((dead) => dead.lat === latLng.lat)
                    ? Promise.reject(new Error(`no imagery at: ${latLng.lat}`))
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

    test('rejects with the last setLocation error when every seed fails', async () => {
        const viewer = new TestViewer();
        viewer.deadPanoIds.add('abc');
        viewer.deadLatLngs.push(START, BACKUP_1);
        await expect(viewer._moveToInitialLocation({
            startPanoId: 'abc', startLatLng: START, backupLatLngs: [BACKUP_1],
        })).rejects.toThrow(`no imagery at: ${BACKUP_1.lat}`);
        expect(viewer.initialSeed).toBeUndefined();
    });

    test('lat/lng-only seeding tries the candidates in order', async () => {
        const viewer = new TestViewer();
        viewer.deadLatLngs.push(START);
        await viewer._moveToInitialLocation({ startLatLng: START, backupLatLngs: [BACKUP_1] });
        expect(viewer.calls).toEqual([`loc:${START.lat}`, `loc:${BACKUP_1.lat}`]);
        expect(viewer.initialSeed).toBe('latLng');
    });
});
