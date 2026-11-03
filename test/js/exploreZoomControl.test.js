/**
 * Tests for Explore's zoom control (frontend/js/explore/zoom/ZoomControl.js, #5840): the buttons, the keyboard
 * entry points, the scroll wheel, and the gates that hold each direction at the end of its range or for the tutorial.
 * The seeded-zoom start is pinned in zoomControlSeededZoom.test.js.
 */

import { loadModules } from './loader.js';
import { fakeTracker, fakePanoManager } from './fakes.js';

describe('ZoomControl', () => {
  let control;
  let buttons;
  let layer;
  let pov;
  let panoManager;
  let canvas;
  let zoomShortcutAlert;
  let tracker;
  let povListeners;

  beforeEach(async () => {
    document.body.innerHTML = '<button id="zoom-in-button"></button><button id="zoom-out-button"></button>';
    buttons = {
      zoomIn: document.getElementById('zoom-in-button'),
      zoomOut: document.getElementById('zoom-out-button'),
    };
    layer = document.createElement('div');
    pov = { heading: 0, pitch: 0, zoom: 2 };
    povListeners = [];
    // The pano answers with whatever zoom it was last set to, the way the real one's POV follows setZoom.
    panoManager = fakePanoManager({ getPov: () => pov }, {
      setZoom: vi.fn((zoom) => { pov = { ...pov, zoom }; }),
      onPovChanged: (listener) => povListeners.push(listener),
    });
    canvas = { showLabelHoverInfo: vi.fn() };
    zoomShortcutAlert = { zoomClicked: vi.fn() };
    tracker = fakeTracker();
    const { ZoomControl } = await loadModules('frontend/js/explore/zoom/ZoomControl.js');
    control = new ZoomControl(layer, canvas, panoManager, zoomShortcutAlert, tracker);
  });

  /** Scrolls the wheel over the pano; a negative deltaY is scrolling up, which zooms in. */
  const wheel = (deltaY) => {
    const e = new WheelEvent('wheel', { deltaY, cancelable: true });
    layer.dispatchEvent(e);
    return e;
  };

  describe('the buttons', () => {
    test('zoom in steps the pano up one level, logs the click and takes the hover card down', () => {
      const zoomed = vi.fn();
      control.onZoomed(zoomed);

      buttons.zoomIn.click();

      expect(panoManager.setZoom).toHaveBeenCalledWith(3);
      expect(canvas.showLabelHoverInfo).toHaveBeenCalledWith(undefined);
      expect(tracker.push).toHaveBeenCalledWith('Click_ZoomIn');
      expect(zoomShortcutAlert.zoomClicked).toHaveBeenCalledTimes(1);
      expect(zoomed).toHaveBeenCalledWith('in');
    });

    test('zoom out steps the pano down one level', () => {
      const zoomed = vi.fn();
      control.onZoomed(zoomed);

      buttons.zoomOut.click();

      expect(panoManager.setZoom).toHaveBeenCalledWith(1);
      expect(tracker.push).toHaveBeenCalledWith('Click_ZoomOut');
      expect(zoomShortcutAlert.zoomClicked).toHaveBeenCalledTimes(1);
      expect(zoomed).toHaveBeenCalledWith('out');
    });

    test('a held button does nothing, not even log', () => {
      control.zoomInGate.hold('tutorial');
      control.zoomOutGate.hold('survey');

      buttons.zoomIn.click();
      buttons.zoomOut.click();

      expect(panoManager.setZoom).not.toHaveBeenCalled();
      expect(tracker.push).not.toHaveBeenCalled();
    });

    test('the shortcut hint stays quiet while the tutorial has a button blinking', () => {
      control.blinkZoomIn();
      buttons.zoomIn.click();
      control.blinkZoomOut();
      buttons.zoomOut.click();

      expect(zoomShortcutAlert.zoomClicked).not.toHaveBeenCalled();
      expect(panoManager.setZoom.mock.calls).toEqual([[3], [2]]);
    });

    test('show as disabled while anything holds them', () => {
      control.zoomInGate.hold('tutorial');
      expect(buttons.zoomIn.getAttribute('aria-disabled')).toBe('true');
      control.zoomInGate.release('tutorial');
      expect(buttons.zoomIn.getAttribute('aria-disabled')).toBe('false');
    });

    test('follow the view: a move to a pano at full zoom holds zoom in and frees zoom out', () => {
      pov = { ...pov, zoom: 3 };
      povListeners.forEach((listener) => listener());

      expect(control.zoomInGate.isHeld()).toBe(true);
      expect(control.zoomOutGate.isHeld()).toBe(false);
      expect(buttons.zoomIn.getAttribute('aria-disabled')).toBe('true');
    });
  });

  describe('the keyboard entry points', () => {
    test('zoomIn and zoomOut step the pano and answer with the control', () => {
      const zoomed = vi.fn();
      control.onZoomed(zoomed);

      expect(control.zoomIn()).toBe(control);
      expect(panoManager.setZoom).toHaveBeenLastCalledWith(3);
      expect(control.zoomOut()).toBe(control);
      expect(panoManager.setZoom).toHaveBeenLastCalledWith(2);
      expect(zoomed.mock.calls).toEqual([['in'], ['out']]);
    });

    test('answer false and leave the pano alone while held', () => {
      control.zoomInGate.hold('tutorial');
      control.zoomOutGate.hold('tutorial');

      expect(control.zoomIn()).toBe(false);
      expect(control.zoomOut()).toBe(false);
      expect(panoManager.setZoom).not.toHaveBeenCalled();
    });

    test('an unsubscribed listener hears no further steps', () => {
      const zoomed = vi.fn();
      const unsubscribe = control.onZoomed(zoomed);
      control.zoomIn();
      unsubscribe();

      control.zoomOut();

      expect(zoomed).toHaveBeenCalledTimes(1);
    });
  });

  describe('the scroll wheel', () => {
    beforeEach(() => vi.useFakeTimers());

    test('scrolling up zooms in a little and keeps the page from scrolling', () => {
      const e = wheel(-200);

      expect(e.defaultPrevented).toBe(true);
      expect(panoManager.setZoom.mock.calls[0][0]).toBeCloseTo(2.3, 10);
    });

    test('scrolling down zooms out, clamped to the minimum', () => {
      wheel(1000);

      expect(panoManager.setZoom).toHaveBeenCalledWith(1);
    });

    test('a gesture is logged once, after it settles, by its direction', () => {
      wheel(-100);
      wheel(-100);
      wheel(-100);
      expect(tracker.push).not.toHaveBeenCalled();

      vi.advanceTimersByTime(250);

      expect(tracker.push).toHaveBeenCalledTimes(1);
      expect(tracker.push).toHaveBeenCalledWith('Scroll_ZoomIn');
      wheel(100);
      vi.advanceTimersByTime(250);
      expect(tracker.push).toHaveBeenLastCalledWith('Scroll_ZoomOut');
    });

    test('a held direction ignores the wheel that way but not the other', () => {
      control.zoomInGate.hold('tutorial');

      wheel(-100);
      expect(panoManager.setZoom).not.toHaveBeenCalled();
      wheel(100);
      expect(panoManager.setZoom).toHaveBeenCalledTimes(1);

      control.zoomOutGate.hold('tutorial');
      wheel(100);
      expect(panoManager.setZoom).toHaveBeenCalledTimes(1);
    });
  });

  describe('blinking for the tutorial', () => {
    beforeEach(() => vi.useFakeTimers());

    test('blinkZoomIn pulses the zoom-in button until stopped', () => {
      control.blinkZoomIn();

      vi.advanceTimersByTime(500);
      expect(buttons.zoomIn.classList.contains('highlight-50')).toBe(true);
      vi.advanceTimersByTime(500);
      expect(buttons.zoomIn.classList.contains('highlight-50')).toBe(false);

      vi.advanceTimersByTime(500);
      control.stopBlinking();
      expect(buttons.zoomIn.classList.contains('highlight-50')).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(buttons.zoomIn.classList.contains('highlight-50')).toBe(false);
    });

    test('blinkZoomOut takes over from a blinking zoom-in button', () => {
      control.blinkZoomIn();
      vi.advanceTimersByTime(500);

      control.blinkZoomOut();

      expect(buttons.zoomIn.classList.contains('highlight-50')).toBe(false);
      vi.advanceTimersByTime(500);
      expect(buttons.zoomOut.classList.contains('highlight-50')).toBe(true);
      expect(buttons.zoomIn.classList.contains('highlight-50')).toBe(false);
    });
  });
});
