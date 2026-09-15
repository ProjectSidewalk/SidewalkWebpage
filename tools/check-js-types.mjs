#!/usr/bin/env node
// Type-checks public/js/ with TypeScript, using the JSDoc types we already write (#5278). Nothing is compiled or
// shipped; this only reads the code.
//
// Grunt glues each app's files into one script that shares a single global scope, so tsc has to see a whole bundle
// at once to know what a name refers to. Explore, Validate, and Gallery each get their own run because they reuse
// class names (Main, Label, Form, ...) that would clash if checked together; everything else is one run. The runs
// are the tsconfig.*.json files in tools/js-types/.
//
// Each run sees more than any one page loads (all of common/, and every other page script in the last run), so a
// name a page never loads still resolves. This catches wrong types, not missing <script> tags.
//
// Most of the tree doesn't pass yet, so only the folders in CHECKED can fail the build. To add one, run with --all to
// see its errors, fix them, and list it here. Exits non-zero if a checked folder has an error or isn't type-checked.
//
// Usage: node tools/check-js-types.mjs [--all]

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TS_MAJOR = 7;

// Folders under public/js/ (each with everything inside it) or single files that must type-check cleanly. Grow this
// list; never shrink it.
const CHECKED = [
  'public/js/common',
  'public/js/community',
  'public/js/explore',
  'public/js/gallery',
  'public/js/shared-label',
  'public/js/validate',
];

// common/ is in every run, and each run can find different errors there (a common/ typedef can clash with one app's
// class), so every run's errors count; the same error from several runs is printed once.
const RUNS = ['tsconfig.explore.json', 'tsconfig.validate.json', 'tsconfig.gallery.json', 'tsconfig.other.json'];

// A tsc error line: `public/js/foo.js(12,5): error TS2339: Property 'x' does not exist on type 'y'.`
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): /;

/**
 * Finds tsc, refusing another major version: a worktree without node_modules can pick up the main checkout's older one.
 * @returns {string} Path to the tsc script.
 */
function findTsc() {
  const pkgPath = createRequire(import.meta.url).resolve('typescript/package.json');
  const { version } = createRequire(import.meta.url)(pkgPath);
  if (Number(version.split('.')[0]) !== TS_MAJOR) {
    console.error(`✗ Found TypeScript ${version} at ${pkgPath}, but this check needs ${TS_MAJOR}.x. Run \`npm ci\`.`);
    process.exit(1);
  }
  return join(dirname(pkgPath), 'bin', 'tsc');
}

/**
 * Runs tsc on one config, gathering its errors (with their indented follow-up lines) and the files it read.
 * @param {string} tsc - Path to the tsc script.
 * @param {string} config - File name of a config in tools/js-types/.
 * @returns {{errors: {file: string, text: string}[], files: string[]}} Repo-relative paths; `file` is empty if none.
 */
function runTsc(tsc, config) {
  const args = [tsc, '-p', join('tools', 'js-types', config), '--pretty', 'false', '--listFiles'];
  let output;
  try {
    output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // Exit code 1 just means type errors were found. Anything else (a crash, a kill) may have cut the output short.
    if (err.signal || err.status !== 1) {
      console.error(`✗ tsc failed on ${config} (${err.signal || `exit ${err.status}`}):\n${err.stderr || err.message}`);
      process.exit(1);
    }
    output = err.stdout;
  }

  const errors = [];
  const files = [];
  for (const line of output.split('\n')) {
    const match = ERROR_LINE.exec(line);
    if (match) {
      errors.push({ file: match[1], text: line });
    } else if (line.startsWith('/')) {
      files.push(relative(ROOT, line));
    } else if (line.startsWith(' ') && errors.length) {
      errors[errors.length - 1].text += `\n${line}`;
    } else if (line.trim()) {
      errors.push({ file: '', text: line });
    }
  }
  return { errors, files };
}

/**
 * Lists the JS files under a CHECKED entry, skipping build/ bundles.
 * @param {string} entry - A folder or file path relative to the repo root.
 * @returns {string[]} Paths relative to the repo root; empty if the entry doesn't exist.
 */
function jsFilesUnder(entry) {
  const path = join(ROOT, entry);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return [];
  }
  if (stat.isFile()) return entry.endsWith('.js') ? [entry] : [];
  return readdirSync(path, { withFileTypes: true })
    .filter((d) => d.name !== 'build')
    .flatMap((d) => jsFilesUnder(join(entry, d.name)));
}

/**
 * Tells whether errors in a file fail the check. Anything outside public/js/ (a config or globals.d.ts) affects every
 * folder, so it always does.
 * @param {string} file - Path relative to the repo root, or empty for an error tied to no file.
 * @returns {boolean} True if the error fails the check.
 */
function isFatal(file) {
  if (!file.startsWith('public/js/')) return true;
  return CHECKED.some((entry) => file === entry || file.startsWith(`${entry}/`));
}

const showAll = process.argv.includes('--all');
const tsc = findTsc();

const seen = new Set();
const errors = [];
const readFiles = new Set();
for (const config of RUNS) {
  const run = runTsc(tsc, config);
  for (const e of run.errors) {
    if (!seen.has(e.text)) errors.push(e);
    seen.add(e.text);
  }
  run.files.forEach((f) => readFiles.add(f));
}

// A checked folder only counts if tsc actually read its files; a typo'd include would otherwise pass silently.
const coverageProblems = CHECKED.flatMap((entry) => {
  const files = jsFilesUnder(entry);
  if (files.length === 0) return [`CHECKED lists ${entry}, which has no JS files.`];
  return files.filter((f) => !readFiles.has(f)).map((f) => `${f} is in CHECKED, but no tsconfig reads it.`);
});
const failing = errors.filter((e) => isFatal(e.file));

if (showAll) {
  const unchecked = errors.filter((e) => !isFatal(e.file));
  for (const e of unchecked) console.log(e.text);

  // A count per folder, to help pick the next one to add to CHECKED.
  const perFolder = new Map();
  for (const e of unchecked) {
    const folder = dirname(e.file);
    perFolder.set(folder, (perFolder.get(folder) || 0) + 1);
  }
  console.log('\nErrors in folders not yet checked:');
  for (const [folder, count] of [...perFolder].sort((a, b) => a[1] - b[1])) {
    console.log(`${String(count).padStart(6)}  ${folder}`);
  }
  console.log('');
}

if (failing.length || coverageProblems.length) {
  console.error([...failing.map((e) => e.text), ...coverageProblems].join('\n'));
  if (failing.length) console.error(`\n✗ ${failing.length} type error(s) in checked folders or shared config.`);
  if (coverageProblems.length) console.error(`\n✗ ${coverageProblems.length} CHECKED file(s) aren't type-checked.`);
  process.exit(1);
}
console.log(`✓ No type errors in the ${CHECKED.length} checked folder(s).`);
