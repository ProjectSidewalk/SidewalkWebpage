/**
 * The viewer's diagnostic channel: how a failure inside a pano viewer reaches a log a bug report can be checked against.
 *
 * Users can't be asked to open DevTools, so PanoViewer._fireDiagnostic is the one path by which a black or missing
 * pano leaves a trace. Two sinks: a page with an interaction tracker subscribes with addListener('diagnostic'); a page
 * without one falls back to window.logWebpageActivity. Values are flattened to the `k:v,k:v` alphabet both trackers
 * join notes with, since a stray comma or colon in an error message would corrupt the row.
 *
 * PanoViewer is a top-level `class` written for the Grunt-concatenation world, so we eval the source in the jsdom
 * global scope alongside stubs for the subclasses its constructor names.
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/common/pano-viewer/src');
const NO_IMAGERY_ERROR_SRC = fs.readFileSync(path.join(SRC_DIR, 'NoImageryError.js'), 'utf8');
const VIEWER_SRC = fs.readFileSync(path.join(SRC_DIR, 'PanoViewer.js'), 'utf8');

function loadPanoViewer() {
    window.eval(`
        class GsvViewer {}
        class MapillaryViewer {}
        class Infra3dViewer {}
        class PannellumViewer {}
        class PanoramaxViewer {}
        ${NO_IMAGERY_ERROR_SRC}
        ${VIEWER_SRC}
        window.PanoViewer = PanoViewer;
    `);
    return window.PanoViewer;
}

describe('PanoViewer diagnostics', () => {
    /** A concrete viewer whose initialize() does nothing, so create() can run against a real mount. */
    let TestViewer;

    beforeAll(() => {
        const PanoViewer = loadPanoViewer();
        TestViewer = class extends PanoViewer {
            async initialize() {}
        };
    });

    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        window.logWebpageActivity = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete window.logWebpageActivity;
    });

    it('hands the event to a subscribed tracker and leaves webpage_activity alone', () => {
        const viewer = new TestViewer();
        const listener = jest.fn();
        viewer.addListener('diagnostic', listener);

        viewer._fireDiagnostic('TokenRefreshed', { remainingSec: 3595, attempt: 1 });

        expect(listener).toHaveBeenCalledWith('TokenRefreshed', { remainingSec: '3595', attempt: '1' });
        expect(window.logWebpageActivity).not.toHaveBeenCalled();
    });

    it('falls back to webpage_activity, asynchronously, when no tracker is listening', () => {
        const viewer = new TestViewer();

        viewer._fireDiagnostic('TokenRefreshFailed', { attempt: 2, reason: 'HTTP 503' });

        expect(window.logWebpageActivity).toHaveBeenCalledWith('PanoViewer_TokenRefreshFailed_attempt=2_reason=HTTP 503', true);
    });

    it('flattens values to the note alphabet and drops empty ones', () => {
        const viewer = new TestViewer();
        const listener = jest.fn();
        viewer.addListener('diagnostic', listener);

        viewer._fireDiagnostic('TokenRefreshFailed', { reason: 'a:b,c', status: undefined, code: null });

        expect(listener).toHaveBeenCalledWith('TokenRefreshFailed', { reason: 'a;b;c' });
    });

    it('stops delivering to a removed listener', () => {
        const viewer = new TestViewer();
        const listener = jest.fn();
        viewer.addListener('diagnostic', listener);
        viewer.removeListener('diagnostic', listener);

        viewer._fireDiagnostic('WebGLContextLost');

        expect(listener).not.toHaveBeenCalled();
        expect(window.logWebpageActivity).toHaveBeenCalledWith('PanoViewer_WebGLContextLost', true);
    });

    it('reports a WebGL context lost on a canvas the provider created inside the mount', async () => {
        // webglcontextlost doesn't bubble, so the mount only hears it through a capture-phase listener.
        const mount = document.createElement('div');
        document.body.appendChild(mount);
        const viewer = await TestViewer.create(mount);
        const listener = jest.fn();
        viewer.addListener('diagnostic', listener);
        const canvas = document.createElement('canvas');
        mount.appendChild(canvas);

        canvas.dispatchEvent(new Event('webglcontextlost', { bubbles: false }));

        expect(listener).toHaveBeenCalledWith('WebGLContextLost', {});
        mount.remove();
    });
});
