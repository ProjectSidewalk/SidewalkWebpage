/**
 * GSV FOV probe analyzer (issue #5083): turns a record.mjs run into focal-length measurements, applies the
 * pre-registered gates and decision rule from README.md, and writes results.json + report.md into the run
 * directory. Optionally copies the committable summary (numbers + report, no live imagery) to recorded/.
 *
 * Usage:
 *   node tools/gsv-fov-probe/analyze.mjs (--latest | <run-dir>) [--copy-recorded] [--emit-fixture] [--step N]
 *
 * --emit-fixture regenerates test/js/fixtures/gsvFovMeasurements.json, the recorded measurement set that
 * test/js/gsvFovContract.test.js pins the projection code against.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const est = require('./estimator.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEG = Math.PI / 180;

// Pre-registered thresholds (see README.md — do not tune these against the data).
const METHOD_GATE_FOV_TOL_DEG = 1.5; // |measured hFov - zoomToFov| at 3:2 on live panos, per zoom.
const MODEL_GATE_DELTA_TOL = 0.005;  // Max relative spread of per-delta median f within a cell.
const VERDICT_INVARIANCE_TOL_DEG = 0.5; // FOV deviation across aspects treated as "invariant" (or 3*sigma).
const OUTLIER_MAD_MULT = 5;
const CELL_MAX_DROP_FRAC = 0.2;
// Amendment 4 (README): a pair whose warp fit never correlated is a failed measurement, not a data point.
// Observed NCC is bimodal — ≥0.94 on every credible fit, ≤0.40 when the rotated sliver was featureless sky/road —
// and the MAD filter can't reject 50% contamination in 4-pair pitch cells (the median lands between clusters).
const MIN_PAIR_NCC = 0.8;

/** The app's empirical WebGL zoom->hFov curve (panoUtilities.js zoomToFov), the H1 reference. */
const zoomToFov = (zoom) => (zoom <= 2 ? 126.5 - zoom * 36.75 : 195.93 / Math.pow(1.92, zoom));

const args = process.argv.slice(2);
const step = args.includes('--step') ? Number(args[args.indexOf('--step') + 1]) : 2;
const copyRecorded = args.includes('--copy-recorded');

function resolveRunDir() {
    const positional = args.filter((a) => !a.startsWith('--') && a !== String(step));
    if (positional.length === 1) return positional[0];
    if (args.includes('--latest')) {
        const runs = path.join(HERE, 'runs');
        const entries = fs.readdirSync(runs).filter((d) => fs.existsSync(path.join(runs, d, 'manifest.json'))).sort();
        if (entries.length === 0) throw new Error('No runs found.');
        return path.join(runs, entries.at(-1));
    }
    throw new Error('Pass a run directory or --latest.');
}

/** Decodes a capture PNG to grayscale, returning image-space dimensions. */
function loadGray(runDir, file) {
    const png = PNG.sync.read(fs.readFileSync(path.join(runDir, file)));
    return { gray: est.rgbaToGray(png.data, png.width, png.height), width: png.width, height: png.height };
}

function povRad(state) {
    return { heading: state.pov.heading * DEG, pitch: state.pov.pitch * DEG };
}

