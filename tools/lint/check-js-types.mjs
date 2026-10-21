#!/usr/bin/env node
// Type-checks frontend/js/ with TypeScript, using the JSDoc types we already write (#5278). Nothing is compiled or
// shipped; this only reads the code.
//
// Every file is an ES module, so one run over all of frontend/js/ sees each name the way its own imports define it;
// the config is tools/lint/js-types/tsconfig.json. Vendor libraries loaded by <script> tag, and the few values the
// views stamp onto window, are declared in globals.d.ts beside it.
//
// Every file in frontend/js/ must type-check cleanly. Exits non-zero if a file has an error or the config misses one.
//
// Usage: node tools/lint/check-js-types.mjs

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TS_MAJOR = 7;

const RUNS = ['tsconfig.json'];

// A tsc error line: `frontend/js/foo.js(12,5): error TS2339: Property 'x' does not exist on type 'y'.`
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
 * @param {string} config - File name of a config in tools/lint/js-types/.
 * @returns {{errors: {file: string, text: string}[], files: string[]}} Repo-relative paths; `file` is empty if none.
 */
function runTsc(tsc, config) {
  const args = [tsc, '-p', join('tools', 'lint', 'js-types', config), '--pretty', 'false', '--listFiles'];
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
 * @param {string} folder - A folder path relative to the repo root.
 * @returns {string[]} Paths relative to the repo root.
 */
function jsFilesUnder(folder) {
  return readdirSync(join(ROOT, folder), { withFileTypes: true })
    .filter((d) => d.name !== 'build')
    .flatMap((d) => {
      const path = join(folder, d.name);
      if (d.isDirectory()) return jsFilesUnder(path);
      return d.name.endsWith('.js') ? [path] : [];
    });
}

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

// A file only counts as checked if tsc actually read it; a new bundle that no tsconfig includes would otherwise pass
// silently.
const coverageProblems = jsFilesUnder('frontend/js')
  .filter((f) => !readFiles.has(f))
  .map((f) => `${f} isn't read by any tsconfig in tools/lint/js-types/.`);

if (errors.length || coverageProblems.length) {
  console.error([...errors.map((e) => e.text), ...coverageProblems].join('\n'));
  if (errors.length) console.error(`\n✗ ${errors.length} type error(s).`);
  if (coverageProblems.length) console.error(`\n✗ ${coverageProblems.length} coverage problem(s).`);
  process.exit(1);
}
console.log('✓ No type errors in frontend/js/.');
