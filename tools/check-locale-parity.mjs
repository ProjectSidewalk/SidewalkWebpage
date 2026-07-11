#!/usr/bin/env node
// Cross-locale key-parity check for the i18next translation files under public/locales/.
//
// This is the i18n-aware companion to the eslint-plugin-i18n-json rules wired into eslint.config.js: the plugin
// handles per-file validity/empty-value checks, and this script handles cross-file key parity, which the plugin's
// `identical-keys` rule can't do correctly here. Two i18n realities make a plain "every locale must have exactly the
// reference's keys" comparison wrong:
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
// as subsets. Exits non-zero (and prints the offending files/keys) if any mismatch is found, so it can gate CI.

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
 * Read a translation file and return its leaf keys as a Set with i18next plural suffixes normalized away, so that
 * languages with different plural-category counts compare as equal.
 *
 * @param {string} filePath - Absolute path to the JSON file.
 * @returns {Set<string>} Normalized leaf key set (empty if the file is missing or unparseable -- validity is the
 *                        i18n-json ESLint rules' job, not this script's).
 */
function normalizedKeySet(filePath) {
    if (!existsSync(filePath)) return new Set();
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
        return new Set();
    }
    return new Set(leafKeys(parsed).map(key => key.replace(PLURAL_SUFFIX, '')));
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
        const baseNamespace = stem.split('-')[0];
        const isCityOverlay = stem.includes('-');

        // The reference for any file is the reference locale's *base* namespace (e.g. `common-zurich.json` and
        // `en-US/common.json` both compare against `en/common.json`).
        if (!baseNamespaces.includes(baseNamespace)) continue; // Unknown namespace; nothing to compare against.

        // The reference's own base-namespace files have nothing to compare against (they'd compare to themselves).
        // Its city overlays are still worth subset-checking against the base namespace.
        if (locale === REFERENCE_LOCALE && !isCityOverlay) continue;

        const referenceKeys = normalizedKeySet(join(LOCALES_DIR, REFERENCE_LOCALE, `${baseNamespace}.json`));
        const localeKeys = normalizedKeySet(join(LOCALES_DIR, locale, file));

        const unknown = [...localeKeys].filter(key => !referenceKeys.has(key));
        if (isOverrideOnlyLocale || isCityOverlay) {
            // Override-only: only unknown/typo'd keys are errors; missing keys are the intended fallback behavior.
            if (unknown.length) problems.push({ file: `${locale}/${file}`, unknown });
        } else {
            const missing = [...referenceKeys].filter(key => !localeKeys.has(key));
            if (missing.length || unknown.length) problems.push({ file: `${locale}/${file}`, missing, unknown });
        }
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
    console.log(`Locale parity OK -- all locales consistent with '${REFERENCE_LOCALE}'.`);
    process.exit(0);
}

console.error(`Locale parity check failed (${problems.length} file(s) differ from '${REFERENCE_LOCALE}'):\n`);
for (const { file, missingFile, missing, unknown } of problems) {
    if (missingFile) {
        console.error(`  ${file}\n    - entire namespace file is missing`);
        continue;
    }
    console.error(`  ${file}`);
    if (missing?.length) console.error(`    - missing ${missing.length} key(s): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}`);
    if (unknown?.length) console.error(`    - ${unknown.length} unknown key(s) not in reference: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? ', ...' : ''}`);
}
process.exit(1);
