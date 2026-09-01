#!/usr/bin/env node
// Asset-URL check for public/js/ (#4893). Frontend JS names a public asset by its logical path and resolves it with
// `util.assetPath`, so staged builds serve the content-fingerprinted copy (`max-age=31536000, immutable`) instead of
// the original (one hour, so a returning visitor re-asks about every asset hourly and a swapped file reaches a cached
// client only once that hour is up). Nothing else enforces that: `AssetsFinder.path` returns the plain path for an
// asset it can't find rather than throwing, and `util.assetPath` falls back to the plain path too, so both halves of
// a mistake are silent.
//
// So this checks:
//   1. No hardcoded '/assets/' URL in public/js, whether a full path or a bare base directory that a name is later
//      appended to — sbt-digest fingerprints the filename, so a base directory can never carry a digest. The
//      exceptions are the ALLOWED entries below (which must still match, or the registry is stale and this fails).
//   2. Every `util.assetPath` argument names something the digest manifest can fingerprint:
//      - a literal argument must be a real file under public/, written as a logical path (no leading slash, no
//        'assets/' prefix), sitting under one of build.sbt's `assetManifestPrefixes`;
//      - a template literal carrying ${...} is checked as far as it can be — its literal prefix (up to the first
//        interpolation) must name one of those same families, which is what catches a whole family missing from the
//        manifest;
//      - an argument built by concatenation is rejected outright: only a whole path inside one template literal is
//        checkable, and CLAUDE.md asks for that form anyway.
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

// A hardcoded asset URL: '/assets/' opening a string or a css url(), and however much literal path follows — none at
// all still counts, since a bare '/assets/' is a base directory something appends a filename to, which is the one
// form that can never be fingerprinted. Excludes only the interpolated '/assets/${...}', which is how util.assetPath
// itself builds the URL.
const HARDCODED = /['"`(]\/assets\/(?!\$)[A-Za-z0-9_\-./]*/g;

// Where a util.assetPath call starts; its argument is then read off with the walker below rather than by regex, so
// every call shape is accounted for instead of only the ones a pattern happens to describe.
const CALL = /util\.assetPath\(/g;

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

// The tokens a '/' can follow and still open a regex literal rather than divide. Anything else ending an expression
// (an identifier, a number, a closing bracket) means division.
const REGEX_PRECEDING_KEYWORDS = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'of', 'return', 'throw', 'typeof', 'void', 'yield',
]);

/**
 * Whether the '/' at `at` opens a regex literal rather than being a division operator.
 *
 * Best effort, and only ever consulted to decide how much text to skip: the shapes it can get wrong (a regex right
 * after a `}`, say) are absent from public/js, and the cost of a wrong answer is a stretch of code read as a regex
 * body or vice versa, not a crash.
 *
 * @param {string} text - The file's contents.
 * @param {number} at - Index of the '/'.
 * @returns {boolean} True if a regex literal starts here.
 */
function opensRegexLiteral(text, at) {
  let i = at - 1;
  while (i >= 0 && /\s/.test(text[i])) i--;
  if (i < 0) return true;
  if (/[)\]}]/.test(text[i])) return false;
  if (!/[A-Za-z0-9_$]/.test(text[i])) return true;
  let start = i;
  while (start >= 0 && /[A-Za-z0-9_$]/.test(text[start])) start--;
  return REGEX_PRECEDING_KEYWORDS.has(text.slice(start + 1, i + 1));
}

/**
 * Blanks out comments, keeping every other character (and so every line and column) in place.
 *
 * Only code can load an asset, and rule 1's pattern is loose enough to match prose — `/assets/...` in a JSDoc block
 * reads as a path. Walks the file character by character rather than replacing two comment patterns: `/*` and `//`
 * only open a comment outside a string, and a regex can't tell the difference, so `const marker = 'foo/*bar';` would
 * blank every line down to the next `*` + `/` and silently switch both rules off over that span. The walk tracks all
 * three string forms (with escapes, and template interpolations, which hold code that can hold more strings), so a
 * trailing `// ...` comment is stripped as reliably as one that opens its line.
 *
 * @param {string} text - A JS file's contents.
 * @returns {string} The same text with comment bodies replaced by spaces.
 */
