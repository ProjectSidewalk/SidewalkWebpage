/**
 * GSV FOV probe recorder (issue #5083): drives probe.html through Playwright and records the screenshot
 * pairs + metadata that analyze.mjs turns into focal-length measurements. See README.md for the protocol,
 * pre-registered decision rules, and how to reproduce a run.
 *
 * Preconditions: the dev app serving on BASE_URL (default http://localhost:9000 — the probe page is served
 * on that origin so tutorial-pano tiles resolve and the Maps key sees the app's own referer), and a real
 * Google Maps API key (env GOOGLE_MAPS_API_KEY, or scraped from the served app page when unset).
 *
 * Usage:
 *   node tools/gsv-fov-probe/record.mjs [--control-only] [--configs a,b] [--panos x,y] [--zooms 1,2]
 *     [--loads N] [--maps-version weekly|quarterly] [--headed] [--out DIR] [--resume <run-dir|latest>]
 *
 * --resume continues an interrupted run in place: loads whose completion marker is already in that run's
 * manifest are skipped, everything else is (re-)recorded into the same directory.
 *
 * Output: runs/<ISO-timestamp>/<pano>/<container>/load<N>/*.png plus a run-level manifest.json (written
 * incrementally, so an interrupted run keeps its completed captures). Raw screenshots of live imagery stay
 * local (runs/ is gitignored); only derived numbers are committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const { rgbaToGray, laplacianVariance } = require('./estimator.cjs');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:9000';
const PROBE_PATH = '/gsv-fov-probe';

/**
 * Container configurations. Aspect coverage per the pre-registered protocol: 3:2 control, matched-height and
 * matched-width 16:9, 21:9, portrait, square, a 2x-size 3:2 (size invariance vs pixel-count clamping), and a
 * DSF-2 control (CSS-px vs backing-store pinning).
 */
const CONTAINERS = [
    { name: 'control-720x480', width: 720, height: 480, dsf: 1 },
    { name: 'wide169h-854x480', width: 854, height: 480, dsf: 1 },
    { name: 'wide219h-1120x480', width: 1120, height: 480, dsf: 1 },
    { name: 'wide169w-720x405', width: 720, height: 405, dsf: 1 },
    { name: 'portrait-480x853', width: 480, height: 853, dsf: 1 },
    { name: 'square-480x480', width: 480, height: 480, dsf: 1 },
    { name: 'size2x-1440x960', width: 1440, height: 960, dsf: 1 },
    { name: 'dpr2-720x480', width: 720, height: 480, dsf: 2 },
    // Clamp-boundary discriminators (README amendment 2): extreme enough that the width-pinned vFov leaves
    // the ~[15°, 90°] clamp window at zooms the milder containers cannot bind, pinning whether each bound
    // is zoom-dependent.
    { name: 'xportrait-360x1000', width: 360, height: 1000, dsf: 1 },
    { name: 'xwide-2400x480', width: 2400, height: 480, dsf: 1 },
];

/**
 * Scenes. The tutorial pano is the deterministic control (version-pinned local tiles). Live panos are
 * resolved from fixed coordinates at record time; the manifest records the resolved pano id + imagery date +
 * worldSize so the report can classify generation and a replay can compare against the same imagery.
 */
const PANOS = [
    { name: 'tutorial', pano: 'tutorial' },
    { name: 'dc-tutorial-site', location: { lat: 38.94042608, lng: -77.06766133 } },
    { name: 'seattle-downtown', location: { lat: 47.60555, lng: -122.33306 } },
    { name: 'teaneck-residential', location: { lat: 40.88586, lng: -74.01252 } },
];

const ZOOMS = [1, 2, 3];
const DELTAS_DEG = [1, 2, 4];
const EXTRA_DELTA_ZOOM1 = 8; // Model-validation gate: f must agree across a 1..8-degree delta range at zoom 1.
const H0_CANDIDATES = [0, 45, 90, 135, 180, 225, 270, 315];
const H0_KEEP = 4;
const SEAM_MARGIN_DEG = 20;
const PITCH_DELTA_DEG = 2; // One pitch pair per h0 at zoom 2: vertical-focal anisotropy check.
const SETTLE = { minShots: 3, minElapsedMs: 600, intervalMs: 150, timeoutMs: 10000 };

