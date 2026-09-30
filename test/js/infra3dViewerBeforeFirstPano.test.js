/**
 * Infra3dViewer before its first pano has loaded (issue #5561).
 *
 * Validate's tracker stamps every action with the viewer's pano, position and POV, and it pushes from inside
 * PanoManager's init — before the first pano has landed — because that is when the expired-pano shortcut sends the
 * first label to Pannellum. A getter that dereferences a node it doesn't have yet throws inside that push, and every
 * pointer, touch and key event of the page's first seconds is lost with it. The getters answer null instead, as
 * GsvViewer's do.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');
const NO_IMAGERY_ERROR_SRC = fs.readFileSync(path.join(SRC_DIR, 'NoImageryError.js'), 'utf8');
const VIEWER_SRC = fs.readFileSync(path.join(SRC_DIR, 'Infra3dViewer.js'), 'utf8');

/**
 * Loads the production Infra3dViewer class with the globals it reads at definition time stubbed.
 * @returns {Function} The class.
 */
function loadInfra3dViewer() {
    window.eval(`
        class PanoViewer {
            constructor() { this.viewerType = 'infra3d'; }
            getViewerType() { return this.viewerType; }
        }
        class PanoData {
            constructor(params) { this.params = params; }
            getPanoId() { return this.params.panoId; }
            getProperty(key) { return this.params[key]; }
        }
        const proj4 = () => [0, 0];
        const util = { math: { toDegrees: (radians) => radians } };
        ${NO_IMAGERY_ERROR_SRC}
        ${VIEWER_SRC}
        window.Infra3dViewer = Infra3dViewer;
    `);
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
