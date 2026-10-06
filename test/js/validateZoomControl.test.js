/**
 * Tests for Validate's zoom (frontend/js/validate/zoom/ZoomControl.js, #5580).
 *
 * Two phone-layout bugs it pins: the wheel was heard only on the control layer, which goes click-through on a touch
 * screen, so a trackpad's wheel over the imagery did nothing there; and the 1-3 range sat partly inside GSV's
 * vertical-fov clamp on a phone-shaped frame, so the first zoom-ins changed nothing on screen.
 */

const { loadModules, loadGlobalScript, realUtil } = require('./loadGlobalScript');

window.bowser = {
    getParser: () => ({
        getBrowserName: () => 'Test', getBrowserVersion: () => '1',
        getOSName: () => 'TestOS', getPlatformType: () => 'desktop',
    }),
};
window.util = realUtil();
loadGlobalScript('frontend/js/common/utilitiesMath.js');
loadGlobalScript('frontend/js/common/pano-viewer/panoUtilities.js');

describe('ZoomControl', () => {
    let pov;
    let control;
    let frame;

    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = `
            <div id="svv-panorama-holder"><div id="svv-panorama"><canvas id="gsv"></canvas></div>
              <div id="view-control-layer"></div></div>
            <button id="zoom-in-button"></button><button id="zoom-out-button"></button>`;
        pov = { heading: 0, pitch: 0, zoom: 1 };
        frame = { width: 720, height: 480 };
        window.svv = {
            ui: {
                status: { zoomInButton: document.getElementById('zoom-in-button'),
                    zoomOutButton: document.getElementById('zoom-out-button') },
                viewer: { controlLayer: document.getElementById('view-control-layer') },
            },
            panoViewer: { getPov: () => ({ ...pov }), getViewerType: () => 'gsv' },
            panoManager: { setZoom: jest.fn((zoom) => { pov.zoom = zoom; }) },
            canvasWidth: () => frame.width,
            canvasHeight: () => frame.height,
            tracker: { push: jest.fn() },
        };
        const { ZoomControl } = loadModules('frontend/js/validate/zoom/ZoomControl.js');
        control = new ZoomControl();
    });

    afterEach(() => jest.useRealTimers());

    const wheel = (target, deltaY) => target.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }));

    test('a wheel over the imagery itself zooms, as it reaches it when the control layer is click-through', () => {
        wheel(document.getElementById('gsv'), -200);
        expect(svv.panoManager.setZoom).toHaveBeenCalledTimes(1);
        expect(pov.zoom).toBeGreaterThan(1);
    });

    test('on a portrait phone the first wheel zoom-in starts from where the view first changes, not from 1', () => {
        frame = { width: 390, height: 844 };
        const { min } = window.util.pano.gsvZoomRange(390 / 844);
        wheel(document.getElementById('view-control-layer'), -100);
        expect(pov.zoom).toBeCloseTo(min + 0.15, 6);
    });

    test('the buttons step a level within the frame\'s range and grey out at its ends', () => {
        control.zoomIn();
        control.zoomIn();
        control.zoomIn();
        expect(pov.zoom).toBe(3);
        expect(document.getElementById('zoom-in-button').getAttribute('aria-disabled')).toBe('true');
        control.zoomOut();
        control.zoomOut();
        expect(pov.zoom).toBe(1);
        expect(document.getElementById('zoom-out-button').getAttribute('aria-disabled')).toBe('true');
    });

    test('other viewers keep 1-3 whatever the frame', () => {
        svv.panoViewer.getViewerType = () => 'mapillary';
        frame = { width: 390, height: 844 };
        control.zoomOut();
        expect(pov.zoom).toBe(1);
    });
});
