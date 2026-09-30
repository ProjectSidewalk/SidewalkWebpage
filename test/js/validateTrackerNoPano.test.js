/**
 * Tests for public/js/validate/src/Tracker.js — logging an action before the viewer has loaded any pano.
 *
 * GsvViewer.getPosition() and getPov() answer null until the first pano's metadata has arrived, and the first push
 * can land before then: when the first label's pano is expired, the primary viewer never loads one and Pannellum
 * takes over inside PanoManager's init, which pushes as it goes. A tracker that dereferenced the position there took
 * the whole page down with it (the browser suite's expired-pano path found it), so the action must carry nulls
 * instead.
 */

const fs = require('fs');
const path = require('path');

const TRACKER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/Tracker.js');

/**
 * Loads the `Tracker` class out of the production file — a bare `class` the Grunt bundle concatenates into page
 * scope — by wrapping the source in an IIFE that returns it.
 * @returns {Function} The Tracker class.
 */
function loadTrackerClass() {
    const src = fs.readFileSync(TRACKER_PATH, 'utf8');
    return (0, eval)('(() => {\n' + src + '\nreturn Tracker;\n})()');
}

const Tracker = loadTrackerClass();

describe('Tracker before the first pano loads', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.svv;
    });

    /** A GSV-shaped viewer in its pre-load state: nothing to report yet. */
    function unloadedViewer() {
        return { getPosition: () => null, getPov: () => null, getPanoId: () => null };
    }

    test('records nulls for position, pov and pano rather than throwing', () => {
        global.svv = { panoManager: {}, panoViewer: unloadedViewer(), missionContainer: null, form: {} };
        const tracker = new Tracker();
        expect(() => tracker.push('Viewer_Pannellum')).not.toThrow();
        const [action] = tracker.getActions();
        expect(action).toMatchObject({
            action: 'Viewer_Pannellum', pano_id: null, lat: null, lng: null, heading: null, pitch: null, zoom: null,
        });
    });

    test('reads the viewer before PanoManager.create has returned, when svv.panoManager is still unset', () => {
        global.svv = {
            panoViewer: {
                getPosition: () => ({ lat: 40.9, lng: -74.0 }),
                getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
                getPanoId: () => 'pano-first',
            },
            missionContainer: null,
            form: {},
        };
        const [action] = new Tracker().push('Viewer_Pannellum').getActions();
        expect(action.pano_id).toBe('pano-first');
    });

    test('reports the position and pov once a viewer has them', () => {
        global.svv = {
            panoManager: {},
            panoViewer: {
                getPosition: () => ({ lat: 40.9, lng: -74.0 }),
                getPov: () => ({ heading: 10, pitch: 2, zoom: 1 }),
                getPanoId: () => 'pano-1',
            },
            missionContainer: null,
            form: {},
        };
        const [action] = new Tracker().push('POV_Changed').getActions();
        expect(action).toMatchObject({ pano_id: 'pano-1', lat: 40.9, lng: -74.0, heading: 10, pitch: 2, zoom: 1 });
    });
});

describe('Tracker before the mission exists', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.svv;
    });

    /** A mission container reporting one mission, as MissionContainer does once Main has created it. */
    function missionContainerWith(missionId) {
        return { getCurrentMission: () => ({ getProperty: (key) => (key === 'missionId' ? missionId : undefined) }) };
    }

    test('an action pushed before the mission container exists is filed under the mission at drain time', () => {
        global.svv = { panoManager: null, panoViewer: null, missionContainer: null, form: {} };
        const tracker = new Tracker();
        tracker.push('Viewer_Pannellum');
        expect(tracker.getActions()[0].mission_id).toBeNull();

        global.svv.missionContainer = missionContainerWith(42);
        tracker.push('MissionStart');
        expect(tracker.getActions().map((a) => a.mission_id)).toEqual([42, 42]);
    });

    test('an action that already names a mission keeps it', () => {
        global.svv = { panoManager: null, panoViewer: null, missionContainer: missionContainerWith(7), form: {} };
        const tracker = new Tracker();
        tracker.push('MissionComplete');
        global.svv.missionContainer = missionContainerWith(8);
        tracker.push('MissionStart');
        expect(tracker.getActions().map((a) => a.mission_id)).toEqual([7, 8]);
    });
});
