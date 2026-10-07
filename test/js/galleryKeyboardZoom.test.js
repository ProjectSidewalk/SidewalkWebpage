/**
 * The Gallery's Z / Shift+Z zoom shortcut (#5142): frontend/js/gallery/keyboard/KeyboardManager.js calling
 * PopupPanoManager's zoomIn()/zoomOut() (frontend/js/common/label-detail/PopupPanoManager.js).
 *
 * These pin the key → manager call → viewer POV chain (the manager has to have the methods the key calls), the
 * logging, the keypresses the card doesn't own (a text field, a dialog stacked over it), and the step bounds,
 * including wheel-set zooms between steps and the views (crop, no imagery, no label yet) with nothing to zoom.
 */

const { loadModules } = require('./loadGlobalScript');


/** A stand-in for a GSV/Mapillary/Pannellum viewer whose POV setPov() really changes. */
function fakeViewer(zoom = 1) {
    let pov = { heading: 10, pitch: 0, zoom };
    return {
        setPano: jest.fn(() => Promise.resolve()),
        addListener: jest.fn(),
        getPanoId: () => 'pano-1',
        getViewerType: () => 'gsv',
        resize: jest.fn(),
        setPov: jest.fn((next) => { pov = { ...next }; }),
        getPov: () => ({ ...pov }),
    };
}

/** Stubs the globals PopupPanoManager reaches for and loads it fresh. */
function loadPopupPanoManager() {
    window.panzoom = () => ({ on: jest.fn(), zoomAbs: jest.fn(), moveTo: jest.fn(), getTransform: () => ({}) });
    window.util = {
        assetPath: (p) => `/assets/${p}`,
        afterLoadIdle: () => {},
        isMobile: () => false,
        misc: { getIconImagePaths: () => null, getLabelColors: () => 'currentColor' },
    };
    window.i18next = { t: (k) => k };
    window.createPanoViewerLogo = () => ({ showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() });
    window.createPanoAttribution = () => ({ show: jest.fn(), hide: jest.fn() });
    window.LabelVisibilityToggle = { HIDDEN_CLASS: 'hidden' };
    window.fetch = jest.fn(() => Promise.resolve({ ok: false }));
    return loadModules('frontend/js/common/label-detail/PopupPanoManager.js').PopupPanoManager;
}

/** Builds a manager the way LabelDetail does, with a viewer type whose create() returns `viewer`. */
function createManager(PopupPanoManager, viewer) {
    document.body.innerHTML = '<div id="sv-holder"></div><div id="button-holder"></div>';
    const viewerType = { create: jest.fn(() => Promise.resolve(viewer)), preloadLibrary: () => Promise.resolve() };
    const manager = PopupPanoManager.create(
        document.getElementById('sv-holder'), document.getElementById('button-holder'), false, viewerType, 'token',
    );
    return { manager, viewerType };
}

/** Releases a key on the page, the event the Gallery's manager listens for. */
function release(init) {
    document.body.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, ...init }));
}

