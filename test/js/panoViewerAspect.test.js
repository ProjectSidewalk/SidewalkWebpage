/**
 * Tests for the viewport-aspect side of the fov↔zoom conversion (#4852).
 *
 * Mapillary and Infra3D express their camera in *vertical* fov while our zoom levels are defined in
 * *horizontal*-fov terms, and the bridge between the two is the viewport's width:height ratio. Convert through
 * the wrong ratio and the zoom recorded/consumed disagrees with what the marker projection assumes, drifting
 * markers toward the canvas edges — most visibly on portrait mobile (~0.46), invisibly on a 3:2 desktop canvas.
 *
 * Three layers, matching how the conversion is built:
 *   1. util.pano.vFovToHFov / hFovToVFov — the pure math, including the invariant that pins desktop behavior: a
 *      3:2 viewport must convert exactly as 2·atan(tan(v/2)·1.5).
 *   2. PanoViewer._viewportAspect — the live measurement with its can't-measure fallback.
 *   3. MapillaryViewer.getPov/setPov — the wiring: conversions read the cached render-camera aspect, and the
 *      cached vertical fov mirrors the [14.25°, 90°] band Mapillary can actually render a spherical image at,
 *      so getPov() never reports a zoom the viewer isn't showing.
 *
 * MapillaryViewer is a top-level `class` written for the Grunt-concatenation world, so the sources are eval'd
 * into the jsdom global scope, with stub declarations for the sibling viewer classes PanoViewer's constructor
 * compares `new.target` against.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');

// utilities.js builds a Bowser parser at load time; nothing here consults it.
window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
loadGlobalScript('public/js/common/utilities.js');
loadGlobalScript('public/js/common/utilitiesMath.js');
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');

const util = window.util;
const pano = util.pano;

/** The horizontal fov a 3:2 Explore canvas renders for a given vertical fov, longhand — the desktop invariant. */
function hFovOnExploreCanvas(verticalFov) {
    return util.math.toDegrees(
        2 * Math.atan(Math.tan(util.math.toRadians(verticalFov / 2)) * util.EXPLORE_CANVAS_ASPECT_RATIO),
    );
}

describe('util.pano.vFovToHFov / hFovToVFov', () => {
    test('a square viewport renders the same field horizontally and vertically', () => {
        expect(pano.vFovToHFov(90, 1)).toBeCloseTo(90, 10);
        expect(pano.hFovToVFov(63.5, 1)).toBeCloseTo(63.5, 10);
    });

    test('at the Explore-canvas aspect they match the longhand 3:2 conversion, pinning desktop behavior', () => {
        for (const vFov of [10, 45, 67.4, 90]) {
            expect(pano.vFovToHFov(vFov, util.EXPLORE_CANVAS_ASPECT_RATIO)).toBeCloseTo(hFovOnExploreCanvas(vFov), 10);
        }
    });

    test('round-trips through any aspect', () => {
        for (const aspect of [0.46, 1, 1.5, 2.2]) {
            for (const vFov of [15, 60, 90, 120]) {
                expect(pano.hFovToVFov(pano.vFovToHFov(vFov, aspect), aspect)).toBeCloseTo(vFov, 8);
            }
        }
    });

    test('a portrait viewport shows a narrower horizontal field than its vertical one', () => {
        const portrait = 390 / 844;
        expect(pano.vFovToHFov(90, portrait)).toBeLessThan(90);
        // And the wider the viewport, the wider the horizontal field for the same vertical one.
        expect(pano.vFovToHFov(90, 1.5)).toBeGreaterThan(pano.vFovToHFov(90, portrait));
    });
});

/**
 * Loads PanoViewer + MapillaryViewer fresh into the jsdom global scope.
 * @returns {{PanoViewer: Function, MapillaryViewer: Function}}
 */
function loadViewers() {
    const panoViewerSrc = fs.readFileSync(path.join(SRC_DIR, 'PanoViewer.js'), 'utf8');
    const mapillarySrc = fs.readFileSync(path.join(SRC_DIR, 'MapillaryViewer.js'), 'utf8');
    window.eval(`
        class GsvViewer {}
        class Infra3dViewer {}
        class PannellumViewer {}
        class PanoramaxViewer {}
        ${panoViewerSrc}
        ${mapillarySrc}
        window.PanoViewer = PanoViewer;
        window.MapillaryViewer = MapillaryViewer;
    `);
    return { PanoViewer: window.PanoViewer, MapillaryViewer: window.MapillaryViewer };
}

