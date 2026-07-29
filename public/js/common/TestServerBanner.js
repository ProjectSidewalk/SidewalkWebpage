/**
 * Test-server warning banner: a dev/test-only notice that the current server is not production.
 *
 * The banner is a fixed bar pinned above the navbar. Instead of overlaying content, it reserves its own space by
 * publishing its rendered height as the `--test-banner-height` CSS custom property; main.css offsets the navbar, the
 * page content, and the full-window map height by that amount. The variable defaults to 0, so pages without the
 * banner — and production, where it never renders — are unaffected.
 *
 * Two dismiss controls: "Don't show again" persists the choice in localStorage; the close (×) button hides the banner
 * for the current visit only. Loaded on every non-prod page via main.scala.html; the module no-ops when the banner is
 * absent.
 */
class TestServerBanner {
  /** localStorage key remembering a permanent "don't show again" dismissal. */
  static STORAGE_KEY = 'hideTestServerWarningBanner';

  /** CSS custom property (set on :root) carrying the banner's reserved height, in px. */
  static HEIGHT_VAR = '--test-banner-height';

  /** @type {HTMLElement} The `.test-server-banner` root element. */
  #banner;

  /**
   * @param {HTMLElement} banner - The `.test-server-banner` element.
   */
  constructor(banner) {
    this.#banner = banner;

    // Apply a permanent dismissal before the first paint so the banner never flashes for users who hid it.
    if (this.#dismissedForever()) this.#banner.classList.add('ps-hidden');

    this.#banner.querySelector('.test-server-banner-dont-show-again')?.addEventListener('click', () => {
      try {
        window.localStorage.setItem(TestServerBanner.STORAGE_KEY, 'true');
      } catch {
        // localStorage can be unavailable (e.g. private mode); hiding for this visit still works.
      }
      this.hide();
    });

    this.#banner.querySelector('.test-server-banner-close')?.addEventListener('click', () => this.hide());

    // Measure now, then again whenever the banner may reflow (fonts finish loading, text wraps at a new width).
    this.updateHeight();
    window.addEventListener('load', () => this.updateHeight());
    window.addEventListener('resize', () => this.updateHeight());
  }

  /**
   * @returns {boolean} Whether the user has opted out via "don't show again".
   */
  #dismissedForever() {
    try {
      return JSON.parse(window.localStorage.getItem(TestServerBanner.STORAGE_KEY)) === true;
    } catch {
      return false;
    }
  }

  /** Hides the banner for this visit and releases its reserved height. */
  hide() {
    this.#banner.classList.add('ps-hidden');
    this.updateHeight();
  }

  /**
   * Publishes the banner's current height to `--test-banner-height` so the navbar and content are offset by it.
   * Reserves nothing (height 0) when the banner is hidden or not fixed — the /mobile app positions the banner
   * absolutely and owns its own layout, so it must not also be offset by this variable.
   *
   * @returns {number} The height, in px, written to the variable.
   */
  updateHeight() {
    const isFixed = window.getComputedStyle(this.#banner).position === 'fixed';
    const hidden = this.#banner.classList.contains('ps-hidden');
    const height = isFixed && !hidden ? this.#banner.offsetHeight : 0;
    document.documentElement.style.setProperty(TestServerBanner.HEIGHT_VAR, `${height}px`);
    return height;
  }
}

/** Wires up the banner if it is present on the page. */
function initTestServerBanner() {
  const banner = document.querySelector('.test-server-banner');
  if (banner) new TestServerBanner(banner);
}

// The banner's <script> tag sits right after its markup, so the element is already parsed: init synchronously to keep
// the pre-paint dismissal. Fall back to DOMContentLoaded if this ever loads before the element exists.
if (document.querySelector('.test-server-banner')) {
  initTestServerBanner();
} else if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTestServerBanner);
} else {
  initTestServerBanner();
}