function main() {
    const runDir = resolveRunDir();
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
    console.log(`Analyzing ${runDir} (${manifest.captures.length} captures)`);

    // Pair up captures: key without side.
    const pairs = new Map();
    for (const c of manifest.captures) {
        const key = [c.panoName, c.containerName, c.load, c.kind, c.zoom, c.h0, c.deltaDeg].join('|');
        if (!pairs.has(key)) pairs.set(key, {});
        pairs.get(key)[c.side] = c;
    }

    // Fitting dominates runtime, so cached fits let classifier changes rerun without refitting the run.
    const cachePath = path.join(runDir, 'fits-cache.json');
    const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
    const fits = [];
    let done = 0;
    for (const [key, pair] of pairs) {
        if (!pair.a || !pair.b) continue;
        const cacheKey = `${key}|step${step}`;
        let fit = cache[cacheKey];
        if (!fit) {
            const A = loadGray(runDir, pair.a.file);
            const B = loadGray(runDir, pair.b.file);
            if (A.width !== B.width || A.height !== B.height) continue;
            fit = est.fitFocal(A.gray, B.gray, A.width, A.height, povRad(pair.a.state), povRad(pair.b.state),
                { step });
            cache[cacheKey] = { f: fit.f, ncc: fit.ncc };
        }
        const dsf = pair.a.dsf;
        fits.push({
            key,
            panoName: pair.a.panoName,
            containerName: pair.a.containerName,
            widthCss: pair.a.width,
            heightCss: pair.a.height,
            dsf,
            load: pair.a.load,
            kind: pair.a.kind,
            zoom: pair.a.zoom,
            zoomReadback: pair.a.state.zoom,
            h0: pair.a.h0,
            deltaDeg: pair.a.deltaDeg,
            fCss: fit.f / dsf, // Focal length in CSS px — the unit all FOV math uses.
            ncc: fit.ncc,
            settled: pair.a.settle.settled && pair.b.settle.settled,
        });
        if (++done % 50 === 0) console.log(`  fitted ${done}/${pairs.size} pairs`);
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache));

    // Aggregate cells: (pano, container, zoom, kind).
    const cells = new Map();
    for (const f of fits) {
        const key = [f.panoName, f.containerName, f.zoom, f.kind].join('|');
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(f);
    }

    const cellResults = [];
    for (const [key, cellFits] of cells) {
        const [panoName, containerName, zoom, kind] = key.split('|');
        // NCC validity floor runs before the MAD filter so garbage pairs can't drag the median between clusters.
        const valid = cellFits.filter((f) => Number.isFinite(f.fCss) && f.ncc >= MIN_PAIR_NCC);
        const values = valid.map((f) => f.fCss);
        const med = est.median(values);
        const sigma = est.madSigma(values);
        const kept = valid.filter((f) => sigma === 0 || Math.abs(f.fCss - med) <= OUTLIER_MAD_MULT * sigma);
        const dropFrac = 1 - kept.length / cellFits.length;
        const keptValues = kept.map((f) => f.fCss);
        const fMed = est.median(keptValues);
        const ci = est.clusterBootstrapCI(kept.map((f) => ({ value: f.fCss, cluster: `${f.load}-h${f.h0}` })));
        const { widthCss, heightCss, dsf } = cellFits[0];
        const fovs = est.fovsFromFocal(fMed, widthCss, heightCss);
        // Model gate ingredient: per-delta medians must agree.
        const byDelta = new Map();
        for (const f of kept) {
            if (!byDelta.has(f.deltaDeg)) byDelta.set(f.deltaDeg, []);
            byDelta.get(f.deltaDeg).push(f.fCss);
        }
        const deltaMedians = [...byDelta.entries()].map(([d, vs]) => ({ deltaDeg: d, f: est.median(vs) }));
        const deltaSpread = deltaMedians.length > 1
            ? (Math.max(...deltaMedians.map((d) => d.f)) - Math.min(...deltaMedians.map((d) => d.f))) / fMed
            : 0;
        cellResults.push({
            panoName, containerName, kind, zoom: Number(zoom),
            widthCss, heightCss, dsf, aspect: +(widthCss / heightCss).toFixed(4),
            n: cellFits.length, nKept: kept.length, dropFrac: +dropFrac.toFixed(3),
            fCss: +fMed.toFixed(2), sigmaF: +est.madSigma(keptValues).toFixed(2),
            ciLo: +ci.lo.toFixed(2), ciHi: +ci.hi.toFixed(2),
            hFovDeg: +fovs.hFovDeg.toFixed(3), vFovDeg: +fovs.vFovDeg.toFixed(3), dFovDeg: +fovs.dFovDeg.toFixed(3),
            deltaMedians: deltaMedians.map((d) => ({ deltaDeg: d.deltaDeg, f: +d.f.toFixed(2) })),
            deltaSpread: +deltaSpread.toFixed(5),
            meanNcc: +(kept.reduce((s, f) => s + f.ncc, 0) / Math.max(1, kept.length)).toFixed(4),
            unreliable: dropFrac > CELL_MAX_DROP_FRAC,
            zoomReadbacks: [...new Set(kept.map((f) => f.zoomReadback))],
        });
    }
    cellResults.sort((a, b) => a.panoName.localeCompare(b.panoName) ||
        a.containerName.localeCompare(b.containerName) || a.zoom - b.zoom || a.kind.localeCompare(b.kind));

    const gates = applyGates(cellResults);
    const verdict = applyVerdictRule(cellResults);

    const results = {
        generatedAt: new Date().toISOString(),
        runDir: path.basename(runDir),
        mapsVersionRequested: manifest.mapsVersionRequested,
        mapsVersion: manifest.captures.find((c) => c.state?.mapsVersion)?.state.mapsVersion ?? null,
        panos: manifest.panos,
        thresholds: {
            METHOD_GATE_FOV_TOL_DEG, MODEL_GATE_DELTA_TOL, VERDICT_INVARIANCE_TOL_DEG,
            OUTLIER_MAD_MULT, CELL_MAX_DROP_FRAC, MIN_PAIR_NCC, analysisStep: step,
        },
        gates,
        verdict,
        cells: cellResults,
    };
    fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(runDir, 'report.md'), renderReport(results));
    console.log(`Wrote ${path.join(runDir, 'results.json')} and report.md`);
    console.log(`Gates: ${JSON.stringify(gates, null, 2)}`);
    console.log(`Verdict: ${JSON.stringify(verdict)}`);

    if (copyRecorded) {
        const dest = path.join(HERE, 'recorded', new Date().toISOString().slice(0, 10));
        fs.mkdirSync(dest, { recursive: true });
        for (const f of ['results.json', 'report.md', 'manifest.json']) {
            fs.copyFileSync(path.join(runDir, f), path.join(dest, f));
        }
        console.log(`Committable summary copied to ${dest}`);
    }

    if (args.includes('--emit-fixture')) {
        const fixture = {
            generatedAt: results.generatedAt,
            runDir: results.runDir,
            mapsVersion: results.mapsVersion,
            mapsVersionRequested: results.mapsVersionRequested,
            verdict: verdict.verdict,
            clamp: verdict.clamp ?? null,
            gates: {
                method: gates.method.pass, model: gates.model.pass, anisotropy: gates.anisotropy.pass,
                // Amendment 4 (README): a model-gate exceedance is carried, not hidden, so the contract test
                // can pin the known, diagnosed cells and still fail loudly on any new one.
                modelExceedances: gates.model.detail.filter((d) => !d.pass).map((d) => ({
                    pano: d.panoName, container: d.containerName, zoom: d.zoom, deltaSpread: d.deltaSpread,
                })),
            },
            panos: Object.fromEntries(Object.entries(manifest.panos).map(([name, m]) => [name, {
                panoId: m.panoId, imageDate: m.imageDate, worldSize: m.worldSize,
            }])),
            configs: cellResults.filter((c) => c.kind === 'yaw' && !c.unreliable).map((c) => ({
                pano: c.panoName, container: c.containerName, width: c.widthCss, height: c.heightCss,
                dpr: c.dsf, zoom: c.zoom, fPx: c.fCss, sigmaF: c.sigmaF, ciLo: c.ciLo, ciHi: c.ciHi,
                hFovDeg: c.hFovDeg, vFovDeg: c.vFovDeg, n: c.nKept,
            })),
        };
        const fixturePath = path.resolve(HERE, '..', '..', 'test/js/fixtures/gsvFovMeasurements.json');
        fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
        fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
        console.log(`Fixture written to ${fixturePath}`);
    }
}

