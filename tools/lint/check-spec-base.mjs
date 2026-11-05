#!/usr/bin/env node
// A spec that touches the database must build on util.SidewalkSpec. Any other base leaves ScalaTest's `===` on, which
// quietly turns Slick's `filter(_.id === id)` into `where false` (#3936), and nothing fails when that happens.
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

const PLAY_SPEC = /\bPlaySpec\b/;
// ScalaTest's own bases are fine for plain logic, so they are flagged only in a file that uses Slick.
const SCALATEST_BASE = /\bextends\s+Any[A-Z]\w*\b/;
const USES_SLICK = /^import\s+(slick\.|models\.utils\.MyPostgresProfile)/m;

const offenders = scalaFiles(TEST_DIR)
  .filter((file) => file !== BASE_CLASS)
  .flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const usesSlick = USES_SLICK.test(source);
    return source.split('\n')
      .map((line, i) => ({ line, location: `${relative(ROOT, file)}:${i + 1}` }))
      .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !/^import\s/.test(line))
      .filter(({ line }) => PLAY_SPEC.test(line) || (usesSlick && SCALATEST_BASE.test(line)));
  });

if (offenders.length > 0) {
  console.error('These specs can reach ScalaTest\'s ===. Build them on util.SidewalkSpec instead:');
  offenders.forEach(({ line, location }) => console.error(`  ${location}: ${line.trim()}`));
  process.exit(1);
}
console.log('Spec base class check passed.');
