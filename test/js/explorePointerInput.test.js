/**
 * Tests for PointerInput (frontend/js/explore/canvas/PointerInput.js, #5664): the touch and pen layer under Explore's
 * pano. It decides whether a finger meant a tap (place a label, open a menu), a drag (pan) or a pinch (zoom), and it is
 * what stops one tap from also arriving as replayed mouse events, which used to place a second label.
 */

const { loadModules } = require('./loadGlobalScript');
const { pointerEvent } = require('./pointerEventStub');

describe('PointerInput', () => {
    let PointerInput;
    let layer;
    let calls;
    let input;

    /** Dispatches a pointer event on the layer. */
    const fire = (type, opts) => {
        const e = pointerEvent(type, opts);
        layer.dispatchEvent(e);
        return e;
    };

    beforeEach(() => {
        ({ PointerInput } = loadModules('frontend/js/explore/canvas/PointerInput.js'));
        layer = document.createElement('div');
        document.body.appendChild(layer);
        layer.setPointerCapture = jest.fn();
        layer.releasePointerCapture = jest.fn();
        layer.hasPointerCapture = jest.fn(() => true);
        calls = [];
        const record = (name) => (arg) => calls.push([name, arg]);
        input = new PointerInput(layer, {
            onDown: record('down'), onTap: record('tap'),
            onDragStart: record('dragStart'), onDrag: record('drag'), onDragEnd: record('dragEnd'),
            onPinchStart: record('pinchStart'), onPinch: record('pinch'), onPinchEnd: record('pinchEnd'),
        });
    });

    afterEach(() => layer.remove());

    const names = () => calls.map(([name]) => name);

    test('a finger lifted within the slop is a tap, and nothing else', () => {
        fire('pointerdown', { x: 100, y: 100 });
        fire('pointermove', { x: 106, y: 105 });
        fire('pointerup', { x: 106, y: 105 });

        expect(names()).toEqual(['down', 'tap']);
        expect(calls[1][1]).toEqual({ clientX: 106, clientY: 105, pointerType: 'touch' });
        // An uncaptured tap keeps its own target, which is how a nav arrow inside the layer still gets its click.
        expect(layer.setPointerCapture).not.toHaveBeenCalled();
    });

    test('a finger that moves past the slop drags instead, with deltas from the previous move', () => {
        fire('pointerdown', { x: 100, y: 100 });
        fire('pointermove', { x: 120, y: 100 });
        fire('pointermove', { x: 125, y: 90 });
        fire('pointerup', { x: 125, y: 90 });

        expect(names()).toEqual(['down', 'dragStart', 'drag', 'drag', 'dragEnd']);
        expect(calls[2][1]).toMatchObject({ dx: 20, dy: 0 });
        expect(calls[3][1]).toMatchObject({ dx: 5, dy: -10 });
        expect(layer.setPointerCapture).toHaveBeenCalledWith(1);
        expect(layer.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    test('a pen behaves like a finger', () => {
        fire('pointerdown', { pointerType: 'pen', x: 10, y: 10 });
        fire('pointerup', { pointerType: 'pen', x: 10, y: 10 });

        expect(calls[1]).toEqual(['tap', { clientX: 10, clientY: 10, pointerType: 'pen' }]);
    });

    test('a mouse is ignored, and its pointerdown is not cancelled', () => {
        // Canvas keeps its own mouse listeners; cancelling a mouse pointerdown would also cancel focus and selection.
        const down = fire('pointerdown', { pointerType: 'mouse' });
        fire('pointerup', { pointerType: 'mouse' });

        expect(calls).toEqual([]);
        expect(down.defaultPrevented).toBe(false);
    });

    test('a touch pointerdown is cancelled, so the browser replays no mouse events from it', () => {
        expect(fire('pointerdown', {}).defaultPrevented).toBe(true);
    });

    test('mouse events right after a touch are recognised as replayed', () => {
        fire('pointerdown', {});
        fire('pointerup', {});

        expect(input.isCompatMouseEvent(new MouseEvent('mouseup'))).toBe(true);
    });

    test('mouse events with no touch before them are real', () => {
        expect(input.isCompatMouseEvent(new MouseEvent('mouseup'))).toBe(false);
    });

    test('a cancelled pointer ends the drag and never taps', () => {
        fire('pointerdown', {});
        fire('pointercancel', {});
        fire('pointerdown', { x: 50, y: 50 });
        fire('pointermove', { x: 80, y: 50 });
        fire('pointercancel', { x: 80, y: 50 });

        expect(names()).toEqual(['down', 'down', 'dragStart', 'drag', 'dragEnd']);
    });

    test('two fingers pinch: zoomDelta is log2 of the spread, and neither finger taps', () => {
        fire('pointerdown', { id: 1, x: 100, y: 100 });
        fire('pointerdown', { id: 2, x: 200, y: 100 });
        // Spread 100 → 200 is one doubling; the centroid ends where it started.
        fire('pointermove', { id: 1, x: 50, y: 100 });
        fire('pointermove', { id: 2, x: 250, y: 100 });
        fire('pointerup', { id: 2, x: 250, y: 100 });
        fire('pointerup', { id: 1, x: 50, y: 100 });

        // The finger still down after the pinch carries on as a drag, so lifting it ends one.
        expect(names()).toEqual(['down', 'down', 'pinchStart', 'pinch', 'pinch', 'pinchEnd', 'dragEnd']);
        const last = calls[4][1];
        expect(last.zoomDelta).toBeCloseTo(1);
        expect(calls[3][1].dx + last.dx).toBeCloseTo(0);
    });

    test('pinch reports the centroid moving, so two fingers can pan as they zoom', () => {
        fire('pointerdown', { id: 1, x: 100, y: 100 });
        fire('pointerdown', { id: 2, x: 200, y: 100 });
        fire('pointermove', { id: 1, x: 110, y: 120 });

        expect(calls[3][0]).toBe('pinch');
        expect(calls[3][1]).toMatchObject({ dx: 5, dy: 10 });
    });

    test('a long press is not offered the browser menu, a mouse right click still is', () => {
        fire('pointerdown', {});
        const touchMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        layer.dispatchEvent(touchMenu);
        expect(touchMenu.defaultPrevented).toBe(true);

        fire('pointerdown', { pointerType: 'mouse' });
        const mouseMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        layer.dispatchEvent(mouseMenu);
        expect(mouseMenu.defaultPrevented).toBe(false);
    });

    test('a new first finger forgets a finger whose pointerup landed elsewhere', () => {
        fire('pointerdown', { id: 1 });
        // Pointer 1's pointerup never reached the layer; the next gesture starts with a fresh primary pointer.
        fire('pointerdown', { id: 3, isPrimary: true, x: 5, y: 5 });
        fire('pointerup', { id: 3, x: 5, y: 5 });

        expect(names()).toEqual(['down', 'down', 'tap']);
    });
});
