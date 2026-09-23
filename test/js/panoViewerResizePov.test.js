/**
 * A viewer's resize() must report a POV change once the frame reflecting the new box has rendered
 * (PanoViewer._firePovChangedAfterResize, #5085).
 *
 * Mapillary, Infra3D and Panoramax keep their camera's vertical field of view across a resize, so the horizontal
 * one, and the zoom getPov() reports, changes with the box, and their SDKs apply the new size in their own render
 * loop a frame later. Explore redraws its label canvas as soon as resize() returns, so without this notification the
 * labels kept the old projection until the next pan moved them: a label placed in immersive mode sat beside its
 * feature after leaving the mode, then snapped onto it on the first pan.
 *
 * MapillaryViewer is a top-level `class` written for Grunt concatenation, so the sources are eval'd into jsdom with
 * stubs for the sibling classes PanoViewer's constructor compares `new.target` against.
 */
const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');

// getPov() converts through util.pano; utilities.js builds a Bowser parser at load time that nothing here consults.
window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
loadGlobalScript('public/js/common/utilities.js');
loadGlobalScript('public/js/common/utilitiesMath.js');
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');

/** Loads PanoViewer + MapillaryViewer fresh into the jsdom global scope. */
function loadViewers() {
    window.eval(`
        class GsvViewer {}
        class Infra3dViewer {}
        class PannellumViewer {}
        class PanoramaxViewer {}
        ${fs.readFileSync(path.join(SRC_DIR, 'PanoViewer.js'), 'utf8')}
        ${fs.readFileSync(path.join(SRC_DIR, 'MapillaryViewer.js'), 'utf8')}
        window.MapillaryViewer = MapillaryViewer;
    `);
    return window.MapillaryViewer;
}

describe('PanoViewer resize reports a POV change once the new box has rendered', () => {
    let frames;

    beforeEach(() => {
        // Animation frames are collected and run by hand, so the test controls which frame has painted.
        frames = [];
        window.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
    });

    /** Runs every frame callback queued so far, as one paint would. */
    function paint() {
        const due = frames.splice(0);
        due.forEach((cb) => cb());
    }

    test('MapillaryViewer reads the new aspect from its container at resize, so getPov() is right at once', () => {
        const MapillaryViewer = loadViewers();
        const viewer = new MapillaryViewer();
        viewer.viewer = { resize: jest.fn() };
        viewer.currCameraHeading = 180; // What getPov() reads besides the camera cache.
        viewer.currCenter = [0.5, 0.5];
        const onPov = jest.fn();
        viewer.addListener('pov_changed', onPov);
        const camera = (aspect) => ({ perspective: { fov: 90, aspect }, _currentImageId: 'img' });

        viewer._onRenderCamera(camera(1.5)); // The viewer coming up: nothing was drawn against an older aspect.
        expect(onPov).not.toHaveBeenCalled();
        viewer._onRenderCamera(camera(1.5)); // An ordinary render tick.
        expect(onPov).not.toHaveBeenCalled();
        const boxedZoom = viewer.getPov().zoom;

        // The layout has already given the container its new, wider box when resize() is called.
        viewer.canvasElem = { getBoundingClientRect: () => ({ width: 1920, height: 1080 }) };
        viewer.resize();
        expect(viewer.viewer.resize).toHaveBeenCalledTimes(1);
        // getPov() is right the moment resize() returns: a wider box at the same vertical fov is a wider view.
        expect(viewer.currAspect).toBeCloseTo(16 / 9, 10);
        expect(viewer.getPov().zoom).toBeLessThan(boxedZoom);
        paint();
        paint();
        expect(onPov).toHaveBeenCalledTimes(1); // The base helper, after the SDK's frame and ours.
        viewer._onRenderCamera(camera(16 / 9)); // The SDK confirms the aspect the container already reported.
        expect(onPov).toHaveBeenCalledTimes(1);
        viewer._onRenderCamera(camera(1.5)); // A camera reporting a different aspect is still a POV change.
        expect(onPov).toHaveBeenCalledTimes(2);
    });

    test('a viewer without a camera event reports the POV two frames after resize (the base helper)', () => {
        const MapillaryViewer = loadViewers();
        const viewer = new MapillaryViewer();
        const onPov = jest.fn();
        viewer.addListener('pov_changed', onPov);
        viewer._firePovChangedAfterResize();
        paint();
        expect(onPov).not.toHaveBeenCalled(); // The SDK's frame.
        paint();
        expect(onPov).toHaveBeenCalledTimes(1); // Ours.
        paint();
        expect(onPov).toHaveBeenCalledTimes(1);
    });
});
