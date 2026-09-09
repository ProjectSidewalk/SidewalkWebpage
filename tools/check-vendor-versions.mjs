#!/usr/bin/env node
// Keeps docs/upgrading-libraries.md honest about what's in public/vendor/ (#4399).
//
// Self-hosted libraries are invisible to Dependabot — it only reads package.json, which is build tooling — so that
// doc's list is the entire inventory we have, and it's a hand-copy of the versions baked into the filenames. The two
// drift silently: a new turf lands and the doc doesn't move, or a whole library is never listed at all.
//
// It deliberately does *not* ask npm what the newest release is. Half these libraries aren't plain npm packages (the
// Infra3d build is locally patched, the photo-sphere-viewer bundle is ours, bootstrap-accessibility vendors two other
// libraries inside itself) and a third of the list is frozen on purpose, so such a report would need a hand-kept map
// of npm names and freeze reasons — a second copy of the doc — and would nag monthly about decisions already made.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = join(ROOT, 'public', 'vendor');
const DOC = 'docs/upgrading-libraries.md';

// A version in a filename ('turf-7.3.4.min.js', 'kinetic-v4.4.3.min.js'). The leading separator is what keeps this
// from reading the '2' out of a '.min.js' or off the end of a library name.
const VERSION_IN_FILENAME = /[-_.]v?(\d+(?:\.\d+)+)/g;

// The bolded head of a doc entry: '- **turf.js: 7.3.4** — …'. Everything after it is prose we don't parse.
const DOC_ENTRY = /^- \*\*(.+?)\*\*/gm;

const problems = [];

/** @returns {string} `name` with punctuation and case dropped, so 'chart-js' and 'chart.js' compare as equal. */
function normalize(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Every .js/.css file under it, relative to public/vendor/. Skips build/ directories, which hold
 *                     the recipe for a bundle we build ourselves rather than a shipped library.
 */
function walkVendor(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'build') return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walkVendor(full);
    return /\.(js|css)$/.test(entry.name) ? [relative(VENDOR_DIR, full)] : [];
  });
}

/** @returns {string[]} Every version number in `text`, e.g. ['1.7.6', '1.7.5']. */
function versionsIn(text) {
  return [...text.matchAll(/\d+(?:\.\d+)+/g)].map(([version]) => version);
}

const doc = readFileSync(join(ROOT, DOC), 'utf8');
const sectionStart = doc.indexOf('\n## JavaScript');
const sectionEnd = doc.indexOf('\n## ', sectionStart + 1);
if (sectionStart === -1) {
  console.error(`${DOC}: no "## JavaScript" heading — the section was renamed, and nothing below is being checked.`);
  process.exit(1);
}
const section = doc.slice(sectionStart, sectionEnd === -1 ? doc.length : sectionEnd);
const normalizedSection = normalize(section);

const entries = [...section.matchAll(DOC_ENTRY)].map(([, head]) => ({
  name: head.split(':')[0].trim(),
  versions: versionsIn(head),
}));

const dirs = readdirSync(VENDOR_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const files = walkVendor(VENDOR_DIR);

// A file carrying no version in its name can't be checked either way, so it's reported rather than failed.
const versionsByDir = new Map(dirs.map((dir) => [dir, new Set()]));
const unversioned = [];
for (const file of files) {
  const dir = file.split('/')[0];
  const found = [...basename(file).matchAll(VERSION_IN_FILENAME)].map(([, version]) => version);
  if (found.length === 0) unversioned.push(file);
  for (const version of found) versionsByDir.get(dir)?.add(version);
}

// Everything on disk is in the doc.
for (const dir of dirs) {
  if (!normalizedSection.includes(normalize(dir))) {
    problems.push(`public/vendor/${dir}/ is not mentioned in ${DOC} — add an entry so the library is on the `
      + 'inventory we actually maintain, since Dependabot never sees it');
    continue; // Its versions can't be in a section that doesn't name it; one message is enough.
  }
  for (const version of versionsByDir.get(dir)) {
    if (!section.includes(version)) {
      problems.push(`public/vendor/${dir}/ ships ${version}, which ${DOC} doesn't mention — an upgrade that didn't `
        + 'update the doc, so bump the version in its entry');
    }
  }
}

// Everything in the doc is on disk.
const allVersions = new Set([...versionsByDir.values()].flatMap((set) => [...set]));

/**
 * The vendor directory a doc entry describes, ignoring punctuation ('chart.js' → chart-js, 'infra3dapi' → infra3d).
 *
 * An exact name wins first, so 'i18next' takes its own folder rather than i18next-http-backend's; failing that the
 * longest contained folder name wins, which picks magnific-popup over jquery for an entry naming both.
 *
 * @param {string} name - The library name from the doc entry.
 * @returns {string|null} The directory, or null when the entry doesn't line up with one (e.g. mapbox-search-js,
 *                        which lives inside the mapbox-gl folder).
 */
function dirForEntry(name) {
  const wanted = normalize(name);
  const exact = dirs.find((dir) => normalize(dir) === wanted);
  if (exact) return exact;
  const contained = dirs.filter((dir) => wanted.includes(normalize(dir)));
  if (contained.length > 0) return contained.sort((a, b) => normalize(b).length - normalize(a).length)[0];
  return dirs.filter((dir) => normalize(dir).includes(wanted)).sort((a, b) => a.length - b.length)[0] ?? null;
}

for (const { name, versions } of entries) {
  const dir = dirForEntry(name);
  // A library whose files carry no version can neither confirm nor deny what the doc says.
  if (dir && versionsByDir.get(dir).size === 0) continue;
  const onDisk = dir ? versionsByDir.get(dir) : allVersions;
  const where = dir ? `public/vendor/${dir}/` : 'public/vendor/';

  for (const version of versions) {
    if (!onDisk.has(version)) {
      problems.push(`${DOC} lists ${name} at ${version}, but no file in ${where} is named for it — either the doc is `
        + 'stale, or the file was upgraded without being renamed to match');
    }
  }
}

if (problems.length === 0) {
  console.log(`Vendor versions OK -- ${dirs.length} libraries, ${files.length} files, ${allVersions.size} versions `
    + `cross-checked against ${DOC}.`);
  if (unversioned.length > 0) {
    console.log(`  ${unversioned.length} file(s) carry no version in the name, so they go unchecked: `
      + `${unversioned.join(', ')}`);
  }
  process.exit(0);
}

console.error(`Vendor version check failed (${problems.length} problem(s)):\n`);
for (const problem of problems) console.error(`  ${problem}`);
process.exit(1);
