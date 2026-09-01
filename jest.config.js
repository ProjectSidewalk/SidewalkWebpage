/**
 * Jest configuration for Project Sidewalk's frontend test layer.
 *
 * Run it with `npm run test:js`; CI runs the same command as an advisory step in the frontend job, non-blocking until
 * the layer reaches the Phase 1 bar (#2487). See test/js/README.md and docs/testing-and-ci.md.
 */

/** @type {import('jest').Config} */
module.exports = {
  // These tests render into a DOM, so run them under jsdom (provides window/document). Jest only honors a
  // `@jest-environment` docblock if it is the file's FIRST docblock; our files lead with a descriptive comment, so
  // we set the environment here at the config level instead.
  testEnvironment: 'jsdom',

  // `collectCoverageFrom` can only report on files Jest has crawled, so without public/js as a root the ratio answers
  // "how well is the tested code tested" rather than "how much of the frontend is tested" (#4743). testMatch is what
  // keeps production JS from being picked up as a test.
  roots: ['<rootDir>/test/js', '<rootDir>/public/js'],
  testMatch: ['<rootDir>/test/js/**/*.test.js'],

  // Grunt's bundles duplicate every source file they concatenate, and being gitignored they're present in a working
  // checkout but absent in CI. Excluding them keeps the number the same either way.
  modulePathIgnorePatterns: ['/public/js/[^/]+/build/'],

  // These tests and the modules under test are plain ES6 that Node runs natively. Jest layers coverage
  // instrumentation on top, so an empty transform does not disable it.
  transform: {},

  // The whole first-party frontend, so an untested file counts against the ratio rather than being invisible.
  collectCoverageFrom: [
    'public/js/**/*.js',
    '!public/js/**/build/**'
  ],

  // The default per-file table is 229 rows of mostly zeroes, which buries the totals; lcov keeps the detail.
  coverageReporters: ['text-summary', 'lcov'],

  // A ratchet, not a target: just under the measured number, raised as the suite grows. It stays low because most of
  // the denominator is the Explore/Validate canvas and pano code we never unit-test. Statements and lines only — a
  // four-way ratchet is four things to bump for no more signal.
  coverageThreshold: {
    global: {
      statements: 2.75,
      lines: 2.75
    }
  },

  verbose: true
};
