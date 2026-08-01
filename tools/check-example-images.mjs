#!/usr/bin/env node
// Coverage check for the example imagery under public/images/examples/ (#4723).
//
// The files are named for what they depict -- `<LabelType>/tag-<slug>.png`, `<LabelType>/severity-<n>.png`,
// `<country-id>/<LabelType>/tag-<slug>.png` -- so a filename and a `tag` row can finally be compared. This script is
// what does the comparing: it reads the tag list on stdin as `<label_type>\t<tag>` rows (see `make
// lint-example-images`) and reconciles it against the tree on disk.
//
// The slug rule is not reimplemented here. `util.misc.tagSlug` from public/js/common/utilitiesSidewalk.js is loaded
// and called directly, so the names this script expects are by construction the names the app requests -- a
// divergence between the two would be invisible in production until a tooltip came up blank.
//
// Errors (exit 1) are drift the tree can't recover from on its own: a file no tag claims, an override directory the
// app will never look in, a filename the app can't generate. A tag with no image yet is a gap in the artwork, not a
// bug in the tree, so it is reported as a warning and doesn't fail the run.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInNewContext } from 'node:vm';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES_DIR = join(REPO_ROOT, 'public', 'images', 'examples');
const UTILITIES = join(REPO_ROOT, 'public', 'js', 'common', 'utilitiesSidewalk.js');

// Files directly under examples/ that belong to no label type.
const LOOSE_FILES = new Set(['placeholder.png', 'lookaround-example.gif']);

// Annotation marks are stored here rather than painted into the photos; authored at /admin/exampleImages.
const ANNOTATIONS_FILE = join(EXAMPLES_DIR, 'annotations.json');

// Reasons shared by every label type live in _common/ rather than being copied into each label type's directory.
const COMMON_DIR = '_common';

/**
 * Loads util.misc out of utilitiesSidewalk.js so the slug rule and the override-country list have exactly one
 * definition. The file is a plain browser script, so it only needs `window` (which it treats as the global object)
 * and an i18next stub for the translation calls inside function bodies that this script never reaches.
 *
 * @returns {object} The populated `util.misc` object.
 */
function loadUtilMisc() {
  const context = createContext({ JSON, console, i18next: { t: () => '' } });
  context.window = context;
  runInNewContext(readFileSync(UTILITIES, 'utf8'), context, { filename: UTILITIES });
  return context.util.misc;
}

const utilMisc = loadUtilMisc();
const { tagSlug, VALID_LABEL_TYPES, LABEL_TYPES_WITHOUT_SEVERITY, COUNTRIES_WITH_EXAMPLE_OVERRIDES } = utilMisc;
const labelTypes = new Set(VALID_LABEL_TYPES);

/**
 * Reads the `<label_type>\t<tag>` rows the Makefile pipes in from psql.
 *
 * @returns {Array<{labelType: string, tag: string}>} One entry per row of the `tag` table.
 */
function readTagsFromStdin() {
  return readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [labelType, tag] = line.split('\t');
      return { labelType, tag };
    });
}

const errors = [];
const warnings = [];

const tags = readTagsFromStdin();
if (tags.length === 0) {
  console.error('No tag rows on stdin. Run this via `make lint-example-images`, which pipes them in from psql.');
  process.exit(1);
}
for (const { labelType, tag } of tags) {
  if (!labelType || !tag) errors.push(`Malformed tag row on stdin: ${JSON.stringify({ labelType, tag })}`);
}

// Every image in the tree, as a path relative to examples/, so each can be struck off as something claims it.
const allFiles = [];
(function walk(dir, prefix) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
    else if (!LOOSE_FILES.has(`${prefix}${entry}`) && entry !== 'annotations.json') allFiles.push(`${prefix}${entry}`);
  }
})(EXAMPLES_DIR, '');
const unclaimed = new Set(allFiles);

/** @param {string} path - Path relative to examples/. @returns {boolean} True if it existed and was struck off. */
function claim(path) {
  return unclaimed.delete(path);
}

// Tag examples: the default set, plus whichever ones each override country chooses to replace.
for (const { labelType, tag } of tags) {
  if (!labelTypes.has(labelType)) {
    errors.push(`Tag "${tag}" has label type "${labelType}", which util.misc.VALID_LABEL_TYPES doesn't list.`);
    continue;
  }
  const file = `${labelType}/tag-${tagSlug(tag)}.png`;
  if (!claim(file)) warnings.push(`No example image for the "${tag}" ${labelType} tag (expected ${file}).`);
  for (const country of COUNTRIES_WITH_EXAMPLE_OVERRIDES) claim(`${country}/${file}`);
}

