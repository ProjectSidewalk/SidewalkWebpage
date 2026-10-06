/**
 * Tests for the immersive-mode toggle shared by Explore and Validate (frontend/js/common/ImmersiveMode.js, #5085,
 * #5560), built here with Explore's wiring; validateImmersiveKey.test.js covers Validate's key path.
 *
 * The layout is CSS keyed on two classes, so what the module has to get right is the bookkeeping around a toggle:
 * both classes flip together, the tool is re-laid out synchronously, anchored panels are closed first, the button
 * describes the action it now offers, the paired Click_/KeyboardShortcut_ events carry the frame, the exit hint
 * shows once per session, and none of it is reachable during the tutorial.
 *
 * ImmersiveMode is a Grunt-concatenated `class` reaching for page globals (util, i18next, Toast), so the source is
 * eval'd into jsdom with those stubbed; the tool-specific collaborators arrive through its options.
 */


const { assetPathStub, loadModules } = require('./loadGlobalScript');


describe('ImmersiveMode', () => {
    let ImmersiveMode;
    let tracker;
    let relayout;
    let onboarding;

    /** Builds the module against a fresh page, wired the way Explore's Main.js wires it. */
    function build(extra = {}) {
        return new ImmersiveMode({
            tracker,
            bodyClass: 'svl-immersive',
            relayout,
            isDisabled: () => window.svl.isOnboarding(),
            beforeToggle: () => {
                if (window.svl.contextMenu.isOpen()) window.svl.contextMenu.hide();
                window.svl.canvas.showLabelHoverInfo(undefined);
            },
            frame: () => window.svl.CANVAS_FRAME,
            hintReference: () => document.getElementById('pano'),
            urlParam: 'immersive',
            ...extra,
        });
    }

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="immersive-toggle-holder" class="ps-icon-button-stack">
              <button type="button" id="immersive-toggle-button" class="ps-icon-button">
                <img id="immersive-toggle-icon" src="/assets/images/icons/maximize-2-white-feather.svg" alt="">
              </button>
            </div>`;
        document.body.className = '';
        document.documentElement.className = '';
        window.sessionStorage.clear();
        window.history.replaceState(null, '', '/explore');
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
        Object.assign(window, loadModules('frontend/js/common/ImmersiveMode.js'));
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
        expect(button.getAttribute('aria-label')).toBe('common:immersive-exit');
        expect(document.getElementById('immersive-toggle-icon').getAttribute('src')).toContain('minimize-2');

        button.click();
        expect(mode.isActive()).toBe(false);
        expect(document.body.classList.contains('svl-immersive')).toBe(false);
        expect(document.documentElement.classList.contains('chromeless')).toBe(false);
        expect(relayout).toHaveBeenCalledTimes(2);
        expect(button.getAttribute('aria-label')).toBe('common:immersive-enter');
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
        const getItem = jest.spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => { throw new Error('denied'); });
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

    it('keeps the mode across a page load in the same tab, without a relayout or a click event', () => {
        build().toggle('Click');
        expect(window.sessionStorage.getItem('svl-immersive-active')).toBe('1');

        // The next page load: the module is built before the tool's first layout.
        document.body.className = '';
        document.documentElement.className = '';
        relayout.mockClear();
        tracker.push.mockClear();
        const restored = build();
        expect(restored.isActive()).toBe(true);
        expect(document.body.classList.contains('svl-immersive')).toBe(true);
        expect(document.documentElement.classList.contains('chromeless')).toBe(true);
        expect(document.getElementById('immersive-toggle-button').getAttribute('aria-label'))
            .toBe('common:immersive-exit');
        expect(relayout).not.toHaveBeenCalled();
        expect(tracker.push).toHaveBeenCalledTimes(1);
        expect(tracker.push).toHaveBeenCalledWith('ImmersiveMode_Restored', expect.objectContaining({
            innerWidth: expect.any(Number), innerHeight: expect.any(Number),
        }));

        // Leaving the mode forgets it, so the next load is boxed.
        restored.toggle('Click');
        expect(window.sessionStorage.getItem('svl-immersive-active')).toBeNull();
        expect(build().isActive()).toBe(false);
    });

    // Validate's tracker can only attribute a row once the mission exists, which is after the mode is built.
    it('holds the restore event for a deferring tool until logRestored() asks for it', () => {
        build().toggle('Click');
        tracker.push.mockClear();
        const restored = build({ deferRestoreLog: true });
        expect(restored.isActive()).toBe(true);
        expect(tracker.push).not.toHaveBeenCalled();

        restored.logRestored();
        expect(tracker.push).toHaveBeenCalledTimes(1);
        expect(tracker.push).toHaveBeenCalledWith('ImmersiveMode_Restored', expect.anything());

        // A load that did not come back into the mode has nothing to report.
        restored.toggle('Click');
        tracker.push.mockClear();
        build({ deferRestoreLog: true }).logRestored();
        expect(tracker.push).not.toHaveBeenCalled();
    });

    it('forgets the mode once left, even for a deferring tool', () => {
        const restored = build({ deferRestoreLog: true });
        restored.toggle('Click');
        restored.toggle('Click');
        expect(window.sessionStorage.getItem('svl-immersive-active')).toBeNull();
        expect(build().isActive()).toBe(false);
    });

    it('enters from a link carrying immersive=1, keeps it for the sitting, and says the link asked (#5480)', () => {
        window.history.replaceState(null, '', '/explore?panoId=abc&immersive=1');
        const mode = build();
        expect(mode.isActive()).toBe(true);
        expect(document.body.classList.contains('svl-immersive')).toBe(true);
        expect(relayout).not.toHaveBeenCalled();
        expect(tracker.push).toHaveBeenCalledWith('ImmersiveMode_Restored', expect.objectContaining({ source: 'url' }));
        // The ask outlives the link: the fresh /explore a finished route goes through has no param.
        expect(window.sessionStorage.getItem('svl-immersive-active')).toBe('1');
        window.history.replaceState(null, '', '/explore');
        tracker.push.mockClear();
        expect(build().isActive()).toBe(true);
        expect(tracker.push).toHaveBeenCalledWith('ImmersiveMode_Restored',
            expect.objectContaining({ source: 'session' }));
    });

    it('credits the tab, not the link, when both say immersive: only a new arrival reads as url (#5480)', () => {
        window.sessionStorage.setItem('svl-immersive-active', '1');
        window.history.replaceState(null, '', '/explore?panoId=abc&immersive=1');
        expect(build().isActive()).toBe(true);
        expect(tracker.push).toHaveBeenCalledWith('ImmersiveMode_Restored',
            expect.objectContaining({ source: 'session' }));
    });

    it('keeps the tutorial boxed even when the link says immersive=1', () => {
        window.history.replaceState(null, '', '/explore?retakeTutorial=true&immersive=1');
        onboarding = true;
        expect(build().isActive()).toBe(false);
        expect(document.body.classList.contains('svl-immersive')).toBe(false);
        expect(window.sessionStorage.getItem('svl-immersive-active')).toBeNull();
        expect(tracker.push).not.toHaveBeenCalled();
    });

    it('tells its onChange hook after every toggle, once the tool is laid out (#5480)', () => {
        const onChange = jest.fn();
        const mode = build({ onChange });
        mode.toggle('Click');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(relayout.mock.invocationCallOrder[0]).toBeLessThan(onChange.mock.invocationCallOrder[0]);
        mode.toggle('KeyboardShortcut');
        expect(onChange).toHaveBeenCalledTimes(2);
        // A build without the hook, and a toggle during the tutorial, stay quiet.
        expect(() => build().toggle('Click')).not.toThrow();
        onboarding = true;
        build({ onChange }).toggle('Click');
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('ignores immersive=1 for a tool that names no URL param (Validate)', () => {
        window.history.replaceState(null, '', '/validate?immersive=1');
        expect(build({ urlParam: undefined }).isActive()).toBe(false);
        expect(tracker.push).not.toHaveBeenCalled();
    });

    it('does not restore the mode into the tutorial', () => {
        window.sessionStorage.setItem('svl-immersive-active', '1');
        onboarding = true;
        expect(build().isActive()).toBe(false);
        expect(document.body.classList.contains('svl-immersive')).toBe(false);
    });

    it('is inert on a page without the toggle markup', () => {
        document.body.innerHTML = '';
        expect(() => build()).not.toThrow();
    });

    // Validate at phone width (#5580): the mode is the layout there, not a choice the user can make or keep.
    describe('forced', () => {
        let forced;
        const buildForced = (extra = {}) => build({ urlParam: undefined, forced: () => forced, ...extra });

        beforeEach(() => {
            forced = true;
        });

        it('at construction hides the button, sets both classes, stores nothing, and ignores the toggle', () => {
            const mode = buildForced();
            expect(mode.isActive()).toBe(true);
            expect(mode.isForced()).toBe(true);
            expect(document.getElementById('immersive-toggle-holder').hidden).toBe(true);
            expect(document.body.classList.contains('svl-immersive')).toBe(true);
            expect(document.documentElement.classList.contains('chromeless')).toBe(true);
            expect(window.sessionStorage.getItem('svl-immersive-active')).toBeNull();
            // Not a restore, so nothing to report even when asked.
            mode.logRestored();
            expect(tracker.push).not.toHaveBeenCalled();

            mode.toggle('KeyboardShortcut');
            document.getElementById('immersive-toggle-button').click();
            expect(mode.isActive()).toBe(true);
            expect(relayout).not.toHaveBeenCalled();
            expect(tracker.push).not.toHaveBeenCalled();
            expect(window.Toast.show).not.toHaveBeenCalled();
        });

        it('refreshForced() off restores the stored choice and shows the button', () => {
            const mode = buildForced();
            forced = false;
            expect(mode.refreshForced()).toBe(true);
            expect(mode.isForced()).toBe(false);
            expect(mode.isActive()).toBe(false);
            expect(document.getElementById('immersive-toggle-holder').hidden).toBe(false);
            expect(document.body.classList.contains('svl-immersive')).toBe(false);
            expect(document.getElementById('immersive-toggle-button').getAttribute('aria-label'))
                .toBe('common:immersive-enter');

            // The toggle works again once the user owns the mode.
            mode.toggle('Click');
            expect(mode.isActive()).toBe(true);
            expect(window.sessionStorage.getItem('svl-immersive-active')).toBe('1');
        });

        it('refreshForced() off keeps the mode when the tab had chosen it, and reports no layout change', () => {
            window.sessionStorage.setItem('svl-immersive-active', '1');
            const mode = buildForced();
            forced = false;
            expect(mode.refreshForced()).toBe(false);
            expect(mode.isActive()).toBe(true);
            expect(document.getElementById('immersive-toggle-holder').hidden).toBe(false);
            expect(window.sessionStorage.getItem('svl-immersive-active')).toBe('1');
        });

        it('refreshForced() on enters the mode without storing it, and is a no-op when nothing changed', () => {
            forced = false;
            const mode = buildForced();
            expect(mode.refreshForced()).toBe(false);

            forced = true;
            expect(mode.refreshForced()).toBe(true);
            expect(mode.isActive()).toBe(true);
            expect(document.getElementById('immersive-toggle-holder').hidden).toBe(true);
            expect(window.sessionStorage.getItem('svl-immersive-active')).toBeNull();
            expect(mode.refreshForced()).toBe(false);
            // The caller lays out once for the resize that prompted this; the module doesn't.
            expect(relayout).not.toHaveBeenCalled();
        });

        it('yields to isDisabled (Expert Validate stays boxed)', () => {
            onboarding = true;
            const mode = buildForced();
            expect(mode.isActive()).toBe(false);
            expect(mode.refreshForced()).toBe(false);
            expect(document.body.classList.contains('svl-immersive')).toBe(false);
        });
    });

    it('keeps each tool\'s mode and hint under its own body class', () => {
        const validate = new ImmersiveMode({ tracker, bodyClass: 'svv-immersive', relayout });
        validate.toggle('Click');
        expect(document.body.classList.contains('svv-immersive')).toBe(true);
        expect(document.body.classList.contains('svl-immersive')).toBe(false);
        expect(window.sessionStorage.getItem('svv-immersive-active')).toBe('1');
        expect(window.sessionStorage.getItem('svl-immersive-active')).toBeNull();
        // No frame given, so the event carries the window only.
        expect(tracker.push).toHaveBeenLastCalledWith('Click_ImmersiveMode_Enter',
            { innerWidth: window.innerWidth, innerHeight: window.innerHeight });
    });
});
