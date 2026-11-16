/**
 * Validate's zoom: the desktop buttons, Z keys and wheel/trackpad (frontend/js/validate/zoom/ZoomControl.js), and the
 * phone's pinch logging (frontend/js/validate/zoom/PinchZoomDetector.js). Both are judged by what the validator sees
 * (the pano's zoom, the buttons greyed out at the ends of the range) and what lands in the interaction log (#5840).
 */

import { loadModules } from './loader.js';
import { fakePanoManager, fakeTracker } from './fakes.js';

/**
 * A viewer whose zoom the manager's setZoom writes and getPov reads back, the way PanoManager forwards both.
 * @param {number} zoom - Where the pano opens.
 * @param {string} [viewerType] - What getViewerType answers.
 * @returns {{viewer: object, panoManager: object, zoomChanged: () => void}} The viewer, a manager over it, and a call
 *   that fires the Google pano's 'zoom_changed' listener (a no-op when none was added).
 */
function zoomableViewer(zoom, viewerType = 'gsv') {
  let current = zoom;
  let onZoomChanged = () => {};
  const viewer = {
    getPov: () => ({ heading: 0, pitch: 0, zoom: current }),
    getViewerType: () => viewerType,
    gsvPano: { addListener: vi.fn((event, callback) => { if (event === 'zoom_changed') onZoomChanged = callback; }) },
  };
  const panoManager = fakePanoManager(viewer, { setZoom: vi.fn((next) => { current = next; }) });
  return { viewer, panoManager, zoomChanged: () => onZoomChanged() };
}

describe('Validate ZoomControl', () => {
  let ZoomControl;
  let zoomIn;
  let zoomOut;
  let layer;
  let tracker;

  beforeEach(async () => {
    // Cut down from validate.scala.html's zoom stack and pano holder.
    document.body.innerHTML = `
      <div id="view-control-layer"></div>
      <button type="button" id="zoom-in-button"></button>
      <button type="button" id="zoom-out-button"></button>`;
    zoomIn = document.getElementById('zoom-in-button');
    zoomOut = document.getElementById('zoom-out-button');
    layer = document.getElementById('view-control-layer');
    tracker = fakeTracker();
    ({ ZoomControl } = await loadModules('frontend/js/validate/zoom/ZoomControl.js'));
  });

  /**
   * @param {number} zoom - Where the pano opens.
   * @returns {{control: object, panoManager: object}} A control over a pano at that zoom, and its manager.
   */
  const build = (zoom) => {
    const { panoManager } = zoomableViewer(zoom);
    const ui = { status: { zoomInButton: zoomIn, zoomOutButton: zoomOut }, viewer: { controlLayer: layer } };
    return { control: new ZoomControl(ui, panoManager, tracker), panoManager };
  };

  /**
   * Scrolls the wheel over the pano.
   * @param {number} deltaY - Negative scrolls up (zooms in).
   * @param {boolean} [ctrlKey] - True for a trackpad pinch, which browsers report as a wheel with Ctrl held.
   * @returns {WheelEvent} The event, to check whether the page scroll was stopped.
   */
  const wheel = (deltaY, ctrlKey = false) => {
    const event = new WheelEvent('wheel', { deltaY, ctrlKey, cancelable: true });
    layer.dispatchEvent(event);
    return event;
  };

  it('zooms in a level per click, logs it, and greys the button out at the closest level', () => {
    const { panoManager } = build(1);
    zoomIn.click();
    expect(panoManager.getPov().zoom).toBe(2);
    expect(tracker.push).toHaveBeenCalledWith('Click_ZoomIn');
    zoomIn.click();
    expect(panoManager.getPov().zoom).toBe(3);
    expect(zoomIn.getAttribute('aria-disabled')).toBe('true');
    expect(zoomOut.getAttribute('aria-disabled')).toBe('false');
  });

  it('ignores a click on a greyed-out zoom-in button', () => {
    const { panoManager, control } = build(3);
    control.updateZoomAvailability();
    zoomIn.click();
    expect(panoManager.setZoom).not.toHaveBeenCalled();
    expect(tracker.push).not.toHaveBeenCalled();
  });

  it('ignores a click on a greyed-out zoom-out button', () => {
    const { panoManager, control } = build(1);
    control.updateZoomAvailability();
    zoomOut.click();
    expect(panoManager.setZoom).not.toHaveBeenCalled();
    expect(tracker.push).not.toHaveBeenCalled();
  });

  it('zooms out a level per click, logs it, and greys the button out at the widest level', () => {
    const { panoManager } = build(3);
    zoomOut.click();
    expect(panoManager.getPov().zoom).toBe(2);
    expect(tracker.push).toHaveBeenCalledWith('Click_ZoomOut');
    zoomOut.click();
    expect(panoManager.getPov().zoom).toBe(1);
    expect(zoomOut.getAttribute('aria-disabled')).toBe('true');
    expect(zoomIn.getAttribute('aria-disabled')).toBe('false');
  });

  it('snaps an in-between wheel zoom to the nearest level before stepping with the keys', () => {
    const { control, panoManager } = build(1.6);
    control.zoomIn();
    expect(panoManager.getPov().zoom).toBe(3);
    const other = build(2.4);
    other.control.zoomOut();
    expect(other.panoManager.getPov().zoom).toBe(1);
  });

  it('stays put when a key asks for a level past either end', () => {
    const high = build(3);
    high.control.zoomIn();
    expect(high.panoManager.setZoom).not.toHaveBeenCalled();
    const low = build(1);
    low.control.zoomOut();
    expect(low.panoManager.setZoom).not.toHaveBeenCalled();
  });

  describe('the wheel', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('zooms in on scroll up, stops the page scrolling, and logs one entry per gesture', () => {
      const { panoManager } = build(1);
      const event = wheel(-200);
      wheel(-200);
      expect(event.defaultPrevented).toBe(true);
      expect(panoManager.getPov().zoom).toBeCloseTo(1.6);
      expect(tracker.push).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      expect(tracker.push.mock.calls).toEqual([['Scroll_ZoomIn']]);
    });

    it('zooms out on scroll down and logs it as a zoom out', () => {
      const { panoManager } = build(2);
      wheel(200);
      expect(panoManager.getPov().zoom).toBeCloseTo(1.7);
      vi.advanceTimersByTime(250);
      expect(tracker.push).toHaveBeenCalledWith('Scroll_ZoomOut');
    });

    it('moves a trackpad pinch about a level per gesture (#5729)', () => {
      const { panoManager } = build(1);
      wheel(-140, true);
      expect(panoManager.getPov().zoom).toBeCloseTo(1.98);
    });

    it('keeps the zoom within levels 1 to 3 and greys out the button at the end it reached', () => {
      const { panoManager } = build(2);
      wheel(-5000);
      expect(panoManager.getPov().zoom).toBe(3);
      expect(zoomIn.getAttribute('aria-disabled')).toBe('true');
      wheel(5000);
      expect(panoManager.getPov().zoom).toBe(1);
      expect(zoomOut.getAttribute('aria-disabled')).toBe('true');
    });
  });
});

