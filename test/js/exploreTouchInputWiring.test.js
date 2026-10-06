/**
 * Tests for the pieces around Explore's touch layer (#5664): the context menu closing on a tap outside it, the zoom
 * control following a pinch, and the low-level log recording touch presses. Each would quietly break on a tablet
 * while every mouse test stayed green, because a cancelled touch pointerdown means no mouse event ever arrives.
 */

const { loadModules } = require('./loadGlobalScript');
const { makeContextMenuUi } = require('./contextMenuUiStub');
const { pointerEvent } = require('./pointerEventStub');

describe('ContextMenu closes on a tap outside it', () => {
    let menu;
    let ui;

    beforeEach(() => {
        window.i18next = { t: (key) => key };
        window.util = {
            camelToKebab: (s) => s,
            anchorPanelToLabel: jest.fn(),
            misc: {
                labelTypeName: (type) => type,
                getIconImagePaths: () => ({ iconImagePath: 'CurbRamp.svg' }),
                labelTypeHasSeverity: () => false,
                getLabelDescriptions: () => ({ tagInfo: {} }),
            },
        };
        const canvas = { clear: () => canvas, render: () => canvas, getStatus: () => false };
        window.svl = {
            canvas,
            tracker: { push: jest.fn() },
            ribbon: { enableModeSwitch: jest.fn() },
            keyboard: { setStatus: jest.fn() },
            isOnboarding: () => false,
            LABEL_ICON_RADIUS: 17,
            navigationService: { setStatus: jest.fn() },
            labelContainer: { getAllLabels: () => [] },
        };
        const { ContextMenu } = loadModules('frontend/js/explore/canvas/ContextMenu.js');
        ui = makeContextMenuUi();
        document.body.appendChild(ui.holder);
        menu = new ContextMenu(ui);
        window.svl.contextMenu = menu;
        const props = { labelType: 'CurbRamp', severity: null, description: '', tagIds: [], temporaryLabelId: 7 };
        menu.show({
            getLabelType: () => 'CurbRamp', getCanvasXY: () => ({ x: 1, y: 1 }), getProperty: (k) => props[k],
            getProperties: () => props, isDeleted: () => false, setProperty: (k, v) => { props[k] = v; },
        });
    });

    // Closed, so this menu's document listener (which outlives the test) ignores the presses later tests make.
    afterEach(() => {
        menu.hide();
        ui.holder.remove();
    });

    test('a touch on the pano closes it', () => {
        document.body.dispatchEvent(pointerEvent('pointerdown'));

        expect(menu.isOpen()).toBe(false);
        expect(window.svl.tracker.push).toHaveBeenCalledWith('ContextMenu_CloseClickOut');
    });

    test('a touch inside it does not', () => {
        ui.holder.dispatchEvent(pointerEvent('pointerdown'));

        expect(menu.isOpen()).toBe(true);
    });
});

describe('ZoomControl follows a pinch', () => {
    let zoom;
    let tracker;
    let pov;

    beforeEach(() => {
        document.body.innerHTML = '<button id="zoom-in-button"></button><button id="zoom-out-button"></button>';
        pov = { heading: 0, pitch: 0, zoom: 1 };
        tracker = { push: jest.fn() };
        const canvas = { clear: () => canvas, render: () => canvas, hideHoverCard: jest.fn() };
        window.svl = {
            ui: { streetview: { viewControlLayer: document.createElement('div') } },
            panoViewer: { getPov: () => pov },
            panoManager: { setZoom: jest.fn((z) => { pov.zoom = z; }) },
            labelContainer: { getCanvasLabels: () => [] },
            canvas,
        };
        const { ZoomControl } = loadModules('frontend/js/explore/zoom/ZoomControl.js');
        zoom = new ZoomControl(canvas, tracker);
    });

    test('zooms from where the pinch started, clamped to the zoom range', () => {
        zoom.pinchStart();
        zoom.pinchZoom(0.5);
        expect(pov.zoom).toBeCloseTo(1.5);
        zoom.pinchZoom(5);
        expect(pov.zoom).toBe(3);
        zoom.pinchEnd();
    });

    test('logs a Start and an End per direction, the way Validate does', () => {
        zoom.pinchStart();
        zoom.pinchZoom(0.4);
        zoom.pinchZoom(0.8);
        zoom.pinchZoom(0.2);
        zoom.pinchEnd();

        expect(tracker.push.mock.calls.map(([a]) => a)).toEqual([
            'Pinch_ZoomIn_Start', 'Pinch_ZoomIn_End', 'Pinch_ZoomOut_Start', 'Pinch_ZoomOut_End',
        ]);
    });

    test('does nothing outside a pinch, or against a locked direction', () => {
        zoom.pinchZoom(1);
        expect(window.svl.panoManager.setZoom).not.toHaveBeenCalled();

        // Zoom 1 is the floor, so zoom-out is disabled and a pinch inward has nowhere to go.
        zoom.pinchStart();
        zoom.pinchZoom(-1);
        zoom.pinchEnd();
        expect(window.svl.panoManager.setZoom).not.toHaveBeenCalled();
        expect(tracker.push).not.toHaveBeenCalled();
    });
});

describe('Tracker logs touch presses', () => {
    let tracker;

    beforeEach(() => {
        window.svl = {};
        const { Tracker } = loadModules('frontend/js/explore/data/Tracker.js');
        tracker = new Tracker();
        tracker.push = jest.fn();
    });

    test('a touch logs its pointerdown and pointerup with position and type', () => {
        document.body.dispatchEvent(pointerEvent('pointerdown', { x: 12, y: 34 }));
        document.body.dispatchEvent(pointerEvent('pointerup', { x: 12, y: 34 }));

        const pointerRows = tracker.push.mock.calls.filter(([a]) => a.startsWith('LowLevelEvent_pointer'));
        expect(pointerRows.map(([a]) => a)).toEqual(['LowLevelEvent_pointerdown', 'LowLevelEvent_pointerup']);
        expect(pointerRows[0][1]).toMatchObject({ pointerType: 'touch' });
    });

    test('a mouse logs no pointer rows; its mousedown/mouseup rows already cover it', () => {
        document.body.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse' }));

        expect(tracker.push.mock.calls.filter(([a]) => a.startsWith('LowLevelEvent_pointer'))).toEqual([]);
    });
});
