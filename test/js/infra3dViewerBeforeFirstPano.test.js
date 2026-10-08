/**
 * Infra3dViewer before its first pano has loaded (issue #5561).
 *
 * Validate's tracker stamps every action with the viewer's pano, position and POV, and it pushes from inside
 * PanoManager's init — before the first pano has landed — because that is when the expired-pano shortcut sends the
 * first label to Pannellum. A getter that dereferences a node it doesn't have yet throws inside that push, and every
 * pointer, touch and key event of the page's first seconds is lost with it. The getters answer null instead, as
 * GsvViewer's do.
 */

const path = require('path');
const { loadModules } = require('./loadGlobalScript');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'frontend/js/common/pano-viewer');

/**
 * Loads the production Infra3dViewer class with the globals it reads at definition time stubbed.
 * @returns {Function} The class.
 */
function loadInfra3dViewer() {
    window.PanoViewer = class PanoViewer {
        constructor() { this.viewerType = 'infra3d'; }
        getViewerType() { return this.viewerType; }
    };
    window.PanoData = class PanoData {
        constructor(params) { this.params = params; }
        getPanoId() { return this.params.panoId; }
        getProperty(key) { return this.params[key]; }
    };
    window.proj4 = () => [0, 0];
    window.util = { math: { toDegrees: (radians) => radians } };
    Object.assign(window, loadModules(path.join(SRC_DIR, 'Infra3dViewer.js'), path.join(SRC_DIR, 'NoImageryError.js')));
    return window.Infra3dViewer;
}

describe('Infra3dViewer before the first pano', () => {
    let viewer;

    beforeAll(() => {
        const Infra3dViewer = loadInfra3dViewer();
        viewer = new Infra3dViewer();
        // The SDK viewer exists from construction; no node has been moved to yet.
        viewer.viewer = { getCameraView: () => ({ lon: 0, lat: 0, type: 'flat' }) };
    });

    test('answers null for the pano id, position and POV rather than throwing', () => {
        expect(viewer.getPanoId()).toBeNull();
        expect(viewer.getPosition()).toBeNull();
        expect(viewer.getPov()).toBeNull();
    });
});
