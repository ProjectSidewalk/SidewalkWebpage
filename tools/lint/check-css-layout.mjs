#!/usr/bin/env node
// Layout check for frontend/css/ (#5030, #5651). A stylesheet there is one of: the token/primitive base (main.css,
// fonts.css), a shared component (components/), or a page (pages/ — a single file, or a subdir for a page family such
// as the API docs or Explore). A module `import`s the stylesheets it needs, Vite writes them to public/build/css/, and
// a view emits its page's <link> tags with `@ViteAssets.stylesheets("<entry>")`. The tree only stays that way if:
//
//   1. A page's stylesheet is imported only by the modules registered to it below — its entry, or the page's own JS
//      folder. Anything two pages need belongs in css/components/. Every entry under pages/ must be registered, so a
//      new page file is covered by construction.
//   2. Every stylesheet is imported by something: one that isn't is served to nobody.
//   3. A page's class prefix (ud-, svl-, ...) is defined only in that page's stylesheet(s), so a component can't
//      quietly depend on a page stylesheet it may not be loaded with.
//   4. Nothing sits at the root but main.css, fonts.css, components/, and pages/.
//   5. A view that loads an entry's JS also asks for that entry's styles, and names an entry that exists. A leftover
//      `<link>` to a stylesheet by path is caught here too.
//
// Exits non-zero with the offending files listed, so it can gate CI.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS_DIR = join(ROOT, 'frontend', 'css');
const JS_DIR = join(ROOT, 'frontend', 'js');
const PAGES_DIR = join(JS_DIR, 'pages');
const ROOT_ENTRIES = new Set(['main.css', 'fonts.css', 'components', 'pages']);

// Every entry under pages/ (a file, or a subdir for a page family): which modules may import it (a directory prefix
// or a single file) and which class prefixes are its own. homepage.css and auth.css are registered to the shell entry,
// which main.scala.html loads on every page. `api-` is deliberately not a prefix: the API docs' own classes carry it,
// but so does the admin dashboard's API-analytics page.
const PAGES = {
  'pages/about.css': { importers: ['frontend/js/pages/about.js'] },
  'pages/access-score.css': { importers: ['frontend/js/pages/accessScore.js', 'frontend/js/access-score/'], prefixes: ['acs-'] },
  'pages/admin-dashboard.css': {
    importers: ['frontend/js/pages/admin/', 'frontend/js/admin-dashboard/'],
    prefixes: ['ac-', 'ov-', 'dq-', 'hva-', 'mgmt-', 'contrib-', 'coverage-', 'activity-', 'deploy-strip',
      'stories-queue-', 'street-status-', 'imagery-', 'health-kpi', 'partners-', 'admin-nav-'],
  },
  'pages/api-docs': { importers: ['frontend/js/pages/api-docs/', 'frontend/js/api-docs/'] },
  'pages/auth.css': { importers: ['frontend/js/pages/main.js'] },
  'pages/community-list.css': {
    importers: ['frontend/js/pages/routes.js', 'frontend/js/pages/stories.js', 'frontend/js/community/'],
  },
  'pages/errors.css': { importers: ['frontend/js/pages/errorPage.js'] },
  'pages/explore': { importers: ['frontend/js/pages/explore.js', 'frontend/js/explore/'], prefixes: ['svl-'] },
  'pages/gallery': { importers: ['frontend/js/pages/gallery.js', 'frontend/js/gallery/'], prefixes: ['gallery-'] },
  'pages/homepage.css': { importers: ['frontend/js/pages/main.js'] },
  'pages/labeling-guide.css': { importers: ['frontend/js/pages/labelingGuide.js', 'frontend/js/common/labelingGuide.js'] },
  'pages/maintenance.css': { importers: ['frontend/js/pages/maintenance.js'] },
  'pages/mobile-landing.css': { importers: ['frontend/js/pages/mobileLanding.js'] },
  'pages/mobile-validate.css': { importers: ['frontend/js/pages/mobileValidate.js', 'frontend/js/mobileValidate.js'] },
  'pages/route-builder.css': { importers: ['frontend/js/pages/routeBuilder.js', 'frontend/js/route-builder/'] },
  'pages/shared-label.css': { importers: ['frontend/js/pages/sharedLabel.js', 'frontend/js/shared-label/'] },
  'pages/user-dashboard.css': { importers: ['frontend/js/pages/dashboard/', 'frontend/js/user-dashboard/'], prefixes: ['ud-'] },
  'pages/validate': {
    importers: ['frontend/js/pages/validate.js', 'frontend/js/pages/mobileValidate.js', 'frontend/js/validate/'],
    prefixes: ['svv-'],
  },
};

// A relative `import` of a stylesheet or module, static or dynamic.
const IMPORT = /\bimport\s*(?:[^'"()]*?\bfrom\s*)?\(?\s*['"](\.[^'"]+)['"]/g;

const problems = [];

/** @returns {string[]} Every file under `dir` (recursively) whose name passes `keep`, as repo-relative paths. */
function walk(dir, keep) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, keep);
    return keep(entry.name) ? [relative(ROOT, full)] : [];
  });
}

/** @returns {string|null} The PAGES key that owns a `pages/...` path (the file itself, or the subdir it sits in). */
function ownerOf(cssRelPath) {
  return Object.keys(PAGES).find((key) => cssRelPath === key || cssRelPath.startsWith(`${key}/`)) ?? null;
}

