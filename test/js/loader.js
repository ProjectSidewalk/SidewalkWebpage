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

/** The factories registered with `mockModule`, by absolute path, re-registered on every load. */
const mocks = new Map();

/**
 * Loads source files fresh and merges their exports. Files in one call share a registry, so one's import of another
 * is the instance the suite gets back; the suite's own loads are never redirected by `mockModule`.
 * @param {...string} paths - Repo-relative paths, e.g. "frontend/js/community/RouteListPage.js".
 * @returns {Promise<object>} Their exports, merged.
 */
export async function loadModules(...paths) {
    // A fresh registry each time, so state a module keeps between calls doesn't leak from one test into the next.
    vi.resetModules();
    // Vitest keeps a mocked module's instance across that reset, so a factory would otherwise run once per file and
    // its `importOriginal` side effects (utilitiesSidewalk.js building `util.misc`, say) land on a `util` long gone.
    for (const [file, factory] of mocks) {
        vi.doUnmock(file);
        vi.doMock(file, factory);
    }
    await takeLiveUtilities();
    const exports = {};
    // In order, since an earlier file may set up what a later one reads at import time.
    for (const p of paths) Object.assign(exports, await vi.importActual(abs(p)));
    // Again after the load, for members on a sub-object (`util.misc`, `util.math`) that a later file builds.
    applyUtilOverrides();
    return exports;
}

/**
 * Replaces a source module with a fake for whatever `loadModules` loads next.
 * @param {string} relativePath - Repo-relative path, e.g. "frontend/js/common/Toast.js".
 * @param {(importOriginal: () => Promise<object>) => object | Promise<object>} factory - Builds the fake's exports;
 *   spread `await importOriginal()` to keep the ones it doesn't replace.
 */
export function mockModule(relativePath, factory) {
    mocks.set(abs(relativePath), factory);
    vi.doMock(abs(relativePath), factory);
}



/**
 * Undoes `mockModule`, so later loads get the real file again.
 * @param {string} relativePath - The path given to `mockModule`.
 */
export function unmockModule(relativePath) {
    mocks.delete(abs(relativePath));
    vi.doUnmock(abs(relativePath));
}

/** The members a suite put on `util` with `useUtil`, keyed as given. */
let utilOverrides = {};
/** utilities.js as the current registry has it; what the mock below hands every importer. */
let liveUtilities = null;
/** Per overridden `util` key, what went on and what it displaced, so a later `useUtil` can take it off again. */
let applied = new Map();

/**
 * Makes `util`, as the modules under test import it, answer with the given members on top of the real ones: the real
 * utilities.js behind it, so only what a test needs changed is written out. A sub-object (`misc`, `math`) is merged
 * into the real one rather than replacing it. Calling it again replaces the previous set, and applies to a `util`
 * already loaded.
 * @param {object} [members] - E.g. `{ isMobile: () => true, misc: { getStreetNameNear } }`.
 */
export function useUtil(members = {}) {
    utilOverrides = members;
    applyUtilOverrides();
}

/** Loads the real utilities.js into the fresh registry and puts the current overrides on its `util`. */
async function takeLiveUtilities() {
    liveUtilities = await vi.importActual(abs(UTILITIES));
    applied = new Map();
    applyUtilOverrides();
}

/**
 * Takes the previous overrides off the live `util` and puts the current ones on. Only what is still ours comes off:
 * a module loaded in between may have rebuilt a sub-object (utilitiesMath.js does `util.math = {}`), and that is the
 * real thing now.
 */
function applyUtilOverrides() {
    if (!liveUtilities) return;
    const util = liveUtilities.util;
    for (const [key, entry] of applied) {
        if (entry.members) {
            const sub = util[key];
            if (!isPlainObject(sub)) continue;
            for (const [subKey, m] of entry.members) {
                if (sub[subKey] !== m.value) continue;
                if (m.previous === undefined) delete sub[subKey];
                else sub[subKey] = m.previous;
            }
            if (sub === entry.created) delete util[key];
        } else if (util[key] === entry.value) {
            if (entry.previous === undefined) delete util[key];
            else util[key] = entry.previous;
        }
    }
    applied = new Map();
    for (const [key, value] of Object.entries(utilOverrides)) {
        if (isPlainObject(value) && isPlainObject(util[key])) {
            const members = new Map();
            for (const [subKey, subValue] of Object.entries(value)) {
                members.set(subKey, { previous: util[key][subKey], value: subValue });
                util[key][subKey] = subValue;
            }
            applied.set(key, { members });
        } else if (isPlainObject(value) && util[key] === undefined) {
            // The module that builds this sub-object has not loaded yet, and utilitiesSidewalk.js spreads whatever
            // `util.misc` already holds into the real one. Kept out of that spread, a stand-in never becomes the
            // "real" helper a later `useUtil` restores.
            const sub = {};
            const members = new Map();
            for (const [subKey, subValue] of Object.entries(value)) {
                Object.defineProperty(sub, subKey, { value: subValue, configurable: true, writable: true });
                members.set(subKey, { previous: undefined, value: subValue });
            }
            util[key] = sub;
            applied.set(key, { members, created: sub });
        } else {
            applied.set(key, { previous: util[key], value });
            util[key] = value;
        }
    }
}

/** @returns {boolean} Whether `value` is an object literal (not a class instance, array or function). */
const isPlainObject = (value) => (
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
);

// Registered once, up front. Vitest keeps a mocked module across `vi.resetModules()`, so the mock reads through to
// whatever utilities.js the current registry holds instead of the one it was first built from.
vi.doMock(abs(UTILITIES), async (importOriginal) => {
    const actual = await importOriginal();
    liveUtilities ??= actual;
    const mod = {};
    for (const key of Object.keys(actual)) {
        Object.defineProperty(mod, key, { enumerable: true, get: () => liveUtilities[key] });
    }
    return mod;
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
