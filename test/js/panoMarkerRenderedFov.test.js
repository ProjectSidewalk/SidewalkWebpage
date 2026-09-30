/**
 * PanoMarker (public/js/common/PanoMarker.js) projects a marker with the field of view its viewer actually renders
 * for the container's shape, not the zoom curve alone (#5083, #5085): GSV clamps its vertical field on a tall or wide
 * viewport, and a marker projected with the curve sits off its feature there. Validate's marker and the label
 * popup's both come through here.
 */

const fs = require('fs');
const path = require('path');

const MARKER_SRC = fs.readFileSync(path.resolve(__dirname, '..', '..', 'public/js/common/PanoMarker.js'), 'utf8');

describe('PanoMarker projection', () => {
    let PanoMarker;
    let container;

    beforeEach(() => {
        window.util = {
            pano: {
                // jsdom has no WebGL, so PanoMarker picks the 2d projection; both take the same trailing fov.
                centeredPovToCanvasCoord2d: jest.fn(() => ({ x: 10, y: 20 })),
                centeredPovToCanvasCoord: jest.fn(() => ({ x: 10, y: 20 })),
                renderedHFov: jest.fn(() => 42),
            },
        };
        // PanoMarker probes for WebGL on load; jsdom has no canvas contexts and would log a not-implemented error.
        HTMLCanvasElement.prototype.getContext = () => null;
        window.eval(`${MARKER_SRC}\nwindow.PanoMarker = PanoMarker;`);
        PanoMarker = window.PanoMarker;
        container = document.createElement('div');
        document.body.replaceChildren(container);
        // jsdom lays nothing out, so the container's box is declared.
        Object.defineProperty(container, 'offsetWidth', { value: 800 });
        Object.defineProperty(container, 'offsetHeight', { value: 400 });
    });

    it('asks the viewer for the fov it renders at this container\'s aspect and projects with it', () => {
        const panoViewer = {
            getPov: () => ({ heading: 90, pitch: 5, zoom: 3 }),
            getViewerType: () => 'gsv',
            addListener: jest.fn(),
            removeListener: jest.fn(),
            getPanoId: () => 'pano',
        };
        const marker = new PanoMarker({ panoViewer, markerContainer: container, position: { heading: 95, pitch: 0 } });
        marker.draw();
        expect(window.util.pano.renderedHFov).toHaveBeenCalledWith(3, 2, 'gsv');
        expect(window.util.pano.centeredPovToCanvasCoord2d).toHaveBeenCalledWith(
            { heading: 95, pitch: 0 }, { heading: 90, pitch: 5, zoom: 3 }, 800, 400, expect.any(Number), 42,
        );
    });
});
