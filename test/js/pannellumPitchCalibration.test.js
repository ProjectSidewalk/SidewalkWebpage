/**
 * Tests that PannellumViewer's POV maps to the panorama with no camera-pitch term (#5174).
 *
 * A pano's column 0 sits at an arbitrary bearing, so yaw must be calibrated against cameraHeading. Row
 * panoHeight/2 is the horizon by construction, so pitch must NOT be calibrated against cameraPitch — and every
 * other component that maps a row to a pitch agrees (util.pano.povToPanoCoord, PanoDataService
 * .calculatePovFromPanoXY, CropGeometry.computeCropBox). Applying one displaced Validate's label marker by
 * camera_pitch, which is nonzero on ~98% of panos.
 *
 * These cases only bite on a pano with a nonzero cameraPitch: with the zero-tilt fixtures the other suites use,
 * both conventions produce identical numbers, which is exactly why this went unnoticed.
 *
 * The viewers are top-level `class` declarations written for the Grunt-concatenation world, so the sources are
 * eval'd into the jsdom global scope with a stubbed pannellum library underneath.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');

window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
loadGlobalScript('public/js/common/utilities.js');
loadGlobalScript('public/js/common/utilitiesMath.js');
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');

const CAMERA_PITCH = 8.5;    // degrees; near the top of the real distribution
const CAMERA_HEADING = 104.9;

/** A stand-in for the pannellum library that records the pitch/yaw it is actually driven with. */
function makeFakePannellum() {
    const state = { pitch: 0, yaw: 0, hfov: 90, handlers: {} };
    const viewer = {
        getPitch: () => state.pitch,
        setPitch: (p) => { state.pitch = p; },
        getYaw: () => state.yaw,
        setYaw: (y) => { state.yaw = y; },
        getHfov: () => state.hfov,
        setHfov: (h) => { state.hfov = h; },
        addScene: () => {},
        removeScene: () => {},
        loadScene: (id, pitch, yaw, hfov) => { state.pitch = pitch; state.yaw = yaw; state.hfov = hfov; },
        on: (evt, cb) => { state.handlers[evt] = cb; if (evt === 'load') setTimeout(cb, 0); },
        off: () => {},
        destroy: () => {},
    };
    return {
        state,
        lib: {
            viewer: (el, config) => {
                // Pannellum applies the default scene's pitch/yaw/hfov on construction; mirror that so the
                // startup path is actually exercised rather than silently leaving state at its defaults.
                const scene = config && config.scenes && config.scenes[config.default.firstScene];
                if (scene) {
                    state.pitch = scene.pitch;
                    state.yaw = scene.yaw;
                    state.hfov = scene.hfov;
                }
                return viewer;
            },
        },
    };
}

async function makeViewer() {
    const { state, lib } = makeFakePannellum();
    window.pannellum = lib;
    // PanoData wraps captureDate in moment() and validates it with `instanceof moment`, so the stub has to hand
    // back something on its own prototype chain. Nothing here reads the formatted value.
    window.moment = function moment(v) {
        const m = Object.create(window.moment.prototype);
        m.format = () => String(v);
        return m;
    };
    window.eval(`
        class GsvViewer {}
        class MapillaryViewer {}
        class Infra3dViewer {}
        ${fs.readFileSync(path.join(SRC_DIR, 'PanoData.js'), 'utf8')}
        ${fs.readFileSync(path.join(SRC_DIR, 'PanoViewer.js'), 'utf8')}
        ${fs.readFileSync(path.join(SRC_DIR, 'PannellumViewer.js'), 'utf8')}
        window.PannellumViewer = PannellumViewer;
    `);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const v = new window.PannellumViewer();
    await v.initialize(el, {
        panoMetadata: {
            panoId: 'p1', imageUrl: '/backupImage/p1', width: 13312, height: 6656,
            cameraHeading: CAMERA_HEADING, cameraPitch: CAMERA_PITCH,
            lat: 40.9, lng: -74.0, captureDate: '2023-05', linkedPanos: [], history: [], source: 'pannellum',
        },
        startPitch: 0,
        startZoom: 1,
    });
    return { viewer: v, state };
}

describe('PannellumViewer pitch is not calibrated against cameraPitch', () => {
    test('setPov drives the library with the pitch it was given, unshifted', async () => {
        const { viewer, state } = await makeViewer();

        viewer.setPov({ heading: CAMERA_HEADING, pitch: -20.28, zoom: 1 });

        expect(state.pitch).toBeCloseTo(-20.28, 6);
    });

    test('getPov reports the library pitch unshifted', async () => {
        const { viewer, state } = await makeViewer();

        // Driven directly rather than via setPov: a matched subtract-on-write/add-on-read pair round-trips
        // perfectly, so only reading a pitch the viewer did not write catches a calibration term here.
        state.pitch = -20.28;

        expect(viewer.getPov().pitch).toBeCloseTo(-20.28, 6);
    });

    test('the initial scene opens at the requested pitch', async () => {
        const { state } = await makeViewer();

        // startPitch was 0: the horizon, which is row panoHeight/2 of the stored image.
        expect(state.pitch).toBeCloseTo(0, 6);
    });

    test('heading IS still calibrated against cameraHeading — the asymmetry is deliberate', async () => {
        const { viewer, state } = await makeViewer();

        viewer.setPov({ heading: CAMERA_HEADING, pitch: 0, zoom: 1 });

        // Looking down the pano's centre column is yaw 0, whatever bearing that column happens to be.
        expect(state.yaw).toBeCloseTo(0, 6);
        expect(viewer.getPov().heading).toBeCloseTo(CAMERA_HEADING, 6);
    });
});
