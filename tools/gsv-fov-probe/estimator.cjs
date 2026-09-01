/**
 * Focal-length estimation from image pairs related by a known camera rotation (issue #5083).
 *
 * Given two screenshots of the same panorama taken at slightly different headings (or pitches), and the exact
 * rotation between them, the rendered focal length f (in pixels) is the single free parameter of the pinhole
 * reprojection that maps one image onto the other. We estimate f by maximizing normalized cross-correlation
 * (NCC) between image A and image B warped into A's frame under the candidate f. From f, the horizontal /
 * vertical / diagonal fields of view of the rendering follow directly:
 *
 *   hFov = 2*atan(W / 2f),  vFov = 2*atan(H / 2f),  dFov = 2*atan(sqrt((W/2)^2 + (H/2)^2) / f)
 *
 * which is what the #5083 experiment compares across container aspect ratios.
 *
 * Pure computation on grayscale Float64Array images — no I/O, no DOM, no dependencies — so the jest suite can
 * unit-test the estimator against synthetically rendered ground truth (see makeProceduralEquirectSampler /
 * renderPinhole below and test/js/gsvFovProbeEstimator.test.js).
 *
 * Conventions: image x grows right, y grows down; camera frame is x right, y down, z forward (optical axis);
 * heading grows clockwise (a heading increase moves scene content left); pitch grows upward (a pitch increase
 * moves scene content down). Angles are radians everywhere except the *Deg helpers.
 */
'use strict';

const DEG_TO_RAD = Math.PI / 180;

// --- Small linear algebra -------------------------------------------------------------------------------------

/**
 * Rotation about the y (down) axis: maps (0,0,1) to (sin a, 0, cos a).
 * @param {number} a - Angle in radians.
 * @returns {number[]} Row-major 3x3 matrix.
 */
function rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/**
 * Rotation about the x (right) axis: maps (0,0,1) to (0, -sin a, cos a).
 * @param {number} a - Angle in radians.
 * @returns {number[]} Row-major 3x3 matrix.
 */
function rotX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [1, 0, 0, 0, c, -s, 0, s, c];
}

/**
 * @param {number[]} m - Row-major 3x3.
 * @param {number[]} n - Row-major 3x3.
 * @returns {number[]} m * n, row-major 3x3.
 */
function matMul(m, n) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            r[3 * i + j] = m[3 * i] * n[j] + m[3 * i + 1] * n[3 + j] + m[3 * i + 2] * n[6 + j];
        }
    }
    return r;
}

/**
 * Rotation taking camera-A-frame directions to camera-B-frame directions, for cameras with the given
 * headings/pitches: R = Rx(-pitchB) * Ry(headingA - headingB) * Rx(pitchA).
 *
 * @param {{heading: number, pitch: number}} povA - Camera A orientation, radians.
 * @param {{heading: number, pitch: number}} povB - Camera B orientation, radians.
 * @returns {number[]} Row-major 3x3 matrix.
 */
function rotationAToB(povA, povB) {
    return matMul(rotX(-povB.pitch), matMul(rotY(povA.heading - povB.heading), rotX(povA.pitch)));
}

// --- Image basics ---------------------------------------------------------------------------------------------

/**
 * Converts interleaved 8-bit RGBA to grayscale luminance (Rec. 601 weights).
 * @param {Uint8Array|Uint8ClampedArray|Buffer} rgba - Pixel data, 4 bytes per pixel.
 * @param {number} width - Image width in pixels.
 * @param {number} height - Image height in pixels.
 * @returns {Float64Array} Luminance, length width*height.
 */
function rgbaToGray(rgba, width, height) {
    const g = new Float64Array(width * height);
    for (let i = 0; i < width * height; i++) {
        g[i] = 0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2];
    }
    return g;
}

/**
 * Bilinearly samples a grayscale image; returns NaN outside the valid domain.
 * @param {Float64Array} img - Grayscale image.
 * @param {number} width - Image width.
 * @param {number} height - Image height.
 * @param {number} x - Sample x (pixel-center coordinates).
 * @param {number} y - Sample y.
 * @returns {number} Interpolated value, or NaN if (x, y) falls outside the image.
 */
