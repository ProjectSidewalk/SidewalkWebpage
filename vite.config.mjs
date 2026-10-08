// Builds the frontend (#4467, #5651): every file in frontend/js/pages/ is one page's entry, bundled with what it
// imports (stylesheets included) to public/build/, where Play serves it. Vite's backend-integration setup: the pages
// are Twirl views, so views.ViteAssets reads the manifest to emit each page's <link> tags, and there is no dev server,
// since `vite build --watch` plus `sbt run` already serves a rebuilt page.
import { globSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const pages = globSync('frontend/js/pages/**/*.js');

// `vite build` runs in production mode; the watcher (tools/dev/watch-assets.mjs) asks for development mode.
export default defineConfig(({ mode }) => ({
  // Where the output is served. Vite assumes public/ is copied in beside it; here the output sits inside public/,
  // so renderBuiltUrl below addresses the two differently.
  base: '/assets/build/',
  publicDir: 'public',
  experimental: {
    /**
     * @returns {string|{relative: boolean}} A file under public/ by its served path; a built chunk or stylesheet
     *   relative to the importer.
     */
    renderBuiltUrl(filename, { type }) {
      return type === 'public' ? `/assets/${filename}` : { relative: true };
    }
  },
  build: {
    outDir: 'public/build',
    // The output lives inside public/, so copying public/ into it would recurse.
    copyPublicDir: false,
    // Each rebuild under the watcher would otherwise empty the directory first, and a page loaded in that gap has no
    // manifest to render from. Stale hashed files then linger until the next production build clears them.
    emptyOutDir: mode === 'production',
    // Vite writes no source map for CSS, so the watcher leaves it readable in DevTools.
    cssMinify: mode === 'production',
    // Not the default `.vite/manifest.json`: sbt-web skips hidden files when it stages public/, so Play would never
    // see it.
    manifest: 'manifest.json',
    // The map carries the sources: they live outside public/, so the server has nothing else to point at.
    sourcemap: true,
    rolldownOptions: {
      input: Object.fromEntries(
        pages.map(file => [path.relative('frontend/js/pages', file).replace(/\.js$/, ''), file])
      ),
      output: {
        // An entry keeps its plain name so a view can name it (sbt-digest fingerprints it at stage time). Chunks are
        // imported by relative path, and stylesheets named by the manifest, so both carry a hash; `[name]` alone
        // would also collide for admin/shell and dashboard/shell.
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/chunks/[name]-[hash].js',
        // Only stylesheets go to css/, where Play's cache rules (conf/application.conf) expect them; anything else a
        // module ever imports lands beside them under assets/.
        assetFileNames: ({ names }) =>
          (names.some(name => name.endsWith('.css')) ? 'css' : 'assets') + '/[name]-[hash][extname]'
      }
    }
  }
}));
