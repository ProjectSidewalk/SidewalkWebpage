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
        global.$ = jest.fn(() => ({ on: jest.fn() }));
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.$;
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
