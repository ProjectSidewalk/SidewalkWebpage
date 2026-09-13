/**
 * Jest configuration for Project Sidewalk's frontend test layer.
 *
 * Run it with `make test-js` (or `npm run test:js`; `test:js:coverage` for the report). CI runs the latter as a
 * blocking step in the frontend job. See test/js/README.md and docs/testing-and-ci.md.
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

  // These tests and the modules under test are plain ES6 that Node runs natively. Jest layers coverage
  // instrumentation on top, so an empty transform does not disable it.
  transform: {},

  // The whole first-party frontend, so an untested file counts against the ratio rather than being invisible. The
  // build/ exclusion is load-bearing, not tidiness: the frontend CI job runs `npx grunt` before this suite, so the
  // bundles are on disk here as well as locally, and each one duplicates every source file it concatenates.
  collectCoverageFrom: [
    'public/js/**/*.js',
    '!public/js/**/build/**'
  ],

  // The default per-file table is 229 rows of mostly zeroes, which buries the totals; lcov keeps the detail.
  coverageReporters: ['text-summary', 'lcov'],

  // No `coverageThreshold` yet, deliberately. Only files Jest loads through `require` get instrumented, and 99 of the
  // 107 suites read their subject with `fs.readFileSync` and run it through `eval` — the only way to reach a file
  // that defines a bare top-level class instead of assigning to `window`. So the report covers 10 files of 229, and
  // deleting a suite that exercises one of the other 219 would move the number by zero. A floor on top of that would
  // read as protection without being any. Report the number until the loaders are uniform (#5112).

  verbose: true
};
