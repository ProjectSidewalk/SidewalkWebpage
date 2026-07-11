/**
 * Tests for the ShareWidget class (public/js/common/share/ShareWidget.js, issue #456).
 *
 * ShareWidget is a top-level `class` declaration written for the Grunt-concatenation world, so unlike the
 * `window.X = ...` IIFE modules, require()-ing it would leave the class module-scoped. We instead eval the source in
 * the jsdom global scope with an explicit `window.ShareWidget = ShareWidget` epilogue.
 *
 * Coverage: the native-share vs popover fork, popover construction + ARIA contract, ESC/outside-click close with
 * focus management, copy-link clipboard flow with the transient "Copied!" state, share-intent URLs, activity
 * logging, and setTarget's stale-popover guard.
 */

const fs = require('fs');
const path = require('path');

const WIDGET_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/share/ShareWidget.js'), 'utf8'
);

/** Loads a fresh ShareWidget class into the jsdom global scope. */
function loadShareWidget() {
    window.eval(`${WIDGET_SRC}\nwindow.ShareWidget = ShareWidget;`);
    return window.ShareWidget;
}

const TARGET = {
    url: 'https://sidewalk-test.example.org/label/123',
    title: 'Share',
    text: 'Check out this Curb Ramp on Project Sidewalk'
};

