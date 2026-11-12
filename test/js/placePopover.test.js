/**
 * util.placePopover (frontend/js/common/utilities.js), which parks a popover under the button it opens from instead of
 * the middle of the window, where the browser puts it by default. Validate's admin info and the label-type picker
 * open through it. jsdom lays nothing out, so the anchor's box and the popover's size are declared here; the window
 * is jsdom's default 1024x768. (#5840)
 */

import { loadModules } from './loader.js';

const { util } = await loadModules('frontend/js/common/utilities.js');

/**
 * Renders a button and its popover, the popover sized `width` x `height` once it is laid out.
 * @param {{left: number, top: number, bottom: number}} anchorRect - Where the button sits in the window.
 * @param {object} [size] - The popover's laid-out size.
 * @param {number} [size.width=200] - Its width.
 * @param {number} [size.height=100] - Its height.
 * @param {boolean} [size.open=true] - False for a popover that is not shown yet, which has no size until it is.
 * @returns {{popover: HTMLElement, anchor: HTMLElement}} The two elements.
 */
function render(anchorRect, { width = 200, height = 100, open = true } = {}) {
  document.body.innerHTML = '<button id="anchor">Info</button><div id="pop" popover></div>';
  const anchor = document.getElementById('anchor');
  const popover = document.getElementById('pop');
  anchor.getBoundingClientRect = () => /** @type {DOMRect} */ (anchorRect);
  const laidOut = () => open || popover.style.display === 'block';
  Object.defineProperty(popover, 'offsetWidth', { get: () => (laidOut() ? width : 0) });
  Object.defineProperty(popover, 'offsetHeight', { get: () => (laidOut() ? height : 0) });
  return { popover, anchor };
}

afterEach(() => {
  document.documentElement.style.removeProperty('--ui-scale');
});

describe('util.placePopover', () => {
  test('opens just below the button, lined up with its left edge', () => {
    const { popover, anchor } = render({ left: 100, top: 50, bottom: 80 });
    util.placePopover(popover, anchor);
    expect(popover.style.left).toBe('100px');
    expect(popover.style.top).toBe('86px');
  });

  test('widens the gap with the tool\'s scale, like the rest of the tool', () => {
    document.documentElement.style.setProperty('--ui-scale', '2');
    const { popover, anchor } = render({ left: 100, top: 50, bottom: 80 });
    util.placePopover(popover, anchor);
    expect(popover.style.top).toBe('92px');
  });

  test('flips above a button near the bottom of the window', () => {
    const { popover, anchor } = render({ left: 100, top: 700, bottom: 730 });
    util.placePopover(popover, anchor);
    expect(popover.style.top).toBe(`${700 - 6 - 100}px`);
  });

  // With no room either way, below at least keeps its top edge, and the close control, on screen.
  test('stays below when there is no room above either', () => {
    const { popover, anchor } = render({ left: 100, top: 40, bottom: 70 }, { height: 720 });
    util.placePopover(popover, anchor);
    expect(popover.style.top).toBe('76px');
  });

  test('is kept inside the window\'s right edge', () => {
    const { popover, anchor } = render({ left: 950, top: 50, bottom: 80 });
    util.placePopover(popover, anchor);
    expect(popover.style.left).toBe(`${1024 - 200 - 8}px`);
  });

  test('is kept inside the window\'s left edge', () => {
    const { popover, anchor } = render({ left: -30, top: 50, bottom: 80 });
    util.placePopover(popover, anchor);
    expect(popover.style.left).toBe('8px');
  });

  // Called from `beforetoggle`, before the popover shows: it has to be measured without flashing on screen.
  test('measures a popover that is not shown yet, then hands its display back', () => {
    const { popover, anchor } = render({ left: 950, top: 700, bottom: 730 }, { open: false });
    util.placePopover(popover, anchor);
    expect(popover.style.left).toBe(`${1024 - 200 - 8}px`);
    expect(popover.style.top).toBe(`${700 - 6 - 100}px`);
    expect(popover.style.display).toBe('');
    expect(popover.style.visibility).toBe('');
  });
});
