/**
 * Infra3dViewer before its first pano has loaded (issue #5561).
 *
 * Validate's tracker stamps every action with the viewer's pano, position and POV, and it pushes from inside
 * PanoManager's init — before the first pano has landed — because that is when the expired-pano shortcut sends the
 * first label to Pannellum. A getter that dereferences a node it doesn't have yet throws inside that push, and every
 * pointer, touch and key event of the page's first seconds is lost with it. The getters answer null instead, as
 * GsvViewer's do.
 */

import { loadModules } from './loader.js';

describe('Infra3dViewer before the first pano', () => {
    let viewer;

    beforeAll(async () => {
        const { Infra3dViewer } = await loadModules('frontend/js/common/pano-viewer/Infra3dViewer.js');
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
