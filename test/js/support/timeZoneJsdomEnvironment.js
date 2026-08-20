/**
 * A jsdom test environment that can be pinned to a timezone.
 *
 * Some of what the admin dashboard renders is decided by the *viewer's* local date rather than by an instant — a week
 * grid, a "which day is this" bucket — and those have edge cases that only appear at particular offsets. They can't
 * be reached by setting `process.env.TZ` inside a test: V8 caches the zone per context, and jest's jsdom context is
 * already built by the time any test code runs, so the assignment is silently ignored and the case quietly passes for
 * the wrong reason.
 *
 * Setting it here, before `super()` builds that context, is what makes it stick. Use it per file:
 *
 *     /**
 *      * @jest-environment <rootDir>/test/js/support/timeZoneJsdomEnvironment.js
 *      * @jest-environment-options {"timeZone": "Australia/Brisbane"}
 *      *\/
 *
 * The docblock has to be the file's first, so a file using this leads with it rather than with a description.
 */

const JsdomEnvironment = require('jest-environment-jsdom').default;

class TimeZoneJsdomEnvironment extends JsdomEnvironment {
  constructor(config, context) {
    const timeZone = config.projectConfig.testEnvironmentOptions.timeZone;
    const previous = process.env.TZ;
    if (timeZone) process.env.TZ = timeZone;
    super(config, context);
    this.previousTimeZone = previous;
  }

  /**
   * Puts the worker's timezone back once the file is done.
   *
   * It has to stay set for the whole file rather than only across the constructor: V8 reads the zone lazily on each
   * Date operation and re-reads it whenever `process.env.TZ` is assigned, so restoring any earlier would put every
   * assertion back in the original zone. Workers run files one at a time, so nothing else is affected meanwhile.
   */
  async teardown() {
    if (this.previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = this.previousTimeZone;
    await super.teardown();
  }
}

module.exports = TimeZoneJsdomEnvironment;
