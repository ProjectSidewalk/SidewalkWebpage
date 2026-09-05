/**
 * Pins the recorded GSV FOV-vs-aspect measurements (issue #5083) against the projection code in
 * public/js/common/pano-viewer/src/panoUtilities.js. The fixture (test/js/fixtures/gsvFovMeasurements.json)
 * holds focal lengths measured from live GSV rendering by tools/gsv-fov-probe/; its README has the protocol,
 * the regeneration steps, and when a re-record is called for.
 *
 * What this suite catches: a change to panoUtilities.js (or to the width-spanning assumption it encodes) that
 * stops agreeing with the recorded measurements, and a regenerated fixture whose verdict, clamp bounds, or
 * cells moved. What it does NOT catch: Google changing the renderer — every number here comes from the frozen
 * fixture, so renderer drift shows up only in a fresh probe run, and in production as markers drifting at
 * non-3:2 aspects. CI runs the jest suite as a blocking step in the `frontend` job
 * (docs/testing-and-ci.md), so a code change that breaks the contract stops a merge — but nothing in CI
 * watches Google's renderer, and a green run here is not evidence that it has not moved.
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
loadGlobalScript('public/js/common/utilitiesMath.js'); // hFovToVFov/vFovToHFov use util.math.to{Degrees,Radians}.
loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');
const pano = window.util.pano;

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures', 'gsvFovMeasurements.json');
// The suite self-skips while the recorded fixture doesn't exist yet (it is produced by a completed probe
// sweep via `analyze.mjs --emit-fixture`), so an in-progress experiment branch keeps the jest tree green.
const fixture = fs.existsSync(FIXTURE_PATH) ? JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) : null;
const describeWithFixture = fixture ? describe : describe.skip;

// Agreement required between a measured hFov and the contract's prediction. The worst residual across the
// fixture's 120 dpr-1 configs is 0.153° (teaneck-residential/square-480x480 at zoom 1 — the app's zoom-1
// curve constant reads ~0.13° low, the same class of error as the zoom-3 one below but a fifth the size),
// so this carries better than 2x headroom over the measurements while still biting: the hypotheses the probe
// separated are 5°-50° apart. Per-config it widens to 3 bootstrap sigmas for noisier cells, mirroring
// VERDICT_INVARIANCE_TOL_DEG's 3-sigma widening in tools/gsv-fov-probe/analyze.mjs.
const CONTRACT_TOL_DEG = 0.35;

// The clamp window the verdict reports, as literals rather than reads of fixture.clamp: a regenerated
// fixture whose bounds moved must fail here instead of quietly re-deriving its own expectation.
const CLAMP_FLOOR_DEG = 14.97;
const CLAMP_CEILING_DEG = 89.84;
const CLAMP_BOUND_TOL_DEG = 0.05;

// The aspect at which each clamp bound starts binding, per zoom — the engineering deliverable #5085 consumes
// (tools/gsv-fov-probe/README.md, "Where the clamp bites"). Derived from the measured control hFovs and the
// clamp window; pinned here so neither input can drift without this failing.
const FLOOR_BINDS_AT_ASPECT = {1: 7.59, 2: 3.80, 3: 1.90};
const CEILING_BINDS_AT_ASPECT = {1: 1.00, 2: 0.50, 3: 0.25};
const BINDING_ASPECT_TOL = 0.02;

/**
 * Measurement tolerance for one config, in degrees.
 * @param {object} cfg - Fixture config.
 * @returns {number} Tolerance in degrees.
 */
function tolDeg(cfg) {
    const toFov = (f) => 2 * Math.atan(cfg.width / (2 * f)) * 180 / Math.PI;
    // A config with no usable bootstrap CI is a hole in the evidence, not a config that tolerates anything;
    // it falls back to the flat tolerance here and fails the provenance test outright.
    const sigma = (toFov(cfg.ciLo) - toFov(cfg.ciHi)) / 2 / 1.96;
    return Number.isFinite(sigma) ? Math.max(CONTRACT_TOL_DEG, 3 * sigma) : CONTRACT_TOL_DEG;
}

/**
 * The 3:2 hFov the contract is anchored on for a zoom. Zooms 1-2 use the app's own curve, which the
 * measurements reproduce to under 0.14°. Zoom 3 uses the MEASURED control hFov: `zoomToFov(3)` returns
 * 27.682° against a measured 28.03°, a 0.35° error in the legacy fitted constant (issue #5083, bonus finding
 * 1). Absorbing that error into the tolerance instead would triple it and stop this suite from biting.
 * @param {number} zoom - Explore zoom level.
 * @returns {number} Reference hFov in degrees at the 3:2 calibration aspect.
 */
function referenceHFov(zoom) {
    return zoom === 3 ? fixture.controlHFovDeg[zoom] : pano.zoomToFov(zoom);
}

/**
 * The horizontal FOV the measured verdict predicts for a config, anchored on the 3:2 reference (where all
 * candidate contracts coincide).
 * @param {object} cfg - Fixture config.
 * @returns {number} Predicted hFov in degrees.
 */
