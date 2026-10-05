/**
 * Jest configuration for Project Sidewalk's frontend test layer.
 *
 * Run it with `make test-js` (or `npm run test:js`; `test:js:coverage` for the report). CI runs the latter as a
 * blocking step in the frontend job. See test/js/README.md and docs/testing-and-ci.md.
 */

// Pinned, or the suite inherits the machine's zone and a bug that only bites west of Greenwich -- a UTC timestamp
// near midnight printing as the month before -- passes in a UTC runner while failing for the labelers it reaches.
process.env.TZ = 'America/Los_Angeles';

/** @type {import('jest').Config} */
module.exports = {
  // These tests render into a DOM, so run them under jsdom (provides window/document). Jest only honors a
  // `@jest-environment` docblock if it is the file's FIRST docblock; our files lead with a descriptive comment, so
  // we set the environment here at the config level instead.
  testEnvironment: 'jsdom',

  // `collectCoverageFrom` can only report on files Jest has crawled, so without frontend/js as a root the ratio answers
  // "how well is the tested code tested" rather than "how much of the frontend is tested" (#4743). testMatch is what
  // keeps production JS from being picked up as a test.
  roots: ['<rootDir>/test/js', '<rootDir>/frontend/js'],
  testMatch: ['<rootDir>/test/js/**/*.test.js'],

  // Turns each ES-module source into CommonJS so a suite can `require` it, and lets an import defer to a fake the
  // suite put on `window` (test/js/moduleTransform.js).
  transform: {
    '/frontend/js/.+\\.js$': '<rootDir>/test/js/moduleTransform.js'
  },

  // The whole first-party frontend, so an untested file counts against the ratio rather than being invisible (the
  // built bundles live in public/build/, outside it).
  collectCoverageFrom: ['frontend/js/**/*.js'],

  // The default per-file table is 229 rows of mostly zeroes, which buries the totals; lcov keeps the detail.
  coverageReporters: ['text-summary', 'lcov'],

  // No `coverageThreshold` yet: the number is a baseline to grow from before it becomes a floor (#5112).

  verbose: true
};
