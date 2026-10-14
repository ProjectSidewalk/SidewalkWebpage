/**
 * Explore's zoom buttons start from the zoom the pano opened at (frontend/js/explore/zoom/ZoomControl.js): a label
 * card's "Explore here" hop seeds a zoomed-in view before the control exists, so no view change tells it (#4637).
 */

import { loadModules } from './loader.js';
import { fakeTracker, fakePanoManager } from './fakes.js';

describe('ZoomControl at a seeded zoom', () => {
  let ZoomControl;
  let buttons;

  beforeEach(async () => {
    document.body.innerHTML = '<button id="zoom-in-button"></button><button id="zoom-out-button"></button>';
    buttons = { zoomIn: document.getElementById('zoom-in-button'), zoomOut: document.getElementById('zoom-out-button') };
    ({ ZoomControl } = await loadModules('frontend/js/explore/zoom/ZoomControl.js'));
  });

  const build = (zoom) => new ZoomControl(document.createElement('div'), { showLabelHoverInfo: vi.fn() },
    fakePanoManager({ getPov: () => ({ heading: 0, pitch: 0, zoom }) }, { setZoom: vi.fn() }),
    { zoomClicked: vi.fn() }, fakeTracker());

  it('lets the labeler zoom back out when the pano opened zoomed in', () => {
    const control = build(2);
    expect(control.zoomOutGate.isHeld()).toBe(false);
    expect(buttons.zoomOut.getAttribute('aria-disabled')).toBe('false');
    expect(buttons.zoomIn.getAttribute('aria-disabled')).toBe('false');
  });

  it('holds the button at the end of the range the pano opened at', () => {
    const control = build(1);
    expect(control.zoomOutGate.isHeld()).toBe(true);
    expect(buttons.zoomOut.getAttribute('aria-disabled')).toBe('true');
    expect(build(3).zoomInGate.isHeld()).toBe(true);
  });
});
