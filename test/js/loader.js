/**
 * Loads frontend/js source files into jsdom for the unit suites. Vitest runs them as the ES modules they are; the
 * module registry is reset per load so state can't leak between tests, and a suite that wants a collaborator replaced
 * says which module (`mockModule`) or which `util` member (`useUtil`) rather than relying on anything implicit.
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
 * Loads source files fresh and merges their exports. Files in one call share a registry, so one's import of another
 * is the instance the suite gets back; the suite's own loads are never redirected by `mockModule`.
 * @param {...string} paths - Repo-relative paths, e.g. "frontend/js/community/RouteListPage.js".
 * @returns {Promise<object>} Their exports, merged.
 */
export async function loadModules(...paths) {
    // A fresh registry each time, so state a module keeps between calls doesn't leak from one test into the next.
    vi.resetModules();
    liveUtil = null;
    const exports = {};
    // In order, since an earlier file may set up what a later one reads at import time.
    for (const p of paths) Object.assign(exports, await vi.importActual(abs(p)));
    // Again after the load, for members on a sub-object (`util.misc`, `util.math`) that a later file builds.
    if (liveUtil) applyUtilOverrides();
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
 * Undoes `mockModule`, so later loads get the real file again.
 * @param {string} relativePath - The path given to `mockModule`.
 */
export function unmockModule(relativePath) {
    fakedExports.delete(abs(relativePath));
    vi.doUnmock(abs(relativePath));
}

/** The members a suite put on `util` with `useUtil`, keyed as given. */
let utilOverrides = {};
/** The `util` of the most recent load, so `useUtil` can change it after the fact. */
let liveUtil = null;
/** What `liveUtil` held before the overrides went on, so a later `useUtil` can take them off again. */
let overridden = new Map();

/**
 * Makes `util`, as the modules under test import it, answer with the given members on top of the real ones: the real
 * utilities.js behind it, so only what a test needs changed is written out. A sub-object (`misc`, `math`) is merged
 * into the real one rather than replacing it. Calling it again replaces the previous set, and applies to a `util`
 * already loaded.
 * @param {object} [members] - E.g. `{ isMobile: () => true, misc: { getStreetNameNear } }`.
 */
export function useUtil(members = {}) {
    utilOverrides = members;
    if (liveUtil) applyUtilOverrides();
}

/** Takes the previous overrides off `liveUtil` and puts the current ones on. */
function applyUtilOverrides() {
    for (const [key, previous] of overridden) {
        if (previous === undefined) delete liveUtil[key];
        else liveUtil[key] = previous;
    }
    overridden = new Map();
    for (const [key, value] of Object.entries(utilOverrides)) {
        overridden.set(key, liveUtil[key]);
        const merge = isPlainObject(value) && isPlainObject(liveUtil[key]);
        liveUtil[key] = merge ? { ...liveUtil[key], ...value } : value;
    }
}

/** @returns {boolean} Whether `value` is an object literal (not a class instance, array or function). */
const isPlainObject = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

// Registered once, up front: the real util with the suite's members on top, whichever order the suite loads and
// overrides in. The getter is the transitional `stubUtil` seam, removed once every suite is on `useUtil`.
vi.doMock(abs(UTILITIES), async (importOriginal) => {
    const actual = await importOriginal();
    liveUtil = actual.util;
    overridden = new Map();
    applyUtilOverrides();
    return { ...actual, get util() { return Object.hasOwn(window, 'util') ? window.util : actual.util; } };
});

/**
 * Runs a vendored library into the page the way its <script> tag does. (Most of these bundles are UMD, but
 * i18next-http-backend is a plain `var x = (function(){...})()` script, which only a script evaluation makes global.)
 * Found by folder rather than by filename, which carries the version and would go stale on the next bump.
 * @param {string} folder - The library's folder under public/vendor/, e.g. "i18next".
 */
export function loadVendored(folder) {
    const dir = path.join(REPO_ROOT, 'public/vendor', folder);
    const bundle = fs.readdirSync(dir).find((name) => name.endsWith('.js'));
    if (!bundle) throw new Error(`no bundle in ${dir}`);
    window.eval(fs.readFileSync(path.join(dir, bundle), 'utf8'));
}

// ---- Transitional: the Jest-era seam, kept only until every suite is on the API above. ----

/** Per mocked file, the exports that read from `window` (fakeImport). */
const fakedExports = new Map();

/**
 * Makes a module's named exports read from `window` in whatever loads next.
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
 * Loads a source file fresh for its side effects alone.
 * @param {string} relativePath - Repo-relative path.
 */
export async function loadGlobalScript(relativePath) {
    await loadModules(relativePath);
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

/** @param {string} logicalPath - Path under public/. @returns {string} The unstamped asset URL. */
export const assetPathStub = (logicalPath) => `/assets/${logicalPath}`;

/** Installs the real `util.misc` onto the suite's `window.util`. */
export async function installUtilitiesMisc() {
    stubUtil(window.util || {});
    vi.resetModules();
    await import(abs('frontend/js/common/utilitiesSidewalk.js'));
}

/** Copies the real date helpers from utilities.js onto `window.util`. */
export async function installDateHelpers() {
    const { SHORT_DATE, SHORT_DATE_TIME, yearMonth, monthYear, parseDate, localIsoDate, timeAgo } = await realUtil();
    stubUtil(Object.assign(window.util || {},
        { SHORT_DATE, SHORT_DATE_TIME, yearMonth, monthYear, parseDate, localIsoDate, timeAgo }));
}

/** Adds the real `util.escapeHTML` to `window.util`. */
export async function installEscapeHTML() {
    stubUtil(Object.assign(window.util || {}, { escapeHTML: (await realUtil()).escapeHTML }));
}

/** @returns {Promise<object>} The real util. */
export async function realUtil() {
    return (await vi.importActual(abs(UTILITIES))).util;
}