/** A MapillaryViewer poked into a renderable state without a real SDK viewer behind it. */
function bareMapillaryViewer(overrides = {}) {
    const { MapillaryViewer } = loadViewers();
    const viewer = new MapillaryViewer();
    viewer.viewer = { setCenter: jest.fn(), setFieldOfView: jest.fn() };
    viewer.currCameraHeading = 180;
    viewer.currCenter = [0.5, 0.5];
    viewer.currVerticalFov = 90;
    return Object.assign(viewer, overrides);
}

describe('PanoViewer._viewportAspect', () => {
    test('measures the element the viewer was mounted into', () => {
        const viewer = bareMapillaryViewer();
        viewer.canvasElem = {
            getBoundingClientRect: () => ({ width: 390, height: 844 }),
        };
        expect(viewer._viewportAspect()).toBeCloseTo(390 / 844, 10);
    });

    test('falls back to the Explore-canvas ratio when the element has no measurable box', () => {
        const viewer = bareMapillaryViewer();
        viewer.canvasElem = { getBoundingClientRect: () => ({ width: 0, height: 0 }) }; // display: none
        expect(viewer._viewportAspect()).toBe(util.EXPLORE_CANVAS_ASPECT_RATIO);
        viewer.canvasElem = undefined; // never mounted
        expect(viewer._viewportAspect()).toBe(util.EXPLORE_CANVAS_ASPECT_RATIO);
    });
});

// A landscape phone: wide enough to push both the fov floor and the sub-zero end of the zoom range.
const LANDSCAPE_ASPECT = 844 / 310;

describe('MapillaryViewer aspect wiring', () => {
    test('getPov converts through the cached render-camera aspect, not a constant', () => {
        const portraitZoom = bareMapillaryViewer({ currAspect: 390 / 844 }).getPov().zoom;
        const desktopZoom = bareMapillaryViewer({ currAspect: 1.5 }).getPov().zoom;
        // Same vertical fov renders a narrower horizontal field on portrait, i.e. a higher zoom.
        expect(portraitZoom).toBeGreaterThan(desktopZoom);
        expect(desktopZoom).toBeCloseTo(pano.fovToZoom(hFovOnExploreCanvas(90)), 10);
    });

    test('setPov mirrors the 90° ceiling of what Mapillary renders, so getPov reports the rendered zoom', () => {
        const viewer = bareMapillaryViewer({ currAspect: 390 / 844 });
        // On a portrait viewport, zoom 1 (hFov 90°) needs a vertical fov far beyond what Mapillary renders.
        viewer.setPov({ heading: 0, pitch: 0, zoom: 1 });
        expect(viewer.currVerticalFov).toBe(90);
        // The read-back zoom is the clamped (rendered) one, and round-trips through getPov→setPov stably.
        const renderedZoom = viewer.getPov().zoom;
        expect(renderedZoom).toBeGreaterThan(1);
        viewer.setPov({ heading: 0, pitch: 0, zoom: renderedZoom });
        expect(viewer.getPov().zoom).toBeCloseTo(renderedZoom, 8);
    });

    test('setPov mirrors the 14.25° floor too, which a wide viewport hits at our max zoom', () => {
        const viewer = bareMapillaryViewer({ currAspect: LANDSCAPE_ASPECT });
        // Mapillary caps zoom at 3, rendering fov = 2·atan(1/8); our zoom 3 asks for a narrower field than that.
        viewer.setPov({ heading: 0, pitch: 0, zoom: 3 });
        expect(viewer.currVerticalFov).toBeCloseTo(util.math.toDegrees(2 * Math.atan(1 / 8)), 10);
        const renderedZoom = viewer.getPov().zoom;
        expect(renderedZoom).toBeLessThan(3);
        viewer.setPov({ heading: 0, pitch: 0, zoom: renderedZoom });
        expect(viewer.getPov().zoom).toBeCloseTo(renderedZoom, 8);
    });

    test('a viewport wider than ~2:1 reports a negative zoom, which still round-trips', () => {
        const viewer = bareMapillaryViewer({ currAspect: LANDSCAPE_ASPECT });
        const zoom = viewer.getPov().zoom; // Fully zoomed out (vertical fov 90°) on a landscape phone.
        expect(zoom).toBeLessThan(0);
        viewer.setPov({ heading: 0, pitch: 0, zoom });
        expect(viewer.getPov().zoom).toBeCloseTo(zoom, 8);
    });

    test('an unclamped zoom passes through the cache untouched', () => {
        const viewer = bareMapillaryViewer({ currAspect: 1.5 });
        viewer.setPov({ heading: 0, pitch: 0, zoom: 3 });
        expect(viewer.viewer.setFieldOfView).toHaveBeenCalledWith(viewer.currVerticalFov);
        expect(viewer.getPov().zoom).toBeCloseTo(3, 8);
    });
});
