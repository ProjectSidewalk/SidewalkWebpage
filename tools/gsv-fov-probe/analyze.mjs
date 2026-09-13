/**
 * GSV FOV probe analyzer (issue #5083): turns a record.mjs run into focal-length measurements, applies the
 * pre-registered gates and decision rule from README.md, and writes results.json + report.md into the run
 * directory. Optionally copies the committable summary (numbers + report, no live imagery) to recorded/.
 *
 * Usage:
 *   node tools/gsv-fov-probe/analyze.mjs (--latest | <run-dir>)
 *     [--copy-recorded] [--emit-fixture] [--no-cache] [--step N]
 *
 * --emit-fixture regenerates test/js/fixtures/gsvFovMeasurements.json, the recorded measurement set that
 * test/js/gsvFovContract.test.js pins the projection code against.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
// Amendment 5 (README): an absolute floor under the MAD rejection window. Some cells are so repeatable that
// 5*MAD collapses to a fraction of a pixel, and then legitimate pairs fall outside it — a rejection driven by
// the cell's own precision rather than by any pair being wrong.
const OUTLIER_MIN_WINDOW_FRAC = 0.001; // Rejection window is at least 0.1% of the cell's median f.
const CELL_MAX_DROP_FRAC = 0.2;
// Amendment 4 (README): a pair whose warp fit never correlated is a failed measurement, not a data point.
// Observed NCC is bimodal — ≥0.90 on every credible fit, ≤0.40 when the rotated sliver was featureless
// sky or road, nothing in between —
// and the MAD filter can't reject 50% contamination in 4-pair pitch cells (the median lands between clusters).
const MIN_PAIR_NCC = 0.8;
// Amendment 5 (README): the independent patch-shift seed must agree with the warp fit, at the same 3% bracket
// the estimator unit suite holds it to on synthetic ground truth.
const SEED_AGREEMENT_TOL = 0.03;

/** The app's empirical WebGL zoom->hFov curve (panoUtilities.js zoomToFov), the H1 reference. */
const zoomToFov = (zoom) => (zoom <= 2 ? 126.5 - zoom * 36.75 : 195.93 / Math.pow(1.92, zoom));

/**
 * The fitter's identity, folded into every cache key so an estimator edit can never be served from a cache
 * written by the previous version.
 */
const ESTIMATOR_HASH = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(HERE, 'estimator.cjs'))).digest('hex').slice(0, 12);

const args = parseArgs(process.argv.slice(2));

/**
 * Flag parser for the CLI documented in the file header. Values are consumed by index (never matched by
 * value against the positional list, which would drop a run directory that happens to equal a flag value).
 * @param {string[]} argv - Raw arguments.
 * @returns {object} Parsed options.
 */
function parseArgs(argv) {
    const out = { step: 2, copyRecorded: false, emitFixture: false, noCache: false, latest: false, positional: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--copy-recorded') out.copyRecorded = true;
        else if (a === '--emit-fixture') out.emitFixture = true;
        else if (a === '--no-cache') out.noCache = true;
        else if (a === '--latest') out.latest = true;
        else if (a === '--step') {
            out.step = Number(argv[++i]);
            if (!Number.isInteger(out.step) || out.step < 1) throw new Error('--step needs a positive integer.');
        } else if (a.startsWith('--')) throw new Error(`Unknown argument: ${a}`);
        else out.positional.push(a);
    }
    return out;
}

function resolveRunDir() {
    if (args.positional.length === 1) return args.positional[0];
    if (args.latest) {
        const runs = path.join(HERE, 'runs');
        const entries = fs.readdirSync(runs).filter((d) => fs.existsSync(path.join(runs, d, 'manifest.json'))).sort();
        if (entries.length === 0) throw new Error('No runs found.');
        return path.join(runs, entries.at(-1));
    }
    throw new Error('Pass a run directory or --latest.');
}

/**
 * Decodes a capture PNG to grayscale, returning image-space dimensions.
 * @param {string} runDir - Run directory the capture path is relative to.
 * @param {object} capture - Manifest capture record (its CSS size x DSF is the expected image size).
 * @returns {{gray: Float64Array, width: number, height: number}} Grayscale image and its dimensions.
 */