function withoutComments(text) {
  const out = text.split('');
  const blank = (i) => { if (text[i] !== '\n') out[i] = ' '; };
  // Open string/template contexts, innermost last. A template interpolation pushes '${' and holds code until '}'.
  const stack = [];
  let mode = 'code';
  let inCharClass = false; // Inside a regex's [...], where an unescaped '/' does not end the literal.

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (mode === 'line') {
      if (ch === '\n') mode = 'code';
      else blank(i);
      continue;
    }
    if (mode === 'block') {
      blank(i);
      if (ch === '*' && next === '/') { blank(i + 1); i++; mode = 'code'; }
      continue;
    }
    if (mode === 'regex') {
      if (ch === '\\') { i++; continue; }
      if (ch === '[') inCharClass = true;
      else if (ch === ']') inCharClass = false;
      else if (ch === '/' && !inCharClass) mode = 'code';
      else if (ch === '\n') mode = 'code'; // Unterminated; a regex literal can't span lines.
      continue;
    }
    if (mode === 'string') {
      const quote = stack[stack.length - 1];
      if (ch === '\\') { i++; continue; }
      if (ch === quote) { stack.pop(); mode = 'code'; continue; }
      if (quote === '`' && ch === '$' && next === '{') { stack.push('${'); i++; mode = 'code'; continue; }
      continue;
    }

    // Code, either at the top level or inside a template interpolation.
    if (ch === '/' && next === '/') { blank(i); blank(i + 1); i++; mode = 'line'; continue; }
    if (ch === '/' && next === '*') { blank(i); blank(i + 1); i++; mode = 'block'; continue; }
    if (ch === '/' && opensRegexLiteral(text, i)) { mode = 'regex'; inCharClass = false; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { stack.push(ch); mode = 'string'; continue; }
    if (ch === '{') { stack.push('{'); continue; }
    if (ch === '}') {
      const open = stack.pop();
      if (open === '${') mode = 'string'; // Back into the template literal this interpolation interrupted.
      continue;
    }
  }
  return out.join('');
}

/**
 * Walks an expression, reporting every character that is code — outside string bodies, and outside the strings inside
 * a template interpolation.
 *
 * Regex literals are not tracked, so a bracket or quote inside one counts: an asset path is named with strings, and
 * no call in public/js puts a regex in the argument.
 *
 * @param {string} text - Text to walk; comments must already be stripped.
 * @param {number} start - Index to start at.
 * @param {function(string, number, number): (boolean|void)} visit - Called with (character, index, nesting depth);
 *                                                                   returning false stops the walk. Depth counts the
 *                                                                   open brackets and interpolations around it, so
 *                                                                   depth 0 is the expression's own top level.
 */
function walkCode(text, start, visit) {
  const stack = [];
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    const top = stack[stack.length - 1];
    if (top === '\'' || top === '"' || top === '`') {
      if (ch === '\\') { i++; continue; }
      if (ch === top) stack.pop();
      else if (top === '`' && ch === '$' && text[i + 1] === '{') { stack.push('${'); i++; }
      continue;
    }
    if (visit(ch, i, stack.length) === false) return;
    if (ch === '\'' || ch === '"' || ch === '`' || ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') stack.pop();
  }
}

/**
 * The source text of the single argument in a call whose '(' sits at `open`.
 *
 * @param {string} text - The file, comments already stripped.
 * @param {number} open - Index of the call's opening parenthesis.
 * @returns {string|null} The argument source, trimmed, or null if the call's parenthesis never closes.
 */
function callArgument(text, open) {
  let close = -1;
  walkCode(text, open, (ch, i, depth) => {
    if (ch === ')' && depth === 1) { close = i; return false; }
  });
  return close === -1 ? null : text.slice(open + 1, close).trim();
}

