/**
 * PanoMarker (frontend/js/common/PanoMarker.js), the label marker over a pano in Validate and on the label detail
 * card: an element pinned to a heading and pitch that follows the view as the user pans, parks itself off screen
 * when the label is behind the camera, and lets go of its listeners when removed, since a marker is rebuilt per
 * label and leaked listeners keep redrawing dead ones (#4231). The projection math is panoUtilities.js's and has
 * its own suite; here it is a stand-in that reports what it was asked. (#5840)
 */

import { loadModules, useUtil } from './loader.js';

/** The 2d projection's answer, in the container's pixels. */
const PROJECTED = { x: 300, y: 120 };

let PanoMarker;
let pano;
let container;
let viewer;

/**
 * A pano viewer whose POV a test can change, firing pov_changed the way the real viewers do.
 * @returns {object} The viewer, with `turnTo(pov)` to pan it.
 */
function fakeViewer() {
  const listeners = new Set();
  let pov = { heading: 90, pitch: 0, zoom: 1 };
  return {
    getPov: () => pov,
    getViewerType: () => 'gsv',
    addListener: vi.fn((event, listener) => listeners.add(listener)),
    removeListener: vi.fn((event, listener) => listeners.delete(listener)),
    turnTo(next) {
      pov = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Builds a marker the way Validate's PanoManager does, with any option replaced.
 * @param {object} [overrides] - Options to add or replace.
 * @returns {PanoMarker} The marker.
 */
const build = (overrides = {}) => new PanoMarker({
  panoViewer: viewer,
  markerContainer: container,
  position: { heading: 95, pitch: -10 },
  size: { width: 22, height: 22 },
  ...overrides,
});

beforeEach(async () => {
  // jsdom has no canvas contexts; a browser without WebGL answers null the same way.
  HTMLCanvasElement.prototype.getContext = () => null;
  ({ PanoMarker } = await loadModules('frontend/js/common/PanoMarker.js'));
  pano = {
    centeredPovToCanvasCoord2d: vi.fn(() => PROJECTED),
    centeredPovToCanvasCoord: vi.fn(() => PROJECTED),
    renderedHFov: () => 60,
  };
  useUtil({ pano });
  container = document.createElement('div');
  document.body.replaceChildren(container);
  Object.defineProperty(container, 'offsetWidth', { value: 720 });
  Object.defineProperty(container, 'offsetHeight', { value: 480 });
  viewer = fakeViewer();
});

describe('PanoMarker', () => {
  test('adds a marker element centered on its spot in the view', () => {
    const marker = build({ id: 'validate-pano-marker', zIndex: 2 });
    const el = container.querySelector('#validate-pano-marker');
    expect(el).toBe(marker.marker_);
    expect(el.classList).toContain('label-marker');
    expect(el.style.left).toBe(`${300 - 11}px`);
    expect(el.style.top).toBe(`${120 - 11}px`);
    expect(el.style.width).toBe('22px');
    // The pulse halo sizes itself off this rather than a fixed px.
    expect(el.style.getPropertyValue('--marker-diameter')).toBe('22px');
    expect(el.style.zIndex).toBe('2');
    expect(el.style.display).toBe('block');
  });

  test('shows the label\'s icon, stacked at the bottom unless told otherwise', () => {
    const marker = build({ icon: '/assets/images/icons/label_type_icons/CurbRamp_small.svg' });
    expect(marker.marker_.style.getPropertyValue('--label-icon'))
      .toBe('url(/assets/images/icons/label_type_icons/CurbRamp_small.svg)');
    expect(marker.marker_.style.zIndex).toBe('1');
    expect(marker.marker_.id).toBe('');
  });

  test('uses the 3d projection when the browser has WebGL', () => {
    HTMLCanvasElement.prototype.getContext = (type) => (type === 'webgl' ? {} : null);
    build();
    expect(pano.centeredPovToCanvasCoord).toHaveBeenCalled();
    expect(pano.centeredPovToCanvasCoord2d).not.toHaveBeenCalled();
  });

  test('follows the view as the user pans, and tells whatever hangs off it', () => {
    const onDraw = vi.fn();
    const marker = build({ onDraw });
    pano.centeredPovToCanvasCoord2d.mockReturnValue({ x: 100, y: 200 });
    viewer.turnTo({ heading: 80, pitch: 0, zoom: 1 });
    expect(pano.centeredPovToCanvasCoord2d).toHaveBeenLastCalledWith(
      { heading: 95, pitch: -10 }, { heading: 80, pitch: 0, zoom: 1 }, 720, 480, 22, 60);
    expect(marker.marker_.style.left).toBe(`${100 - 11}px`);
    expect(onDraw).toHaveBeenCalledTimes(2);
  });

  test('redraws when the window is resized', () => {
    const marker = build();
    pano.centeredPovToCanvasCoord2d.mockReturnValue({ x: 50, y: 60 });
    window.dispatchEvent(new Event('resize'));
    expect(marker.marker_.style.top).toBe(`${60 - 11}px`);
  });

  test('parks itself out of sight while the label is behind the camera', () => {
    pano.centeredPovToCanvasCoord2d.mockReturnValue(null);
    const marker = build();
    expect(marker.marker_.style.left).toBe(`${-(9999 + 22)}px`);
    expect(marker.marker_.style.top).toBe('0px');
  });

  test('moves to a new spot', () => {
    const marker = build();
    pano.centeredPovToCanvasCoord2d.mockReturnValue({ x: 400, y: 240 });
    marker.setPosition({ heading: 120, pitch: 0 });
    expect(pano.centeredPovToCanvasCoord2d).toHaveBeenLastCalledWith(
      { heading: 120, pitch: 0 }, expect.any(Object), 720, 480, 22, 60);
    expect(marker.marker_.style.left).toBe(`${400 - 11}px`);
  });

  test('resizes around the same spot when the tool scales', () => {
    const marker = build();
    marker.setSize({ width: 30, height: 30 });
    expect(marker.marker_.style.width).toBe('30px');
    expect(marker.marker_.style.height).toBe('30px');
    expect(marker.marker_.style.getPropertyValue('--marker-diameter')).toBe('30px');
    expect(marker.marker_.style.left).toBe(`${300 - 15}px`);
  });

  test('swaps its icon when the label\'s type changes', () => {
    const marker = build({ icon: '/assets/a.svg' });
    marker.setIcon('/assets/b.svg');
    expect(marker.marker_.style.getPropertyValue('--label-icon')).toBe('url(/assets/b.svg)');
  });

  test('hides and shows', () => {
    const marker = build();
    marker.setVisible(false);
    expect(marker.marker_.style.display).toBe('none');
    marker.setVisible(true);
    expect(marker.marker_.style.display).toBe('block');
  });

  test('when removed, leaves the page and stops listening for pans and resizes', () => {
    const marker = build();
    const el = marker.marker_;
    marker.removeMarker();
    expect(container.contains(el)).toBe(false);
    expect(marker.marker_).toBeNull();
    expect(viewer.removeListener).toHaveBeenCalledWith('pov_changed', viewer.addListener.mock.calls[0][1]);
    const draws = pano.centeredPovToCanvasCoord2d.mock.calls.length;
    viewer.turnTo({ heading: 0, pitch: 0, zoom: 1 });
    window.dispatchEvent(new Event('resize'));
    expect(pano.centeredPovToCanvasCoord2d).toHaveBeenCalledTimes(draws);
  });
});