const args = parseArgs(process.argv.slice(2));

/**
 * Minimal flag parser for the CLI documented in the file header.
 * @param {string[]} argv - Raw arguments.
 * @returns {object} Parsed options.
 */
function parseArgs(argv) {
    const out = { loads: 2, mapsVersion: 'weekly', out: path.join(HERE, 'runs'), headed: false, controlOnly: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--control-only') out.controlOnly = true;
        else if (a === '--headed') out.headed = true;
        else if (a === '--configs') out.configs = argv[++i].split(',');
        else if (a === '--panos') out.panos = argv[++i].split(',');
        else if (a === '--zooms') out.zooms = argv[++i].split(',').map(Number);
        else if (a === '--loads') out.loads = Number(argv[++i]);
        else if (a === '--maps-version') out.mapsVersion = argv[++i];
        else if (a === '--out') out.out = argv[++i];
        else if (a === '--resume') out.resume = argv[++i];
        else throw new Error(`Unknown argument: ${a}`);
    }
    return out;
}

/**
 * Finds the Maps API key: env var first, else scraped from the served app page (the same key the real app
 * boots with). The key is used only in the in-memory served HTML — never written to any run artifact.
 * @returns {Promise<string>} The API key.
 */
async function resolveApiKey() {
    if (process.env.GOOGLE_MAPS_API_KEY) return process.env.GOOGLE_MAPS_API_KEY;
    const resp = await fetch(`${BASE_URL}/`);
    const html = await resp.text();
    const m = html.match(/key:\s*"([^"]+)"/);
    if (!m) throw new Error(`Could not find a Maps API key on ${BASE_URL}/ — set GOOGLE_MAPS_API_KEY.`);
    return m[1];
}

/**
 * Screenshots the pano rendering surface until it stops changing: at least minShots captures, at least
 * minElapsedMs after the POV change, and the last two captures byte-identical. This one loop subsumes
 * pan tweening, tile arrival, progressive LOD sharpening, and the initial fade — both shots of every
 * measurement pair are terminal-state renders.
 *
 * @param {import('@playwright/test').Locator} target - Element to capture.
 * @returns {Promise<{shot: Buffer, iters: number, settled: boolean, elapsedMs: number}>} Final capture.
 */
async function settleScreenshot(target) {
    const t0 = Date.now();
    let prev = null;
    let iters = 0;
    for (;;) {
        let shot;
        try {
            shot = await target.screenshot({ animations: 'disabled', timeout: 8000 });
        } catch (e) {
            // A transient capture failure counts against the settle budget rather than killing the load.
            if (Date.now() - t0 > SETTLE.timeoutMs * 2) throw e;
            await new Promise((r) => setTimeout(r, SETTLE.intervalMs));
            continue;
        }
        iters++;
        const elapsed = Date.now() - t0;
        if (prev && shot.equals(prev) && iters >= SETTLE.minShots && elapsed >= SETTLE.minElapsedMs) {
            return { shot, iters, settled: true, elapsedMs: elapsed };
        }
        if (elapsed > SETTLE.timeoutMs) return { shot, iters, settled: false, elapsedMs: elapsed };
        prev = shot;
        await new Promise((r) => setTimeout(r, SETTLE.intervalMs));
    }
}

/**
 * Texture score of a PNG buffer's central region — the recorder picks measurement headings by this.
 * @param {Buffer} pngBuf - Encoded PNG.
 * @returns {number} Laplacian variance of the central 40% region.
 */
function centralTexture(pngBuf) {
    const png = PNG.sync.read(pngBuf);
    const gray = rgbaToGray(png.data, png.width, png.height);
    const rx = Math.floor(png.width * 0.3), ry = Math.floor(png.height * 0.3);
    return laplacianVariance(gray, png.width, png.height,
        { x0: rx, y0: ry, x1: png.width - rx, y1: png.height - ry });
}

/** @returns {number} Smallest absolute angular difference between two headings, degrees. */
function headingDist(a, b) {
    const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
    return d;
}

