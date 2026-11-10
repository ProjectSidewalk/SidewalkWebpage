#!/usr/bin/env node
// The deployment learns which env vars to pass only from the "Runtime configuration contract" table in
// docs/deployment-and-stages.md (#5138), so every `${?NAME}` in conf/ must have a row there and vice versa. Exits
// non-zero with the names each side lacks, so it can gate CI.

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
  });
}

/**
 * @param {string[]} files Config files to scan for `${?NAME}` references.
 * @returns {Map<string, string>} Name → the first `file:line` that references it.
 */
function referencedVars(files) {
  const found = new Map();
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const match of line.matchAll(/\$\{\?([A-Z][A-Z0-9_]*)\}/g)) {
        if (!found.has(match[1])) found.set(match[1], `${relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  return found;
}

/**
 * A documented name is a backticked UPPER_SNAKE word in the contract section; requiring an underscore keeps
 * placeholders like `NAME` out.
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
  return new Set([...section.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map((m) => m[1]));
}

const referenced = referencedVars(confFiles(CONF_DIR));
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
