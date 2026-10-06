/**
 * Tests for Canvas's touch wiring (frontend/js/explore/canvas/Canvas.js, #5664).
 *
 * What matters to a labeler: one tap places exactly one label (the old touch shim let the browser's replayed mouseup
 * place a second), a drag pans whether or not a label type is armed, and the mouse behaves exactly as before. The
 * Canvas is built for real against a stand-in `svl`; only the collaborators a press reaches are present.
 */

const { loadModules } = require('./loadGlobalScript');
const { makeRecordingCtx } = require('./canvasCtxStub');
const { pointerEvent } = require('./pointerEventStub');

describe('Canvas touch and mouse input', () => {
    let viewLayer;
    let drawingLayer;
    let createdLabels;

    const label = () => ({ getProperty: () => 7, className: 'Label' });

    beforeEach(() => {
        document.body.innerHTML = `
          <canvas id="label-canvas"></canvas>
          <div id="interaction-area-holder"></div>
          <div id="view-control-layer"></div>
          <div id="label-drawing-layer"></div>
          <div id="hover-card"></div><button id="hover-edit"></button><button id="hover-delete"></button>`;
        viewLayer = document.getElementById('view-control-layer');
        drawingLayer = document.getElementById('label-drawing-layer');
        for (const layer of [viewLayer, drawingLayer]) {
            layer.setPointerCapture = jest.fn();
            layer.releasePointerCapture = jest.fn();
        }
        HTMLCanvasElement.prototype.getContext = () => ({ ...makeRecordingCtx(), clearRect: jest.fn() });
        createdLabels = [];

        window.util = {
            sizeCanvasToDisplay: jest.fn(),
            exploreDisplayScale: () => 2,
            // jsdom lays nothing out, so every layer sits at the origin and client coordinates are layer coordinates.
            mousePosition: (e) => ({ x: e.clientX, y: e.clientY }),
            assetPath: (p) => p,
            pano: {
                canvasCoordToCenteredPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
                centeredPovToCanvasCoord: () => ({ x: 0, y: 0 }),
            },
        };
        window.svl = {
            ui: {
                canvas: {
                    drawingLayer,
                    hoverCard: document.getElementById('hover-card'),
                    hoverCardEdit: document.getElementById('hover-edit'),
                    hoverCardDelete: document.getElementById('hover-delete'),
                },
                streetview: { viewControlLayer: viewLayer },
            },
            tracker: { push: jest.fn() },
            panoManager: { getStatus: () => false, updatePov: jest.fn() },
            panoViewer: { getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }), getPanoId: () => 'pano' },
            CANVAS_FRAME: { width: 720, height: 480 },
            LABEL_ICON_RADIUS: 17,
            renderedHFov: () => 90,
            missionContainer: { getCurrentMission: () => ({ getProperty: () => 1 }) },
            taskContainer: { getCurrentTask: () => ({ getAuditTaskId: () => 3 }) },
            labelContainer: {
                createLabel: jest.fn(() => {
                    const l = label();
                    createdLabels.push(l);
                    return l;
                }),
                getCanvasLabels: () => [],
            },
            contextMenu: { show: jest.fn(), hide: jest.fn() },
            form: { submitData: jest.fn().mockResolvedValue(undefined) },
            isOnboarding: () => false,
            zoomControl: { pinchStart: jest.fn(), pinchZoom: jest.fn(), pinchEnd: jest.fn(), updateOpacity: jest.fn() },
        };
        const ribbon = {
            getStatus: (key) => (key === 'selectedLabelType' ? 'CurbRamp' : 'CurbRamp'),
            backToWalk: jest.fn(),
        };

        const { Canvas } = loadModules('frontend/js/explore/canvas/Canvas.js');
        window.svl.canvas = new Canvas(ribbon);
    });

    const actions = () => window.svl.tracker.push.mock.calls.map(([action]) => action);

    test('a tap on the drawing layer places exactly one label, even if the browser replays it as mouse events', () => {
        drawingLayer.dispatchEvent(pointerEvent('pointerdown', { x: 200, y: 100 }));
        drawingLayer.dispatchEvent(pointerEvent('pointerup', { x: 200, y: 100 }));
        // What the old shim, and Chrome on Android without the cancel, would deliver next.
        drawingLayer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 200, clientY: 100 }));
        drawingLayer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 100 }));

        expect(window.svl.labelContainer.createLabel).toHaveBeenCalledTimes(1);
        expect(actions().filter((a) => a === 'LabelingCanvas_FinishLabeling')).toHaveLength(1);
        // The tap is placed in the logical frame: 200 CSS px at display scale 2.
        expect(window.svl.labelContainer.createLabel.mock.calls[0][0].originalCanvasXY).toEqual({ x: 100, y: 50 });
        expect(window.svl.tracker.push).toHaveBeenCalledWith('LabelingCanvas_MouseUp',
            { x: 100, y: 50, pointerType: 'touch' });
    });

    test('a drag on the drawing layer pans and places nothing, so the type stays armed', () => {
        drawingLayer.dispatchEvent(pointerEvent('pointerdown', { x: 200, y: 100 }));
        drawingLayer.dispatchEvent(pointerEvent('pointermove', { x: 240, y: 100 }));
        drawingLayer.dispatchEvent(pointerEvent('pointerup', { x: 240, y: 100 }));

        expect(window.svl.labelContainer.createLabel).not.toHaveBeenCalled();
        // 40 CSS px past the 10 px slop arrives as one 40 px move; display scale 2 and zoom 1 (2^1) divide it by 4.
        expect(window.svl.panoManager.updatePov).toHaveBeenCalledWith(10, 0);
    });

    test('a drag on the view-control layer pans, and logs its press and release with the pointer type', () => {
        viewLayer.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 100 }));
        viewLayer.dispatchEvent(pointerEvent('pointermove', { x: 100, y: 140 }));
        viewLayer.dispatchEvent(pointerEvent('pointerup', { x: 100, y: 140 }));

        expect(window.svl.panoManager.updatePov).toHaveBeenCalledWith(0, 10);
        expect(window.svl.tracker.push).toHaveBeenCalledWith('ViewControl_MouseDown',
            { x: 50, y: 50, pointerType: 'touch' });
        expect(window.svl.tracker.push).toHaveBeenCalledWith('ViewControl_MouseUp',
            { x: 50, y: 70, pointerType: 'touch' });
    });

    test('no pan while panning is disabled (the tutorial locks it)', () => {
        window.svl.panoManager.getStatus = () => true;
        viewLayer.dispatchEvent(pointerEvent('pointerdown', { x: 100, y: 100 }));
        viewLayer.dispatchEvent(pointerEvent('pointermove', { x: 160, y: 100 }));

        expect(window.svl.panoManager.updatePov).not.toHaveBeenCalled();
    });

    test('a two-finger pinch drives the zoom control', () => {
        viewLayer.dispatchEvent(pointerEvent('pointerdown', { id: 1, x: 100, y: 100 }));
        viewLayer.dispatchEvent(pointerEvent('pointerdown', { id: 2, x: 200, y: 100 }));
        viewLayer.dispatchEvent(pointerEvent('pointermove', { id: 2, x: 300, y: 100 }));
        viewLayer.dispatchEvent(pointerEvent('pointerup', { id: 2, x: 300, y: 100 }));

        expect(window.svl.zoomControl.pinchStart).toHaveBeenCalledTimes(1);
        expect(window.svl.zoomControl.pinchZoom).toHaveBeenCalledWith(1);
        expect(window.svl.zoomControl.pinchEnd).toHaveBeenCalledTimes(1);
    });

    describe('the mouse path is unchanged', () => {
        test('a mouse drag on the view-control layer pans and logs with no pointer type', () => {
            viewLayer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
            viewLayer.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
            viewLayer.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 140, clientY: 100 }));
            viewLayer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 140, clientY: 100 }));

            expect(window.svl.panoManager.updatePov).toHaveBeenCalledWith(10, 0);
            expect(window.svl.tracker.push).toHaveBeenCalledWith('ViewControl_MouseDown', { x: 50, y: 50 });
            expect(window.svl.tracker.push).toHaveBeenCalledWith('ViewControl_MouseUp', { x: 70, y: 50 });
        });

        test('a mouse up on the drawing layer places a label; a mouse drag there never pans', () => {
            drawingLayer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }));
            drawingLayer.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 160, clientY: 100 }));
            drawingLayer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 160, clientY: 100 }));

            expect(window.svl.panoManager.updatePov).not.toHaveBeenCalled();
            expect(window.svl.labelContainer.createLabel).toHaveBeenCalledTimes(1);
            expect(window.svl.tracker.push).toHaveBeenCalledWith('LabelingCanvas_MouseUp', { x: 80, y: 50 });
        });

        test('mouse pointer events are left to the mouse listeners', () => {
            drawingLayer.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));
            drawingLayer.dispatchEvent(pointerEvent('pointerup', { pointerType: 'mouse' }));

            expect(window.svl.labelContainer.createLabel).not.toHaveBeenCalled();
        });
    });
});
