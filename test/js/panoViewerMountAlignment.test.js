/**
 * Tests for the viewer-mount invariants that broke mobile Validate on Mapillary/Infra3d (#4999).
 *
 * Both SDKs (Infra3d is a mapillary-js fork) style their render canvas `position: absolute` with no offsets, so
 * it renders at its static position — which an inherited `text-align: center` (mobile Validate centers body and
 * .tool-ui) places at the middle of the line box, shoving the canvas right by half the mount's width. GSV is
 * unaffected because it positions its canvas explicitly, which is exactly why the bug read as "GSV works,
 * Mapillary/Infra3d don't". PanoViewer.create() pins the mount's text-align so no page has to know about this.
 *
 * Infra3dViewer additionally lacked a resize() override, so the base class's no-op silently swallowed the
 * re-measure that PanoManager requests after sizing the pano to the phone viewport.
 *
 * The viewer classes are written for the Grunt-concatenation world, so the sources are eval'd into the jsdom
 * global scope with stub declarations for the sibling classes PanoViewer's constructor compares `new.target`
 * against, following panoViewerAspect.test.js.
 */

const { loadModules } = require('./loadGlobalScript');


/**
 * Loads PanoViewer + Infra3dViewer fresh into the jsdom global scope.
 * @returns {{PanoViewer: Function, Infra3dViewer: Function}}
 */
function loadViewers() {
            Object.assign(window, loadModules('frontend/js/common/pano-viewer/PanoViewer.js', 'frontend/js/common/pano-viewer/Infra3dViewer.js'));
    return { PanoViewer: window.PanoViewer, Infra3dViewer: window.Infra3dViewer };
}

describe('PanoViewer.create mount alignment', () => {
    test('pins the mount element\'s text-align to left before initializing', async () => {
        const { PanoViewer } = loadViewers();
        class TestViewer extends PanoViewer {
            initialize(canvasElem) {
                // The guard must already be in place by the time the SDK gets the element.
                expect(canvasElem.style.textAlign).toBe('left');
                return Promise.resolve();
            }
        }

        const mount = document.createElement('div');
        expect(mount.style.textAlign).toBe('');
        const viewer = await TestViewer.create(mount);
        expect(mount.style.textAlign).toBe('left');
        expect(viewer.canvasElem).toBe(mount);
    });
});

describe('Infra3dViewer.resize', () => {
    test('delegates to the SDK viewer instead of inheriting the base-class no-op', () => {
        const { Infra3dViewer } = loadViewers();
        const viewer = new Infra3dViewer();
        const sdkResize = jest.fn();
        viewer.viewer = { _sdk_viewer: { resize: sdkResize } };
        viewer.resize();
        expect(sdkResize).toHaveBeenCalledTimes(1);
    });
});