function predictedHFov(cfg) {
    const curve = referenceHFov(cfg.zoom);
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
            if (unclampedV > CLAMP_CEILING_DEG) return pano.vFovToHFov(CLAMP_CEILING_DEG, aspect);
            if (unclampedV < CLAMP_FLOOR_DEG) return pano.vFovToHFov(CLAMP_FLOOR_DEG, aspect);
            return curve;
        }
        default:
            throw new Error(
                `Unpinnable verdict "${fixture.verdict}" — regenerate via tools/gsv-fov-probe (see its ` +
                'README) and, if the verdict really changed, update this suite and issue #5083.');
    }
}

/** @returns {boolean} Whether the width-pinned vFov for this config sits inside the clamp window. */
function unclamped(cfg) {
    const v = pano.hFovToVFov(referenceHFov(cfg.zoom), cfg.width / cfg.height);
    return v <= CLAMP_CEILING_DEG && v >= CLAMP_FLOOR_DEG;
}

describeWithFixture('GSV FOV contract (recorded fixture, #5083)', () => {
    test('fixture carries its provenance', () => {
        expect(typeof fixture.generatedAt).toBe('string');
        expect(typeof fixture.mapsVersion).toBe('string');
        expect(fixture.configs.length).toBeGreaterThan(0);
        expect(fixture.gates.method).toBe(true);
        expect(fixture.gates.anisotropy).toBe(true);
        expect(fixture.gates.seed).toBe(true);
        // Every config must carry a usable bootstrap CI: tolDeg is derived from it, and a cell that produced
        // fewer than two bootstrap clusters is a measurement the fixture should not be pinning anything on.
        const noCi = fixture.configs.filter((c) => !Number.isFinite(c.ciLo) || !Number.isFinite(c.ciHi))
            .map((c) => `${c.pano}/${c.container}/zoom${c.zoom}`);
        expect(noCi).toEqual([]);
        // The model gate carries one known, diagnosed exceedance (probe README, amendment 4): sub-pixel
        // estimator bias on the design's smallest image displacement — square-480x480 at zoom 1, where
        // f ≈ 240 px puts a 1° rotation at ~4 px — bounded at ≤0.25° of FOV. Pin exactly that envelope so
        // any new or larger exceedance in a regenerated fixture still fails here.
        for (const e of fixture.gates.modelExceedances) {
            expect(e.container).toBe('square-480x480');
            expect(e.zoom).toBe(1);
            expect(e.deltaSpread).toBeLessThan(0.007);
        }
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

    test('every unclamped measurement matches the width-spanning assumption in the code', () => {
        // In the unclamped regime the code's `f = (canvasWidth/2)/tan(hFov/2)` is exact: hFov does not move
        // with aspect at all.
        const cfgs = fixture.configs.filter((c) => c.dpr === 1 && unclamped(c));
        expect(cfgs.length).toBeGreaterThan(0);
        expect(violations(cfgs, (cfg) => Math.abs(cfg.hFovDeg - referenceHFov(cfg.zoom)))).toEqual([]);
    });

    test('every measurement matches the verdict contract, portrait included', () => {
        const all = fixture.configs.filter((c) => c.dpr === 1);
        expect(violations(all, (cfg) => Math.abs(cfg.hFovDeg - predictedHFov(cfg)))).toEqual([]);
    });

    test('the clamp window is the one the verdict reports, and its binding cells agree on it', () => {
        expect(Math.abs(fixture.clamp.floorDeg - CLAMP_FLOOR_DEG)).toBeLessThanOrEqual(CLAMP_BOUND_TOL_DEG);
        expect(Math.abs(fixture.clamp.ceilingDeg - CLAMP_CEILING_DEG)).toBeLessThanOrEqual(CLAMP_BOUND_TOL_DEG);
        expect(fixture.clamp.nFloorCells).toBeGreaterThan(0);
        expect(fixture.clamp.nCeilingCells).toBeGreaterThan(0);
        // Separately from the bounds' values: the cells that bind a bound must agree with each other on it.
        // A wide spread would mean the bound is not a single constant (e.g. it is zoom- or size-dependent).
        const spread = (cfgs) => (cfgs.length ? Math.max(...cfgs) - Math.min(...cfgs) : 0);
        const dpr1 = fixture.configs.filter((c) => c.dpr === 1);
        const floorCells = dpr1.filter((c) =>
            pano.hFovToVFov(referenceHFov(c.zoom), c.width / c.height) < CLAMP_FLOOR_DEG);
        const ceilingCells = dpr1.filter((c) =>
            pano.hFovToVFov(referenceHFov(c.zoom), c.width / c.height) > CLAMP_CEILING_DEG);
        expect(floorCells.length).toBeGreaterThan(0);
        expect(ceilingCells.length).toBeGreaterThan(0);
        expect(spread(floorCells.map((c) => c.vFovDeg))).toBeLessThan(0.1);
        expect(spread(ceilingCells.map((c) => c.vFovDeg))).toBeLessThan(0.2);
    });

    test('the per-zoom clamp binding aspects are the ones #5085 consumes', () => {
        // tan(hFov/2)/tan(bound/2) is the aspect at which the width-pinned vFov reaches the bound. Recompute
        // it from the fixture's own clamp window and measured control hFovs, and pin the result.
        const tanHalf = (deg) => Math.tan(deg / 2 * Math.PI / 180);
        const off = [];
        for (const zoom of [1, 2, 3]) {
            const hFov = fixture.controlHFovDeg[zoom];
            expect(Number.isFinite(hFov)).toBe(true);
            const floorAspect = tanHalf(hFov) / tanHalf(fixture.clamp.floorDeg);
            const ceilingAspect = tanHalf(hFov) / tanHalf(fixture.clamp.ceilingDeg);
            if (Math.abs(floorAspect - FLOOR_BINDS_AT_ASPECT[zoom]) > BINDING_ASPECT_TOL) {
                off.push({ zoom, bound: 'floor', derived: +floorAspect.toFixed(3) });
            }
            if (Math.abs(ceilingAspect - CEILING_BINDS_AT_ASPECT[zoom]) > BINDING_ASPECT_TOL) {
                off.push({ zoom, bound: 'ceiling', derived: +ceilingAspect.toFixed(3) });
            }
        }
        expect(off).toEqual([]);
        // The analyzer emits the same table into results.json and the fixture; a disagreement between the
        // two derivations means one of them changed.
        for (const row of fixture.bindingAspects) {
            expect(Math.abs(row.floorBindsAtAspectAtLeast - FLOOR_BINDS_AT_ASPECT[row.zoom]))
                .toBeLessThanOrEqual(BINDING_ASPECT_TOL);
            expect(Math.abs(row.ceilingBindsAtAspectAtMost - CEILING_BINDS_AT_ASPECT[row.zoom]))
                .toBeLessThanOrEqual(BINDING_ASPECT_TOL);
        }
    });

    test('FOV is pinned in CSS pixels, not backing-store pixels (DPR-2 config)', () => {
        const dpr2 = fixture.configs.filter((c) => c.dpr === 2);
        expect(dpr2.length).toBeGreaterThan(0);
        // A dpr-2 config with no dpr-1 partner is a missing comparison, not a passing one — report it as an
        // offender rather than dropping it, or this test passes vacuously on a thinner fixture.
        const offenders = dpr2.map((cfg) => {
            const control = fixture.configs.find((c) => c.pano === cfg.pano && c.zoom === cfg.zoom &&
                c.dpr === 1 && c.width === cfg.width && c.height === cfg.height);
            const name = `${cfg.pano}/zoom${cfg.zoom}`;
            if (!control) return { name, reason: 'no dpr-1 control' };
            const relDiff = Math.abs(cfg.fPx - control.fPx) / control.fPx;
            return relDiff >= 0.002 ? { name, relDiff: +relDiff.toFixed(5) } : null;
        }).filter(Boolean);
        expect(offenders).toEqual([]);
    });

    test('the measured curve pins the app zoomToFov at the calibration aspect', () => {
        const controls = fixture.configs.filter((c) => c.container === 'control-720x480' && c.dpr === 1);
        expect(controls.length).toBeGreaterThan(0);
        // Zooms 1-2: the app's fitted curve reproduces the measurement.
        expect(violations(controls.filter((c) => c.zoom !== 3),
            (cfg) => Math.abs(cfg.hFovDeg - pano.zoomToFov(cfg.zoom)))).toEqual([]);
        // Zoom 3: it does not. The measured 28.03° against the curve's 27.682° is issue #5083's bonus
        // finding 1 — the legacy `195.93 / 1.92^zoom` constant is 0.35° low. Pinned as a known, bounded
        // error in BOTH directions: correcting the constant is a tracked follow-up, and this fails when it
        // lands (update the expectation then) as well as if the gap ever grows.
        for (const cfg of controls.filter((c) => c.zoom === 3)) {
            expect(cfg.hFovDeg - pano.zoomToFov(3)).toBeGreaterThan(0.25);
            expect(cfg.hFovDeg - pano.zoomToFov(3)).toBeLessThan(0.45);
        }
    });

    test('the analyzer measures against the same zoomToFov curve the app renders with', () => {
        // tools/gsv-fov-probe/analyze.mjs keeps its own copy of the curve (it is an ES module run outside
        // jsdom and cannot load panoUtilities.js). Nothing links the two definitions, and the tracked
        // zoom-3 correction would silently desync them — so compare them here.
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'tools/gsv-fov-probe/analyze.mjs'), 'utf8');
        const match = src.match(/const zoomToFov = \(zoom\) =>\s*(\([^;]*?\));/);
        expect(match).not.toBeNull();
        const analyzerCurve = new Function('zoom', `return ${match[1]};`);
        for (const zoom of [1, 2, 3]) {
            expect(analyzerCurve(zoom)).toBeCloseTo(pano.zoomToFov(zoom), 10);
        }
    });
});