describe('Validate PinchZoomDetector', () => {
  let PinchZoomDetector;
  let screen;
  let tracker;

  beforeEach(async () => {
    // Cut down from mobileValidate.scala.html.
    document.body.innerHTML = '<div id="svv-panorama"></div>';
    screen = document.getElementById('svv-panorama');
    tracker = fakeTracker();
    ({ PinchZoomDetector } = await loadModules('frontend/js/validate/zoom/PinchZoomDetector.js'));
  });

  /**
   * Fires a touch event on the pano with this many fingers on the glass.
   * @param {string} type - 'touchstart' or 'touchend'.
   * @param {number} fingers - How many touches are still down.
   */
  const touch = (type, fingers) => {
    const event = new Event(type);
    Object.defineProperty(event, 'touches', { value: { length: fingers } });
    screen.dispatchEvent(event);
  };

  /**
   * @param {number} zoom - Where the pano opens.
   * @returns {{panoManager: object, zoomChanged: () => void}} A detector's manager, and the Google zoom listener.
   */
  const build = (zoom) => {
    const { panoManager, zoomChanged } = zoomableViewer(zoom);
    new PinchZoomDetector(panoManager, tracker);
    return { panoManager, zoomChanged };
  };

  /**
   * Moves the pano's zoom the way a pinch does, then lets the Google pano report it.
   * @param {{panoManager: object, zoomChanged: () => void}} pano - From `build`.
   * @param {number} zoom - The new zoom.
   */
  const pinchTo = (pano, zoom) => {
    pano.panoManager.setZoom(zoom);
    pano.zoomChanged();
  };

  it('logs the start and end of a two-finger zoom in', () => {
    const pano = build(1);
    touch('touchstart', 2);
    pinchTo(pano, 1.5);
    pinchTo(pano, 2);
    touch('touchend', 1);
    expect(tracker.push.mock.calls).toEqual([['Pinch_ZoomIn_Start'], ['Pinch_ZoomIn_End']]);
  });

  it('logs a zoom out, and closes one direction before opening the other when the pinch reverses', () => {
    const pano = build(2);
    touch('touchstart', 2);
    pinchTo(pano, 1.5);
    pinchTo(pano, 1.3);
    pinchTo(pano, 1.8);
    pinchTo(pano, 1.2);
    touch('touchend', 0);
    expect(tracker.push.mock.calls).toEqual([
      ['Pinch_ZoomOut_Start'], ['Pinch_ZoomOut_End'], ['Pinch_ZoomIn_Start'], ['Pinch_ZoomIn_End'],
      ['Pinch_ZoomOut_Start'], ['Pinch_ZoomOut_End'],
    ]);
  });

  it('logs nothing for a zoom that was not a pinch, or a pinch that did not change the zoom', () => {
    const pano = build(1);
    touch('touchstart', 1);
    pinchTo(pano, 2);
    touch('touchend', 0);
    touch('touchstart', 2);
    pinchTo(pano, 2);
    touch('touchend', 0);
    expect(tracker.push).not.toHaveBeenCalled();
  });

  it('logs nothing past the most zoomed-in level Google allows a pinch to log', () => {
    const pano = build(4);
    touch('touchstart', 2);
    pinchTo(pano, 4.5);
    touch('touchend', 0);
    expect(tracker.push).not.toHaveBeenCalled();
  });

  it('keeps the pinch going while two fingers are still down', () => {
    const pano = build(1);
    touch('touchstart', 3);
    pinchTo(pano, 2);
    touch('touchend', 2);
    expect(tracker.push.mock.calls).toEqual([['Pinch_ZoomIn_Start']]);
    touch('touchend', 1);
    touch('touchend', 0);
    expect(tracker.push.mock.calls).toEqual([['Pinch_ZoomIn_Start'], ['Pinch_ZoomIn_End']]);
  });

  it('does not listen for Google zoom changes on a viewer that is not Google Street View', () => {
    const { viewer, panoManager } = zoomableViewer(1, 'mapillary');
    new PinchZoomDetector(panoManager, tracker);
    expect(viewer.gsvPano.addListener).not.toHaveBeenCalled();
  });
});
