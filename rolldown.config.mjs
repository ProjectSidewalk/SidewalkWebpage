// Bundles the ES-module pages (#4467): every file in frontend/js/pages/ is one page's entry, built to public/build/js/
// under the same name, with code shared by several pages split into chunks/ so a visitor downloads it once.
import { globSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'rolldown';

const pages = globSync('frontend/js/pages/**/*.js');

export default defineConfig({
  input: Object.fromEntries(pages.map(file => [path.relative('frontend/js/pages', file).replace(/\.js$/, ''), file])),
  output: {
    dir: 'public/build/js',
    // Empties the folder first, so chunks from earlier builds (their names change with their contents) don't pile up.
    cleanDir: true,
    format: 'es',
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    minify: true,
    // The map carries the sources: they live outside public/, so the server has nothing else to point at.
    sourcemap: true
  }
});
