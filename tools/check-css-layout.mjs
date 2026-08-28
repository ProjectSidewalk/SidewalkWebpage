#!/usr/bin/env node
// Layout check for public/css/ (#5030). A stylesheet there is one of: the token/primitive base (main.css, fonts.css),
// a shared component (components/), or a page (pages/ — a single file, or a subdir for a page family such as the
// API docs or Explore). The tree only stays that way if:
//
//   1. A page's stylesheet is linked only by that page's own views — or, for the Grunt-bundled tools, only by that
//      tool's own bundle in Gruntfile.js. Anything two pages need belongs in css/components/.
//   2. A page's class prefix (ud-, svl-, ...) is defined only in that page's stylesheet(s), so a component can't
//      quietly depend on a page stylesheet it may not be loaded with.
//   3. Nothing sits at the root but main.css, fonts.css, components/, and pages/.
//
// It also checks that every stylesheet a view links exists: assets.path() resolves at render time, so a moved file is
// a 500 on the page, not a build failure. Exits non-zero with the offending files listed, so it can gate CI.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = join(ROOT, 'public', 'css');
const ROOT_ENTRIES = new Set(['main.css', 'fonts.css', 'components', 'pages']);

// The pages with an owner: which views may link them (`[]` = a Grunt-bundled tool, never linked from a view; its
// bundle is `public/js/<name>/`) and which class prefixes are theirs. A page absent here (about.css, auth.css, ...)
// may be linked from anywhere. `api-` is deliberately not a prefix: the API docs' own classes carry it, but so does
// the admin dashboard's API-analytics page.
const PAGES = {
  'pages/api-docs': { views: ['app/views/apiDocs/'], prefixes: [] },
  'pages/admin-dashboard.css': {
    views: ['app/views/admin/dashboard/'],
    prefixes: ['ac-', 'ov-', 'dq-', 'hva-', 'mgmt-', 'contrib-', 'coverage-', 'activity-', 'deploy-strip',
      'stories-queue-', 'street-status-', 'imagery-', 'health-kpi'],
  },
  'pages/user-dashboard.css': { views: ['app/views/userDashboard/'], prefixes: ['ud-'] },
  'pages/explore': { views: [], prefixes: ['svl-'] },
  'pages/validate': { views: [], prefixes: ['svv-'] },
  'pages/gallery': { views: [], prefixes: ['gallery-'] },
};

const problems = [];

/** @returns {string[]} Every file under `dir` (recursively) whose name passes `keep`, as repo-relative paths. */
function walk(dir, keep) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, keep);
    return keep(entry.name) ? [relative(ROOT, full)] : [];
  });
}

/** @returns {string|null} The PAGES key that owns a `pages/...` path (a file itself, or the subdir it sits in). */
function ownerOf(cssRelPath) {
  return Object.keys(PAGES).find((key) => cssRelPath === key || cssRelPath.startsWith(`${key}/`)) ?? null;
}

// --- 1. Links from views, and that every linked file exists -------------------------------------------------------

const LINK = /assets\.path\("css\/([^"]+\.css)"\)/g;
for (const view of walk(join(ROOT, 'app', 'views'), (name) => name.endsWith('.scala.html'))) {
  const text = readFileSync(join(ROOT, view), 'utf8');
  for (const [, href] of text.matchAll(LINK)) {
    if (!existsSync(join(CSS_DIR, href))) {
      problems.push(`${view}: links css/${href}, which does not exist`);
      continue;
    }
    const owner = ownerOf(href);
    if (owner === null) continue;
    const { views } = PAGES[owner];
    if (!views.some((prefix) => view.startsWith(prefix))) {
      problems.push(views.length
        ? `${view}: links css/${href}, which only ${views.join(', ')} may link (shared rules go in css/components/)`
        : `${view}: links css/${href}, which is bundled by Grunt and never linked directly`);
    }
  }
}

// --- 1b. Grunt bundles: a tool's stylesheets only feed that tool's own bundle -------------------------------------

const grunt = readFileSync(join(ROOT, 'Gruntfile.js'), 'utf8');
for (const [, srcList, dest] of grunt.matchAll(/src:\s*\[([^\]]*)\]\s*,\s*dest:\s*'([^']+)'/g)) {
  for (const [, src] of srcList.matchAll(/'public\/css\/([^']+)'/g)) {
    const owner = ownerOf(src);
    if (owner === null) continue;
    const tool = owner.slice('pages/'.length);
    if (!dest.startsWith(`public/js/${tool}/`)) {
      problems.push(`Gruntfile.js: ${dest} bundles public/css/${src}, which only ${tool}'s bundle may`);
    }
  }
}

// --- 2. Page prefixes stay in the page's own files; 3. nothing else at the root ----------------------------------

for (const entry of readdirSync(CSS_DIR)) {
  if (!ROOT_ENTRIES.has(entry)) {
    problems.push(`public/css/${entry}: not one of main.css, fonts.css, components/, pages/ — move it into one of them`);
  }
}

const stylesheets = walk(CSS_DIR, (name) => name.endsWith('.css'));
for (const file of stylesheets) {
  const cssRel = relative(join('public', 'css'), file);
  const owner = ownerOf(cssRel);

  // Selector preludes only: strip comments, then take the text before each `{` that isn't an at-rule.
  const css = readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const classes = new Set();
  for (const [, prelude] of css.matchAll(/([^{}]+)\{/g)) {
    if (prelude.trim().startsWith('@')) continue;
    for (const [, cls] of prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(cls);
  }
  for (const [page, { prefixes }] of Object.entries(PAGES)) {
    if (page === owner) continue;
    const leaked = [...classes].filter((cls) => prefixes.some((p) => cls.startsWith(p)));
    if (leaked.length) {
      problems.push(`${file}: styles ${page} classes (${leaked.slice(0, 5).join(', ')}${leaked.length > 5 ? ', ...' : ''}); only css/${page} may`);
    }
  }
}

if (problems.length === 0) {
  console.log(`CSS layout OK -- ${stylesheets.length} stylesheets, every page file linked only by its page.`);
  process.exit(0);
}

console.error(`CSS layout check failed (${problems.length} problem(s)):\n`);
for (const problem of problems) console.error(`  ${problem}`);
process.exit(1);