describe('Gallery Z / Shift+Z shortcut', () => {
    // One KeyboardManager for the file: its constructor adds a window listener that is never removed.
    const expandedView = { open: true, panoManager: null, closeExpandedViewAndRemoveCardTransparency: jest.fn() };

    beforeAll(() => {
        window.sg = { tracker: { push: jest.fn() } };
        const { KeyboardManager } = loadModules('frontend/js/gallery/keyboard/KeyboardManager.js');
        new KeyboardManager(expandedView);
    });

    beforeEach(() => {
        window.sg.tracker.push.mockClear();
        expandedView.open = true;
        expandedView.panoManager = { zoomIn: jest.fn(() => true), zoomOut: jest.fn(() => true) };
        document.body.innerHTML = '';
    });

    afterAll(() => {
        delete window.sg;
    });

    it('Z zooms in and logs it', () => {
        release({ key: 'z', code: 'KeyZ' });
        expect(expandedView.panoManager.zoomIn).toHaveBeenCalledTimes(1);
        expect(expandedView.panoManager.zoomOut).not.toHaveBeenCalled();
        expect(window.sg.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ZoomIn', null, { code: 'KeyZ' });
    });

    it('Shift+Z zooms out and logs it', () => {
        release({ key: 'Z', code: 'KeyZ', shiftKey: true });
        expect(expandedView.panoManager.zoomOut).toHaveBeenCalledTimes(1);
        expect(expandedView.panoManager.zoomIn).not.toHaveBeenCalled();
        expect(window.sg.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ZoomOut', null, { code: 'KeyZ' });
    });

    it('still logs a press that could not move the view, as Explore and Validate do', () => {
        expandedView.panoManager.zoomIn.mockReturnValue(false);
        release({ key: 'z', code: 'KeyZ' });
        expect(window.sg.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ZoomIn', null, { code: 'KeyZ' });
    });

    it('does nothing while the expanded view is closed', () => {
        expandedView.open = false;
        release({ key: 'z', code: 'KeyZ' });
        expect(expandedView.panoManager.zoomIn).not.toHaveBeenCalled();
        expect(window.sg.tracker.push).not.toHaveBeenCalled();
    });

    it.each(['INPUT', 'TEXTAREA'])('leaves a z typed into a focused %s alone', (tag) => {
        const field = document.createElement(tag.toLowerCase());
        document.body.append(field);
        field.focus();
        field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'z', code: 'KeyZ' }));
        expect(expandedView.panoManager.zoomIn).not.toHaveBeenCalled();
        expect(window.sg.tracker.push).not.toHaveBeenCalled();
    });

    it.each([
        ['a focused select', '<select><option>x</option></select>', 'select'],
        ['a focused contenteditable', '<div contenteditable="true" tabindex="0">x</div>', 'div'],
        ['a button in a dialog stacked over the card', '<dialog open><button>OK</button></dialog>', 'button'],
    ])('leaves Z alone from %s', (_name, html, selector) => {
        document.body.innerHTML = html;
        document.querySelector(selector).focus();
        release({ key: 'z', code: 'KeyZ' });
        expect(expandedView.panoManager.zoomIn).not.toHaveBeenCalled();
        expect(window.sg.tracker.push).not.toHaveBeenCalled();
    });

    it('leaves Z alone while a dialog is open and nothing holds focus', () => {
        document.body.innerHTML = '<dialog open><p>Delete this label?</p></dialog>';
        release({ key: 'z', code: 'KeyZ' });
        expect(expandedView.panoManager.zoomIn).not.toHaveBeenCalled();
        expect(window.sg.tracker.push).not.toHaveBeenCalled();
    });

    it('still zooms from a focused control on the card itself', () => {
        document.body.innerHTML = '<button>Agree</button><dialog><p>closed</p></dialog>';
        document.querySelector('button').focus();
        release({ key: 'z', code: 'KeyZ' });
        expect(expandedView.panoManager.zoomIn).toHaveBeenCalledTimes(1);
    });

    it.each(['ctrlKey', 'metaKey', 'altKey'])('leaves Z to the browser with %s held', (modifier) => {
        release({ key: 'z', code: 'KeyZ', [modifier]: true });
        expect(expandedView.panoManager.zoomIn).not.toHaveBeenCalled();
        expect(window.sg.tracker.push).not.toHaveBeenCalled();
    });

    it('drives a real PopupPanoManager without throwing before any label has been shown (#5142, #5128)', async () => {
        const PopupPanoManager = loadPopupPanoManager();
        const { manager, viewerType } = createManager(PopupPanoManager, fakeViewer());
        expandedView.panoManager = await manager;

        expect(() => release({ key: 'z', code: 'KeyZ' })).not.toThrow();
        expect(() => release({ key: 'Z', code: 'KeyZ', shiftKey: true })).not.toThrow();
        // Zooming must never be what builds the billable viewer.
        expect(viewerType.create).not.toHaveBeenCalled();
        expect(window.sg.tracker.push).toHaveBeenCalledTimes(2);
    });
});

