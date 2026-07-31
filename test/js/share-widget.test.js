/**
 * Tests for the ShareWidget class (public/js/common/share/ShareWidget.js, issue #456).
 *
 * ShareWidget is a top-level `class` declaration written for the Grunt-concatenation world, so unlike the
 * `window.X = ...` IIFE modules, require()-ing it would leave the class module-scoped. We instead eval the source in
 * the jsdom global scope with an explicit `window.ShareWidget = ShareWidget` epilogue.
 *
 * Coverage: the native-share vs popover fork, popover construction + ARIA contract, ESC/outside-click close with
 * focus management, arrow-key/Home/End menu navigation, copy-link clipboard flow with the transient "Copied!"
 * state, share-intent URLs, activity logging, and setTarget's stale-popover guard.
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
        // The widget reserves the native share sheet for touch-primary devices, which jsdom can't answer for —
        // it has no matchMedia at all. Default to a desktop pointer; the touch tests override per-case.
        window.matchMedia = jest.fn().mockReturnValue({ matches: false });
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
            expect([...items].map((i) => i.querySelector('.label-detail__share-item-label').textContent))
                .toEqual([
                    'share.copy-link', 'share.on-bluesky', 'share.on-x',
                    'share.on-facebook', 'share.on-linkedin', 'share.via-email'
                ]);
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

    describe('menu keyboard navigation', () => {
        /** Opens the popover, waits for the deferred document listeners, and returns the four menu items. */
        async function openMenu() {
            buildWidget();
            trigger.click();
            await flushPromises();
            return [...popover().querySelectorAll('[role="menuitem"]')];
        }

        const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));

        test('ArrowDown cycles focus forward through the items and wraps to the first', async () => {
            const items = await openMenu();
            expect(document.activeElement).toBe(items[0]);
            // Walk the whole list rather than a fixed number of presses, so adding a share platform doesn't
            // silently turn this into a test of the first four items (#4721 added two).
            for (let i = 1; i < items.length; i++) {
                press('ArrowDown');
                expect(document.activeElement).toBe(items[i]);
            }
            press('ArrowDown');
            expect(document.activeElement).toBe(items[0]);
        });

        test('ArrowUp cycles focus backward and wraps to the last', async () => {
            const items = await openMenu();
            press('ArrowUp');
            expect(document.activeElement).toBe(items[items.length - 1]);
            press('ArrowUp');
            expect(document.activeElement).toBe(items[items.length - 2]);
        });

        test('Home and End jump to the first and last items', async () => {
            const items = await openMenu();
            press('End');
            expect(document.activeElement).toBe(items[items.length - 1]);
            press('Home');
            expect(document.activeElement).toBe(items[0]);
        });

        test('arrow keys re-enter the menu when focus has wandered outside it', async () => {
            const items = await openMenu();
            trigger.focus();
            press('ArrowDown');
            expect(document.activeElement).toBe(items[0]);
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
            expect(intentUrl).toContain('https://x.com/intent/post?url=');
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
        /** Makes the device look touch-primary, which is the only case the native sheet is used for. */
        const asTouchDevice = () => window.matchMedia.mockReturnValue({ matches: true });

        test('prefers navigator.share on a touch device when canShare approves, without a popover', () => {
            asTouchDevice();
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
            asTouchDevice();
            navigator.share = jest.fn();
            navigator.canShare = jest.fn().mockReturnValue(false);
            buildWidget();
            trigger.click();

            expect(navigator.share).not.toHaveBeenCalled();
            expect(popover()).not.toBeNull();
            expect(popover().hidden).toBe(false);
        });

        // Desktop Chrome and Safari both implement navigator.share, and their OS sheets are a poor fit for this —
        // macOS's doesn't even offer copy-URL (#4660). A fine pointer means our own popover, always.
        test('never uses the OS sheet on a fine-pointer device, even where the API exists', () => {
            navigator.share = jest.fn().mockResolvedValue(undefined);
            navigator.canShare = jest.fn().mockReturnValue(true);
            buildWidget();
            trigger.click();

            expect(navigator.share).not.toHaveBeenCalled();
            expect(window.logWebpageActivity).not.toHaveBeenCalledWith('Share_Native');
            expect(popover()).not.toBeNull();
            expect(popover().hidden).toBe(false);
        });
    });

    describe('isOpen', () => {
        test('reports whether the popover is showing, so a self-dismissing host can wait on it', () => {
            const widget = buildWidget();
            expect(widget.isOpen()).toBe(false);

            trigger.click();
            expect(widget.isOpen()).toBe(true);

            trigger.click();
            expect(widget.isOpen()).toBe(false);
        });
    });

    // Explore's just-placed labels have no server-side id until the next form submit, so the host is given a chance
    // to produce the target before the popover reads it (#4726).
    describe('beforeOpen', () => {
        test('awaits the host step, then opens against the target it produced', async () => {
            const widget = new ShareWidget(trigger, {
                beforeOpen: async () => {
                    await flushPromises();
                    widget.setTarget(TARGET);
                }
            });
            // No target yet: without beforeOpen this click would be a no-op.
            trigger.click();
            expect(popover()).toBeNull();

            await flushPromises();
            await flushPromises();
            expect(popover()).not.toBeNull();
            expect(popover().hidden).toBe(false);
        });

        test('marks the trigger pending while the host step runs, and clears it after', async () => {
            let release;
            const widget = new ShareWidget(trigger, {
                beforeOpen: () => new Promise((resolve) => { release = () => { widget.setTarget(TARGET); resolve(); }; })
            });

            trigger.click();
            expect(trigger.classList.contains('is-pending')).toBe(true);

            release();
            await flushPromises();
            expect(trigger.classList.contains('is-pending')).toBe(false);
        });

        test('ignores a second click while the host step is still in flight', async () => {
            const beforeOpen = jest.fn().mockResolvedValue(undefined);
            const widget = new ShareWidget(trigger, { beforeOpen });
            widget.setTarget(TARGET);

            trigger.click();
            trigger.click();
            await flushPromises();

            // The duplicate would have started a second form submission.
            expect(beforeOpen).toHaveBeenCalledTimes(1);
        });

        test('stays closed when the host step throws, rather than opening a share with no URL', async () => {
            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const widget = new ShareWidget(trigger, { beforeOpen: () => Promise.reject(new Error('submit failed')) });
            widget.setTarget(TARGET);

            trigger.click();
            await flushPromises();

            expect(popover()).toBeNull();
            expect(trigger.classList.contains('is-pending')).toBe(false);
            errSpy.mockRestore();
        });
    });
});