function bilinear(img, width, height, x, y) {
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return NaN;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
    const fx = x - x0, fy = y - y0;
    const a = img[y0 * width + x0], b = img[y0 * width + x1];
    const c = img[y1 * width + x0], d = img[y1 * width + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * Variance of the 4-neighbor Laplacian over a region — a standard texture/sharpness score. The recorder picks
 * measurement headings by this score, because a featureless road vanishing point or blank sky gives NCC
 * nothing to lock onto.
 *
 * @param {Float64Array} img - Grayscale image.
 * @param {number} width - Image width.
 * @param {number} height - Image height.
 * @param {{x0: number, y0: number, x1: number, y1: number}} [region] - Inclusive-exclusive bounds; whole image
 *     (minus 1px border) if omitted.
 * @returns {number} Laplacian variance; 0 for degenerate regions.
 */
function laplacianVariance(img, width, height, region) {
    const r = region ?? { x0: 1, y0: 1, x1: width - 1, y1: height - 1 };
    const x0 = Math.max(1, r.x0), y0 = Math.max(1, r.y0);
    const x1 = Math.min(width - 1, r.x1), y1 = Math.min(height - 1, r.y1);
    let sum = 0, sumSq = 0, n = 0;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const lap = 4 * img[y * width + x] - img[y * width + x - 1] - img[y * width + x + 1] -
                img[(y - 1) * width + x] - img[(y + 1) * width + x];
            sum += lap;
            sumSq += lap * lap;
            n++;
        }
    }
    return n > 0 ? sumSq / n - (sum / n) * (sum / n) : 0;
}

// --- NCC and the warp fit -------------------------------------------------------------------------------------

/**
 * Zero-normalized cross-correlation of two equal-length sample vectors, ignoring entries where either is NaN.
 * @param {number[]|Float64Array} a - First sample vector.
 * @param {number[]|Float64Array} b - Second sample vector.
 * @returns {{ncc: number, n: number}} Correlation in [-1, 1] (NaN if degenerate) and the sample count used.
 */
function nccOf(a, b) {
    let n = 0, sa = 0, sb = 0;
    for (let i = 0; i < a.length; i++) {
        if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
        sa += a[i];
        sb += b[i];
        n++;
    }
    if (n < 16) return { ncc: NaN, n };
    const ma = sa / n, mb = sb / n;
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < a.length; i++) {
        if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
        const da = a[i] - ma, db = b[i] - mb;
        cov += da * db;
        va += da * da;
        vb += db * db;
    }
    if (va <= 0 || vb <= 0) return { ncc: NaN, n };
    return { ncc: cov / Math.sqrt(va * vb), n };
}

/**
 * NCC between image A and image B warped into A's frame under focal length f and the exact rotation between
 * the two camera orientations. Sampling is over a centered region of A on a regular grid.
 *
 * @param {Float64Array} grayA - Image A, grayscale.
 * @param {Float64Array} grayB - Image B, grayscale.
 * @param {number} width - Image width (both images).
 * @param {number} height - Image height (both images).
 * @param {{heading: number, pitch: number}} povA - Camera A orientation, radians (use rendered readbacks).
 * @param {{heading: number, pitch: number}} povB - Camera B orientation, radians.
 * @param {number} f - Candidate focal length, pixels.
 * @param {{regionFrac?: number, step?: number, centerX?: number, centerY?: number}} [opts] - regionFrac:
 *     linear fraction of each dimension to correlate over (default 0.5); step: sample-grid stride in px
 *     (default 1); centerX/centerY: region center as a fraction of width/height (default 0.5, i.e. centered —
 *     used by the off-center model check).
 * @returns {{ncc: number, n: number}} Correlation and sample count.
 */
function warpNcc(grayA, grayB, width, height, povA, povB, f, opts = {}) {
    const regionFrac = opts.regionFrac ?? 0.5;
    const step = opts.step ?? 1;
    const cxFrac = opts.centerX ?? 0.5, cyFrac = opts.centerY ?? 0.5;
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    const rw = Math.floor(width * regionFrac / 2), rh = Math.floor(height * regionFrac / 2);
    const rcx = Math.round(width * cxFrac), rcy = Math.round(height * cyFrac);
    const m = rotationAToB(povA, povB);
    const va = [], vb = [];
    for (let y = Math.max(0, rcy - rh); y < Math.min(height, rcy + rh); y += step) {
        for (let x = Math.max(0, rcx - rw); x < Math.min(width, rcx + rw); x += step) {
            const dx = (x - cx) / f, dy = (y - cy) / f;
            const bx = m[0] * dx + m[1] * dy + m[2];
            const by = m[3] * dx + m[4] * dy + m[5];
            const bz = m[6] * dx + m[7] * dy + m[8];
            if (bz <= 1e-9) continue;
            const sample = bilinear(grayB, width, height, cx + f * bx / bz, cy + f * by / bz);
            if (Number.isNaN(sample)) continue;
            va.push(grayA[y * width + x]);
            vb.push(sample);
        }
    }
    return nccOf(va, vb);
}

