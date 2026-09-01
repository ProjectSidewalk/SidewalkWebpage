#!/usr/bin/env node
// Asset-URL check for public/js/ (#4893). Frontend JS names a public asset by its logical path and resolves it with
// `util.assetPath`, so staged builds serve the content-fingerprinted copy (`max-age=31536000, immutable`) instead of
// the original (one hour, so a returning visitor re-asks about every asset hourly and a swapped file reaches a cached
// client only once that hour is up). Nothing else enforces that: `AssetsFinder.path` returns the plain path for an
// asset it can't find rather than throwing, and `util.assetPath` falls back to the plain path too, so both halves of
// a mistake are silent.
//
// So this checks:
//   1. No hardcoded '/assets/...' URL in public/js, except the entries in ALLOWED below (which must still match, or
//      the registry is stale and this fails).
//   2. Every literal `util.assetPath('...')` argument is a real file under public/, written as a logical path (no
//      leading slash, no 'assets/' prefix), and sits under one of build.sbt's `assetManifestPrefixes` — the families
//      the digest manifest actually covers. A path outside them resolves, but never fingerprinted.
//   3. Every prefix in that list is a real directory, so a renamed asset family fails here rather than in sbt.
//
// Exits non-zero with the offending files listed, so it can gate CI.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = join(ROOT, 'public', 'js');
const PUBLIC_DIR = join(ROOT, 'public');

// The hardcoded '/assets/' URLs that may stay, each with the reason it can't go through util.assetPath. Every entry
// must match something in its file; one that matches nothing is a stale exemption and fails the check.
const ALLOWED = [
  {
    file: 'public/js/common/AppManager.js',
    url: '/assets/locales/{{lng}}/{{ns}}.json',
    reason: 'an i18next-http-backend loadPath template the library interpolates and multi-loads itself',
  },
];

// A hardcoded asset URL: '/assets/' opening a string or a css url(), followed by a literal path. Excludes the
// interpolated form ('/assets/${...}', which is how util.assetPath itself builds the URL) and prose mentions of a
// bare '/assets/'.
const HARDCODED = /['"`(]\/assets\/[A-Za-z0-9_\-./]+/g;

// A util.assetPath call whose argument is one literal string — a template literal carrying ${...} is dynamic and
// only its prefix could be checked, which would be a weaker check than none.
const STATIC_CALL = /util\.assetPath\(\s*(['"`])([^'"`$\\]*)\1\s*\)/g;

const problems = [];

/** @returns {string[]} Every .js file under `dir` outside a build/ output directory, as repo-relative paths. */
function walkJs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'build') return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walkJs(full);
    return entry.name.endsWith('.js') ? [relative(ROOT, full)] : [];
  });
}

/**
 * Blanks out comments, keeping every other character (and so every line number) in place.
 *
 * Only code can load an asset, and rule 1's pattern is loose enough to match prose — `/assets/...` in a JSDoc block
 * reads as a path. Nothing under public/js writes `/*` inside a string, so the block form needs no real parser; the
 * line form is only stripped when `//` opens the line, which no string can do.
 *
 * @param {string} text - A JS file's contents.
 * @returns {string} The same text with comment bodies replaced by spaces.
 */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, (line, indent) => indent + ' '.repeat(line.length - indent.length));
}

/** @returns {string[]} The asset families build.sbt puts in the digest manifest. */
function manifestPrefixes() {
  const buildSbt = readFileSync(join(ROOT, 'build.sbt'), 'utf8');
  const block = buildSbt.match(/assetManifestPrefixes\s*=\s*Seq\(([\s\S]*?)\)/);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map(([, prefix]) => prefix);
}

// --- 0. The manifest prefixes, which rules 2 and 3 are both built on ----------------------------------------------

const PREFIXES = manifestPrefixes();
if (PREFIXES.length === 0) {
  problems.push('tools/check-asset-paths.mjs: parsed no prefixes out of build.sbt\'s assetManifestPrefixes — the '
    + 'literal moved or changed shape, and every util.assetPath argument below is going unchecked');
}

for (const prefix of PREFIXES) {
  const dir = join(PUBLIC_DIR, prefix);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    problems.push(`build.sbt: assetManifestPrefixes names public/${prefix}, which is not a directory`);
  }
}

// --- 1 & 2. Per-file checks ---------------------------------------------------------------------------------------

const files = walkJs(JS_DIR);
let calls = 0;

for (const file of files) {
  const text = withoutComments(readFileSync(join(ROOT, file), 'utf8'));
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    for (const [match] of line.matchAll(HARDCODED)) {
      const url = match.slice(1); // Drop the opening quote/paren.
      if (ALLOWED.some((entry) => entry.file === file && url.startsWith(entry.url.split('{')[0]))) continue;
      problems.push(`${file}:${i + 1}: hardcoded '${url}' URL — use util.assetPath('images/...') so staged builds `
        + 'serve the fingerprinted, immutable-cached copy');
    }
  });

  for (const [, , logicalPath] of text.matchAll(STATIC_CALL)) {
    calls++;
    const where = `${file}: util.assetPath('${logicalPath}')`;
    if (logicalPath.startsWith('/') || logicalPath.startsWith('assets/')) {
      problems.push(`${where}: takes a path under public/, with no leading slash and no 'assets/' prefix`);
      continue;
    }
    if (!existsSync(join(PUBLIC_DIR, logicalPath))) {
      problems.push(`${where}: no such file at public/${logicalPath}`);
      continue;
    }
    if (PREFIXES.length && !PREFIXES.some((prefix) => logicalPath.startsWith(`${prefix}/`))) {
      problems.push(`${where}: outside the digest manifest, so it can never be fingerprinted — add its family to `
        + 'assetManifestPrefixes in build.sbt, or move the asset under one that is already there');
    }
  }
}

// --- 3. The allowlist is still live -------------------------------------------------------------------------------

for (const { file, url } of ALLOWED) {
  const text = existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : '';
  if (!text.includes(url)) {
    problems.push(`tools/check-asset-paths.mjs: allows '${url}' in ${file}, which no longer contains it — drop the `
      + 'ALLOWED entry');
  }
}

if (problems.length === 0) {
  console.log(`Asset paths OK -- ${files.length} JS files, ${calls} static util.assetPath() calls, `
    + `${PREFIXES.length} manifest prefixes, ${ALLOWED.length} allowed hardcoded URL(s).`);
  process.exit(0);
}

console.error(`Asset path check failed (${problems.length} problem(s)):\n`);
for (const problem of problems) console.error(`  ${problem}`);
process.exit(1);
