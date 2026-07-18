/**
 * Tests for the TestServerBanner class (public/js/common/TestServerBanner.js).
 *
 * TestServerBanner is a top-level `class` declaration written for the Grunt-concatenation world, so — like ShareWidget
 * and unlike the `window.X = ...` IIFE modules — require()-ing it would leave the class module-scoped. We instead eval
 * the source in the jsdom global scope with an explicit `window.TestServerBanner = TestServerBanner` epilogue, after
 * emptying the body so the module's own auto-init epilogue no-ops and each test constructs the banner itself.
 *
 * Coverage: the pre-paint "don't show again" dismissal, the two dismiss controls (permanent vs this-visit) and their
 * localStorage contract, and the --test-banner-height reservation — including the guard that publishes 0 when the
 * banner is hidden or positioned non-fixed (the /mobile app's absolute layout).
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/TestServerBanner.js'), 'utf8'
);

const STORAGE_KEY = 'hideTestServerWarningBanner';
const HEIGHT_VAR = '--test-banner-height';

/** Loads a fresh TestServerBanner class into the jsdom global scope (body is empty, so auto-init no-ops). */
function loadTestServerBanner() {
    document.body.innerHTML = '';
    window.eval(`${SRC}\nwindow.TestServerBanner = TestServerBanner;`);
    return window.TestServerBanner;
}

/** Inserts the banner markup and returns the `.test-server-banner` element. */
function insertBanner() {
    document.body.innerHTML = `
        <aside class="test-server-banner" aria-label="Test server notice">
          <div class="test-server-banner-content">
            <p class="test-server-banner-text">You're on a test server.</p>
            <div class="test-server-banner-actions">
              <button class="test-server-banner-dont-show-again" type="button">Don't show again</button>
              <button class="test-server-banner-close" type="button" aria-label="Dismiss notice"></button>
            </div>
          </div>
        </aside>`;
    return document.querySelector('.test-server-banner');
}

/** Forces getComputedStyle().position and offsetHeight, since jsdom does no layout. */
function stubLayout(el, { position = 'fixed', height = 40 } = {}) {
    jest.spyOn(window, 'getComputedStyle').mockReturnValue({ position });
    Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
}

describe('TestServerBanner', () => {
    let TestServerBanner;

    beforeEach(() => {
        window.localStorage.clear();
        document.documentElement.style.removeProperty(HEIGHT_VAR);
        TestServerBanner = loadTestServerBanner();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('permanent dismissal state', () => {
        test('hides the banner up front when "don\'t show again" was stored', () => {
            window.localStorage.setItem(STORAGE_KEY, 'true');
            const banner = insertBanner();
            stubLayout(banner);

            new TestServerBanner(banner);

            expect(banner.classList.contains('ps-hidden')).toBe(true);
            // Hidden from the start reserves no space.
            expect(document.documentElement.style.getPropertyValue(HEIGHT_VAR)).toBe('0px');
        });

        test('shows the banner when nothing is stored', () => {
            const banner = insertBanner();
            stubLayout(banner, { height: 40 });

            new TestServerBanner(banner);

            expect(banner.classList.contains('ps-hidden')).toBe(false);
            expect(document.documentElement.style.getPropertyValue(HEIGHT_VAR)).toBe('40px');
        });

        test('a non-"true" stored value does not hide the banner', () => {
            window.localStorage.setItem(STORAGE_KEY, 'false');
            const banner = insertBanner();
            stubLayout(banner);

            new TestServerBanner(banner);

            expect(banner.classList.contains('ps-hidden')).toBe(false);
        });
    });

    describe('dismiss controls', () => {
        test('"Don\'t show again" hides the banner and persists the choice', () => {
            const banner = insertBanner();
            stubLayout(banner);
            new TestServerBanner(banner);

            banner.querySelector('.test-server-banner-dont-show-again').click();

            expect(banner.classList.contains('ps-hidden')).toBe(true);
            expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
            // Reserved height is released on dismiss.
            expect(document.documentElement.style.getPropertyValue(HEIGHT_VAR)).toBe('0px');
        });

        test('the close button hides the banner without persisting anything', () => {
            const banner = insertBanner();
            stubLayout(banner);
            new TestServerBanner(banner);

            banner.querySelector('.test-server-banner-close').click();

            expect(banner.classList.contains('ps-hidden')).toBe(true);
            expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
            expect(document.documentElement.style.getPropertyValue(HEIGHT_VAR)).toBe('0px');
        });
    });

    describe('updateHeight() space reservation', () => {
        test('publishes the rendered height when fixed and visible', () => {
            const banner = insertBanner();
            stubLayout(banner, { position: 'fixed', height: 52 });
            const bannerCtl = new TestServerBanner(banner);

            expect(bannerCtl.updateHeight()).toBe(52);
            expect(document.documentElement.style.getPropertyValue(HEIGHT_VAR)).toBe('52px');
        });

        test('reserves nothing when the banner is not fixed (the /mobile absolute layout)', () => {
            const banner = insertBanner();
            stubLayout(banner, { position: 'absolute', height: 75 });
            const bannerCtl = new TestServerBanner(banner);

            expect(bannerCtl.updateHeight()).toBe(0);
            expect(document.documentElement.style.getPropertyValue(HEIGHT_VAR)).toBe('0px');
        });

        test('reserves nothing while hidden even if it still has a height', () => {
            const banner = insertBanner();
            stubLayout(banner, { position: 'fixed', height: 40 });
            const bannerCtl = new TestServerBanner(banner);
            banner.classList.add('ps-hidden');

            expect(bannerCtl.updateHeight()).toBe(0);
            expect(document.documentElement.style.getPropertyValue(HEIGHT_VAR)).toBe('0px');
        });
    });

    describe('resilience', () => {
        test('a throwing localStorage does not stop the banner from hiding', () => {
            const banner = insertBanner();
            stubLayout(banner);
            new TestServerBanner(banner);
            jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
                throw new Error('QuotaExceeded / private mode');
            });

            expect(() => banner.querySelector('.test-server-banner-dont-show-again').click()).not.toThrow();
            expect(banner.classList.contains('ps-hidden')).toBe(true);
        });
    });
});
