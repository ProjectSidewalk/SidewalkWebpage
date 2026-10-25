/**
 * Runs before every suite (vitest.config.mjs `setupFiles`): the page stamps main.scala.html makes, a jsdom fix-up, and
 * the cleanup every file would otherwise repeat.
 */

import fs from 'fs';
import path from 'path';

// A suite's fake timers would otherwise outlive it. Harmless when none were installed.
afterEach(() => vi.useRealTimers());

if (typeof document !== 'undefined') {
  // Node's `fetch` reaches the network; a suite that wants one stubs it, and one that forgot finds out at once.
  window.fetch = () => { throw new Error('fetch is not stubbed for this suite'); };

  // The label-type table every page is served, so `util.misc` builds from the real one. The fixture is a committed
  // copy of what LabelType serializes, and LabelTypeSpec fails if the two diverge.
  const fixture = path.resolve(import.meta.dirname, '..', 'resources', 'label-types-stamp.json');
  window.labelTypes = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  // The canned-reason catalog every page is served (#5475), the same way; ValidationReasonSpec holds the fixture to
  // what ValidationReason stamps.
  const reasons = path.resolve(import.meta.dirname, '..', 'resources', 'validation-reasons-stamp.json');
  window.validationReasons = JSON.parse(fs.readFileSync(reasons, 'utf8'));

  // jsdom ships the Popover API's stylesheet (a closed `[popover]` is `display: none`) without the API, and refuses
  // to focus anything not displayed. The suites model a browser without the API, where no such rule exists.
  const style = document.createElement('style');
  style.textContent = '[popover]:not([hidden]) { display: block !important; }';
  document.head.appendChild(style);
}
