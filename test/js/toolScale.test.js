/**
 * util.applyToolScale (frontend/js/common/utilities.js), which sizes Explore and Validate to the window like browser
 * zoom. The tool reads its reference size from CSS variables and writes one --ui-scale every tool dimension multiplies
 * by, so a wrong figure here misjudges the whole tool at once: it spills off a small laptop or stays tiny on a big
 * screen. jsdom lays nothing out, so the window keeps its default 1024x768 size and the tool sits at
 * the very top of the page (#5840).
 */

import { loadModules } from './loader.js';

const { util } = await loadModules('frontend/js/common/utilities.js');

/**
 * Renders the tool's holder with its base sizes, the way each tool's stylesheet declares them on .tool-ui.
 * @param {Record<string, string>} vars - CSS variable to value, e.g. `{ '--pano-base-width': '600px' }`.
 * @param {string} [overlayStyle] - The mission-start tutorial overlay's own variables, or none to leave it out.
 * @returns {{toolUI: HTMLElement, overlay: ?HTMLElement}} The holder, and the overlay when one was asked for.
 */
function renderTool(vars, overlayStyle) {
  const style = Object.entries(vars).map(([name, value]) => `${name}: ${value}`).join('; ');
  const overlay = overlayStyle === undefined
    ? '' : `<div class="mission-start-tutorial-overlay" style="${overlayStyle}"></div>`;
  document.body.innerHTML = `${overlay}<div class="tool-ui" style="${style}"></div>`;
  return {
    toolUI: document.querySelector('.tool-ui'),
    overlay: document.querySelector('.mission-start-tutorial-overlay'),
  };
}

/** Explore's boxed layout at --ui-scale = 1: 800 wide, 500 tall. */
const BOXED = { '--pano-base-width': '600px', '--sidebar-base-width': '200px', '--pano-base-height': '500px' };

afterEach(() => {
  document.documentElement.style.removeProperty('--ui-scale');
});

describe('util.applyToolScale', () => {
  test('fits the tool to the window less its side margins and the footer reserve', () => {
    const { toolUI } = renderTool(BOXED);
    // Width is the tighter fit: (1024 - 2 * 40) / 800 = 1.18, against (768 - 60) / 500 = 1.416.
    const scale = util.applyToolScale(['--pano-base-width', '--sidebar-base-width'], ['--pano-base-height']);
    expect(scale).toBeCloseTo(1.18, 10);
    expect(toolUI.style.getPropertyValue('--ui-scale')).toBe('1.1800');
    // Overlays drawn outside the tool, like the mission-complete modal, read the same scale off the root.
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.1800');
    expect(util.uiScale()).toBeCloseTo(1.18, 10);
  });

  test('stops growing at the cap a fill-window layout asks for', () => {
    renderTool({ '--pano-base-width': '200px', '--pano-base-height': '100px' });
    expect(util.applyToolScale(['--pano-base-width'], ['--pano-base-height'],
      { maxScale: 3, hMargin: 0, bottomReserve: 0 })).toBe(3);
  });

  test('never shrinks the tool past the point its text stops being readable', () => {
    renderTool({ '--pano-base-width': '4000px', '--pano-base-height': '4000px' });
    expect(util.applyToolScale(['--pano-base-width'], ['--pano-base-height'])).toBe(0.65);
  });

  // A stylesheet that failed to load leaves the variables undefined; NaN would collapse every tool dimension.
  test('leaves the tool unscaled when its base sizes are not defined', () => {
    const { toolUI } = renderTool({});
    expect(util.applyToolScale(['--pano-base-width'], ['--pano-base-height'])).toBe(1);
    expect(toolUI.style.getPropertyValue('--ui-scale')).toBe('');
    expect(util.uiScale()).toBe(1);
  });

  // The tutorial's content is wider than the tool, so a height-limited scale would push its arrow off screen.
  test('gives the mission-start tutorial a scale its wider content still fits at', () => {
    const { overlay } = renderTool(BOXED, '--mst-base-width: 1095px; --mst-h-margin: 20px');
    util.applyToolScale(['--pano-base-width', '--sidebar-base-width'], ['--pano-base-height']);
    // (1024 - 2 * 20) / 1095, under the tool's own 1.18.
    expect(overlay.style.getPropertyValue('--ui-scale')).toBe(((1024 - 40) / 1095).toFixed(4));
  });

  test('leaves the tutorial alone when its stylesheet gives it no reference width', () => {
    const { overlay } = renderTool(BOXED, '');
    util.applyToolScale(['--pano-base-width', '--sidebar-base-width'], ['--pano-base-height']);
    expect(overlay.style.getPropertyValue('--ui-scale')).toBe('');
  });
});