/**
 * Gate 1 (method) and gate 2 (model) from the README, evaluated over the yaw cells.
 * @param {object[]} cells - Aggregated cell results.
 * @returns {object} Gate outcomes with per-cell detail.
 */
function applyGates(cells) {
    const yaw = cells.filter((c) => c.kind === 'yaw' && !c.unreliable);
    // Method gate: 3:2 control cells on LIVE panos must reproduce the empirical curve.
    const controls = yaw.filter((c) => c.containerName === 'control-720x480' && c.panoName !== 'tutorial');
    const methodDetail = controls.map((c) => ({
        panoName: c.panoName, zoom: c.zoom, hFovDeg: c.hFovDeg, expected: zoomToFov(c.zoom),
        errDeg: +(c.hFovDeg - zoomToFov(c.zoom)).toFixed(3),
        pass: Math.abs(c.hFovDeg - zoomToFov(c.zoom)) <= Math.max(METHOD_GATE_FOV_TOL_DEG, 3 * sigmaFovDeg(c)),
    }));
    // Model gate: f agrees across deltas within each cell.
    const modelDetail = yaw.map((c) => ({
        panoName: c.panoName, containerName: c.containerName, zoom: c.zoom,
        deltaSpread: c.deltaSpread, pass: c.deltaSpread <= MODEL_GATE_DELTA_TOL,
    }));
    // Anisotropy: pitch-pair (vertical) f vs yaw f in the same (pano, container, zoom).
    const anisotropy = cells.filter((c) => c.kind === 'pitch').map((p) => {
        const y = cells.find((c) => c.kind === 'yaw' && c.panoName === p.panoName &&
            c.containerName === p.containerName && c.zoom === p.zoom);
        const rel = y ? Math.abs(p.fCss - y.fCss) / y.fCss : NaN;
        return { panoName: p.panoName, containerName: p.containerName, zoom: p.zoom,
            fVertical: p.fCss, fHorizontal: y?.fCss ?? NaN, relDiff: +rel.toFixed(4), pass: rel < 0.01 };
    });
    return {
        method: { pass: methodDetail.length > 0 && methodDetail.every((d) => d.pass), detail: methodDetail },
        model: { pass: modelDetail.length > 0 && modelDetail.every((d) => d.pass), detail: modelDetail },
        anisotropy: { pass: anisotropy.every((d) => d.pass), detail: anisotropy },
    };
}

