#!/usr/bin/env node
// The deployment learns which env vars to pass only from the "Runtime configuration contract" table in
// docs/deployment-and-stages.md (#5138), so every `${?NAME}` in conf/ and every env var logback.xml reads must have a
// row there and vice versa. Exits non-zero with the names each side lacks, so it can gate CI.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONF_DIR = join(ROOT, 'conf');
const DOC = join(ROOT, 'docs', 'deployment-and-stages.md');
const SECTION_HEADING = '## Runtime configuration contract';

/**
 * @param {string} dir Directory to walk.
 * @returns {string[]} Absolute paths of the `.conf` files under it.
 */
function confFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return confFiles(path);
    return entry.name.endsWith('.conf') ? [path] : [];
  }).sort();
}

/** Names logback defines on its own, which `${NAME}` in logback.xml reads without any env var. */
const LOGBACK_BUILTINS = new Set(['HOSTNAME', 'CONTEXT_NAME']);

/**
 * @param {Map<string, string>} found Name → first `file:line`, added to in place.
 * @param {string} file Config file to scan.
 * @param {string} text Its contents with comments already removed, so line numbers still line up.
 * @param {RegExp} pattern Global regex whose first group is the env var name.
 * @param {Set<string>} skip Names that aren't env vars even though they match.
 */
function collectRefs(found, file, text, pattern, skip = new Set()) {
  text.split('\n').forEach((line, i) => {
    for (const match of line.matchAll(pattern)) {
      if (!skip.has(match[1]) && !found.has(match[1])) found.set(match[1], `${relative(ROOT, file)}:${i + 1}`);
    }
  });
}

/**
 * @param {string[]} files Config files to scan for `${?NAME}` references.
 * @returns {Map<string, string>} Name → the first `file:line` that references it.
 */
function referencedVars(files) {
  const found = new Map();
  for (const file of files) {
    const code = readFileSync(file, 'utf8').split('\n').map((line) => line.replace(/(^|\s)(#|\/\/).*$/, ''));
    collectRefs(found, file, code.join('\n'), /\$\{\?([A-Z][A-Z0-9_]*)\}/g);
  }
  return found;
}

/**
 * Logback has no optional marker, so `${NAME}` and `${NAME:-default}` both count unless the file defines NAME itself
 * or logback does. Lowercase names (`user.dir`, `application.home`) are JVM or Play properties, not env vars.
 *
 * @param {string} file The logback config.
 * @returns {Map<string, string>} Name → the first `file:line` that references it.
 */
function logbackVars(file) {
  // Comments go blank rather than away, so the line numbers in the report stay right.
  const xml = readFileSync(file, 'utf8').replace(/<!--[^]*?-->/g, (c) => c.replace(/[^\n]/g, ''));
  const own = new Set([...xml.matchAll(/<(?:property|variable)\s+name="([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]));
  const found = new Map();
  collectRefs(found, file, xml, /\$\{([A-Z][A-Z0-9_]*)(?::-|\})/g, new Set([...own, ...LOGBACK_BUILTINS]));
  return found;
}

/**
 * A documented name is a backticked word in the first column of a table row in the contract section; a name that only
 * appears in another row's description doesn't count.
 *
 * @param {string} markdown The whole doc.
 * @returns {Set<string>} The documented names.
 */
function documentedVars(markdown) {
  const start = markdown.indexOf(SECTION_HEADING);
  if (start < 0) {
    console.error(`${relative(ROOT, DOC)} has no "${SECTION_HEADING}" section.`);
    process.exit(1);
  }
  const rest = markdown.slice(start + SECTION_HEADING.length);
  const end = rest.search(/\n## /);
  const section = end < 0 ? rest : rest.slice(0, end);
  const firstCells = section.split('\n').filter((line) => line.startsWith('|')).map((line) => line.split('|')[1]);
  return new Set(firstCells.flatMap((cell) => [...cell.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1])));
}

const referenced = new Map([...logbackVars(join(CONF_DIR, 'logback.xml')), ...referencedVars(confFiles(CONF_DIR))]);
const documented = documentedVars(readFileSync(DOC, 'utf8'));
const undocumented = [...referenced].filter(([name]) => !documented.has(name));
const unreferenced = [...documented].filter((name) => !referenced.has(name));

if (undocumented.length > 0 || unreferenced.length > 0) {
  const docPath = relative(ROOT, DOC);
  if (undocumented.length > 0) {
    const section = SECTION_HEADING.slice(3);
    console.error(`conf/ reads these env vars, but the "${section}" table in ${docPath} doesn't list them:`);
    undocumented.forEach(([name, where]) => console.error(`  ${name} (${where})`));
  }
  if (unreferenced.length > 0) {
    console.error(`${docPath} lists these env vars, but nothing in conf/ reads them:`);
    unreferenced.forEach((name) => console.error(`  ${name}`));
  }
  process.exit(1);
}
console.log(`Env var contract check passed (${referenced.size} variables).`);
