#!/usr/bin/env node
// Cross-locale key-parity and empty-value checks for the i18next translation files under public/locales/.
//
// The i18n-aware companion to the @eslint/json rules in eslint.config.js, which cover per-file JSON validity. Two
// i18n realities make a plain "every locale must have exactly the reference's keys" comparison wrong:
//
//   1. i18next plural suffixes. A key can appear as `foo_one`, `foo_other`, `foo_few`, ... and which suffixes exist
//      depends on the language's CLDR plural rules -- Chinese (zh-TW) has only `_other`, English has `_one`/`_other`,
//      Polish has `_one`/`_few`/`_many`/`_other`. So we compare *normalized* keys (plural suffix stripped) rather than
//      raw keys.
//   2. Override-only locales. The regional overlays (en-US, en-NZ) and the per-city overlays (`*-zurich`, `*-india`)
//      intentionally hold only the subset of keys they change and fall back to their base locale/namespace. For these
//      we only flag keys that don't exist in the reference at all (typos / stale keys), never missing keys.
//
// The `en` locale is the reference. Full locales are compared for exact key parity; override-only files are compared
// as subsets. Every file, reference included, is also checked for values that aren't a non-empty string. Exits
// non-zero (and prints the offending files/keys) if anything is found, so it can gate CI.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'locales');
const REFERENCE_LOCALE = 'en';

// Locales that deliberately override only a subset of the reference's keys (regional English variants that fall back
// to `en`). Per-city overlay *files* (`common-zurich.json`, `audit-india.json`, ...) are detected structurally below.
const OVERRIDE_ONLY_LOCALES = new Set(['en-US', 'en-NZ']);

// CLDR plural categories i18next appends as `_<category>` suffixes; stripped before comparing key sets.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/**
 * Recursively collect the leaf key paths of a translation object (e.g. `right-ui.badges.next-labels_one`).
 *
 * @param {object} obj - Parsed translation JSON (or a nested sub-object).
 * @param {string} [prefix] - Accumulated dotted path prefix for recursion.
 * @returns {string[]} Dotted paths of every leaf (string) value.
 */
function leafKeys(obj, prefix = '') {
    return Object.entries(obj).flatMap(([key, value]) =>
        value && typeof value === 'object' ? leafKeys(value, `${prefix}${key}.`) : [`${prefix}${key}`]);
}

/**
 * Parse a translation file, or null if it's missing or invalid -- validity is @eslint/json's job, not this script's.
 *
 * @param {string} filePath - Absolute path to the JSON file.
 * @returns {object|null} The parsed translations.
 */
