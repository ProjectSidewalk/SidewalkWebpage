/**
 * Tests for SmallScreenGate (frontend/js/explore/SmallScreenGate.js, #5664): what a touch screen too small to label on
 * sees instead of the tool. The gate is judged by screen shape and size, never device class, and nothing that bills a
 * pano may start until it opens.
 */

const { loadModules } = require('./loadGlobalScript');

/** The markup explore.scala.html renders for the gate, ids only. */
function renderGateMarkup() {
    document.body.innerHTML = `
      <div id="page-loading"></div>
      <section id="explore-small-screen" hidden>
        <div id="explore-rotate-prompt" hidden><h1 tabindex="-1">rotate</h1></div>
        <div id="explore-small-screen-notice" hidden>
          <h1 tabindex="-1">notice</h1><button id="explore-small-screen-continue"></button>
        </div>
      </section>`;
}

describe('SmallScreenGate', () => {
    let gate;
    let screen;
    let orientationListeners;

    /** Sets what the screen reports: pointer kind and window size. */
    const setScreen = (s) => Object.assign(screen, s);

    beforeEach(() => {
        renderGateMarkup();
        screen = { coarse: true, width: 390, height: 844 };
        orientationListeners = [];
        window.matchMedia = (query) => ({
            matches: query.includes('orientation') ? screen.width > screen.height : false,
            addEventListener: (_type, fn) => orientationListeners.push(fn),
            removeEventListener: (_type, fn) => {
                orientationListeners = orientationListeners.filter((f) => f !== fn);
            },
        });
        window.logWebpageActivity = jest.fn();
        // The real helpers, over a fake inputProfile, so the 600 px rule and the portrait test are exercised as written.
        const { util } = loadModules('frontend/js/common/utilities.js');
        util.inputProfile = () => ({
            coarse: screen.coarse, hover: !screen.coarse, shortSide: Math.min(screen.width, screen.height),
            maxTouchPoints: screen.coarse ? 5 : 0,
        });
        Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => screen.width });
        Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => screen.height });
        window.util = util;
        gate = loadModules('frontend/js/explore/SmallScreenGate.js');
    });

    const visible = (id) => !document.getElementById(id).hidden;

    test.each([
        ['an upright phone', { width: 390, height: 844 }, 'rotate'],
        ['a phone on its side', { width: 844, height: 390 }, 'notice'],
        ['an iPad mini, upright', { width: 744, height: 1133 }, null],
        ['an 8-inch Android tablet, upright', { width: 600, height: 960 }, null],
        ['a narrow desktop window', { coarse: false, width: 390, height: 844 }, null],
    ])('%s gets %p', (_name, s, expected) => {
        setScreen(s);
        expect(gate.smallScreenGate()).toBe(expected);
    });

    test('resolves at once, showing nothing, where labeling fits', async () => {
        setScreen({ width: 1024, height: 768 });

        await gate.waitForLabelableScreen();

        expect(visible('explore-small-screen')).toBe(false);
        expect(window.logWebpageActivity).not.toHaveBeenCalled();
    });

    test('an upright phone gets the rotate prompt, with no way past it', async () => {
        let opened = false;
        gate.waitForLabelableScreen().then(() => { opened = true; });
        await Promise.resolve();

        expect(visible('explore-rotate-prompt')).toBe(true);
        expect(visible('explore-small-screen-notice')).toBe(false);
        expect(document.activeElement.textContent).toBe('rotate');
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Visit_Explore_RotatePrompt');
        expect(opened).toBe(false);
        expect(document.getElementById('page-loading').style.visibility).toBe('hidden');
    });

    test('turning the phone sideways swaps the prompt for the notice, and Continue opens the tool', async () => {
        const opened = gate.waitForLabelableScreen();
        setScreen({ width: 844, height: 390 });
        orientationListeners.forEach((fn) => fn());

        expect(visible('explore-rotate-prompt')).toBe(false);
        expect(visible('explore-small-screen-notice')).toBe(true);
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Visit_Explore_SmallScreenNotice');

        document.getElementById('explore-small-screen-continue').click();
        await opened;

        expect(visible('explore-small-screen')).toBe(false);
        expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=ExploreSmallScreenContinue');
        expect(document.getElementById('page-loading').style.visibility).toBe('');
    });

    test('a phone already sideways gets the notice straight away', async () => {
        setScreen({ width: 844, height: 390 });
        const opened = gate.waitForLabelableScreen();

        expect(visible('explore-small-screen-notice')).toBe(true);
        expect(window.logWebpageActivity).not.toHaveBeenCalledWith('Visit_Explore_RotatePrompt');

        document.getElementById('explore-small-screen-continue').click();
        await expect(opened).resolves.toBeUndefined();
    });
});