/**
 * Coarse focal-length estimate from the horizontal pixel shift of image A's central patch between the two
 * shots of a symmetric heading pair. For a pair at headings h0 -/+ delta/2, center content shifts by
 * 2*f*tan(delta/2), so f = shift / (2*tan(delta/2)). Integer NCC search plus parabolic sub-pixel refinement.
 * Kept as an independent cross-check on the warp fit (a bug in one is unlikely to reproduce in the other).
 *
 * @param {Float64Array} grayA - First image (earlier heading), grayscale.
 * @param {Float64Array} grayB - Second image (later heading), grayscale.
 * @param {number} width - Image width.
 * @param {number} height - Image height.
 * @param {number} deltaRad - Full heading separation of the pair, radians.
 * @param {{maxShiftFrac?: number, patchFrac?: number}} [opts] - maxShiftFrac: max search shift as a fraction
 *     of width (default 0.45); patchFrac: linear patch size fraction (default 0.35).
 * @returns {{f: number, shift: number, peakNcc: number}} Estimated focal length (px), the sub-pixel shift, and
 *     the NCC at the peak; f is NaN when no usable peak was found.
 */
function crossShiftEstimate(grayA, grayB, width, height, deltaRad, opts = {}) {
    const maxShift = Math.floor(width * (opts.maxShiftFrac ?? 0.45));
    const pw = Math.floor(width * (opts.patchFrac ?? 0.35) / 2), ph = Math.floor(height * (opts.patchFrac ?? 0.35) / 2);
    const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
    const scores = [];
    // A heading increase moves content left, so B's copy of A's central patch sits at negative x offsets.
    for (let s = -maxShift; s <= 0; s++) {
        const va = [], vb = [];
        for (let y = cy - ph; y < cy + ph; y++) {
            for (let x = cx - pw; x < cx + pw; x++) {
                const bx = x + s;
                if (bx < 0 || bx >= width) continue;
                va.push(grayA[y * width + x]);
                vb.push(grayB[y * width + bx]);
            }
        }
        scores.push(nccOf(va, vb).ncc);
    }
    let best = -1, bestNcc = -Infinity;
    for (let i = 0; i < scores.length; i++) {
        if (!Number.isNaN(scores[i]) && scores[i] > bestNcc) {
            bestNcc = scores[i];
            best = i;
        }
    }
    if (best <= 0 || best >= scores.length - 1 || !Number.isFinite(bestNcc)) return { f: NaN, shift: NaN, peakNcc: bestNcc };
    // Parabolic sub-integer refinement around the peak.
    const y0 = scores[best - 1], y1 = scores[best], y2 = scores[best + 1];
    const denom = y0 - 2 * y1 + y2;
    const frac = Math.abs(denom) > 1e-12 ? 0.5 * (y0 - y2) / denom : 0;
    const shift = Math.abs(-maxShift + best + frac);
    return { f: shift / (2 * Math.tan(deltaRad / 2)), shift, peakNcc: bestNcc };
}

/**
 * Golden-section maximization of a unimodal function on [lo, hi].
 * @param {function(number): number} fn - Function to maximize.
 * @param {number} lo - Lower bound.
 * @param {number} hi - Upper bound.
 * @param {number} tol - Absolute tolerance on the argument.
 * @returns {{x: number, value: number}} Argmax and value.
 */
function goldenMax(fn, lo, hi, tol) {
    const invPhi = (Math.sqrt(5) - 1) / 2;
    let a = lo, b = hi;
    let c = b - invPhi * (b - a), d = a + invPhi * (b - a);
    let fc = fn(c), fd = fn(d);
    while (b - a > tol) {
        if (fc > fd) {
            b = d;
            d = c;
            fd = fc;
            c = b - invPhi * (b - a);
            fc = fn(c);
        } else {
            a = c;
            c = d;
            fc = fd;
            d = a + invPhi * (b - a);
            fd = fn(d);
        }
    }
    const x = (a + b) / 2;
    return { x, value: fn(x) };
}

