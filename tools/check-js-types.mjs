#!/usr/bin/env node
// Type-checks public/js/ with TypeScript, using the JSDoc types we already write (#5278). Nothing is compiled or
// shipped; this only reads the code.
//
// Grunt glues each app's files into one script that shares a single global scope, so tsc has to see a whole bundle
// at once to know what a name refers to. Explore, Validate, and Gallery each get their own run because they reuse
// class names (Main, Label, Form, ...) that would clash if checked together; everything else is one run. The runs
// are the configs in tools/js-types/.
//
// Most of the tree doesn't pass yet, so only the folders in CHECKED can fail the build. To add one, run with --all to
// see its errors, fix them, and list it here. Exits non-zero if a checked folder has an error.
//
// Usage: node tools/check-js-types.mjs [--all]

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Folders under public/js/ (each with everything inside it) or single files that must type-check cleanly. Grow this
// list; never shrink it.
const CHECKED = [
  'public/js/common/share',
  'public/js/community',
  'public/js/explore/src/alert',
  'public/js/explore/src/controls',
  'public/js/explore/src/data',
  'public/js/explore/src/game',
  'public/js/explore/src/label',
  'public/js/explore/src/menu',
  'public/js/explore/src/panorama',
  'public/js/explore/src/region',
  'public/js/explore/src/user',
  'public/js/explore/src/zoom',
  'public/js/gallery/src/data',
  'public/js/gallery/src/displays',
  'public/js/gallery/src/expandedview',
  'public/js/gallery/src/keyboard',
  'public/js/gallery/src/validation',
  'public/js/validate/src/data',
  'public/js/validate/src/mission',
  'public/js/validate/src/modal',
  'public/js/validate/src/status',
  'public/js/validate/src/user',
  'public/js/validate/src/util',
  'public/js/validate/src/zoom',
];

// One tsc run per config. common/ is in every run, and each run can find different errors there (a common/ typedef
// can clash with one app's class), so every run's errors count; the same error from several runs is printed once.
const RUNS = ['tsconfig.explore.json', 'tsconfig.validate.json', 'tsconfig.gallery.json', 'tsconfig.other.json'];

// A tsc error line: `public/js/foo.js(12,5): error TS2339: Property 'x' does not exist on type 'y'.`
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): /;

/**
 * Runs tsc on one config and gathers its errors, keeping each error's indented follow-up lines with it.
 * @param {string} config - File name of a config in tools/js-types/.
 * @returns {{file: string, text: string}[]} Every error tsc reported, with paths relative to the repo root.
 */
function runTsc(config) {
  // Found from here rather than from ROOT, so a git worktree without its own node_modules uses the main checkout's.
  const tsc = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc');
  let output;
  try {
    output = execFileSync(process.execPath, [tsc, '-p', join('tools', 'js-types', config), '--pretty', 'false'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // tsc exits non-zero whenever it finds an error; only a run with no output at all is a real failure.
    if (!err.stdout) throw err;
    output = err.stdout;
  }

  const errors = [];
  for (const line of output.split('\n')) {
    const match = ERROR_LINE.exec(line);
    if (match) {
      errors.push({ file: match[1], text: line });
    } else if (line.startsWith(' ') && errors.length) {
      errors[errors.length - 1].text += `\n${line}`;
    } else if (line.trim()) {
      // A config problem (a bad path, an unknown option) rather than a type error. Always fatal.
      errors.push({ file: '', text: line });
    }
  }
  return errors;
}

/**
 * Tells whether a file is in one of the CHECKED folders.
 * @param {string} file - Path relative to the repo root.
 * @returns {boolean} True if errors in this file fail the check.
 */
function isChecked(file) {
  return CHECKED.some((entry) => file === entry || file.startsWith(entry.endsWith('/') ? entry : `${entry}/`));
}

const showAll = process.argv.includes('--all');
const problems = [];

for (const entry of CHECKED) {
  if (!existsSync(join(ROOT, entry))) problems.push(`CHECKED lists ${entry}, which doesn't exist.`);
}

const seen = new Set();
const errors = RUNS.flatMap(runTsc).filter((e) => !seen.has(e.text) && seen.add(e.text));
const failing = errors.filter((e) => !e.file || isChecked(e.file));
problems.push(...failing.map((e) => e.text));

if (showAll) {
  const unchecked = errors.filter((e) => e.file && !isChecked(e.file));
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

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n✗ ${failing.length} type error(s) in checked folders.`);
  process.exit(1);
}
console.log(`✓ No type errors in the ${CHECKED.length} checked folder(s).`);