/** @returns {string[]} The repo-relative targets of every relative import in a JS file, in source order. */
function importsOf(jsFile) {
  const text = readFileSync(join(ROOT, jsFile), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...text.matchAll(IMPORT)].map(([, spec]) => relative(ROOT, resolve(dirname(join(ROOT, jsFile)), spec)));
}

// --- 0. The registry and pages/ agree ----------------------------------------------------------------------------

for (const key of Object.keys(PAGES)) {
  if (!existsSync(join(CSS_DIR, key))) problems.push(`tools/lint/check-css-layout.mjs: registers ${key}, which does not exist`);
}
if (existsSync(join(CSS_DIR, 'pages'))) {
  for (const entry of readdirSync(join(CSS_DIR, 'pages'))) {
    if (!(`pages/${entry}` in PAGES)) {
      problems.push(`frontend/css/pages/${entry}: not registered in tools/lint/check-css-layout.mjs — add it to PAGES with the modules that may import it`);
    }
  }
}

// --- 1 & 2. Imports from modules: every target exists, page sheets stay with their page, nothing goes unimported ---

const stylesheets = walk(CSS_DIR, (name) => name.endsWith('.css'));
const modules = walk(JS_DIR, (name) => name.endsWith('.js'));
const imported = new Set();

for (const module of modules) {
  for (const target of importsOf(module).filter((t) => t.endsWith('.css'))) {
    if (!target.startsWith('frontend/css/') || !existsSync(join(ROOT, target))) {
      problems.push(`${module}: imports ${target}, which is not a stylesheet under frontend/css/`);
      continue;
    }
    imported.add(target);
    const owner = ownerOf(relative(CSS_DIR, join(ROOT, target)));
    if (owner === null) continue;
    const { importers } = PAGES[owner];
    if (!importers.some((prefix) => module.startsWith(prefix))) {
      problems.push(`${module}: imports ${target}, which only ${importers.join(', ')} may (shared rules go in css/components/)`);
    }
  }
}

for (const file of stylesheets) {
  if (!imported.has(file)) problems.push(`${file}: imported by nothing under frontend/js/, so no page gets it — import it from the module that needs it, or delete it`);
}

// --- 3. Page prefixes stay in the page's own files; 4. nothing else at the root ----------------------------------

for (const entry of readdirSync(CSS_DIR)) {
  if (!ROOT_ENTRIES.has(entry)) {
    problems.push(`frontend/css/${entry}: not one of main.css, fonts.css, components/, pages/ — move it into one of them`);
  }
}

for (const file of stylesheets) {
  const owner = ownerOf(relative(CSS_DIR, join(ROOT, file)));

  // Selector preludes only: strip comments, then take the text before each `{` that isn't an at-rule.
  const css = readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const classes = new Set();
  for (const [, prelude] of css.matchAll(/([^{}]+)\{/g)) {
    if (prelude.trim().startsWith('@')) continue;
    for (const [, cls] of prelude.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(cls);
  }
  for (const [page, { prefixes = [] }] of Object.entries(PAGES)) {
    if (page === owner) continue;
    const leaked = [...classes].filter((cls) => prefixes.some((p) => cls.startsWith(p)));
    if (leaked.length) {
      problems.push(`${file}: styles ${page} classes (${leaked.slice(0, 5).join(', ')}${leaked.length > 5 ? ', ...' : ''}); only css/${page} may`);
    }
  }
}

// --- 5. Every view pairs its entry's script with that entry's stylesheet tags --------------------------------------
// `@ViteAssets.stylesheets("<entry>")` emits whatever the manifest says the entry needs, so the only ways to get it
// wrong are to name an entry that doesn't exist (a 500 at render time) or to load an entry's JS without asking for
// its styles (a page that works but looks wrong).

const entries = walk(PAGES_DIR, (name) => name.endsWith('.js')).map((file) => relative(PAGES_DIR, join(ROOT, file)).replace(/\.js$/, ''));
const STYLES_CALL = /ViteAssets\.stylesheets\("([^"]+)"\)/g;
const JS_LINK = /assets\.path\("build\/js\/([^"]+)\.js"\)/g;
const STALE_LINK = /(?:assets\.path|routes\.Assets\.versioned)\("(?:css|build\/css)\/[^"]+"\)/g;
let views = 0;
for (const view of walk(join(ROOT, 'app', 'views'), (name) => name.endsWith('.scala.html'))) {
  const text = readFileSync(join(ROOT, view), 'utf8');
  views++;
  for (const [token] of text.matchAll(STALE_LINK)) {
    problems.push(`${view}: ${token} links a stylesheet by path; import it from the page's entry and emit the tags with @ViteAssets.stylesheets("<entry>")`);
  }
  const styled = [...text.matchAll(STYLES_CALL)].map(([, name]) => name);
  for (const name of styled) {
    if (!entries.includes(name)) problems.push(`${view}: @ViteAssets.stylesheets("${name}"), but frontend/js/pages/ has no entry named ${name}`);
  }
  for (const [, name] of text.matchAll(JS_LINK)) {
    if (!styled.includes(name)) problems.push(`${view}: loads build/js/${name}.js without @ViteAssets.stylesheets("${name}") for its styles`);
  }
}

if (problems.length === 0) {
  console.log(`CSS layout OK -- ${stylesheets.length} stylesheets, every page file imported only by its page; `
    + `${entries.length} entries, each view asking for its entry's styles (${views} checked).`);
  process.exit(0);
}

console.error(`CSS layout check failed (${problems.length} problem(s)):\n`);
for (const problem of problems) console.error(`  ${problem}`);
process.exit(1);
