/**
 * Jest configuration for Project Sidewalk's prototype frontend test layer.
 *
 * Deliberately scoped to test/js/ ONLY so Jest never tries to collect or transform production JavaScript under
 * public/js/ (which is a no-module-system, globals-and-concatenation world that Jest would choke on). This
 * is an opt-in prototype (`npm run test:js`) and is intentionally NOT wired into CI yet — see test/js/README.md and
 * docs/testing-and-ci.md (frontend lint/CI sequencing is owned by issue #2487).
 */

/** @type {import('jest').Config} */
module.exports = {
    // These tests render into a DOM, so run them under jsdom (provides window/document). Jest only honors a
    // `@jest-environment` docblock if it is the file's FIRST docblock; our files lead with a descriptive comment, so
    // we set the environment here at the config level instead.
    testEnvironment: 'jsdom',

    // Only look inside the prototype directory. roots + testMatch together guarantee production JS is never picked up.
    roots: ['<rootDir>/test/js'],
    testMatch: ['<rootDir>/test/js/**/*.test.js'],

    // No Babel/TS transform — these tests and the modules under test are plain ES6 that Node runs natively.
    transform: {},

    // Keep coverage opt-in; if enabled, only measure the api-docs preview modules the prototype targets.
    collectCoverageFrom: ['public/js/api-docs/*-preview.js'],

    verbose: true
};
