#!/usr/bin/env node
// `npm run watch`: `vite build --watch`, restarted whenever frontend/js/pages/ gains or loses a file. Vite reads the
// list of page entries once, when the config runs, so a new page would otherwise go unbuilt until the next start.
import { spawn } from 'node:child_process';
import { globSync, watch } from 'node:fs';
import path from 'node:path';

const PAGES_DIR = path.resolve('frontend/js/pages');
const ENTRY_GLOB = 'frontend/js/pages/**/*.js';

let vite = null;
let restarting = false;
let entries = snapshot();

/** @returns {string} The page entries on disk, as one comparable string. */
function snapshot() {
  return globSync(ENTRY_GLOB).sort().join('\n');
}

/** Runs the bundler in watch mode until it exits, and again after a restart this script asked for. */
function start() {
  // `npm run` puts node_modules/.bin on PATH, so the bare name works in a worktree too. Development mode keeps the
  // previous build in place while the next is written (vite.config.mjs), so a reload mid-rebuild still has a manifest.
  vite = spawn('vite', ['build', '--watch', '--mode', 'development'], { stdio: 'inherit' });
  vite.on('exit', (code, signal) => {
    if (restarting) {
      restarting = false;
      start();
    } else {
      process.exit(signal ? 1 : code ?? 0);
    }
  });
}

/** A save to an existing page is Vite's to handle; only a changed set of entries needs the restart. */
function onPagesChange() {
  const now = snapshot();
  if (now === entries || restarting) return;
  entries = now;
  console.log('==> page entries changed; restarting vite');
  restarting = true;
  vite.kill('SIGTERM');
}

watch(PAGES_DIR, { recursive: true }, onPagesChange);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    vite?.kill(signal);
    process.exit(0);
  });
}
start();