// Severity/quality examples, in both the small tooltip size and the larger one the help page uses.
for (const labelType of VALID_LABEL_TYPES) {
  if (LABEL_TYPES_WITHOUT_SEVERITY.includes(labelType)) continue;
  for (const level of [1, 2, 3]) {
    if (!claim(`${labelType}/severity-${level}.png`)) {
      warnings.push(`No severity ${level} example for ${labelType} (expected ${labelType}/severity-${level}.png).`);
    }
    claim(`${labelType}/severity-${level}-help.png`);
  }
}

// Validate's "why not?" / "not sure" button examples. How many buttons a label type has varies by type, so the
// numbering is read off the tree rather than assumed; the names still have to be well formed and in a real directory.
for (const path of [...unclaimed]) {
  const [head, file] = path.split('/');
  if ((labelTypes.has(head) || head === COMMON_DIR) && /^(disagree|unsure)-\d\.png$/.test(file || '')) claim(path);
}

// Anything still unclaimed is a file nothing can ask for: a stale tag image, a typo'd slug, or a file somewhere the
// app never looks.
for (const path of unclaimed) {
  const [head] = path.split('/');
  if (labelTypes.has(head) || head === COMMON_DIR) {
    errors.push(`${path} matches no tag, severity level, or Validate reason button.`);
  } else if (COUNTRIES_WITH_EXAMPLE_OVERRIDES.includes(head)) {
    errors.push(`${path} overrides a tag that doesn't exist for that label type.`);
  } else {
    errors.push(`${path} is in "${head}/", which is neither a label type nor an override country `
      + `(${COUNTRIES_WITH_EXAMPLE_OVERRIDES.join(', ')}).`);
  }
}

// The annotation manifest. An entry keyed to a missing file renders nothing, and an out-of-range coordinate puts a
// mark off the edge of the photo — both fail silently, so they have to be caught here.
let manifest = {};
try {
  manifest = JSON.parse(readFileSync(ANNOTATIONS_FILE, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') errors.push(`annotations.json is not valid JSON: ${err.message}`);
}
const inRange = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && n >= 0 && n <= 1);
for (const [key, entry] of Object.entries(manifest)) {
  if (key === 'version') continue;
  // Keys are extensionless, so they survive the PNG-to-WebP switch the re-shoot brings.
  if (!allFiles.some((path) => path.replace(/\.[a-z0-9]+$/i, '') === key)) {
    errors.push(`annotations.json has an entry for "${key}", which matches no example image.`);
    continue;
  }
  const marks = entry?.marks;
  if (!Array.isArray(marks) || marks.length === 0) {
    errors.push(`annotations.json entry "${key}" has no marks; drop the entry instead of leaving it empty.`);
    continue;
  }
  for (const [i, mark] of marks.entries()) {
    const where = `annotations.json entry "${key}" mark ${i}`;
    if (!['arrow', 'marker', 'extent'].includes(mark?.type)) {
      errors.push(`${where} has unknown type ${JSON.stringify(mark?.type)}.`);
    } else if (mark.type === 'marker') {
      if (!inRange(mark.at)) errors.push(`${where} needs "at": [u, v] with both in 0-1.`);
    } else if (!inRange(mark.from) || !inRange(mark.to)) {
      errors.push(`${where} needs "from" and "to", each [u, v] with both in 0-1.`);
    }
  }
}

// An override country the app never looks in is invisible: the files are there, the app asks for the default.
const overrideDirs = readdirSync(EXAMPLES_DIR)
  .filter((entry) => statSync(join(EXAMPLES_DIR, entry)).isDirectory())
  .filter((entry) => !labelTypes.has(entry) && entry !== COMMON_DIR);
for (const country of COUNTRIES_WITH_EXAMPLE_OVERRIDES) {
  if (!overrideDirs.includes(country)) {
    errors.push(`util.misc.COUNTRIES_WITH_EXAMPLE_OVERRIDES lists "${country}", but examples/${country}/ is empty `
      + 'or absent, so every city in that country pays a failed request per tag.');
  }
}

for (const warning of warnings) console.warn(`  warning: ${warning}`);
if (errors.length === 0) {
  const counts = `${tags.length} tags, ${warnings.length} without an image`;
  console.log(`Example images OK -- ${counts}.`);
  process.exit(0);
}
console.error(`\nExample image check failed (${errors.length} problem(s)):\n`);
for (const error of errors) console.error(`  ${error}`);
process.exit(1);
