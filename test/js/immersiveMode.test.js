/**
 * Tests for Explore's immersive-mode toggle (public/js/explore/src/controls/ImmersiveMode.js, #5085).
 *
 * The layout is CSS keyed on two classes, so what the module has to get right is the bookkeeping around a toggle:
 * both classes flip together, the tool is re-laid out synchronously, anchored panels are closed first, the button
 * describes the action it now offers, the paired Click_/KeyboardShortcut_ events carry the frame, the exit hint
 * shows once per session, and none of it is reachable during the tutorial.
 *
 * ImmersiveMode is a Grunt-concatenated `class` reaching for page globals (svl, util, i18next, Toast), so the source
 * is eval'd into jsdom with those stubbed.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub } = require('./loadGlobalScript');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/controls/ImmersiveMode.js'), 'utf8'
);

describe('ImmersiveMode', () => {
    let ImmersiveMode;
    let tracker;
    let relayout;
    let onboarding;

    /** Builds the module against a fresh page. */
    function build() {
        return new ImmersiveMode(tracker, relayout);
    }

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="immersive-toggle-holder" class="zoom-buttons-holder">
              <button type="button" id="immersive-toggle-button" class="zoom-button" aria-pressed="false">
                <img id="immersive-toggle-icon" src="/assets/images/icons/maximize-2-white-feather.svg" alt="">
              </button>
            </div>`;
        document.body.className = '';
        document.documentElement.className = '';
        window.sessionStorage.clear();
        onboarding = false;
        tracker = { push: jest.fn() };
        relayout = jest.fn();
        window.util = { assetPath: assetPathStub };
        window.i18next = { t: (key) => key };
        window.Toast = { show: jest.fn() };
        window.svl = {
            isOnboarding: () => onboarding,
            contextMenu: { isOpen: jest.fn(() => false), hide: jest.fn() },
            canvas: { showLabelHoverInfo: jest.fn() },
            CANVAS_FRAME: { width: 720, height: 480 },
        };
        window.eval(`${SRC}\nwindow.ImmersiveMode = ImmersiveMode;`);
        ImmersiveMode = window.ImmersiveMode;
    });

    it('flips both layout classes, re-lays out, and updates the button on enter and exit', () => {
        const mode = build();
        const button = document.getElementById('immersive-toggle-button');

        button.click();
        expect(mode.isActive()).toBe(true);
        expect(document.body.classList.contains('svl-immersive')).toBe(true);
        expect(document.documentElement.classList.contains('chromeless')).toBe(true);
        expect(relayout).toHaveBeenCalledTimes(1);
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(button.getAttribute('aria-label')).toBe('controls.immersive-exit');
        expect(document.getElementById('immersive-toggle-icon').getAttribute('src')).toContain('minimize-2');

        button.click();
        expect(mode.isActive()).toBe(false);
        expect(document.body.classList.contains('svl-immersive')).toBe(false);
        expect(document.documentElement.classList.contains('chromeless')).toBe(false);
        expect(relayout).toHaveBeenCalledTimes(2);
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(document.getElementById('immersive-toggle-icon').getAttribute('src')).toContain('maximize-2');
    });

    it('logs the paired Click_ / KeyboardShortcut_ events with the window and the resulting frame', () => {
        const mode = build();
        window.svl.CANVAS_FRAME = { width: 720, height: 405 };

        document.getElementById('immersive-toggle-button').click();
        expect(tracker.push).toHaveBeenLastCalledWith('Click_ImmersiveMode_Enter', expect.objectContaining({
            innerWidth: window.innerWidth, innerHeight: window.innerHeight, canvasWidth: 720, canvasHeight: 405,
        }));

        mode.toggle('KeyboardShortcut');
        expect(tracker.push).toHaveBeenLastCalledWith('KeyboardShortcut_ImmersiveMode_Exit', expect.any(Object));
    });

    it('closes the anchored panels before the frame changes shape', () => {
        window.svl.contextMenu.isOpen.mockReturnValue(true);
        build().toggle('Click');

        expect(window.svl.contextMenu.hide).toHaveBeenCalledTimes(1);
        expect(window.svl.canvas.showLabelHoverInfo).toHaveBeenCalledWith(undefined);
        // The relayout runs after the panels are gone, so it never measures against a stale anchor.
        expect(window.svl.contextMenu.hide.mock.invocationCallOrder[0])
            .toBeLessThan(relayout.mock.invocationCallOrder[0]);
    });

    it('shows the exit hint on the first entry of a session only', () => {
        const mode = build();
        mode.toggle('Click');
        mode.toggle('Click');
        mode.toggle('Click');
        expect(window.Toast.show).toHaveBeenCalledTimes(1);
        expect(window.Toast.show).toHaveBeenCalledWith(expect.objectContaining({ dark: true }));

        // A second module in the same session (a page reload) stays quiet.
        build().toggle('Click');
        expect(window.Toast.show).toHaveBeenCalledTimes(1);
    });

    it('still enters when session storage is unavailable', () => {
        const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        const mode = build();
        mode.toggle('Click');
        expect(mode.isActive()).toBe(true);
        expect(window.Toast.show).toHaveBeenCalledTimes(1);
        getItem.mockRestore();
    });

    it('hides the button and ignores the key during the tutorial', () => {
        onboarding = true;
        const mode = build();
        expect(document.getElementById('immersive-toggle-holder').hidden).toBe(true);

        mode.toggle('KeyboardShortcut');
        expect(mode.isActive()).toBe(false);
        expect(relayout).not.toHaveBeenCalled();
        expect(tracker.push).not.toHaveBeenCalled();
    });

    it('is inert on a page without the toggle markup', () => {
        document.body.innerHTML = '';
        expect(() => build()).not.toThrow();
    });
});
