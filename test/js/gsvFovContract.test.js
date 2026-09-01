/**
 * Pins the empirically measured GSV FOV-vs-aspect contract (issue #5083) against the projection code in
 * public/js/common/pano-viewer/src/panoUtilities.js. The fixture (test/js/fixtures/gsvFovMeasurements.json)
 * holds focal lengths measured from live GSV rendering by tools/gsv-fov-probe/ (its README has the protocol
 * and regeneration steps); the projection helpers assume the zoomToFov curve spans the container WIDTH, and
 * this suite asserts that assumption against the measurements for every aspect the fixture's `verdict`
 * covers — so a renderer-behavior change flips these tests loudly instead of drifting markers silently.
 */
const fs = require('fs');
const path = require('path');
const {loadGlobalScript} = require('./loadGlobalScript');

// utilities.js builds a Bowser parser at load time; nothing here consults it.
window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
loadGlobalScript('public/js/common/utilities.js');
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');
const pano = window.util.pano;

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures', 'gsvFovMeasurements.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

/**
 * Measurement tolerance for one config, in degrees: the pre-registered invariance tolerance, widened to 3
 * bootstrap sigmas when a config was noisier (mirrors tools/gsv-fov-probe/analyze.mjs).
 * @param {object} cfg - Fixture config.
 * @returns {number} Tolerance in degrees.
 */
function tolDeg(cfg) {
    const toFov = (f) => 2 * Math.atan(cfg.width / (2 * f)) * 180 / Math.PI;
    const sigma = Number.isFinite(cfg.ciLo) && Number.isFinite(cfg.ciHi)
        ? (toFov(cfg.ciLo) - toFov(cfg.ciHi)) / 2 / 1.96
        : Infinity;
    return Math.max(1.5, 3 * sigma);
}

/**
 * The horizontal FOV the measured verdict predicts for a config, anchored on the app's zoomToFov curve
 * (calibrated at 3:2, where all candidate contracts coincide).
 * @param {object} cfg - Fixture config.
 * @returns {number} Predicted hFov in degrees.
 */
function predictedHFov(cfg) {
    const curve = pano.zoomToFov(cfg.zoom);
    const aspect = cfg.width / cfg.height;
    switch (fixture.verdict) {
        case 'horizontal-pinned':
            return curve;
        case 'vertical-pinned':
            return pano.vFovToHFov(pano.hFovToVFov(curve, 1.5), aspect);
        case 'long-axis-pinned':
            // The curve spans the longer container axis: width for landscape, height for portrait.
            return aspect >= 1 ? curve : pano.vFovToHFov(curve, aspect);
        case 'short-axis-pinned':
            return aspect >= 1 ? pano.vFovToHFov(curve, aspect) : curve;
        case 'width-pinned-vfov-clamped': {
            // Width-pinned, but the implied vFov is clamped to the measured [floor, ceiling] window; a
            // binding bound takes over the pin (see tools/gsv-fov-probe/README.md amendment 2).
            const unclampedV = pano.hFovToVFov(curve, aspect);
            const { ceilingDeg, floorDeg } = fixture.clamp;
            if (ceilingDeg != null && unclampedV > ceilingDeg) return pano.vFovToHFov(ceilingDeg, aspect);
            if (floorDeg != null && unclampedV < floorDeg) return pano.vFovToHFov(floorDeg, aspect);
            return curve;
        }
        default:
            throw new Error(
                `Unpinnable verdict "${fixture.verdict}" — regenerate via tools/gsv-fov-probe (see its ` +
                'README) and, if the verdict really changed, update this suite and issue #5083.');
    }
}

describe('GSV FOV contract (recorded fixture, #5083)', () => {
    test('fixture carries its provenance', () => {
        expect(typeof fixture.generatedAt).toBe('string');
        expect(typeof fixture.mapsVersion).toBe('string');
        expect(fixture.configs.length).toBeGreaterThan(0);
        expect(fixture.gates).toEqual({ method: true, model: true, anisotropy: true });
    });

    test('the recorded verdict is the one this suite (and the projection code) encodes', () => {
        // If a regenerated fixture flips this, GSV's renderer contract changed: re-run the probe, re-read
        // issue #5083, and revisit every consumer of zoomToFov before touching this assertion.
        expect(fixture.verdict).toBe('width-pinned-vfov-clamped');
    });

    // Collected rather than asserted per-config so one failure names every offender at once.
    function violations(configs, errOf) {
        return configs
            .map((cfg) => ({ name: `${cfg.pano}/${cfg.container}/zoom${cfg.zoom}`,
                errDeg: +errOf(cfg).toFixed(3), tolDeg: +tolDeg(cfg).toFixed(3) }))
            .filter((v) => v.errDeg > v.tolDeg);
    }

    // In the unclamped regime (width-pinned vFov inside the measured clamp window), the code's
    // width-spanning assumption is exact.
    function unclamped(cfg) {
        const v = pano.hFovToVFov(pano.zoomToFov(cfg.zoom), cfg.width / cfg.height);
        const { ceilingDeg, floorDeg } = fixture.clamp ?? {};
        return (ceilingDeg == null || v <= ceilingDeg) && (floorDeg == null || v >= floorDeg);
    }

    test('every unclamped measurement matches the width-spanning zoomToFov assumption in the code', () => {
        const cfgs = fixture.configs.filter((c) => c.dpr === 1 && unclamped(c));
        expect(cfgs.length).toBeGreaterThan(0);
        expect(violations(cfgs, (cfg) => Math.abs(cfg.hFovDeg - pano.zoomToFov(cfg.zoom)))).toEqual([]);
    });

    test('every measurement matches the verdict contract, portrait included', () => {
        const all = fixture.configs.filter((c) => c.dpr === 1);
        expect(violations(all, (cfg) => Math.abs(cfg.hFovDeg - predictedHFov(cfg)))).toEqual([]);
    });

    test('FOV is pinned in CSS pixels, not backing-store pixels (DPR-2 config)', () => {
        const dpr2 = fixture.configs.filter((c) => c.dpr === 2);
        expect(dpr2.length).toBeGreaterThan(0);
        const offenders = dpr2.map((cfg) => {
            const control = fixture.configs.find((c) => c.pano === cfg.pano && c.zoom === cfg.zoom &&
                c.dpr === 1 && c.width === cfg.width && c.height === cfg.height);
            return control
                ? { name: `${cfg.pano}/zoom${cfg.zoom}`, relDiff: Math.abs(cfg.fPx - control.fPx) / control.fPx }
                : null;
        }).filter((v) => v && v.relDiff >= 0.01);
        expect(offenders).toEqual([]);
    });

    test('the measured curve validates zoomToFov itself at the calibration aspect', () => {
        // The 3:2 control cells double as an empirical pin of the {89.75, 53, 28} curve the whole app uses.
        const controls = fixture.configs.filter((c) => c.container === 'control-720x480' && c.dpr === 1);
        expect(controls.length).toBeGreaterThan(0);
        expect(violations(controls, (cfg) => Math.abs(cfg.hFovDeg - pano.zoomToFov(cfg.zoom)))).toEqual([]);
    });
});
