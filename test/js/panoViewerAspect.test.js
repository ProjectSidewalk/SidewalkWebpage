/**
 * Tests for the viewport-aspect side of the fov↔zoom conversion (#4852).
 *
 * Mapillary and Infra3D express their camera in *vertical* fov while our zoom levels are defined in
 * *horizontal*-fov terms, and the bridge between the two is the viewport's width:height ratio. The bug being
 * pinned here: the viewers converted through the fixed Explore-canvas ratio (1.5), which is only correct on a
 * 3:2 viewport — on portrait mobile (~0.46) the zoom recorded/consumed disagreed with what the marker
 * projection assumed, producing marker offsets that grew toward the canvas edges in Mapillary cities.
 *
 * Three layers, matching how the fix is built:
 *   1. util.pano.vFovToHFov / hFovToVFov — the pure math, including the desktop-parity property (at aspect 1.5
 *      they must reproduce what the old hardcoded conversion computed, so desktop behavior is unchanged).
 *   2. PanoViewer._viewportAspect — the live measurement with its can't-measure fallback.
 *   3. MapillaryViewer.getPov/setPov — the wiring: conversions read the cached render-camera aspect, and the
 *      cached vertical fov mirrors Mapillary's own [0, 90]° clamp so getPov() never reports a zoom the viewer
 *      isn't actually showing.
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

/** The conversion exactly as the viewers wrote it before it became aspect-aware — the desktop-parity oracle. */
function legacyVFovToHFov(verticalFov) {
    return util.math.toDegrees(
        2 * Math.atan(Math.tan(util.math.toRadians(verticalFov / 2)) * util.EXPLORE_CANVAS_ASPECT_RATIO),
    );
}

describe('util.pano.vFovToHFov / hFovToVFov', () => {
    test('a square viewport renders the same field horizontally and vertically', () => {
        expect(pano.vFovToHFov(90, 1)).toBeCloseTo(90, 10);
        expect(pano.hFovToVFov(63.5, 1)).toBeCloseTo(63.5, 10);
    });

    test('at the Explore-canvas aspect they reproduce the old hardcoded conversion, so desktop is unchanged', () => {
        for (const vFov of [10, 45, 67.4, 90]) {
            expect(pano.vFovToHFov(vFov, util.EXPLORE_CANVAS_ASPECT_RATIO)).toBeCloseTo(legacyVFovToHFov(vFov), 10);
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

describe('MapillaryViewer aspect wiring', () => {
    test('getPov converts through the cached render-camera aspect, not a constant', () => {
        const portraitZoom = bareMapillaryViewer({ currAspect: 390 / 844 }).getPov().zoom;
        const desktopZoom = bareMapillaryViewer({ currAspect: 1.5 }).getPov().zoom;
        // Same vertical fov renders a narrower horizontal field on portrait, i.e. a higher zoom.
        expect(portraitZoom).toBeGreaterThan(desktopZoom);
        expect(desktopZoom).toBeCloseTo(pano.fovToZoom(legacyVFovToHFov(90)), 10);
    });

    test('setPov mirrors Mapillary\'s [0, 90]° clamp in the cache, so getPov reports the rendered zoom', () => {
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

    test('an unclamped zoom passes through the cache untouched', () => {
        const viewer = bareMapillaryViewer({ currAspect: 1.5 });
        viewer.setPov({ heading: 0, pitch: 0, zoom: 3 });
        expect(viewer.viewer.setFieldOfView).toHaveBeenCalledWith(viewer.currVerticalFov);
        expect(viewer.getPov().zoom).toBeCloseTo(3, 8);
    });
});