/** Uncertainty of a cell's hFov in degrees, propagated from the f bootstrap CI (half-width / 1.96). */
function sigmaFovDeg(cell) {
    if (!Number.isFinite(cell.ciLo) || !Number.isFinite(cell.ciHi)) return Infinity;
    const lo = est.fovsFromFocal(cell.ciHi, cell.widthCss, cell.heightCss).hFovDeg;
    const hi = est.fovsFromFocal(cell.ciLo, cell.widthCss, cell.heightCss).hFovDeg;
    return (hi - lo) / 2 / 1.96;
}

/**
 * Gate 3/4: per pano and zoom, compare each aspect's hFov/vFov/dFov deviation from the 3:2 control against
 * the invariance tolerance; classify horizontal-pinned / vertical-pinned / diagonal-pinned per cell, then
 * require unanimity across panos, zooms, and aspects for a named verdict.
 * @param {object[]} cells - Aggregated cell results.
 * @returns {object} Verdict plus the per-comparison table.
 */
function applyVerdictRule(cells) {
    const yaw = cells.filter((c) => c.kind === 'yaw' && !c.unreliable && c.dsf === 1);
    const comparisons = [];
    for (const c of yaw) {
        if (c.containerName === 'control-720x480') continue;
        const control = yaw.find((k) => k.panoName === c.panoName && k.zoom === c.zoom &&
            k.containerName === 'control-720x480');
        if (!control) continue;
        const sig = Math.max(sigmaFovDeg(c), sigmaFovDeg(control));
        const tol = Math.max(VERDICT_INVARIANCE_TOL_DEG, 3 * sig);
        // Long/short-axis FOVs: the FOV across the larger / smaller container dimension. Added as named
        // hypotheses after the tutorial-pano preview showed hFov held at 21:9 but vFov held at portrait
        // (i.e., GSV looked long-axis-pinned) — amended BEFORE the confirmatory live-pano sweep; see README.
        const axisFovs = (cell) => ({
            l: 2 * Math.atan(Math.max(cell.widthCss, cell.heightCss) / 2 / cell.fCss) / DEG,
            s: 2 * Math.atan(Math.min(cell.widthCss, cell.heightCss) / 2 / cell.fCss) / DEG,
        });
        const ca = axisFovs(c), ka = axisFovs(control);
        const dh = c.hFovDeg - control.hFovDeg;
        const dv = c.vFovDeg - control.vFovDeg;
        const dd = c.dFovDeg - control.dFovDeg;
        const dl = ca.l - ka.l;
        const ds = ca.s - ka.s;
        comparisons.push({
            panoName: c.panoName, containerName: c.containerName, zoom: c.zoom, aspect: c.aspect,
            dhDeg: +dh.toFixed(3), dvDeg: +dv.toFixed(3), ddDeg: +dd.toFixed(3),
            dlDeg: +dl.toFixed(3), dsDeg: +ds.toFixed(3), tolDeg: +tol.toFixed(3),
            hInvariant: Math.abs(dh) <= tol, vInvariant: Math.abs(dv) <= tol, dInvariant: Math.abs(dd) <= tol,
            lInvariant: Math.abs(dl) <= tol, sInvariant: Math.abs(ds) <= tol,
        });
    }
    if (comparisons.length === 0) return { verdict: 'insufficient-data', comparisons };
    const all = (k) => comparisons.every((c) => c[k]);
    const invariant = [
        ['horizontal-pinned', all('hInvariant')],
        ['vertical-pinned', all('vInvariant')],
        ['diagonal-pinned', all('dInvariant')],
        ['long-axis-pinned', all('lInvariant')],
        ['short-axis-pinned', all('sInvariant')],
    ].filter(([, pass]) => pass).map(([name]) => name);
    if (invariant.length === 1) return { verdict: invariant[0], invariantHypotheses: invariant, comparisons };
    if (invariant.length > 1) {
        return { verdict: `ambiguous:${invariant.join('+')}`, invariantHypotheses: invariant, comparisons };
    }
    return classifyClampedWidthPinned(yaw, comparisons);
}

