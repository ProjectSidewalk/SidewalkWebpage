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

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');

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

    test('MapillaryViewer reports the POV when its render camera first shows the new aspect, not on a timer', () => {
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

        viewer.resize();
        expect(viewer.viewer.resize).toHaveBeenCalledTimes(1);
        paint();
        paint();
        expect(onPov).not.toHaveBeenCalled(); // No frames are trusted; only the camera itself.
        viewer._onRenderCamera(camera(16 / 9)); // The SDK renders the new box.
        expect(onPov).toHaveBeenCalledTimes(1);
        expect(viewer.getPov().zoom).toBeLessThan(1.01); // A wider box at the same vertical fov is a wider view.
        viewer._onRenderCamera(camera(16 / 9)); // Later ticks at that aspect are quiet.
        expect(onPov).toHaveBeenCalledTimes(1);
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
