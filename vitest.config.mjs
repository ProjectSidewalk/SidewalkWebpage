/**
 * Vitest configuration for Project Sidewalk's frontend test layer (#5649).
 *
 * Run it with `make test-js` (or `npm run test:js`; `test:js:coverage` for the report). CI runs the latter as a
 * blocking step in the frontend job. See test/js/README.md and docs/testing-and-ci.md.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // These tests render into a DOM, so run them under jsdom (provides window/document).
    environment: 'jsdom',
    // The page's address is `http://localhost/`, as the suites' expected URLs were written for.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },

    // Each file gets a VM context whose global is the jsdom window, so `window.X = fake` is a page global to the modules
    // under test and `view: window` is a real Window; it is also the fastest pool here (workers are reused, not forked).
    pool: 'vmForks',

    // Pinned, or the suite inherits the machine's zone and a bug that only bites west of Greenwich -- a UTC timestamp
    // near midnight printing as the month before -- passes in a UTC runner while failing for the labelers it reaches.
    env: { TZ: 'America/Los_Angeles' },

    setupFiles: ['test/js/setup.js'],

    // `describe`, `it`, `expect`, `vi` and the hooks as globals, the way the suites were written.
    globals: true,

    include: ['test/js/**/*.test.js'],

    // Spies and `vi.stubGlobal` stubs are undone before every test, so no suite needs an afterEach for it.
    restoreMocks: true,
    unstubGlobals: true,

    coverage: {
      // The whole first-party frontend, so an untested file counts against the ratio rather than being invisible
      // (the built bundles live in public/build/, outside it).
      include: ['frontend/js/**/*.js'],
      // The default per-file table is 229 rows of mostly zeroes, which buries the totals; lcov keeps the detail.
      reporter: ['text-summary', 'lcov'],
      // No `thresholds` yet: the number is a baseline to grow from before it becomes a floor (#5112).
    },
  },
});