/**
 * Full focal-length fit for one image pair: seed with crossShiftEstimate when the pair is a symmetric yaw
 * pair, then golden-section the warp-model NCC over f.
 *
 * @param {Float64Array} grayA - First image, grayscale.
 * @param {Float64Array} grayB - Second image, grayscale.
 * @param {number} width - Image width.
 * @param {number} height - Image height.
 * @param {{heading: number, pitch: number}} povA - Rendered orientation of A, radians.
 * @param {{heading: number, pitch: number}} povB - Rendered orientation of B, radians.
 * @param {{fMin?: number, fMax?: number, tol?: number, step?: number, regionFrac?: number,
 *     centerX?: number, centerY?: number}} [opts] - fMin/fMax: explicit bracket (otherwise derived from the
 *     cross-shift seed, falling back to [0.15, 6] x max(width, height)); tol: focal-length tolerance in px
 *     (default 0.05); step/regionFrac/centerX/centerY: passed to warpNcc.
 * @returns {{f: number, ncc: number, n: number, seedF: number, seedNcc: number}} Fitted focal length, the NCC
 *     and sample count at the optimum, and the cross-shift seed for diagnostics (NaN when unavailable).
 */
function fitFocal(grayA, grayB, width, height, povA, povB, opts = {}) {
    const dh = povB.heading - povA.heading;
    let seed = { f: NaN, peakNcc: NaN };
    if (Math.abs(dh) > 1e-6 && Math.abs(povB.pitch - povA.pitch) < 1e-6) {
        seed = crossShiftEstimate(grayA, grayB, width, height, Math.abs(dh));
    }
    let fMin = opts.fMin, fMax = opts.fMax;
    if (!(fMin > 0) || !(fMax > fMin)) {
        if (Number.isFinite(seed.f) && seed.f > 0) {
            fMin = seed.f * 0.7;
            fMax = seed.f * 1.45;
        } else {
            fMin = 0.15 * Math.max(width, height);
            fMax = 6 * Math.max(width, height);
        }
    }
    const nccAt = (f) => {
        const r = warpNcc(grayA, grayB, width, height, povA, povB, f, opts);
        return Number.isNaN(r.ncc) ? -1 : r.ncc;
    };
    const { x: f } = goldenMax(nccAt, fMin, fMax, opts.tol ?? 0.05);
    const at = warpNcc(grayA, grayB, width, height, povA, povB, f, opts);
    return { f, ncc: at.ncc, n: at.n, seedF: seed.f, seedNcc: seed.peakNcc };
}

// --- FOV conversions ------------------------------------------------------------------------------------------

/**
 * Fields of view implied by a focal length for a given container, in degrees.
 * @param {number} f - Focal length in CSS px.
 * @param {number} width - Container width in CSS px.
 * @param {number} height - Container height in CSS px.
 * @returns {{hFovDeg: number, vFovDeg: number, dFovDeg: number}} Horizontal, vertical, diagonal FOV.
 */
function fovsFromFocal(f, width, height) {
    const halfDiag = Math.sqrt((width / 2) ** 2 + (height / 2) ** 2);
    return {
        hFovDeg: 2 * Math.atan(width / (2 * f)) / DEG_TO_RAD,
        vFovDeg: 2 * Math.atan(height / (2 * f)) / DEG_TO_RAD,
        dFovDeg: 2 * Math.atan(halfDiag / f) / DEG_TO_RAD,
    };
}

// --- Robust statistics ----------------------------------------------------------------------------------------

/**
 * @param {number[]} xs - Sample (not mutated).
 * @returns {number} Median; NaN for an empty sample.
 */
