// Builds the frontend (#4467, #5651): every file in frontend/js/pages/ is one page's entry, bundled with what it imports
// (stylesheets included) to public/build/, where Play serves it. Vite's backend-integration setup: the pages are Twirl
// views, so views.ViteAssets reads the manifest to emit each page's <link> tags, and there is no dev server, since
// `vite build --watch` plus `sbt run` already serves a rebuilt page.
import { globSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const pages = globSync('frontend/js/pages/**/*.js');

export default defineConfig({
  // Where public/ is served, so a stylesheet's `url("/images/x.svg")` resolves.
  base: '/assets/',
  publicDir: 'public',
  build: {
    outDir: 'public/build',
    // The output lives inside public/, so copying public/ into it would recurse.
    copyPublicDir: false,
    // Not the default `.vite/manifest.json`: sbt-web skips hidden files when it stages public/, so Play would never see it.
    manifest: 'manifest.json',
    // The map carries the sources: they live outside public/, so the server has nothing else to point at.
    sourcemap: true,
    rolldownOptions: {
      input: Object.fromEntries(pages.map(file => [path.relative('frontend/js/pages', file).replace(/\.js$/, ''), file])),
      output: {
        // An entry keeps its plain name so a view can name it (sbt-digest fingerprints it at stage time). Chunks are
        // imported by relative path, and stylesheets named by the manifest, so both carry a hash; `[name]` alone would
        // also collide for admin/shell and dashboard/shell.
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/chunks/[name]-[hash].js',
        assetFileNames: 'css/[name]-[hash][extname]'
      }
    }
  }
});
