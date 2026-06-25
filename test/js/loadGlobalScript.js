/**
 * Test helper: load a production "global script" IIFE into the current jsdom context.
 *
 * Project Sidewalk's frontend has no module system — files under public/javascripts are plain scripts that are
 * concatenated by Grunt and assign their public surface onto `window` (e.g. `window.AggregateStatsPreview = {...}`).
 *
 * Under Jest's jsdom test environment, `window`, `document`, `fetch`, `console`, `Promise`, etc. are exposed as Node
 * globals to every module Jest loads, AND jsdom's `window` is wired so that bare `window`/`document` references inside
 * a required file resolve to the page's window. So the simplest faithful way to "run a <script>" is to `require()` the
 * file: its top-level IIFE executes and performs its `window.X = ...` assignment, which the test then reads off the
 * global `window`. We bust Jest's module cache each load so config mutations from one test's setup() don't leak into
 * the next (these modules keep a module-scoped `config` singleton).
 */

const path = require('path');

// Repo root is two levels up from test/js/.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Read a production JS file (relative to repo root) and execute it in the jsdom global scope, returning fresh.
 * @param {string} relativePath - Path to the script relative to the repo root, e.g.
 *   "public/javascripts/api-docs/aggregate-stats-preview.js".
 */
function loadGlobalScript(relativePath) {
    const absPath = path.join(REPO_ROOT, relativePath);
    // Jest maintains its own module registry (Node's require.cache is bypassed), so jest.resetModules() is what forces
    // the IIFE to re-run on the next require — giving each test a fresh module-scoped `config` singleton.
    jest.resetModules();
    require(absPath);
}

module.exports = { loadGlobalScript, REPO_ROOT };