function median(xs) {
    if (xs.length === 0) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Median absolute deviation scaled to be sigma-consistent for a normal distribution (x1.4826).
 * @param {number[]} xs - Sample.
 * @returns {number} Scaled MAD; NaN for an empty sample.
 */
function madSigma(xs) {
    const m = median(xs);
    return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

/**
 * Cluster (block) bootstrap percentile confidence interval for the median: clusters are resampled with
 * replacement, keeping all members of a chosen cluster, so within-cluster correlation (shared pano load,
 * shared h0 patch) doesn't shrink the interval. Deterministic given `seed`.
 *
 * @param {Array<{value: number, cluster: string}>} samples - Estimates tagged with their cluster key.
 * @param {{nBoot?: number, alpha?: number, seed?: number}} [opts] - nBoot: resamples (default 10000);
 *     alpha: two-sided miss probability (default 0.05 for a 95% CI); seed: PRNG seed (default 5083).
 * @returns {{lo: number, hi: number, median: number}} CI bounds and the point estimate.
 */
function clusterBootstrapCI(samples, opts = {}) {
    const nBoot = opts.nBoot ?? 10000;
    const alpha = opts.alpha ?? 0.05;
    const rand = mulberry32(opts.seed ?? 5083);
    const byCluster = new Map();
    for (const s of samples) {
        if (!byCluster.has(s.cluster)) byCluster.set(s.cluster, []);
        byCluster.get(s.cluster).push(s.value);
    }
    const clusters = [...byCluster.values()];
    const point = median(samples.map((s) => s.value));
    if (clusters.length < 2) return { lo: NaN, hi: NaN, median: point };
    const stats = new Float64Array(nBoot);
    for (let b = 0; b < nBoot; b++) {
        const drawn = [];
        for (let i = 0; i < clusters.length; i++) {
            const c = clusters[Math.floor(rand() * clusters.length)];
            for (const v of c) drawn.push(v);
        }
        stats[b] = median(drawn);
    }
    const sorted = [...stats].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
    return { lo: at(alpha / 2), hi: at(1 - alpha / 2), median: point };
}

/**
 * Deterministic 32-bit PRNG (mulberry32), for reproducible bootstraps and synthetic textures.
 * @param {number} seed - 32-bit seed.
 * @returns {function(): number} Generator of floats in [0, 1).
 */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --- Synthetic ground truth (estimator validation, gate 6 of the protocol) ------------------------------------

/**
 * Builds a smooth, richly textured procedural function of (azimuth, elevation) — a sum of oriented sinusoids
 * with pseudo-random frequencies/phases. Being analytic, it renders pinhole views with NO source-image
 * interpolation, so recovered-vs-true focal length isolates estimator error.
 *
 * @param {number} seed - Texture seed.
 * @param {{components?: number, maxCyclesPerRad?: number}} [opts] - components: sinusoid count (default 24);
 *     maxCyclesPerRad: highest angular frequency (default 90 — keep below ~0.25*f cycles/rad to stay clear of
 *     the render Nyquist for the focal lengths under test).
 * @returns {function(number, number): number} sampler(azimuthRad, elevationRad) in roughly [0, 255].
 */
function makeProceduralEquirectSampler(seed, opts = {}) {
    const rand = mulberry32(seed);
    const nComp = opts.components ?? 24;
    const maxK = opts.maxCyclesPerRad ?? 90;
    const comps = [];
    for (let i = 0; i < nComp; i++) {
        const k = 2 + (maxK - 2) * rand() ** 1.5; // Bias toward lower frequencies for broad structure.
        const orient = rand() * Math.PI;
        comps.push({
            kAz: 2 * Math.PI * k * Math.cos(orient),
            kEl: 2 * Math.PI * k * Math.sin(orient),
            phase: rand() * 2 * Math.PI,
            amp: 0.4 + 0.6 * rand(),
        });
    }
    const norm = comps.reduce((s, c) => s + c.amp, 0);
    return (az, el) => {
        let v = 0;
        for (const c of comps) v += c.amp * Math.sin(c.kAz * az + c.kEl * el + c.phase);
        return 127.5 + 127.5 * (v / norm) * 1.8; // Stretch contrast; slight clipping is harmless texture.
    };
}

/**
 * Renders a pinhole view of an equirect-domain sampler at an exact focal length and orientation — the
 * ground-truth image generator for estimator validation.
 *
 * @param {function(number, number): number} sampler - From makeProceduralEquirectSampler.
 * @param {{f: number, headingDeg: number, pitchDeg: number, width: number, height: number}} cam - Camera:
 *     focal length in px, orientation in degrees, image size in px.
 * @returns {Float64Array} Grayscale image, length width*height.
 */
function renderPinhole(sampler, cam) {
    const { f, width, height } = cam;
    const h = cam.headingDeg * DEG_TO_RAD, p = cam.pitchDeg * DEG_TO_RAD;
    // Camera-to-world: w = Ry(h) * Rx(p) * d.
    const m = matMul(rotY(h), rotX(p));
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    const img = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = (x - cx) / f, dy = (y - cy) / f;
            const wx = m[0] * dx + m[1] * dy + m[2];
            const wy = m[3] * dx + m[4] * dy + m[5];
            const wz = m[6] * dx + m[7] * dy + m[8];
            const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
            img[y * width + x] = sampler(Math.atan2(wx, wz), -Math.asin(wy / len));
        }
    }
    return img;
}

module.exports = {
    DEG_TO_RAD,
    rotY,
    rotX,
    matMul,
    rotationAToB,
    rgbaToGray,
    bilinear,
    laplacianVariance,
    nccOf,
    warpNcc,
    crossShiftEstimate,
    goldenMax,
    fitFocal,
    fovsFromFocal,
    median,
    madSigma,
    clusterBootstrapCI,
    mulberry32,
    makeProceduralEquirectSampler,
    renderPinhole,
};
