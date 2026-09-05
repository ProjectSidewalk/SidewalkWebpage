/**
 * Validates the #5083 focal-length estimator (tools/gsv-fov-probe/estimator.cjs) against synthetic ground
 * truth — gate 1 of the probe protocol (tools/gsv-fov-probe/README.md): the estimator must recover a known
 * focal length from analytically rendered pinhole pairs to better than 0.2% before any live GSV measurement
 * is trusted. The synthetic renderer samples an analytic texture (no source-image interpolation), so the
 * recovery error here is pure estimator error.
 */
const {
    fitFocal,
    crossShiftEstimate,
    fovsFromFocal,
    rgbaToGray,
    laplacianVariance,
    clusterBootstrapCI,
    median,
    madSigma,
    makeProceduralEquirectSampler,
    renderPinhole,
} = require('../../tools/gsv-fov-probe/estimator.cjs');

const W = 720;
const H = 480;
const sampler = makeProceduralEquirectSampler(5083);

/**
 * Renders a symmetric rotation pair around a base orientation.
 * @param {number} f - True focal length in px.
 * @param {number} headingDeg - Pair-center heading.
 * @param {number} deltaDeg - Full separation of the pair.
 * @param {'heading'|'pitch'} axis - Which angle the pair varies.
 * @returns {{grayA: Float64Array, grayB: Float64Array, povA: object, povB: object}} Pair plus orientations in
 *     radians as fitFocal expects them.
 */
function renderPair(f, headingDeg, deltaDeg, axis = 'heading') {
    const base = { f, headingDeg, pitchDeg: 0, width: W, height: H };
    const camA = { ...base }, camB = { ...base };
    if (axis === 'heading') {
        camA.headingDeg = headingDeg - deltaDeg / 2;
        camB.headingDeg = headingDeg + deltaDeg / 2;
    } else {
        camA.pitchDeg = -deltaDeg / 2;
        camB.pitchDeg = deltaDeg / 2;
    }
    const toRad = (deg) => deg * Math.PI / 180;
    return {
        grayA: renderPinhole(sampler, camA),
        grayB: renderPinhole(sampler, camB),
        povA: { heading: toRad(camA.headingDeg), pitch: toRad(camA.pitchDeg) },
        povB: { heading: toRad(camB.headingDeg), pitch: toRad(camB.pitchDeg) },
    };
}

describe('gsv-fov-probe estimator on synthetic ground truth', () => {
    test.each([
        [415, 2],   // ~ zoom 1 (hFov 90) at 720px wide.
        [722, 2],   // ~ zoom 2 (hFov 53).
        [1443, 4],  // ~ zoom 3 (hFov 28); wider delta for similar pixel shift.
    ])('recovers f=%s px from a %s-degree yaw pair to <0.2%%', (f, deltaDeg) => {
        const { grayA, grayB, povA, povB } = renderPair(f, 33, deltaDeg);
        const fit = fitFocal(grayA, grayB, W, H, povA, povB, { step: 2 });
        expect(Math.abs(fit.f - f) / f).toBeLessThan(0.002);
        expect(fit.ncc).toBeGreaterThan(0.98);
    });

    test('recovers f from a pitch pair (vertical focal length, anisotropy check path)', () => {
        const { grayA, grayB, povA, povB } = renderPair(722, 90, 2, 'pitch');
        const fit = fitFocal(grayA, grayB, W, H, povA, povB, { step: 2 });
        expect(Math.abs(fit.f - 722) / 722).toBeLessThan(0.002);
    });

    test('off-center region gives the same f as the central region (pinhole model check path)', () => {
        const { grayA, grayB, povA, povB } = renderPair(722, 210, 2);
        const central = fitFocal(grayA, grayB, W, H, povA, povB, { step: 2 });
        const offCenter = fitFocal(grayA, grayB, W, H, povA, povB, { step: 2, regionFrac: 0.3, centerX: 0.3 });
        expect(Math.abs(offCenter.f - central.f) / central.f).toBeLessThan(0.005);
    });

    test('cross-shift seed lands within its bracketing bound of the warp fit (~3%)', () => {
        // The seed is a whole-patch shift estimate, so the yaw shear across the patch biases it by O(1%)
        // (texture-weighted sec^2 variation). It only brackets the warp fit — the fit itself carries the
        // <0.2% requirement above — so the bound here is the bracket-safety margin, not a precision claim.
        const { grayA, grayB, povA, povB } = renderPair(600, 77, 2);
        const fit = fitFocal(grayA, grayB, W, H, povA, povB, { step: 2 });
        const seed = crossShiftEstimate(grayA, grayB, W, H, 2 * Math.PI / 180);
        expect(Math.abs(seed.f - fit.f) / fit.f).toBeLessThan(0.03);
    });

    test('fovsFromFocal round-trips the pinhole formulas', () => {
        const f = (W / 2) / Math.tan((90 / 2) * Math.PI / 180); // f that renders hFov = 90 at 720px.
        const { hFovDeg, vFovDeg } = fovsFromFocal(f, W, H);
        expect(hFovDeg).toBeCloseTo(90, 10);
        expect(vFovDeg).toBeCloseTo(2 * Math.atan((H / 2) / f) * 180 / Math.PI, 10);
    });

    test('laplacianVariance ranks textured imagery above flat imagery', () => {
        const flat = new Float64Array(W * H).fill(128);
        const textured = renderPinhole(sampler, { f: 600, headingDeg: 0, pitchDeg: 0, width: W, height: H });
        expect(laplacianVariance(textured, W, H)).toBeGreaterThan(100 * laplacianVariance(flat, W, H) + 1);
    });

    test('rgbaToGray applies Rec. 601 luminance', () => {
        const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
        const g = rgbaToGray(rgba, 2, 1);
        expect(g[0]).toBeCloseTo(0.299 * 255, 6);
        expect(g[1]).toBeCloseTo(0.587 * 255, 6);
    });

    test('robust stats: median/MAD and a deterministic cluster bootstrap that respects clustering', () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(madSigma([1, 1, 1, 1])).toBe(0);
        const samples = [];
        for (let cluster = 0; cluster < 8; cluster++) {
            for (let i = 0; i < 3; i++) samples.push({ value: 700 + cluster, cluster: `c${cluster}` });
        }
        const ci1 = clusterBootstrapCI(samples, { nBoot: 2000 });
        const ci2 = clusterBootstrapCI(samples, { nBoot: 2000 });
        expect(ci1).toEqual(ci2); // Seeded, so reproducible.
        expect(ci1.lo).toBeLessThanOrEqual(ci1.median);
        expect(ci1.hi).toBeGreaterThanOrEqual(ci1.median);
        expect(ci1.median).toBeCloseTo(median(samples.map((s) => s.value)), 10);
    });
});
