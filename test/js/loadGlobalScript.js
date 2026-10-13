/**
 * Loads frontend/js source files into jsdom. Vitest runs them as the ES modules they are; the module registry is
 * reset per load so state can't leak, and a suite that wants a collaborator faked says which module and which export
 * (`mockModule`, `fakeImport`, `stubUtil`) rather than relying on anything implicit.
 */

import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';

// Repo root is two levels up from test/js/.
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

const UTILITIES = 'frontend/js/common/utilities.js';

/** @returns {string} The absolute path of a repo-relative (or already absolute) one. */
const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));

/**
 * Loads a source file fresh for its side effects alone (what it sets on `window`, listeners it registers).
 * @param {string} relativePath - Repo-relative path, e.g. "frontend/js/api-docs/aggregateStatsPreview.js".
 */
export async function loadGlobalScript(relativePath) {
    vi.resetModules();
    await vi.importActual(abs(relativePath));
}

/**
 * Loads source files fresh and merges their exports. Files in one call share a registry, so one's import of another
 * is the instance the suite gets back; the suite's own loads are never redirected by `mockModule` or `fakeImport`.
 * @param {...string} paths - Repo-relative (or absolute) paths, e.g. "frontend/js/community/RouteListPage.js".
 * @returns {Promise<object>} Their exports, merged.
 */
export async function loadModules(...paths) {
    // A fresh registry each time, so state a module keeps between calls doesn't leak from one test into the next.
    vi.resetModules();
    const exports = {};
    // In order, since an earlier file may set up what a later one reads at import time.
    for (const p of paths) Object.assign(exports, await vi.importActual(abs(p)));
    return exports;
}

/**
 * Replaces a source module with a fake for whatever `loadModules` loads next.
 * @param {string} relativePath - Repo-relative path, e.g. "frontend/js/common/Toast.js".
 * @param {(importOriginal: () => Promise<object>) => object | Promise<object>} factory - Builds the fake's exports;
 *   spread `await importOriginal()` to keep the ones it doesn't replace.
 */
export function mockModule(relativePath, factory) {
    vi.doMock(abs(relativePath), factory);
}

/**
 * Undoes `mockModule` or `fakeImport`, so later loads get the real file again.
 * @param {string} relativePath - The path given to `mockModule`.
 */
export function unmockModule(relativePath) {
    fakedExports.delete(abs(relativePath));
    vi.doUnmock(abs(relativePath));
}

/** Per mocked file, the exports that read from `window` (fakeImport). */
const fakedExports = new Map();

/**
 * Makes a module's named exports read from `window` in whatever loads next: an import of `Toast` gets `window.Toast`
 * while the suite has set one, and the real export otherwise. The fake stays on `window`, where the suite asserts on it.
 * @param {string} relativePath - Repo-relative path of the module whose export is faked.
 * @param {...string} names - The exports to redirect.
 */
export function fakeImport(relativePath, ...names) {
    const file = abs(relativePath);
    const faked = fakedExports.get(file) ?? new Set();
    names.forEach((name) => faked.add(name));
    fakedExports.set(file, faked);
    vi.doMock(file, async (importOriginal) => {
        const actual = await importOriginal();
        const mod = { ...actual };
        for (const name of faked) {
            Object.defineProperty(mod, name, {
                enumerable: true,
                get: () => (Object.hasOwn(window, name) ? window[name] : actual[name]),
            });
        }
        return mod;
    });
}

/**
 * Installs the suite's `util` as what modules import from utilities.js, and keeps it on `window.util`.
 * @param {object} fake - The util object the modules under test should see.
 * @returns {object} The same object.
 */
export function stubUtil(fake) {
    window.util = fake;
    return fake;
}

// Registered up front so a suite may install its util after loading the subject (which reads it at call time anyway).
fakeImport(UTILITIES, 'util');

/**
 * Evaluates a vendored library into the page, the way its <script> tag would.
 *
 * Found by folder rather than by filename, which carries the version and would go stale on the next bump.
 *
 * @param {string} folder - The library's folder under public/vendor/, e.g. "i18next".
 */
export function loadVendored(folder) {
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
export const assetPathStub = (logicalPath) => `/assets/${logicalPath}`;

/**
 * Stamps `window.labelTypes` the way main.scala.html does, so `util.misc` has a label-type table to build from.
 *
 * The fixture is a committed copy of what LabelType serializes, and LabelTypeSpec fails if the two diverge —
 * so this can't quietly become the stale duplicate that sourcing the table from the backend was meant to remove.
 */
export function stampLabelTypes() {
    const fixture = path.join(REPO_ROOT, 'test/resources/label-types-stamp.json');
    window.labelTypes = JSON.parse(fs.readFileSync(fixture, 'utf8'));
}

/**
 * Installs the real `util.misc` (frontend/js/common/utilitiesSidewalk.js) onto the suite's `window.util`.
 *
 * For suites that want the genuine helper rather than a copy of its logic — `labelMarkerFraction` above all, which
 * three separate card surfaces share, so a stub in each would be three chances to drift from the thing they call.
 * `util.assetPath` must already be set, since `getIconImagePaths` builds its paths through it.
 */
export async function installUtilitiesMisc() {
    stampLabelTypes();
    stubUtil(window.util || {});
    // A fresh evaluation, so util.misc lands on the `util` the suite has on window right now.
    vi.resetModules();
    await import(abs('frontend/js/common/utilitiesSidewalk.js'));
}

/**
 * Copies the real date helpers from utilities.js onto `window.util`, leaving the suite's own stubs alone.
 */
export async function installDateHelpers() {
    const { SHORT_DATE, SHORT_DATE_TIME, yearMonth, monthYear, parseDate, localIsoDate, timeAgo } = await realUtil();
    stubUtil(Object.assign(window.util || {},
        { SHORT_DATE, SHORT_DATE_TIME, yearMonth, monthYear, parseDate, localIsoDate, timeAgo }));
}

/**
 * Adds the real `util.escapeHTML` to `window.util`, keeping the suite's own stubs.
 */
export async function installEscapeHTML() {
    stubUtil(Object.assign(window.util || {}, { escapeHTML: (await realUtil()).escapeHTML }));
}

/**
 * The `util` object utilities.js builds, untouched by any fake a suite has put on window.
 * @returns {Promise<object>} The real util.
 */
export async function realUtil() {
    return (await vi.importActual(abs(UTILITIES))).util;
}