/**
 * Composite model (README amendment 2): hFov is width-pinned, but the implied vFov is clamped to a
 * [floor, ceiling] window — when a bound binds, the render pins vFov at the bound instead, silently (zoom
 * readbacks do not reflect it). Verdict `width-pinned-vfov-clamped` iff every non-h-invariant cell is
 * exactly a binding case (its unclamped vFov prediction violates the same bound its measured vFov sits on)
 * and the binding cells agree on each bound's value.
 *
 * @param {object[]} yaw - Usable yaw cells (dsf 1).
 * @param {object[]} comparisons - Per-cell deviation table from applyVerdictRule.
 * @returns {object} Verdict object with clamp bound estimates and per-cell classification.
 */
function classifyClampedWidthPinned(yaw, comparisons) {
    const ceilEstimates = [], floorEstimates = [], cellClasses = [];
    let consistent = true;
    for (const cmp of comparisons) {
        if (cmp.hInvariant) {
            cellClasses.push({ ...cmp, regime: 'unclamped' });
            continue;
        }
        const cell = yaw.find((c) => c.panoName === cmp.panoName && c.zoom === cmp.zoom &&
            c.containerName === cmp.containerName);
        const control = yaw.find((c) => c.panoName === cmp.panoName && c.zoom === cmp.zoom &&
            c.containerName === 'control-720x480');
        // Unclamped width-pinned prediction for this cell's vFov, anchored on the measured control.
        const predVFov = 2 * Math.atan(Math.tan(control.hFovDeg / 2 * DEG) / cmp.aspect) / DEG;
        if (predVFov > cell.vFovDeg + cmp.tolDeg) {
            ceilEstimates.push(cell.vFovDeg);
            cellClasses.push({ ...cmp, regime: 'ceiling-bound', measuredVFov: cell.vFovDeg, unclampedVFov: +predVFov.toFixed(2) });
        } else if (predVFov < cell.vFovDeg - cmp.tolDeg) {
            floorEstimates.push(cell.vFovDeg);
            cellClasses.push({ ...cmp, regime: 'floor-bound', measuredVFov: cell.vFovDeg, unclampedVFov: +predVFov.toFixed(2) });
        } else {
            consistent = false;
            cellClasses.push({ ...cmp, regime: 'inconsistent' });
        }
    }
    const spreadOk = (xs) => xs.length < 2 || Math.max(...xs) - Math.min(...xs) <= 2 * VERDICT_INVARIANCE_TOL_DEG;
    const verdict = consistent && (ceilEstimates.length + floorEstimates.length > 0) &&
        spreadOk(ceilEstimates) && spreadOk(floorEstimates)
        ? 'width-pinned-vfov-clamped' : 'indeterminate';
    return {
        verdict,
        invariantHypotheses: [],
        clamp: {
            ceilingDeg: ceilEstimates.length ? +est.median(ceilEstimates).toFixed(3) : null,
            floorDeg: floorEstimates.length ? +est.median(floorEstimates).toFixed(3) : null,
            nCeilingCells: ceilEstimates.length, nFloorCells: floorEstimates.length,
        },
        comparisons: cellClasses,
    };
}

