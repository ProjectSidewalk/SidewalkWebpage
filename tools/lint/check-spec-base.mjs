#!/usr/bin/env node
// Every backend spec must extend util.SidewalkSpec, never PlaySpec directly. SidewalkSpec switches off ScalaTest's
// `===`, which otherwise wins over Slick's inside a spec and quietly turns `filter(_.id === id)` into `where false`
// (#3936). Nothing fails when that happens, so this check is the only thing that catches a spec that forgot.
//
// Exits non-zero with the offending lines listed, so it can gate CI.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEST_DIR = join(ROOT, 'test');
const BASE_CLASS = join(TEST_DIR, 'util', 'SidewalkSpec.scala');

/**
 * Lists every Scala file under a directory.
 *
 * @param {string} dir Directory to walk.
 * @returns {string[]} Absolute paths of the `.scala` files inside it.
 */
function scalaFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return scalaFiles(path);
    return entry.name.endsWith('.scala') ? [path] : [];
  });
}

const offenders = scalaFiles(TEST_DIR)
  .filter((file) => file !== BASE_CLASS)
  .flatMap((file) => readFileSync(file, 'utf8').split('\n')
    .map((line, i) => ({ line, location: `${relative(ROOT, file)}:${i + 1}` }))
    .filter(({ line }) => /\bextends\s+PlaySpec\b/.test(line)));

if (offenders.length > 0) {
  console.error('These specs extend PlaySpec directly. Extend util.SidewalkSpec instead:');
  offenders.forEach(({ line, location }) => console.error(`  ${location}: ${line.trim()}`));
  process.exit(1);
}
console.log('Spec base class check passed.');
