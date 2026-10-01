/**
 * Test helper: load a production "global script" IIFE into the current jsdom context.
 *
 * Project Sidewalk's frontend has no module system — files under public/js are plain scripts that are
 * concatenated by Grunt and assign their public surface onto `window` (e.g. `window.AggregateStatsPreview = {...}`).
 *
 * Under Jest's jsdom test environment, `window`, `document`, `fetch`, `console`, `Promise`, etc. are exposed as Node
 * globals to every module Jest loads, AND jsdom's `window` is wired so that bare `window`/`document` references inside
 * a required file resolve to the page's window. So the simplest faithful way to "run a <script>" is to `require()` the
 * file: its top-level IIFE executes and performs its `window.X = ...` assignment, which the test then reads off the
 * global `window`. We bust Jest's module cache each load so config mutations from one test's setup() don't leak into
 * the next (these modules keep a module-scoped `config` singleton).
 */

const fs = require('fs');
const path = require('path');

// Repo root is two levels up from test/js/.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Read a production JS file (relative to repo root) and execute it in the jsdom global scope, returning fresh.
 * @param {string} relativePath - Path to the script relative to the repo root, e.g.
 *   "public/js/api-docs/aggregateStatsPreview.js".
 */
function loadGlobalScript(relativePath) {
    const absPath = path.join(REPO_ROOT, relativePath);
    // Jest maintains its own module registry (Node's require.cache is bypassed), so jest.resetModules() is what forces
    // the IIFE to re-run on the next require — giving each test a fresh module-scoped `config` singleton.
    jest.resetModules();
    require(absPath);
}

/**
 * Evaluates a vendored library into the page, the way its <script> tag would.
 *
 * Found by folder rather than by filename, which carries the version and would go stale on the next bump.
 *
 * @param {string} folder - The library's folder under public/vendor/, e.g. "i18next".
 */
function loadVendored(folder) {
    const dir = path.join(REPO_ROOT, 'public/vendor', folder);
    const bundle = fs.readdirSync(dir).find((name) => name.endsWith('.js'));
    if (!bundle) throw new Error(`no bundle in ${dir}`);
    window.eval(fs.readFileSync(path.join(dir, bundle), 'utf8'));
}

/**
 * Stands in for `util.assetPath` in suites that assemble their own minimal `util` instead of loading utilities.js.
 *
 * Returns the unstamped result — plain `/assets/<logical path>` — which is what any page without a
 * `window.assetDigests` stamp gets, jsdom included. The real helper is pinned in assetPath.test.js.
 *
 * @param {string} logicalPath - Path under public/, e.g. "images/icons/openhand.cur".
 * @returns {string} The asset URL.
 */
const assetPathStub = (logicalPath) => `/assets/${logicalPath}`;

/**
 * Stamps `window.labelTypes` the way main.scala.html does, so `util.misc` has a label-type table to build from.
 *
 * The fixture is a committed copy of what LabelType serializes, and LabelTypeSpec fails if the two diverge —
 * so this can't quietly become the stale duplicate that sourcing the table from the backend was meant to remove.
 */
function stampLabelTypes() {
    const fixture = path.join(REPO_ROOT, 'test/resources/label-types-stamp.json');
    window.labelTypes = JSON.parse(fs.readFileSync(fixture, 'utf8'));
}

/**
 * Installs the real `util.misc` (public/js/common/utilitiesSidewalk.js) onto an already-stubbed `window.util`.
 *
 * For suites that want the genuine helper rather than a copy of its logic — `labelMarkerFraction` above all, which
 * three separate card surfaces share, so a stub in each would be three chances to drift from the thing they call.
 * `window.util = window.util || {}` at the top of the source means the caller's own fields survive; `util.assetPath`
 * must already be set, since `getIconImagePaths` builds its paths through it.
 */
function installUtilitiesMisc() {
    stampLabelTypes();
    window.eval(fs.readFileSync(path.join(REPO_ROOT, 'public/js/common/utilitiesSidewalk.js'), 'utf8'));
}

/**
 * Copies the real date helpers from utilities.js onto `window.util`, leaving the suite's own stubs alone.
 *
 * The file runs inside a function with stand-in `window` and `document`, so its top-level functions (camelToKebab
 * and friends) and listeners stay out of the page the suite built.
 */
function installDateHelpers() {
    const scratch = {};
    const scratchWindow = { util: scratch, navigator: window.navigator, addEventListener: () => {} };
    const scratchDocument = { readyState: 'complete', addEventListener: () => {} };
    const src = fs.readFileSync(path.join(REPO_ROOT, 'public/js/common/utilities.js'), 'utf8');
    new Function('window', 'document', 'util', src)(scratchWindow, scratchDocument, scratch);
    const { SHORT_DATE, SHORT_DATE_TIME, yearMonth, monthYear, parseDate, localIsoDate, timeAgo } = scratch;
    window.util = Object.assign(window.util || {},
        { SHORT_DATE, SHORT_DATE_TIME, yearMonth, monthYear, parseDate, localIsoDate, timeAgo });
}

module.exports = {
    loadGlobalScript, loadVendored, REPO_ROOT, assetPathStub, installUtilitiesMisc, installDateHelpers, stampLabelTypes,
};
