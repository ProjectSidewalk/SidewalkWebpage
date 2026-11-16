/**
 * The map credit links set up by frontend/js/common/mapboxgl.js open in a new tab, so following one doesn't throw away
 * a half-built route or a filtered map (#5856). Mapbox rebuilds its attribution and drops any `target` on the way, so
 * the module sets it as each link is clicked; this runs the real module against the real mapbox-gl build. (#5840)
 */

import { loadModules } from './loader.js';

await loadModules('frontend/js/common/mapboxgl.js');

beforeEach(() => {
  document.body.innerHTML = `
    <div class="mapboxgl-ctrl-attrib">
      <a href="https://www.mapbox.com/about/maps/">© Mapbox</a>
    </div>
    <a id="elsewhere" href="/explore">Start exploring</a>`;
});

/**
 * Clicks an element the way a reader does, without letting jsdom try to navigate.
 * @param {EventTarget} target - What is clicked.
 */
const click = (target) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  // Cancelled at the window, after the module's document listener has seen it.
  window.addEventListener('click', (e) => e.preventDefault(), { once: true });
  target.dispatchEvent(event);
};

describe('map credit links', () => {
  test('open in a new tab', () => {
    const credit = document.querySelector('.mapboxgl-ctrl-attrib a');
    click(credit);
    expect(credit.target).toBe('_blank');
  });

  test('leave every other link on the page alone', () => {
    const link = document.getElementById('elsewhere');
    click(link);
    expect(link.target).toBe('');
  });

  test('ignore a click that lands on no element', () => {
    expect(() => click(document)).not.toThrow();
  });
});