/** Renders the human-readable report. */
function renderReport(r) {
    const lines = [];
    lines.push(`# GSV FOV probe results — ${r.generatedAt}`, '');
    lines.push(`Run: \`${r.runDir}\` · Maps channel requested: \`${r.mapsVersionRequested}\``, '');
    lines.push(`## Verdict: **${r.verdict.verdict}**`, '');
    if (r.verdict.clamp) {
        lines.push(`vFov clamp window: ceiling ${r.verdict.clamp.ceilingDeg}° (${r.verdict.clamp.nCeilingCells} ` +
            `binding cells), floor ${r.verdict.clamp.floorDeg}° (${r.verdict.clamp.nFloorCells} binding cells)`, '');
    }
    lines.push(`Gates: method=${r.gates.method.pass ? 'PASS' : 'FAIL'}, model=${r.gates.model.pass ? 'PASS' : 'FAIL'}, ` +
        `anisotropy=${r.gates.anisotropy.pass ? 'PASS' : 'FAIL'}`, '');
    lines.push('## Measured cells', '');
    lines.push('| pano | container | zoom | kind | f (CSS px) | 95% CI | hFov | vFov | n | drop | NCC |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of r.cells) {
        lines.push(`| ${c.panoName} | ${c.containerName} | ${c.zoom} | ${c.kind} | ${c.fCss} ` +
            `| [${c.ciLo}, ${c.ciHi}] | ${c.hFovDeg}° | ${c.vFovDeg}° | ${c.nKept}/${c.n} ` +
            `| ${c.dropFrac} | ${c.meanNcc} |`);
    }
    lines.push('', '## Aspect comparisons vs 3:2 control', '');
    lines.push('| pano | container | zoom | Δh (°) | Δv (°) | Δdiag (°) | Δlong (°) | tol (°) | h-inv | v-inv | long-inv | regime |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of r.verdict.comparisons) {
        lines.push(`| ${c.panoName} | ${c.containerName} | ${c.zoom} | ${c.dhDeg} | ${c.dvDeg} | ${c.ddDeg} ` +
            `| ${c.dlDeg} | ${c.tolDeg} | ${c.hInvariant ? 'yes' : 'NO'} | ${c.vInvariant ? 'yes' : 'NO'} ` +
            `| ${c.lInvariant ? 'yes' : 'NO'} | ${c.regime ?? '—'} |`);
    }
    lines.push('', '## Method gate (3:2 control vs zoomToFov)', '');
    lines.push('| pano | zoom | measured hFov | expected | err (°) | pass |');
    lines.push('|---|---|---|---|---|---|');
    for (const d of r.gates.method.detail) {
        lines.push(`| ${d.panoName} | ${d.zoom} | ${d.hFovDeg}° | ${d.expected}° | ${d.errDeg} | ${d.pass ? 'yes' : 'NO'} |`);
    }
    lines.push('');
    return lines.join('\n');
}

main();