/** @returns {boolean} Whether `arg` joins pieces with '+' at its own top level, rather than being one literal. */
function isConcatenated(arg) {
  let found = false;
  walkCode(arg, 0, (ch, _i, depth) => { if (ch === '+' && depth === 0) found = true; });
  return found;
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

/** @returns {boolean} Whether `logicalPath` sits under a family the digest manifest covers. */
function inManifest(logicalPath) {
  return PREFIXES.length === 0 || PREFIXES.some((prefix) => logicalPath.startsWith(`${prefix}/`));
}

// --- 1 & 2. Per-file checks ---------------------------------------------------------------------------------------

const files = walkJs(JS_DIR);
let staticCalls = 0;
let dynamicCalls = 0;

for (const file of files) {
  const text = withoutComments(readFileSync(join(ROOT, file), 'utf8'));
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    for (const [match] of line.matchAll(HARDCODED)) {
      const url = match.slice(1); // Drop the opening quote/paren.
      // Exact match, not a prefix match: the allowed URL is a template the library interpolates, so the literal this
      // scanner can see is all of it. Matching on a prefix would exempt every longer '/assets/locales/...' string in
      // the same file.
      if (ALLOWED.some((entry) => entry.file === file && url === entry.url.split('{')[0])) continue;
      problems.push(`${file}:${i + 1}: hardcoded '${url}' URL — use util.assetPath('images/...') so staged builds `
        + 'serve the fingerprinted, immutable-cached copy');
    }
  });

  for (const call of text.matchAll(CALL)) {
    const arg = callArgument(text, call.index + call[0].length - 1);
    const where = `${file}:${text.slice(0, call.index).split('\n').length}: util.assetPath(${arg ?? '…'})`;
    if (arg === null) {
      problems.push(`${where}: unparseable call — its parenthesis never closes`);
      continue;
    }

    // A quoted argument with no interpolation: check it whole.
    const literal = /^(['"])((?:[^'"\\]|\\.)*)\1$|^`([^`\\$]*)`$/.exec(arg);
    if (literal) {
      staticCalls++;
      const logicalPath = literal[2] ?? literal[3];
      if (logicalPath.startsWith('/') || logicalPath.startsWith('assets/')) {
        problems.push(`${where}: takes a path under public/, with no leading slash and no 'assets/' prefix`);
      } else if (!existsSync(join(PUBLIC_DIR, logicalPath))) {
        problems.push(`${where}: no such file at public/${logicalPath}`);
      } else if (!inManifest(logicalPath)) {
        problems.push(`${where}: outside the digest manifest, so it can never be fingerprinted — add its family to `
          + 'assetManifestPrefixes in build.sbt, or move the asset under one that is already there');
      }
      continue;
    }

    if (isConcatenated(arg)) {
      problems.push(`${where}: builds its path by concatenation, which leaves nothing checkable — build the whole `
        + 'path inside one template literal instead, e.g. util.assetPath(`images/badges/badge${level}.png`)');
      continue;
    }

    // A template literal carrying ${...}: only its literal head is knowable, and that is the part that says which
    // asset family this is — the check that catches a family missing from the manifest.
    if (arg.startsWith('`') && arg.endsWith('`') && arg.includes('${')) {
      dynamicCalls++;
      const prefix = arg.slice(1, arg.indexOf('${'));
      if (prefix.startsWith('/') || prefix.startsWith('assets/')) {
        problems.push(`${where}: takes a path under public/, with no leading slash and no 'assets/' prefix`);
      } else if (prefix === '') {
        problems.push(`${where}: opens with an interpolation, so not even the asset family is knowable — begin the `
          + 'template with the literal family directory and interpolate only what varies');
      } else if (!inManifest(prefix)) {
        problems.push(`${where}: names the family '${prefix}', which is not in build.sbt's assetManifestPrefixes, so `
          + 'nothing this resolves to can be fingerprinted — add the family to the manifest, or move the asset under '
          + 'one that is already there');
      }
      continue;
    }

    problems.push(`${where}: is neither a literal nor a template literal, so no part of the path can be checked — `
      + 'name the asset with a template literal that opens with its family directory');
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
  console.log(`Asset paths OK -- ${files.length} JS files, ${staticCalls} literal and ${dynamicCalls} interpolated `
    + `util.assetPath() calls, ${PREFIXES.length} manifest prefixes, ${ALLOWED.length} allowed hardcoded URL(s).`);
  process.exit(0);
}

console.error(`Asset path check failed (${problems.length} problem(s)):\n`);
for (const problem of problems) console.error(`  ${problem}`);
process.exit(1);
