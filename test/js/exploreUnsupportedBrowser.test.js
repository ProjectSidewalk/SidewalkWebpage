/**
 * Tests Explore's unsupported-browser warning (frontend/js/explore/detectUnsupportedBrowser.js) (#5840): shown on a
 * browser that is none of Chrome, Firefox or Safari, and dismissed by its close button.
 */

import { loadModules, useUtil } from './loader.js';

describe('Explore unsupported-browser warning', () => {
  const alert = () => document.getElementById('unsupported-browser-alert');

  /** Loads the script and fires the page-ready event it waits for. */
  async function loadOn({ chrome = false, firefox = false, safari = false }) {
    useUtil({ isChrome: () => chrome, isFirefox: () => firefox, isSafari: () => safari });
    await loadModules('frontend/js/explore/detectUnsupportedBrowser.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="unsupported-browser-alert" class="ps-invisible"><button id="browser-warning-close"></button></div>`;
  });

  it('stays hidden on a supported browser', async () => {
    await loadOn({ safari: true });
    expect(alert().classList.contains('ps-invisible')).toBe(true);
  });

  it('shows on any other browser, until the labeler closes it', async () => {
    await loadOn({});
    expect(alert().classList.contains('ps-invisible')).toBe(false);
    document.getElementById('browser-warning-close').click();
    expect(alert().classList.contains('ps-invisible')).toBe(true);
  });
});
