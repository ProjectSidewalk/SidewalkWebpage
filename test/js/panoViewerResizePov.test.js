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

    test('MapillaryViewer.resize re-measures now and reports the POV after the SDK frame and ours', () => {
        const MapillaryViewer = loadViewers();
        const viewer = new MapillaryViewer();
        viewer.viewer = { resize: jest.fn() };
        const onPov = jest.fn();
        viewer.addListener('pov_changed', onPov);

        viewer.resize();
        expect(viewer.viewer.resize).toHaveBeenCalledTimes(1);
        expect(onPov).not.toHaveBeenCalled(); // The SDK has not painted the new size yet.
        paint();
        expect(onPov).not.toHaveBeenCalled(); // That was the SDK's frame.
        paint();
        expect(onPov).toHaveBeenCalledTimes(1); // Ours: the canvas can now be redrawn against the settled camera.
        paint();
        expect(onPov).toHaveBeenCalledTimes(1); // Once per resize, not a stream.
    });
});
