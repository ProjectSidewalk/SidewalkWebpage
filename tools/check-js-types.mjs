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
// Every file in public/js/ must type-check cleanly, except those under UNCHECKED. Run with --all to see their errors
// too. Exits non-zero if a checked file has an error or no tsconfig reads it.
//
// Usage: node tools/check-js-types.mjs [--all]

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TS_MAJOR = 7;

// Folders under public/js/ (each with everything inside it) or single files whose errors don't fail the check yet.
// Shrink this list; never grow it. AccessScore is in beta and changing fast, so it's cleaned up once it settles.
const UNCHECKED = ['public/js/access-score'];

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
 * Lists the JS files under a folder, skipping build/ bundles.
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
 * Finds the UNCHECKED entry a file falls under.
 * @param {string} file - Path relative to the repo root, or empty for an error tied to no file.
 * @returns {string|undefined} The entry, or undefined if the file is checked.
 */
function uncheckedEntry(file) {
  return UNCHECKED.find((entry) => file === entry || file.startsWith(`${entry}/`));
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

// A file only counts as checked if tsc actually read it; a new bundle no tsconfig includes would otherwise pass silently.
const coverageProblems = [
  ...UNCHECKED.filter((entry) => jsFilesUnder(entry).length === 0).map((e) => `UNCHECKED lists ${e}, which has no JS.`),
  ...jsFilesUnder('public/js')
    .filter((f) => !uncheckedEntry(f) && !readFiles.has(f))
    .map((f) => `${f} isn't read by any tsconfig in tools/js-types/.`),
];
// Anything outside public/js/ (a config or globals.d.ts) affects every folder, so its errors always count.
const failing = errors.filter((e) => !uncheckedEntry(e.file));

if (showAll) {
  const unchecked = errors.filter((e) => uncheckedEntry(e.file));
  for (const e of unchecked) console.log(e.text);

  // A count per folder, to show how much cleanup is left.
  const perFolder = new Map();
  for (const e of unchecked) {
    const folder = dirname(e.file);
    perFolder.set(folder, (perFolder.get(folder) || 0) + 1);
  }
  console.log('\nErrors in unchecked folders:');
  for (const [folder, count] of [...perFolder].sort((a, b) => a[1] - b[1])) {
    console.log(`${String(count).padStart(6)}  ${folder}`);
  }
  // Only a note, not a failure, so a folder that happens to be clean mid-rewrite doesn't break its author's build.
  for (const entry of UNCHECKED.filter((en) => !unchecked.some((e) => uncheckedEntry(e.file) === en))) {
    console.log(`\n${entry} has no type errors now; remove it from UNCHECKED.`);
  }
  console.log('');
}

if (failing.length || coverageProblems.length) {
  console.error([...failing.map((e) => e.text), ...coverageProblems].join('\n'));
  if (failing.length) console.error(`\n✗ ${failing.length} type error(s) in checked files or shared config.`);
  if (coverageProblems.length) console.error(`\n✗ ${coverageProblems.length} coverage problem(s).`);
  process.exit(1);
}
console.log(`✓ No type errors in public/js/ outside ${UNCHECKED.join(', ')}.`);
