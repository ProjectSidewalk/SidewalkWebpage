#!/usr/bin/env node
// Keeps docs/upgrading-libraries.md honest about what's in public/vendor/ (#4399).
//
// No Dependabot ecosystem covers public/vendor/ — the npm one reads package.json, which is build tooling — so that
// doc's list is the entire inventory we have for the self-hosted libraries, and it's a hand-copy of the versions
// baked into the filenames. The two drift silently: a new turf lands and the doc doesn't move, or a whole library is
// never listed at all.
//
// Every check is scoped to the doc *entry* that covers a folder rather than to the section as a whole. Searching the
// section text instead looks like it works and doesn't: prose exempts whatever it happens to mention (the selectize
// entry names tom-select as its successor, so a tom-select folder would pass unlisted), and the intro's example
// filename alone would satisfy a library whose entry had been deleted outright.
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

// Where a doc entry starts: '- **turf.js: 7.3.4** — …', with the bolded head captured.
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

/** @returns {Set<string>} Every version number in `text`, e.g. {'1.7.6', '1.7.5'}. */
function versionsIn(text) {
  return new Set([...text.matchAll(/\d+(?:\.\d+)+/g)].map(([version]) => version));
}

const doc = readFileSync(join(ROOT, DOC), 'utf8');
const sectionStart = doc.indexOf('\n## JavaScript');
if (sectionStart === -1) {
  console.error(`${DOC}: no "## JavaScript" heading — the section was renamed, and nothing below is being checked.`);
  process.exit(1);
}
const sectionEnd = doc.indexOf('\n## ', sectionStart + 1);
const section = doc.slice(sectionStart, sectionEnd === -1 ? doc.length : sectionEnd);

const dirs = readdirSync(VENDOR_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const files = walkVendor(VENDOR_DIR);

// --- The doc's entries --------------------------------------------------------------------------------------------

// One per bullet, carrying both the versions its bold head claims (what we're on *now*) and every version in its text
// — the Bootstrap and jQuery copies split out of the bootstrap-accessibility bundle are named only in prose.
const starts = [...section.matchAll(DOC_ENTRY)];
const entries = starts.map((match, i) => {
  const body = section.slice(match.index, starts[i + 1]?.index ?? section.length);
  return { name: match[1].split(':')[0].trim(), body, claimed: versionsIn(match[1]), mentioned: versionsIn(body) };
});

/**
 * The vendor folder a doc entry describes, ignoring punctuation ('chart.js' → chart-js, 'infra3dapi' → infra3d).
 *
 * An exact name wins first, so 'i18next' takes its own folder rather than i18next-http-backend's; failing that the
 * longest contained folder name wins, which picks magnific-popup over jquery for an entry naming both. An entry whose
 * name lines up with no folder — its library ships inside another one's, or under a different name — says so by
 * naming that folder's path in its text.
 *
 * @param {{name: string, body: string}} entry - A doc entry.
 * @returns {string|null} The folder name, or null if the entry describes nothing on disk.
 */
function dirForEntry(entry) {
  const wanted = normalize(entry.name);
  const exact = dirs.find((dir) => normalize(dir) === wanted);
  if (exact) return exact;
  const contained = dirs.filter((dir) => wanted.includes(normalize(dir)));
  if (contained.length > 0) return contained.sort((a, b) => normalize(b).length - normalize(a).length)[0];
  return dirs.find((dir) => entry.body.includes(`public/vendor/${dir}/`)) ?? null;
}

// Which entries speak for each folder. A folder can have several (Mapbox ships three separate libraries into one),
// and an entry speaks for a second folder by naming its path.
const entriesByDir = new Map(dirs.map((dir) => [dir, []]));
for (const entry of entries) {
  const named = dirForEntry(entry);
  if (named === null) {
    problems.push(`${DOC} lists ${entry.name}, which matches no folder under public/vendor/ — either the library was `
      + 'removed and its entry outlived it, or the entry needs to name the folder its files ship in');
    continue;
  }
  for (const dir of dirs) {
    if (dir === named || entry.body.includes(`public/vendor/${dir}/`)) entriesByDir.get(dir).push(entry);
  }
}

// --- What's on disk -----------------------------------------------------------------------------------------------

// A file carrying no version in its name can't be checked either way, so it's reported rather than failed.
const versionsByDir = new Map(dirs.map((dir) => [dir, new Set()]));
const unversioned = [];
for (const file of files) {
  const [dir, ...rest] = file.split('/');
  if (rest.length === 0) {
    problems.push(`public/vendor/${file} sits loose in the vendor root — every library gets its own folder, and a `
      + 'loose file belongs to none, so nothing here can tell whether the doc covers it');
    continue;
  }
  const found = [...basename(file).matchAll(VERSION_IN_FILENAME)].map(([, version]) => version);
  if (found.length === 0) unversioned.push(file);
  for (const version of found) versionsByDir.get(dir).add(version);
}

// --- Every folder is documented, at the versions it ships ---------------------------------------------------------

for (const dir of dirs) {
  const covering = entriesByDir.get(dir);
  if (covering.length === 0) {
    problems.push(`public/vendor/${dir}/ has no entry in ${DOC} — add one, since no Dependabot ecosystem watches `
      + 'this folder and that list is the only inventory these libraries have');
    continue; // Nothing claims a version for it, so every version below would just repeat this.
  }
  const documented = new Set(covering.flatMap((entry) => [...entry.mentioned]));
  for (const version of versionsByDir.get(dir)) {
    if (!documented.has(version)) {
      problems.push(`public/vendor/${dir}/ ships ${version}, which its ${DOC} entry (${covering[0].name}) doesn't `
        + 'mention — an upgrade that skipped the doc, so bring the entry up to the version on disk');
    }
  }
}

// --- Every documented version is on disk ---------------------------------------------------------------------------

for (const entry of entries) {
  const dir = dirForEntry(entry);
  // A library whose files carry no version can neither confirm nor deny what the doc says.
  if (dir === null || versionsByDir.get(dir).size === 0) continue;

  for (const version of entry.claimed) {
    if (!versionsByDir.get(dir).has(version)) {
      problems.push(`${DOC} lists ${entry.name} at ${version}, but no file in public/vendor/${dir}/ is named for it `
        + '— either the doc is stale, or the file was upgraded without being renamed to match');
    }
  }
}

// --- Report ---------------------------------------------------------------------------------------------------------

if (unversioned.length > 0) {
  console.log(`${unversioned.length} vendor file(s) carry no version in the name, so they go unchecked: `
    + `${unversioned.join(', ')}`);
}

if (problems.length === 0) {
  const versions = [...versionsByDir.values()].reduce((total, set) => total + set.size, 0);
  console.log(`Vendor versions OK -- ${dirs.length} libraries, ${files.length} files, ${versions} versions `
    + `cross-checked against ${entries.length} entries in ${DOC}.`);
  process.exit(0);
}

console.error(`\nVendor version check failed (${problems.length} problem(s)):\n`);
for (const problem of problems) console.error(`  ${problem}`);
process.exit(1);
