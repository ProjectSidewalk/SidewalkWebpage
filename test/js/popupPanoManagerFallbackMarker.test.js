/**
 * Tests for where the label popup draws its marker on the static crop it falls back to when no pano can be shown
 * (public/js/common/label-detail/PopupPanoManager.js, issue #2660).
 *
 * The crop behind the fallback is either the browser's snapshot of the Explore canvas, where the label is at its
 * canvas fraction, or the window the nightly crop job cut around the label, where it is wherever `label_crop` says
 * (the centre, unless the window shifted off a pole). The label payload carries that as `cropMarker`; these pin that
 * the fallback marker follows it when present and the canvas fraction otherwise.
 *
 * Like the other PopupPanoManager tests, the source is eval'd into jsdom with jQuery, since it is a top-level class
 * written for Grunt concatenation. The fallback is reached by declaring the imagery expired (no live attempt) with
 * no self-hosted copy (no Pannellum attempt), which is the popup's path for an old label whose pano Google has
 * dropped.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const JQUERY_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/vendor/jquery/jquery-1.12.2.min.js'), 'utf8');
const MANAGER_SRC = fs.readFileSync(path.join(REPO_ROOT, 'public/js/common/label-detail/PopupPanoManager.js'), 'utf8');

const POV = { heading: 10, pitch: 0, zoom: 1 };

/** The label as LabelDetail hands it over: a click at 1/4, 3/4 of the 720x480 canvas. */
function popupLabel(cropMarker) {
    return {
        labelId: 1, label_type: 'CurbRamp', canvasX: 180, canvasY: 360, originalCanvasWidth: 720,
        originalCanvasHeight: 480, pov: POV, streetEdgeId: 5, aiGenerated: false, cropMarker,
    };
}

describe('PopupPanoManager fallback marker', () => {
    let PopupPanoManager;
    let svHolder;

    beforeEach(() => {
        jest.resetModules();
        document.body.innerHTML = `
            <div class="label-detail__pano-wrap">
              <div id="sv-holder" class="label-detail__pano"></div>
              <div class="label-detail__pano-loading" hidden></div>
            </div>
            <div id="button-holder"></div>
            <a id="explore-street"></a>`;
        svHolder = document.getElementById('sv-holder');

        // Identity transform: the marker lands at the fraction of the container's size, nothing else.
        window.panzoom = () => ({
            on: jest.fn(), zoomAbs: jest.fn(), moveTo: jest.fn(), getTransform: () => ({ x: 0, y: 0, scale: 1 }),
        });
        window.util = {
            assetPath: (p) => `/assets/${p}`,
            afterLoadIdle: () => {},
            isMobile: () => false,
            misc: { getIconImagePaths: () => ({ iconImagePath: 'icon.png' }), getLabelColors: () => '#000' },
        };
        window.i18next = { t: (k) => k };
        window.createPanoViewerLogo = () => ({ showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() });
        window.createPanoAttribution = () => ({ show: jest.fn(), hide: jest.fn() });
        window.LabelVisibilityToggle = { HIDDEN_CLASS: 'hidden' };
        window.PannellumViewer = { create: jest.fn() };
        window.fetch = jest.fn(() => Promise.resolve({ ok: false }));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        window.eval(`${JQUERY_SRC}\n${MANAGER_SRC}\nwindow.PopupPanoManager = PopupPanoManager;`);
        PopupPanoManager = window.PopupPanoManager;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    /**
     * Builds a manager whose fallback container has a layout, since jsdom gives every element a 0x0 box and the
     * marker is only placed on a box with a size.
     */
    async function createManager() {
        const viewerType = { create: jest.fn(), preloadLibrary: jest.fn() };
        const manager = await PopupPanoManager.create(svHolder, document.getElementById('button-holder'), false,
            viewerType, 'token');
        const container = document.getElementById('pano-fallback-container');
        Object.defineProperty(container, 'clientWidth', { value: 720 });
        Object.defineProperty(container, 'clientHeight', { value: 480 });
        return manager;
    }

    /** Shows the crop fallback for the label and returns the marker's inline offsets in px. */
    async function markerAfterFallback(cropMarker) {
        const manager = await createManager();
        manager.setLabel(popupLabel(cropMarker));
        await expect(manager.setPano('pano-gone', POV, '/cropImage/CurbRamp/1', true, null)).resolves.toBe(true);
        const marker = document.getElementById('pano-fallback-marker');
        return { left: parseFloat(marker.style.left), top: parseFloat(marker.style.top) };
    }

    test('places the marker where the crop says its label is', async () => {
        await expect(markerAfterFallback({ x: 0.5, y: 0.62 })).resolves.toEqual({ left: 360, top: 297.6 });
    });

    test('places the marker at the canvas fraction for a crop nothing has recorded yet', async () => {
        await expect(markerAfterFallback(null)).resolves.toEqual({ left: 180, top: 360 });
    });
});