describe('PopupPanoManager zoomIn() / zoomOut()', () => {
    let PopupPanoManager;

    beforeEach(() => {
        jest.useFakeTimers();
        PopupPanoManager = loadPopupPanoManager();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    /** A manager showing a live pano on a viewer that starts at `zoom`. */
    async function liveManager(zoom) {
        const viewer = fakeViewer(zoom);
        const { manager: created } = createManager(PopupPanoManager, viewer);
        const manager = await created;
        const shown = manager.setPano('pano-1', { heading: 10, pitch: 0, zoom }, null);
        await jest.runAllTimersAsync();
        await shown;
        viewer.setPov.mockClear();
        return { manager, viewer };
    }

    it('steps one whole level at a time and reports that the view changed', async () => {
        const { manager, viewer } = await liveManager(1);
        expect(manager.zoomIn()).toBe(true);
        expect(viewer.getPov().zoom).toBe(2);
        expect(manager.zoomIn()).toBe(true);
        expect(viewer.getPov().zoom).toBe(3);
        expect(manager.zoomOut()).toBe(true);
        expect(viewer.getPov().zoom).toBe(2);
    });

    it('keeps the heading and pitch while zooming', async () => {
        const { manager, viewer } = await liveManager(1);
        manager.zoomIn();
        expect(viewer.setPov).toHaveBeenCalledWith({ heading: 10, pitch: 0, zoom: 2 });
    });

    it('stops at 3 going in and at 1 going out', async () => {
        const top = await liveManager(3);
        expect(top.manager.zoomIn()).toBe(false);
        expect(top.viewer.setPov).not.toHaveBeenCalled();

        const bottom = await liveManager(1);
        expect(bottom.manager.zoomOut()).toBe(false);
        expect(bottom.viewer.setPov).not.toHaveBeenCalled();
    });

    it('snaps a wheel-set fractional zoom to the nearest step before moving', async () => {
        const { manager, viewer } = await liveManager(2.4);
        expect(manager.zoomIn()).toBe(true);
        expect(viewer.getPov().zoom).toBe(3);
    });

    it('zooms in to 3 from a wheel-set zoom that rounds up to 3', async () => {
        const { manager, viewer } = await liveManager(2.6);
        expect(manager.zoomIn()).toBe(true);
        expect(viewer.getPov().zoom).toBe(3);
    });

    it('zooms out to 3, not 2, from a wheel-set zoom just past 3', async () => {
        const { manager, viewer } = await liveManager(3.4);
        expect(manager.zoomOut()).toBe(true);
        expect(viewer.getPov().zoom).toBe(3);
    });

    it('steps out to the step below a fractional zoom', async () => {
        const { manager, viewer } = await liveManager(2.4);
        expect(manager.zoomOut()).toBe(true);
        expect(viewer.getPov().zoom).toBe(2);
    });

    it('treats float noise around a step as that step', async () => {
        const { manager, viewer } = await liveManager(1.9999999);
        expect(manager.zoomIn()).toBe(true);
        expect(viewer.getPov().zoom).toBe(3);

        const top = await liveManager(2.9999999);
        expect(top.manager.zoomIn()).toBe(false);
        expect(top.viewer.setPov).not.toHaveBeenCalled();
    });

    it('never zooms out on Z when the wheel has taken the view past 3', async () => {
        const { manager, viewer } = await liveManager(4);
        expect(manager.zoomIn()).toBe(false);
        expect(viewer.setPov).not.toHaveBeenCalled();
        expect(manager.zoomOut()).toBe(true);
        expect(viewer.getPov().zoom).toBe(3);
    });

    it('never zooms in on Shift+Z when the view is wider than 1', async () => {
        const { manager, viewer } = await liveManager(0.4);
        expect(manager.zoomOut()).toBe(false);
        expect(manager.zoomIn()).toBe(true);
        expect(viewer.getPov().zoom).toBe(1);
    });

    it('does nothing over the crop fallback, though the hidden live viewer is still there', async () => {
        const { manager, viewer } = await liveManager(2);
        await manager.setPano('pano-gone', { heading: 10, pitch: 0, zoom: 2 }, 'https://example.test/crop.png', true);
        expect(manager.activeViewerName).toBe('StaticCrop');
        expect(manager.panoViewer).toBe(viewer);

        expect(manager.zoomIn()).toBe(false);
        expect(manager.zoomOut()).toBe(false);
        expect(viewer.setPov).not.toHaveBeenCalled();
    });
});