function readTranslations(filePath) {
    if (!existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Leaf keys with i18next plural suffixes normalized away, so languages with different plural-category counts compare
 * as equal.
 *
 * @param {object|null} parsed - Parsed translations, or null for a missing/invalid file.
 * @returns {Set<string>} Normalized leaf key set.
 */
function normalizedKeySet(parsed) {
    return parsed ? new Set(leafKeys(parsed).map(key => key.replace(PLURAL_SUFFIX, ''))) : new Set();
}

// The reference's key sets are compared against once per locale file, so parse each namespace once rather than 63x.
const referenceKeysByNamespace = new Map();

/** @returns {Set<string>} The reference locale's normalized keys for a base namespace. */
function referenceKeySet(baseNamespace) {
    if (!referenceKeysByNamespace.has(baseNamespace)) {
        const path = join(LOCALES_DIR, REFERENCE_LOCALE, `${baseNamespace}.json`);
        referenceKeysByNamespace.set(baseNamespace, normalizedKeySet(readTranslations(path)));
    }
    return referenceKeysByNamespace.get(baseNamespace);
}

/**
 * Collect leaf values that aren't a usable translation string.
 *
 * i18next only falls back when a key is *absent*, so an empty string is a silent blank in the UI rather than a
 * fallback to the reference locale. An empty object holds no keys at all, so the parity comparison can't see it.
 *
 * @param {object} obj - Parsed translation JSON (or a nested sub-object).
 * @param {string} [prefix] - Accumulated dotted path prefix for recursion.
 * @returns {Array<{path: string, reason: string}>} One entry per unusable leaf.
 */
function unusableValues(obj, prefix = '') {
    return Object.entries(obj).flatMap(([key, value]) => {
        const path = `${prefix}${key}`;
        if (typeof value === 'string') return value.trim() === '' ? [{ path, reason: 'empty string' }] : [];
        if (Array.isArray(value)) return [{ path, reason: 'array' }];
        if (value && typeof value === 'object') {
            return Object.keys(value).length ? unusableValues(value, `${path}.`) : [{ path, reason: 'empty object' }];
        }
        return [{ path, reason: `${value === null ? 'null' : typeof value}, not a string` }];
    });
}

/** @returns {string[]} The `.json` filenames directly inside a locale directory. */
function localeFiles(locale) {
    return readdirSync(join(LOCALES_DIR, locale)).filter(name => name.endsWith('.json'));
}

// The reference locale's base namespaces (files whose name has no `-` city suffix): common, validate, audit, ...
const baseNamespaces = localeFiles(REFERENCE_LOCALE)
    .map(name => name.replace(/\.json$/, ''))
    .filter(stem => !stem.includes('-'));

const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

const problems = [];

for (const locale of locales) {
    const isOverrideOnlyLocale = OVERRIDE_ONLY_LOCALES.has(locale);

    for (const file of localeFiles(locale)) {
        const stem = file.replace(/\.json$/, '');

        const parsed = readTranslations(join(LOCALES_DIR, locale, file));
        const problem = { file: `${locale}/${file}` };
        if (parsed) problem.unusable = unusableValues(parsed);

        const baseNamespace = stem.split('-')[0];
        const isCityOverlay = stem.includes('-');

        // The reference for any file is the reference locale's *base* namespace (e.g. `common-zurich.json` and
        // `en-US/common.json` both compare against `en/common.json`).
        // The reference's own base-namespace files have nothing to compare against (they'd compare to themselves).
        // Its city overlays are still worth subset-checking against the base namespace. An unknown namespace has
        // nothing to compare against either -- but its values were still worth checking above.
        const comparable = baseNamespaces.includes(baseNamespace) && !(locale === REFERENCE_LOCALE && !isCityOverlay);
        if (comparable) {
            const referenceKeys = referenceKeySet(baseNamespace);
            const localeKeys = normalizedKeySet(parsed);

            problem.unknown = [...localeKeys].filter(key => !referenceKeys.has(key));
            // Override-only: only unknown/typo'd keys are errors; missing keys are the intended fallback behavior.
            if (!isOverrideOnlyLocale && !isCityOverlay) {
                problem.missing = [...referenceKeys].filter(key => !localeKeys.has(key));
            }
        }

        if (problem.unusable?.length || problem.missing?.length || problem.unknown?.length) problems.push(problem);
    }

    // Full locales must carry every base namespace file; a whole missing file is drift the per-file loop can't see.
    if (locale !== REFERENCE_LOCALE && !isOverrideOnlyLocale) {
        for (const namespace of baseNamespaces) {
            if (!existsSync(join(LOCALES_DIR, locale, `${namespace}.json`))) {
                problems.push({ file: `${locale}/${namespace}.json`, missingFile: true });
            }
        }
    }
}

if (problems.length === 0) {
    console.log(`Locale checks OK -- all locales consistent with '${REFERENCE_LOCALE}', no empty values.`);
    process.exit(0);
}

console.error(`Locale checks failed (${problems.length} problem(s), reference locale '${REFERENCE_LOCALE}'):\n`);
for (const { file, missingFile, missing, unknown, unusable } of problems) {
    if (missingFile) {
        console.error(`  ${file}\n    - entire namespace file is missing`);
        continue;
    }
    console.error(`  ${file}`);
    if (unusable?.length) {
        const shown = unusable.slice(0, 10).map(({ path, reason }) => `${path} (${reason})`).join(', ');
        console.error(`    - ${unusable.length} unusable value(s): ${shown}${unusable.length > 10 ? ', ...' : ''}`);
    }
    if (missing?.length) {
        const shown = missing.slice(0, 10).join(', ');
        console.error(`    - missing ${missing.length} key(s): ${shown}${missing.length > 10 ? ', ...' : ''}`);
    }
    if (unknown?.length) {
        const shown = unknown.slice(0, 10).join(', ');
        const more = unknown.length > 10 ? ', ...' : '';
        console.error(`    - ${unknown.length} unknown key(s) not in reference: ${shown}${more}`);
    }
}
process.exit(1);