/** Flushes pending promise microtasks (clipboard flow resolves through a .then chain). */
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ShareWidget', () => {
    let ShareWidget;
    let trigger;

    /** Builds a widget wired to the standard test target, returning [widget, trigger]. */
    function buildWidget() {
        const widget = new ShareWidget(trigger);
        widget.setTarget(TARGET);
        return widget;
    }

    /** The popover element, or null before first non-native open. */
    const popover = () => document.querySelector('.label-detail__share-popover');

    /** The popover item whose visible label matches (items are labeled by i18n key under the identity-t mock). */
    const item = (labelKey) =>
        [...document.querySelectorAll('.label-detail__share-item')]
            .find((btn) => btn.querySelector('.label-detail__share-item-label').textContent === labelKey);

    beforeEach(() => {
        document.body.innerHTML =
            '<div class="label-detail__share"><button type="button" class="label-detail__share-trigger"></button></div>';
        trigger = document.querySelector('.label-detail__share-trigger');

        // i18next mock: labels render as their namespace-stripped keys (the widget prefixes "common:"), so
        // assertions are locale-independent and readable.
        window.i18next = { t: (key) => key.replace(/^common:/, '') };
        window.logWebpageActivity = jest.fn();
        window.open = jest.fn();
        // jsdom has no navigator.share by default (the popover path); native-share tests define one explicitly.
        delete navigator.share;
        delete navigator.canShare;
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: jest.fn().mockResolvedValue(undefined) },
            configurable: true
        });

        ShareWidget = loadShareWidget();
    });

    describe('constructor', () => {
        test('marks the trigger as a closed popup control', () => {
            buildWidget();
            expect(trigger.getAttribute('aria-haspopup')).toBe('true');
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
        });
    });

    describe('trigger click without native share', () => {
        test('builds and opens an accessible popover with the four share actions', () => {
            buildWidget();
            trigger.click();

            const pop = popover();
            expect(pop).not.toBeNull();
            expect(pop.hidden).toBe(false);
            expect(pop.getAttribute('role')).toBe('menu');
            expect(pop.getAttribute('aria-labelledby')).toBe(pop.querySelector('p').id);
            expect(trigger.getAttribute('aria-expanded')).toBe('true');

            const items = pop.querySelectorAll('[role="menuitem"]');
            expect(items).toHaveLength(4);
            expect(document.activeElement).toBe(items[0]);
            expect(window.logWebpageActivity).toHaveBeenCalledWith('Share_Click');
        });

        test('logs the click but stays closed when no target URL is set', () => {
            new ShareWidget(trigger); // No setTarget.
            trigger.click();
            expect(popover()).toBeNull();
            expect(window.logWebpageActivity).toHaveBeenCalledWith('Share_Click');
        });

        test('a second click toggles the popover closed', () => {
            buildWidget();
            trigger.click();
            trigger.click();
            expect(popover().hidden).toBe(true);
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
        });
    });

    describe('closing behavior', () => {
        test('ESC closes and returns focus to the trigger', async () => {
            buildWidget();
            trigger.click();
            await flushPromises(); // Document listeners are registered on a 0ms timeout after open.

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(popover().hidden).toBe(true);
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
            expect(document.activeElement).toBe(trigger);
        });

        test('a click outside closes without stealing focus back to the trigger', async () => {
            buildWidget();
            trigger.click();
            await flushPromises();

            document.body.click();
            expect(popover().hidden).toBe(true);
            expect(document.activeElement).not.toBe(trigger);
        });

        test('setTarget closes an open popover so items cannot point at a stale target', () => {
            const widget = buildWidget();
            trigger.click();
            widget.setTarget({ ...TARGET, url: 'https://sidewalk-test.example.org/label/456' });
            expect(popover().hidden).toBe(true);
        });
    });

    describe('share actions', () => {
        test('Copy Link writes the URL to the clipboard and shows a transient Copied state', async () => {
            jest.useFakeTimers();
            try {
                buildWidget();
                trigger.click();
                item('share.copy-link').click();
                // Flush the clipboard promise without advancing the 1500ms reset timer.
                await Promise.resolve();
                await Promise.resolve();

                expect(navigator.clipboard.writeText).toHaveBeenCalledWith(TARGET.url);
                expect(window.logWebpageActivity).toHaveBeenCalledWith('Share_CopyLink');
                const copyButton = item('share.copied');
                expect(copyButton.classList.contains('is-copied')).toBe(true);

                jest.advanceTimersByTime(1500);
                expect(copyButton.querySelector('.label-detail__share-item-label').textContent)
                    .toBe('share.copy-link');
                expect(copyButton.classList.contains('is-copied')).toBe(false);
            } finally {
                jest.useRealTimers();
            }
        });

        test('X opens a tweet intent with the encoded URL and text, then closes', () => {
            buildWidget();
            trigger.click();
            item('share.on-x').click();

            expect(window.open).toHaveBeenCalledTimes(1);
            const [intentUrl, target] = window.open.mock.calls[0];
            expect(intentUrl).toContain('https://twitter.com/intent/tweet?url=');
            expect(intentUrl).toContain(encodeURIComponent(TARGET.url));
            expect(intentUrl).toContain(encodeURIComponent(TARGET.text));
            expect(target).toBe('_blank');
            expect(window.logWebpageActivity).toHaveBeenCalledWith('Share_Platform=Twitter');
            expect(popover().hidden).toBe(true);
        });

        test('Facebook opens the sharer with the encoded URL', () => {
            buildWidget();
            trigger.click();
            item('share.on-facebook').click();

            const [intentUrl] = window.open.mock.calls[0];
            expect(intentUrl).toContain('https://www.facebook.com/sharer/sharer.php?u=');
            expect(intentUrl).toContain(encodeURIComponent(TARGET.url));
            expect(window.logWebpageActivity).toHaveBeenCalledWith('Share_Platform=Facebook');
        });

        test('Email logs the platform and closes (mailto: navigation is a jsdom no-op)', () => {
            buildWidget();
            trigger.click();
            item('share.via-email').click();

            expect(window.logWebpageActivity).toHaveBeenCalledWith('Share_Platform=Email');
            expect(popover().hidden).toBe(true);
        });
    });

    describe('native share sheet', () => {
        test('prefers navigator.share when canShare approves, without building a popover', () => {
            navigator.share = jest.fn().mockResolvedValue(undefined);
            navigator.canShare = jest.fn().mockReturnValue(true);
            buildWidget();
            trigger.click();

            expect(navigator.share).toHaveBeenCalledWith({
                title: TARGET.title, text: TARGET.text, url: TARGET.url
            });
            expect(window.logWebpageActivity).toHaveBeenCalledWith('Share_Native');
            expect(popover()).toBeNull();
        });

        test('falls back to the popover when canShare rejects the payload', () => {
            navigator.share = jest.fn();
            navigator.canShare = jest.fn().mockReturnValue(false);
            buildWidget();
            trigger.click();

            expect(navigator.share).not.toHaveBeenCalled();
            expect(popover()).not.toBeNull();
            expect(popover().hidden).toBe(false);
        });
    });
});