function loadGray(runDir, capture) {
    const png = PNG.sync.read(fs.readFileSync(path.join(runDir, capture.file)));
    // Guards against having screenshotted something other than the render canvas (the Maps API mounts small
    // scratch canvases beside it): a wrong element would fit a wrong f without any other symptom.
    if (png.width !== capture.width * capture.dsf || png.height !== capture.height * capture.dsf) {
        throw new Error(`${capture.file}: captured ${png.width}x${png.height}, expected ` +
            `${capture.width * capture.dsf}x${capture.height * capture.dsf} — wrong capture target?`);
    }
    return { gray: est.rgbaToGray(png.data, png.width, png.height), width: png.width, height: png.height };
}

/** @returns {{heading: number, pitch: number}} The settled POV readback in radians (pre-settle read if absent). */
function povRad(capture) {
    const state = capture.stateSettled ?? capture.state;
    return { heading: state.pov.heading * DEG, pitch: state.pov.pitch * DEG };
}

/** @returns {string} Size+mtime tag for a capture file, so re-recorded captures never hit a stale cache entry. */
function fileTag(runDir, file) {
    const s = fs.statSync(path.join(runDir, file));
    return `${s.size}-${Math.round(s.mtimeMs)}`;
}

function main() {
    const runDir = resolveRunDir();
    const step = args.step;
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
    console.log(`Analyzing ${runDir} (${manifest.captures.length} captures)`);

    // Pair up captures: key without side.
    const pairs = new Map();
    for (const c of manifest.captures) {
        const key = [c.panoName, c.containerName, c.load, c.kind, c.zoom, c.h0, c.deltaDeg].join('|');
        if (!pairs.has(key)) pairs.set(key, {});
        pairs.get(key)[c.side] = c;
    }

    // Fitting dominates runtime, so cached fits let classifier changes rerun without refitting the run. The
    // key carries the estimator's hash and both capture files' size+mtime: a re-recorded load (--resume
    // rewrites the same deterministic filenames) or an estimator edit misses the cache instead of serving the
    // previous attempt's fit. A cache written before this run was resumed is discarded outright.
    const cachePath = path.join(runDir, 'fits-cache.json');
    const cacheIsStale = manifest.resumedAt && fs.existsSync(cachePath) &&
        fs.statSync(cachePath).mtimeMs < Date.parse(manifest.resumedAt);
    if (cacheIsStale) console.log('Run was resumed after the fits cache was written — discarding the cache.');
    const cache = fs.existsSync(cachePath) && !args.noCache && !cacheIsStale
        ? JSON.parse(fs.readFileSync(cachePath, 'utf8'))
        : {};
    const fits = [];
    let done = 0;
    for (const [key, pair] of pairs) {
        if (!pair.a || !pair.b) continue;
        const cacheKey = `${key}|step${step}|est${ESTIMATOR_HASH}|` +
            `${fileTag(runDir, pair.a.file)}|${fileTag(runDir, pair.b.file)}`;
        let fit = cache[cacheKey];
        if (!fit) {
            const A = loadGray(runDir, pair.a);
            const B = loadGray(runDir, pair.b);
            if (A.width !== B.width || A.height !== B.height) continue;
            fit = est.fitFocal(A.gray, B.gray, A.width, A.height, povRad(pair.a), povRad(pair.b), { step });
            cache[cacheKey] = { f: fit.f, ncc: fit.ncc, seedF: fit.seedF, seedNcc: fit.seedNcc };
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
            zoomReadback: (pair.a.stateSettled ?? pair.a.state).zoom,
            h0: pair.a.h0,
            deltaDeg: pair.a.deltaDeg,
            fCss: fit.f / dsf, // Focal length in CSS px — the unit all FOV math uses.
            ncc: fit.ncc,
            // Independent patch-shift seed, kept so the seed-vs-fit agreement can be gated and reported
            // (README amendment 5). NaN on pitch pairs, which the shift estimator does not seed.
            seedFCss: Number.isFinite(fit.seedF) ? fit.seedF / dsf : NaN,
            seedNcc: fit.seedNcc,
            settled: pair.a.settle.settled && pair.b.settle.settled,
        });
        if (++done % 50 === 0) {
            console.log(`  fitted ${done}/${pairs.size} pairs`);
            // A full-run refit is over an hour of fitting; flush as we go so a crash near the end does not
            // throw all of it away.
            fs.writeFileSync(cachePath, JSON.stringify(cache));
        }
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
        const window = Math.max(OUTLIER_MAD_MULT * sigma, OUTLIER_MIN_WINDOW_FRAC * med);
        const kept = valid.filter((f) => Math.abs(f.fCss - med) <= window);
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
        const seedRel = kept.filter((f) => Number.isFinite(f.seedFCss))
            .map((f) => Math.abs(f.seedFCss - f.fCss) / f.fCss);
        cellResults.push({
            panoName, containerName, kind, zoom: Number(zoom),
            widthCss, heightCss, dsf, aspect: +(widthCss / heightCss).toFixed(4),
            n: cellFits.length, nKept: kept.length, dropFrac: +dropFrac.toFixed(3),
            // Rejections split by cause so amendment 4's NCC-floor claim is checkable from this file alone.
            nNccRejected: cellFits.length - valid.length, nMadRejected: valid.length - kept.length,
            fCss: +fMed.toFixed(2), sigmaF: +est.madSigma(keptValues).toFixed(2),
            ciLo: +ci.lo.toFixed(2), ciHi: +ci.hi.toFixed(2),
            hFovDeg: +fovs.hFovDeg.toFixed(3), vFovDeg: +fovs.vFovDeg.toFixed(3), dFovDeg: +fovs.dFovDeg.toFixed(3),
            deltaMedians: deltaMedians.map((d) => ({ deltaDeg: d.deltaDeg, f: +d.f.toFixed(2) })),
            deltaSpread: +deltaSpread.toFixed(5),
            meanNcc: +(kept.reduce((s, f) => s + f.ncc, 0) / Math.max(1, kept.length)).toFixed(4),
            seedRelMedian: seedRel.length ? +est.median(seedRel).toFixed(5) : null,
            unreliable: dropFrac > CELL_MAX_DROP_FRAC,
            zoomReadbacks: [...new Set(kept.map((f) => f.zoomReadback))],
        });
    }
    cellResults.sort((a, b) => a.panoName.localeCompare(b.panoName) ||
        a.containerName.localeCompare(b.containerName) || a.zoom - b.zoom || a.kind.localeCompare(b.kind));

    const gates = applyGates(cellResults, fits);
    const verdict = applyVerdictRule(cellResults);
    const controlHFovDeg = controlCurve(cellResults);
    const bindingAspects = bindingAspectTable(controlHFovDeg, verdict.clamp);

    const results = {
        generatedAt: new Date().toISOString(),
        runDir: path.basename(runDir),
        mapsVersionRequested: manifest.mapsVersionRequested,
        mapsVersion: manifest.captures.find((c) => c.state?.mapsVersion)?.state.mapsVersion ?? null,
        estimatorHash: ESTIMATOR_HASH,
        panos: manifest.panos,
        thresholds: {
            METHOD_GATE_FOV_TOL_DEG, MODEL_GATE_DELTA_TOL, VERDICT_INVARIANCE_TOL_DEG,
            OUTLIER_MAD_MULT, OUTLIER_MIN_WINDOW_FRAC, CELL_MAX_DROP_FRAC, MIN_PAIR_NCC,
            SEED_AGREEMENT_TOL, analysisStep: step,
        },
        gates,
        verdict,
        controlHFovDeg,
        bindingAspects,
        pairNccHistogram: nccHistogram(fits),
        cells: cellResults,
    };
    fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(runDir, 'report.md'), renderReport(results));
    console.log(`Wrote ${path.join(runDir, 'results.json')} and report.md`);
    console.log(`Gates: ${JSON.stringify(gates, null, 2)}`);
    console.log(`Verdict: ${JSON.stringify(verdict.verdict)} clamp=${JSON.stringify(verdict.clamp ?? null)}`);

    if (args.copyRecorded) {
        // Named for the RUN's date, not today's: re-analyzing an old run must update its record, not fork a
        // second directory under whatever day the re-analysis happened to run. Non-default Maps channels get
        // a subdirectory so a same-day stability run cannot overwrite the primary one.
        const channel = manifest.mapsVersionRequested;
        const dest = path.join(HERE, 'recorded', path.basename(runDir).slice(0, 10),
            ...(channel === 'weekly' ? [] : [channel]));
        fs.mkdirSync(dest, { recursive: true });
        for (const f of ['results.json', 'report.md']) {
            fs.copyFileSync(path.join(runDir, f), path.join(dest, f));
        }
        // The full manifest is ~11 MB of per-capture readbacks that are only actionable together with the
        // screenshots, which stay local. Commit the provenance extract instead.
        fs.writeFileSync(path.join(dest, 'manifest-extract.json'),
            `${JSON.stringify(manifestExtract(manifest, results), null, 2)}\n`);
        console.log(`Committable summary copied to ${dest}`);
    }

    if (args.emitFixture) {
        const fixture = {
            generatedAt: results.generatedAt,
            runDir: results.runDir,
            mapsVersion: results.mapsVersion,
            mapsVersionRequested: results.mapsVersionRequested,
            verdict: verdict.verdict,
            clamp: verdict.clamp ?? null,
            // Measured hFov at the 3:2 control per zoom — the empirical curve the contract suite anchors on,
            // which is NOT identical to the app's fitted zoomToFov at zoom 3 (issue #5083 bonus finding 1).
            controlHFovDeg,
            bindingAspects,
            gates: {
                method: gates.method.pass, model: gates.model.pass, anisotropy: gates.anisotropy.pass,
                seed: gates.seed.pass,
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
 * Measured hFov at the 3:2 control per zoom, median over the live panos (the same set the method gate uses).
 * @param {object[]} cells - Aggregated cell results.
 * @returns {Object<string, number>} Zoom -> measured control hFov in degrees.
 */
function controlCurve(cells) {
    const controls = cells.filter((c) => c.kind === 'yaw' && !c.unreliable && c.dsf === 1 &&
        c.containerName === 'control-720x480' && c.panoName !== 'tutorial');
    const out = {};
    for (const zoom of [...new Set(controls.map((c) => c.zoom))].sort()) {
        out[zoom] = +est.median(controls.filter((c) => c.zoom === zoom).map((c) => c.hFovDeg)).toFixed(3);
    }
    return out;
}

/**
 * The aspect ratios at which each clamp bound starts binding, per zoom — the engineering deliverable for
 * #5085. Width-pinning puts the unclamped vFov at 2*atan(tan(hFov/2)/aspect), so the floor binds once the
 * container is wide enough that this drops below the floor, and the ceiling once it is tall enough that it
 * rises above the ceiling.
 *
 * @param {Object<string, number>} controlHFovDeg - Measured control hFov per zoom.
 * @param {?{ceilingDeg: ?number, floorDeg: ?number}} clamp - Measured clamp window (null when no clamp).
 * @returns {object[]} Per-zoom binding aspects (null where the corresponding bound was not measured).
 */
function bindingAspectTable(controlHFovDeg, clamp) {
    const tanHalf = (deg) => Math.tan(deg / 2 * DEG);
    return Object.entries(controlHFovDeg).map(([zoom, hFovDeg]) => ({
        zoom: Number(zoom),
        controlHFovDeg: hFovDeg,
        floorBindsAtAspectAtLeast: clamp?.floorDeg != null
            ? +(tanHalf(hFovDeg) / tanHalf(clamp.floorDeg)).toFixed(3) : null,
        ceilingBindsAtAspectAtMost: clamp?.ceilingDeg != null
            ? +(tanHalf(hFovDeg) / tanHalf(clamp.ceilingDeg)).toFixed(3) : null,
    }));
}

/**
 * Distribution of per-pair warp NCC, so amendment 4's "sharply bimodal" claim is checkable from the
 * committed numbers without the run's raw fits.
 * @param {object[]} fits - Per-pair fit records.
 * @returns {object} Bin edges, counts, and the count below the validity floor.
 */
function nccHistogram(fits) {
    const edges = Array.from({ length: 21 }, (_, i) => +(i * 0.05).toFixed(2));
    const counts = new Array(edges.length - 1).fill(0);
    let nonFinite = 0;
    for (const f of fits) {
        if (!Number.isFinite(f.ncc)) { nonFinite++; continue; }
        const i = Math.min(counts.length - 1, Math.max(0, Math.floor(f.ncc / 0.05)));
        counts[i]++;
    }
    return {
        binEdges: edges, counts, nonFinite, nPairs: fits.length,
        nBelowFloor: fits.filter((f) => !(f.ncc >= MIN_PAIR_NCC)).length,
    };
}

/**
 * The subset of the run manifest worth committing: per-load provenance and aggregate settle statistics. The
 * per-capture readbacks it leaves behind are only interpretable with the screenshots, which stay local.
 * @param {object} manifest - Full run manifest.
 * @param {object} results - Analysis results (for the resolved Maps version).
 * @returns {object} Committable provenance extract.
 */
function manifestExtract(manifest, results) {
    const captures = manifest.captures;
    const iters = captures.map((c) => c.settle.iters);
    const elapsed = captures.map((c) => c.settle.elapsedMs);
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    return {
        note: 'Generated by analyze.mjs --copy-recorded. The full manifest.json (per-capture POV readbacks) ' +
            'stays with the raw run; see README.md for the archive location.',
        startedAt: manifest.startedAt,
        resumedAt: manifest.resumedAt ?? null,
        finishedAt: manifest.finishedAt,
        baseUrl: manifest.baseUrl,
        argv: manifest.argv,
        playwrightVersion: manifest.playwrightVersion,
        mapsVersionRequested: manifest.mapsVersionRequested,
        mapsVersion: results.mapsVersion,
        settleConfig: manifest.settleConfig,
        protocol: manifest.protocol,
        panos: manifest.panos,
        settleStats: {
            captures: captures.length,
            unsettled: captures.filter((c) => !c.settle.settled).length,
            itersMin: Math.min(...iters), itersMax: Math.max(...iters),
            itersMean: +(sum(iters) / iters.length).toFixed(2),
            elapsedMsMean: Math.round(sum(elapsed) / elapsed.length),
            elapsedMsMax: Math.max(...elapsed),
        },
        loads: manifest.loads.map((l) => ({
            label: l.label, attempt: l.attempt ?? null, completed: l.completed ?? false,
            error: l.error ?? null, h0s: l.h0s ?? null, h0Scores: l.h0Scores ?? null,
            consoleErrorsAtSelect: l.consoleErrorsAtSelect ?? null, consoleErrors: l.consoleErrors ?? null,
        })),
    };
}

/**
 * Gate 2 (method) and gate 3 (model, including the pitch-vs-yaw anisotropy check and the seed-agreement
 * check) from the README, evaluated over the usable cells.
 * @param {object[]} cells - Aggregated cell results.
 * @param {object[]} fits - Per-pair fit records (for the seed-agreement gate).
 * @returns {object} Gate outcomes with per-cell detail.
 */
function applyGates(cells, fits) {
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
    // Anisotropy: pitch-pair (vertical) f vs yaw f in the same (pano, container, zoom). Cells that dropped
    // too many pairs are excluded here exactly as they are from every other gate and from the verdict —
    // half the pitch cells are unreliable, and a gate must not rest on measurements the run disowned.
    const pitchCells = cells.filter((c) => c.kind === 'pitch');
    const anisotropy = pitchCells.filter((c) => !c.unreliable).map((p) => {
        const y = yaw.find((c) => c.panoName === p.panoName &&
            c.containerName === p.containerName && c.zoom === p.zoom);
        const rel = y ? Math.abs(p.fCss - y.fCss) / y.fCss : NaN;
        return { panoName: p.panoName, containerName: p.containerName, zoom: p.zoom,
            fVertical: p.fCss, fHorizontal: y?.fCss ?? NaN, relDiff: +rel.toFixed(4), pass: rel < 0.01 };
    });
    // Seed agreement: the patch-shift seed is an independent estimate of the same f, so the warp fit landing
    // far from it means one of the two is wrong. Median over yaw pairs (the shift estimator does not seed
    // pitch pairs), at the estimator suite's synthetic 3% bracket.
    const seedRel = fits.filter((f) => Number.isFinite(f.seedFCss) && Number.isFinite(f.fCss) && f.fCss > 0)
        .map((f) => Math.abs(f.seedFCss - f.fCss) / f.fCss);
    const seedMedian = seedRel.length ? est.median(seedRel) : NaN;
    return {
        method: { pass: methodDetail.length > 0 && methodDetail.every((d) => d.pass), detail: methodDetail },
        model: { pass: modelDetail.length > 0 && modelDetail.every((d) => d.pass), detail: modelDetail },
        anisotropy: {
            pass: anisotropy.length > 0 && anisotropy.every((d) => d.pass),
            nPitchCells: pitchCells.length, nExcludedUnreliable: pitchCells.length - anisotropy.length,
            detail: anisotropy,
        },
        seed: {
            pass: seedRel.length > 0 && seedMedian <= SEED_AGREEMENT_TOL,
            nPairs: seedRel.length,
            relMedian: seedRel.length ? +seedMedian.toFixed(5) : null,
            relP95: seedRel.length
                ? +seedRel.slice().sort((a, b) => a - b)[Math.floor(0.95 * (seedRel.length - 1))].toFixed(5)
                : null,
        },
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
 * Gate 4: per pano and zoom, compare each aspect's hFov/vFov/dFov deviation from the 3:2 control against
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
            cellClasses.push({ ...cmp, regime: 'ceiling-bound',
                measuredVFov: cell.vFovDeg, unclampedVFov: +predVFov.toFixed(2) });
        } else if (predVFov < cell.vFovDeg - cmp.tolDeg) {
            floorEstimates.push(cell.vFovDeg);
            cellClasses.push({ ...cmp, regime: 'floor-bound',
                measuredVFov: cell.vFovDeg, unclampedVFov: +predVFov.toFixed(2) });
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
    lines.push(`Run: \`${r.runDir}\` · Maps channel requested: \`${r.mapsVersionRequested}\` · ` +
        `resolved \`google.maps.version\`: \`${r.mapsVersion}\` · estimator \`${r.estimatorHash}\``, '');
    lines.push(`## Verdict: **${r.verdict.verdict}**`, '');
    if (r.verdict.clamp) {
        lines.push(`vFov clamp window: ceiling ${r.verdict.clamp.ceilingDeg}° (${r.verdict.clamp.nCeilingCells} ` +
            `binding cells), floor ${r.verdict.clamp.floorDeg}° (${r.verdict.clamp.nFloorCells} binding cells)`, '');
    }
    lines.push(`Gates: method=${pf(r.gates.method.pass)}, model=${pf(r.gates.model.pass)}, ` +
        `anisotropy=${pf(r.gates.anisotropy.pass)} (${r.gates.anisotropy.nExcludedUnreliable} of ` +
        `${r.gates.anisotropy.nPitchCells} pitch cells excluded as unreliable), ` +
        `seed=${pf(r.gates.seed.pass)} (median |seedF−f|/f = ${r.gates.seed.relMedian})`, '');
    if (r.bindingAspects.length) {
        lines.push('## Clamp binding aspects', '');
        lines.push('| zoom | control hFov | floor binds at aspect ≥ | ceiling binds at aspect ≤ |');
        lines.push('|---|---|---|---|');
        for (const b of r.bindingAspects) {
            lines.push(`| ${b.zoom} | ${b.controlHFovDeg}° | ${b.floorBindsAtAspectAtLeast} ` +
                `| ${b.ceilingBindsAtAspectAtMost} |`);
        }
        lines.push('');
    }
    lines.push('## Measured cells', '');
    lines.push('| pano | container | zoom | kind | f (CSS px) | 95% CI | hFov | vFov | n | drop | NCC |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of r.cells) {
        lines.push(`| ${c.panoName} | ${c.containerName} | ${c.zoom} | ${c.kind} | ${c.fCss} ` +
            `| [${c.ciLo}, ${c.ciHi}] | ${c.hFovDeg}° | ${c.vFovDeg}° | ${c.nKept}/${c.n} ` +
            `| ${c.dropFrac} (${c.nNccRejected} NCC, ${c.nMadRejected} MAD) | ${c.meanNcc} |`);
    }
    lines.push('', '## Aspect comparisons vs 3:2 control', '');
    lines.push('| pano | container | zoom | Δh (°) | Δv (°) | Δdiag (°) | Δlong (°) | tol (°) ' +
        '| h-inv | v-inv | long-inv | regime |');
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
        lines.push(`| ${d.panoName} | ${d.zoom} | ${d.hFovDeg}° | ${d.expected}° | ${d.errDeg} ` +
            `| ${d.pass ? 'yes' : 'NO'} |`);
    }
    lines.push('');
    return lines.join('\n');
}

/** @returns {string} PASS/FAIL label for a gate outcome. */
function pf(pass) {
    return pass ? 'PASS' : 'FAIL';
}

main();
