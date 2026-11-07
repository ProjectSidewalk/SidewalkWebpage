/**
 * Validate's drag-to-pan layer (frontend/js/validate/panorama/PanoOverlay.js): dragging over the pano turns the live
 * viewer, swaps the hand cursor, and takes the label card down, while a press on the card's Hide-label button is left
 * alone so the click lands (#5840).
 */

import { loadModules } from './loader.js';
import { fakePanoManager } from './fakes.js';

describe('Validate PanoOverlay', () => {
  let layer;
  let hideButton;
  let viewer;
  let labelVisibilityControl;
  let panoLoaded;

  beforeEach(async () => {
    // Cut down from validate.scala.html: the hide button sits inside the label card inside the pano holder.
    document.body.innerHTML = `
      <div id="view-control-layer">
        <div class="label-hover-card"><button type="button" id="label-visibility-button-on-label"></button></div>
      </div>`;
    layer = document.getElementById('view-control-layer');
    hideButton = document.getElementById('label-visibility-button-on-label');
    let pov = { heading: 100, pitch: 0, zoom: 1 };
    viewer = { getPov: () => ({ ...pov }), setPov: vi.fn((next) => { pov = next; }) };
    labelVisibilityControl = { hideLabelCard: vi.fn() };
    panoLoaded = true;
    const panoManager = fakePanoManager(viewer, { getProperty: (key) => (key === 'panoLoaded' ? panoLoaded : null) });
    const { PanoOverlay } = await loadModules('frontend/js/validate/panorama/PanoOverlay.js');
    new PanoOverlay(layer, labelVisibilityControl, panoManager);
  });

  /**
   * Fires a mouse event on the layer (or on an element inside it) at a point on screen.
   * @param {string} type - The event, e.g. 'mousedown'.
   * @param {number} x - Pixels from the layer's left edge (jsdom puts the layer at 0, 0).
   * @param {number} y - Pixels from the layer's top edge.
   * @param {Element} [target] - Where the event starts; it bubbles up to the layer.
   */
  const mouse = (type, x, y, target = layer) => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  };

  it('turns the pano by the drag, scaled down at zoom 1', () => {
    mouse('mousedown', 100, 100);
    mouse('mousemove', 140, 80);
    // 40px right and 20px up at zoom 1: each pixel is 1/2 * 0.375 * 0.5 of a degree.
    expect(viewer.setPov).toHaveBeenCalledTimes(1);
    expect(viewer.setPov.mock.calls[0][0]).toEqual({ heading: 100 - 3.75, pitch: -1.875, zoom: 1 });
  });

  it('turns the pano less per pixel when zoomed in', () => {
    viewer.setPov({ heading: 100, pitch: 0, zoom: 2 });
    viewer.setPov.mockClear();
    mouse('mousedown', 100, 100);
    mouse('mousemove', 140, 100);
    expect(viewer.setPov.mock.calls[0][0].heading).toBeCloseTo(100 - 1.875);
  });

  it('measures each move from the last one, not from where the drag began', () => {
    mouse('mousedown', 0, 0);
    mouse('mousemove', 40, 0);
    mouse('mousemove', 80, 0);
    expect(viewer.setPov.mock.calls[1][0].heading).toBeCloseTo(100 - 7.5);
  });

  it('shows the closed hand and takes the label card down while dragging, the open hand after', () => {
    mouse('mousedown', 10, 10);
    expect(layer.style.cursor).toContain('closedhand.cur');
    expect(labelVisibilityControl.hideLabelCard).toHaveBeenCalledTimes(1);

    mouse('mouseup', 10, 10);
    expect(layer.style.cursor).toContain('openhand.cur');
    mouse('mousemove', 50, 10);
    expect(viewer.setPov).not.toHaveBeenCalled();
  });

  it('ends the drag when the pointer leaves the pano', () => {
    mouse('mousedown', 10, 10);
    layer.dispatchEvent(new MouseEvent('mouseleave'));
    expect(layer.style.cursor).toContain('openhand.cur');
    mouse('mousemove', 50, 10);
    expect(viewer.setPov).not.toHaveBeenCalled();
  });

  it('does not move the pano when the pointer only hovers', () => {
    mouse('mousemove', 10, 10);
    mouse('mousemove', 50, 10);
    expect(viewer.setPov).not.toHaveBeenCalled();
  });

  it('leaves a press on the Hide-label button alone so its click still toggles the label (#4521)', () => {
    mouse('mousedown', 10, 10, hideButton);
    expect(labelVisibilityControl.hideLabelCard).not.toHaveBeenCalled();
    expect(layer.style.cursor).toBe('');
    mouse('mousemove', 50, 10);
    expect(viewer.setPov).not.toHaveBeenCalled();
  });

  it('does not pan before the pano has loaded', () => {
    panoLoaded = false;
    mouse('mousedown', 0, 0);
    mouse('mousemove', 40, 0);
    expect(viewer.setPov).not.toHaveBeenCalled();
  });
});