async function main() {
    const apiKey = await resolveApiKey();
    const probeHtml = fs.readFileSync(path.join(HERE, 'probe.html'), 'utf8')
        .replaceAll('__GMAPS_KEY__', () => apiKey)
        .replaceAll('__MAPS_VERSION__', () => args.mapsVersion);

    let runDir;
    if (args.resume) {
        runDir = args.resume === 'latest'
            ? path.join(args.out, fs.readdirSync(args.out)
                .filter((d) => fs.existsSync(path.join(args.out, d, 'manifest.json'))).sort().at(-1))
            : args.resume;
    } else {
        runDir = path.join(args.out, new Date().toISOString().replace(/[:.]/g, '-'));
    }
    fs.mkdirSync(runDir, { recursive: true });

    const manifest = args.resume ? {
        ...JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8')),
        resumedAt: new Date().toISOString(),
    } : {
        startedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        mapsVersionRequested: args.mapsVersion,
        argv: process.argv.slice(2),
        playwrightVersion: require('@playwright/test/package.json').version,
        settleConfig: SETTLE,
        protocol: { zooms: ZOOMS, deltasDeg: DELTAS_DEG, extraDeltaZoom1: EXTRA_DELTA_ZOOM1,
            h0Candidates: H0_CANDIDATES, h0Keep: H0_KEEP, seamMarginDeg: SEAM_MARGIN_DEG,
            pitchDeltaDeg: PITCH_DELTA_DEG },
        panos: {},
        loads: [],
        captures: [],
    };
    const saveManifest = () => fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const containers = CONTAINERS
        .filter((c) => !args.controlOnly || c.name === 'control-720x480')
        .filter((c) => !args.configs || args.configs.includes(c.name));
    const panos = PANOS.filter((p) => !args.panos || args.panos.includes(p.name));
    const zooms = args.zooms ?? ZOOMS;

    // Each load gets a FRESH browser process: a wedged renderer/network stack in one load (observed as a
    // hung screenshot followed by every later Maps script fetch failing in the same process) must not be
    // able to take down the rest of the sweep. Failed loads get one retry after a backoff.
    for (const pano of panos) {
        for (const container of containers) {
            for (let load = 1; load <= args.loads; load++) {
                const label = `${pano.name}/${container.name}/load${load}`;
                if (manifest.loads.some((l) => l.label === label && l.completed)) {
                    console.log(`=== ${label} already recorded, skipping ===`);
                    continue;
                }
                console.log(`=== ${label} (maps ${args.mapsVersion}) ===`);
                const dir = path.join(runDir, pano.name, container.name, `load${load}`);
                for (let attempt = 1; attempt <= 2; attempt++) {
                    fs.rmSync(dir, { recursive: true, force: true });
                    fs.mkdirSync(dir, { recursive: true });
                    manifest.captures = manifest.captures.filter((c) =>
                        !(c.panoName === pano.name && c.containerName === container.name && c.load === load));
                    const browser = await chromium.launch({ headless: !args.headed });
                    try {
                        await recordLoad({ browser, probeHtml, pano, container, load, zooms, dir, runDir, manifest, label });
                        break;
                    } catch (e) {
                        console.error(`FAILED ${label} (attempt ${attempt}): ${e.stack}`);
                        manifest.loads.push({ label, attempt, error: String(e) });
                        if (attempt === 1) await new Promise((r) => setTimeout(r, 20000));
                    } finally {
                        await browser.close();
                    }
                }
                saveManifest();
                await new Promise((r) => setTimeout(r, 2000));
            }
        }
    }
    manifest.finishedAt = new Date().toISOString();
    saveManifest();
    console.log(`Run complete: ${runDir} (${manifest.captures.length} captures)`);
}

/**
 * Records one full page-load's worth of captures for a (pano, container) configuration: renderer assertion,
 * texture-based h0 selection, then the symmetric heading pairs per zoom and the pitch pairs at zoom 2.
 * @param {object} ctx - Everything the load needs (browser, served HTML, config, output dir, manifest).
 */
