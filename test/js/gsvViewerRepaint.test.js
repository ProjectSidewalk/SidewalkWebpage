/**
 * Tests for `PanoViewer.repaint()` and GsvViewer's implementation of it — the workaround for the black GSV pano
 * (#2468, #5367).
 *
 * GSV's renderer can stop painting after its container changes size (a window drag, a Ctrl +/- browser zoom) and
 * stay black until the camera moves, which is why dragging the image clears it. `repaint()` moves the camera by a
 * fraction of a degree to force that frame. Two properties make it safe to call on every resize event, and both are
 * pinned here: it does nothing before a pano has painted (there is no POV to nudge), and consecutive calls cancel
 * out, so a long session of window drags cannot walk the heading away from where the labeler left it.
 *
 * The viewer classes are top-level `class` declarations written for the Grunt-concatenation world, so the sources
 * are eval'd into the jsdom global scope with stub declarations for the sibling classes PanoViewer's constructor
 * compares `new.target` against, following panoViewerMountAlignment.test.js.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');

/**
 * Loads PanoViewer + GsvViewer fresh into the jsdom global scope.
 * @returns {{PanoViewer: Function, GsvViewer: Function}}
 */
function loadViewers() {
    const panoViewerSrc = fs.readFileSync(path.join(SRC_DIR, 'PanoViewer.js'), 'utf8');
    const gsvSrc = fs.readFileSync(path.join(SRC_DIR, 'GsvViewer.js'), 'utf8');
    window.eval(`
        class MapillaryViewer {}
        class Infra3dViewer {}
        class PannellumViewer {}
        class PanoramaxViewer {}
        ${panoViewerSrc}
        ${gsvSrc}
        window.PanoViewer = PanoViewer;
        window.GsvViewer = GsvViewer;
    `);
    return { PanoViewer: window.PanoViewer, GsvViewer: window.GsvViewer };
}

/**
 * A GsvViewer over a fake StreetViewPanorama that actually holds a POV, so a test can read back where a sequence of
 * nudges left the camera rather than only what was asked for.
 * @param {Function} GsvViewer - The class from loadViewers().
 * @param {{heading: number, pitch: number, zoom: number}} pov - The POV the fake pano starts out showing.
 * @returns {{viewer: object, shownPov: () => {heading: number, pitch: number, zoom: number}}}
 */
function viewerShowingPov(GsvViewer, pov) {
    const shown = { ...pov };
    const viewer = new GsvViewer();
    viewer.gsvPano = {
        // The live object itself, the least forgiving thing GSV could hand back: a nudge that edited it in place
        // before calling setPov would make the set look like no change at all.
        getPov: () => shown,
        setPov: jest.fn((next) => { Object.assign(shown, next); }),
    };
    return { viewer, shownPov: () => ({ ...shown }), live: shown };
}

describe('PanoViewer.repaint', () => {
    test('is a no-op on the base class, so providers without the repaint bug are left alone', () => {
        const { PanoViewer } = loadViewers();

        expect(typeof PanoViewer.prototype.repaint).toBe('function');
        expect(PanoViewer.prototype.repaint.call({})).toBeUndefined();
    });
});

describe('GsvViewer.repaint', () => {
    let GsvViewer;

    beforeEach(() => {
        ({ GsvViewer } = loadViewers());
    });

    test('does nothing before a pano has loaded, when there is no frame to force', () => {
        const viewer = new GsvViewer();
        expect(() => viewer.repaint()).not.toThrow(); // No gsvPano at all: the earliest resize can beat the SDK.

        viewer.gsvPano = { getPov: () => undefined, setPov: jest.fn() }; // GSV's answer until the first pano paints.
        viewer.repaint();

        expect(viewer.gsvPano.setPov).not.toHaveBeenCalled();
    });

    test('moves the camera by a fraction of a degree, leaving the zoom alone', () => {
        const { viewer, live } = viewerShowingPov(GsvViewer, { heading: 120, pitch: -5, zoom: 2 });
        // What the pano was showing at the moment it was asked to move: a nudge applied to GSV's own object first
        // would already have moved it, and GSV would then have nothing to redraw.
        const headingWhenSet = [];
        viewer.gsvPano.setPov.mockImplementation((next) => {
            headingWhenSet.push(live.heading);
            Object.assign(live, next);
        });

        viewer.repaint();

        expect(viewer.gsvPano.setPov).toHaveBeenCalledTimes(1);
        const nudged = viewer.gsvPano.setPov.mock.calls[0][0];
        expect(nudged).not.toBe(live);
        expect(headingWhenSet).toEqual([120]);
        expect(Math.abs(nudged.heading - 120)).toBeCloseTo(0.01, 10);
        expect(Math.abs(nudged.pitch - -5)).toBeCloseTo(0.01, 10);
        expect(nudged.zoom).toBe(2); // A changed zoom would be visible, and would desync the marker projection.
    });

    test('alternates direction so a pair of nudges leaves the camera where it started', () => {
        const startPov = { heading: 120, pitch: -5, zoom: 2 };
        const { viewer, shownPov } = viewerShowingPov(GsvViewer, startPov);

        viewer.repaint();
        const afterFirst = shownPov();
        viewer.repaint();
        const afterSecond = shownPov();

        expect(viewer.gsvPano.setPov).toHaveBeenCalledTimes(2); // Each call forces its own frame.
        expect(afterFirst.heading).not.toBeCloseTo(startPov.heading, 10);
        expect(afterSecond.heading).toBeCloseTo(startPov.heading, 10);
        expect(afterSecond.pitch).toBeCloseTo(startPov.pitch, 10);
    });

    test('does not drift the camera over a long run of resizes', () => {
        const { viewer, shownPov } = viewerShowingPov(GsvViewer, { heading: 120, pitch: -5, zoom: 1 });

        // Dragging a window edge fires resize dozens of times; an additive nudge would leave the camera elsewhere.
        for (let i = 0; i < 100; i++) viewer.repaint();

        expect(shownPov().heading).toBeCloseTo(120, 6);
        expect(shownPov().pitch).toBeCloseTo(-5, 6);
    });
});
