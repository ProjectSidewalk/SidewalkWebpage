/**
 * Tests for PopupPanoManager's per-load lifecycle: the loading overlay, the abandoned-load guard, and the
 * zero-size guard on the deferred resize (public/js/common/label-detail/PopupPanoManager.js, #5128).
 *
 * All three exist because the viewer is now built on the first open, which put a visible wait on the card and made
 * a load outlive the label that started it. Every one of them mutates the single shared `.label-detail__pano`
 * holder, so a stale load reaching them paints over whatever replaced it.
 *
 * Like popupPanoManagerLazyViewer.test.js, the source is eval'd into jsdom with jQuery, since it is a top-level
 * class written for Grunt concatenation.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const JQUERY_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/vendor/jquery/jquery-1.12.2.min.js'), 'utf8');
const MANAGER_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/common/label-detail/PopupPanoManager.js'), 'utf8');

const POV = { heading: 10, pitch: 0, zoom: 1 };

/** A viewer whose setPano() the test resolves by hand, so a load can be held open across another one. */
function deferredViewer() {
    const pending = [];
    return {
        pending,
        setPano: jest.fn(() => new Promise((resolve) => pending.push(resolve))),
        addListener: jest.fn(),
        getPanoId: () => 'pano-1',
        resize: jest.fn(),
        setPov: jest.fn(),
        getPov: () => ({ ...POV }),
    };
}

describe('PopupPanoManager load lifecycle', () => {
    let PopupPanoManager;
    let viewerType;
    let viewer;
    let svHolder;
    let loadingEl;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.resetModules();
        // The overlay is a sibling of the holder inside the wrap, which is where #init looks for it.
        document.body.innerHTML = `
            <div class="label-detail__pano-wrap">
              <div id="sv-holder" class="label-detail__pano"></div>
              <div class="label-detail__pano-loading" hidden></div>
            </div>
            <div id="button-holder"></div>`;
        svHolder = document.getElementById('sv-holder');
        loadingEl = document.querySelector('.label-detail__pano-loading');

        window.panzoom = () => ({ on: jest.fn(), zoomAbs: jest.fn(), moveTo: jest.fn(), getTransform: () => ({}) });
        window.util = {
            assetPath: (p) => `/assets/${p}`,
            afterLoadIdle: () => {},
            isMobile: () => false,
            misc: { getIconImagePaths: () => null, getLabelColors: () => '#000' },
        };
        window.i18next = { t: (k) => k };
        window.createPanoViewerLogo = () => ({ showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() });
        window.createPanoAttribution = () => ({ show: jest.fn(), hide: jest.fn() });
        window.LabelVisibilityToggle = { HIDDEN_CLASS: 'hidden' };
        window.PannellumViewer = { create: jest.fn() };
        window.fetch = jest.fn(() => Promise.resolve({ ok: false }));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        viewer = deferredViewer();
        viewerType = { create: jest.fn(() => Promise.resolve(viewer)), preloadLibrary: jest.fn() };

        window.eval(`${JQUERY_SRC}\n${MANAGER_SRC}\nwindow.PopupPanoManager = PopupPanoManager;`);
        PopupPanoManager = window.PopupPanoManager;
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    const createManager = () => PopupPanoManager.create(svHolder, document.getElementById('button-holder'),
        false, viewerType, 'token');

    /** jsdom gives every element a 0x0 rect, so the deferred resize needs a laid-out holder to be exercised. */
    const giveHolderSize = () => {
        svHolder.getBoundingClientRect = () => ({ width: 720, height: 480, top: 0, left: 0, right: 720, bottom: 480 });
    };

    /** Drains the microtask queue. The viewer build alone is several awaits deep before setPano() is reached. */
    const flush = async () => {
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
    };

    /** Drains microtasks, then the manager's fixed 250ms reveal delay, then microtasks again. */
    const settle = async () => {
        await flush();
        jest.advanceTimersByTime(300);
        await flush();
    };

    test('the overlay covers the load and is dropped once imagery is shown', async () => {
        giveHolderSize();
        const manager = await createManager();

        const load = manager.setPano('pano-1', POV, null);
        await flush();
        expect(loadingEl.hidden).toBe(false);
        expect(svHolder.style.visibility).toBe('hidden');

        viewer.pending[0]();
        await settle();
        await load;
        expect(loadingEl.hidden).toBe(true);
        expect(svHolder.style.visibility).toBe('visible');
    });

    test('a load abandoned for a newer label neither reveals nor drops the newer one\'s overlay', async () => {
        giveHolderSize();
        const manager = await createManager();

        const first = manager.setPano('pano-1', POV, null);
        await flush();
        // A second label opens while the first is still in flight — the common case, since #panoSuccessCallback
        // always waits 250ms even on a fast connection.
        const second = manager.setPano('pano-2', POV, null);
        await flush();

        // The first load now completes. Its late work must not touch the holder the second one is loading into.
        viewer.pending[0]();
        await settle();
        await first;
        expect(loadingEl.hidden).toBe(false);
        expect(svHolder.style.visibility).toBe('hidden');

        viewer.pending[1]();
        await settle();
        await second;
        expect(loadingEl.hidden).toBe(true);
        expect(svHolder.style.visibility).toBe('visible');
    });

    test('a load abandoned mid-flight leaves the viewer alone rather than posing it for the wrong label', async () => {
        giveHolderSize();
        const manager = await createManager();

        const first = manager.setPano('pano-1', POV, null);
        await flush();
        manager.setPano('pano-2', POV, null);
        await flush();

        viewer.pending[0]();
        await settle();
        await first;
        // Only the surviving load may drive the shared viewer's POV.
        expect(viewer.setPov).not.toHaveBeenCalled();
    });

    test('a holder with no layout skips the resize that would hand the provider a NaN zoom', async () => {
        const manager = await createManager(); // Holder keeps jsdom's 0x0 rect: the closed-dialog case.

        const load = manager.setPano('pano-1', POV, null);
        await flush();
        viewer.pending[0]();
        await settle();
        await load;

        expect(viewer.resize).not.toHaveBeenCalled();
        expect(viewer.setPov).not.toHaveBeenCalled();
    });

    test('the reveal respects the host\'s closed-during-load flag', async () => {
        giveHolderSize();
        const manager = await createManager();

        const load = manager.setPano('pano-1', POV, null);
        await flush();
        svHolder.dataset.closedDuringLoad = 'true'; // What LabelPopup's close handler sets.
        viewer.pending[0]();
        await settle();
        await load;

        expect(loadingEl.hidden).toBe(true); // The spinner still goes: nothing is loading any more.
        expect(svHolder.style.visibility).toBe('hidden');
    });
});