async function recordLoad(ctx) {
    const { browser, probeHtml, pano, container, load, zooms, dir, runDir, manifest, label } = ctx;
    const context = await browser.newContext({
        viewport: { width: container.width + 60, height: container.height + 60 },
        deviceScaleFactor: container.dsf,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    try {
        await page.route(`${BASE_URL}${PROBE_PATH}`, (route) =>
            route.fulfill({ contentType: 'text/html', body: probeHtml }));
        await page.goto(`${BASE_URL}${PROBE_PATH}`);

        const init = await page.evaluate(
            (cfg) => window.__probe.init(cfg),
            { width: container.width, height: container.height, pano: pano.pano, location: pano.location });
        manifest.panos[pano.name] ??= init.meta;

        // WebGL renderer assertion — the 2D fallback renders through a different projection curve entirely.
        // The render canvas mounts asynchronously after pano_changed, so give it time to appear.
        await page.waitForFunction(() => window.__probe.getState().renderer.fullSizeCanvas, { timeout: 20000 })
            .catch(() => {});
        const census = await page.evaluate(() => window.__probe.getState().renderer);
        if (!census.fullSizeCanvas) {
            throw new Error(`Renderer assertion failed (no container-filling canvas): ${JSON.stringify(census)}`);
        }

        const target = page.locator('#pano canvas').first();

        // h0 selection: score candidate headings by central texture at zoom 1, keep the best H0_KEEP that
        // are mutually >=30 degrees apart and >=SEAM_MARGIN_DEG from the tile seam (centerHeading + 180).
        const seam = init.meta.centerHeading != null ? (init.meta.centerHeading + 180) % 360 : null;
        const scored = [];
        for (const h of H0_CANDIDATES) {
            if (seam != null && headingDist(h, seam) < SEAM_MARGIN_DEG) continue;
            await page.evaluate((p) => window.__probe.setPov(p), { heading: h, pitch: 0, zoom: 1 });
            const s = await settleScreenshot(target);
            scored.push({ h, score: centralTexture(s.shot), settled: s.settled });
        }
        scored.sort((a, b) => b.score - a.score);
        const h0s = [];
        for (const c of scored) {
            if (h0s.length >= H0_KEEP) break;
            if (h0s.every((h) => headingDist(h, c.h) >= 30)) h0s.push(c.h);
        }
        manifest.loads.push({ label, h0Scores: scored, h0s, consoleErrorsAtSelect: [...consoleErrors] });
        console.log(`  h0s: ${h0s.join(', ')}`);

        const capture = async (kind, zoom, h0, deltaDeg, side, requested) => {
            const state = await page.evaluate((p) => window.__probe.setPov(p), requested);
            const s = await settleScreenshot(target);
            const name = `${kind}-z${zoom}-h${h0}-d${deltaDeg}-${side}.png`.replace(/[^\w.-]/g, '_');
            const abs = path.join(dir, name);
            fs.writeFileSync(abs, s.shot);
            manifest.captures.push({
                file: path.relative(runDir, abs),
                panoName: pano.name, containerName: container.name,
                width: container.width, height: container.height, dsf: container.dsf, load,
                kind, zoom, h0, deltaDeg, side, requested, state,
                settle: { iters: s.iters, settled: s.settled, elapsedMs: s.elapsedMs },
            });
        };

        for (const zoom of zooms) {
            const deltas = zoom === 1 ? [...DELTAS_DEG, EXTRA_DELTA_ZOOM1] : DELTAS_DEG;
            for (const h0 of h0s) {
                for (const d of deltas) {
                    await capture('yaw', zoom, h0, d, 'a', { heading: h0 - d / 2, pitch: 0, zoom });
                    await capture('yaw', zoom, h0, d, 'b', { heading: h0 + d / 2, pitch: 0, zoom });
                }
            }
        }
        if (zooms.includes(2)) {
            for (const h0 of h0s) {
                await capture('pitch', 2, h0, PITCH_DELTA_DEG, 'a',
                    { heading: h0, pitch: -PITCH_DELTA_DEG / 2, zoom: 2 });
                await capture('pitch', 2, h0, PITCH_DELTA_DEG, 'b',
                    { heading: h0, pitch: PITCH_DELTA_DEG / 2, zoom: 2 });
            }
        }
        const entry = manifest.loads.findLast((l) => l.label === label && !l.error);
        entry.consoleErrors = consoleErrors;
        entry.completed = true;
    } finally {
        await context.close();
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
