/**
 * Tests the route-ahead chevron bitmap Explore's MinimapStyle (frontend/js/explore/navigation/MinimapStyle.js) hands
 * the minimap (#5840). The map draws it at the device pixel ratio, so a bitmap that ignored the ratio would come out
 * blurry on dense screens; and its fill is the chevron design token so it stays in sync with the legend.
 */

import { loadModules } from './loader.js';

const { MinimapStyle } = await loadModules('frontend/js/explore/navigation/MinimapStyle.js');

/**
 * A 2D context that records the fill color and the size of the bitmap read back, since jsdom has no real canvas.
 * @returns {Object} The recording context.
 */
function recordingCtx() {
  return {
    fillStyle: '',
    filled: [],
    scale: vi.fn(),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() { this.filled.push(this.fillStyle); },
    getImageData: (x, y, width, height) => ({ width, height }),
  };
}

test('the chevron is rasterized at the device pixel ratio and filled in the chevron color', () => {
  const ctx = recordingCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);

  const image = MinimapStyle.chevronImage(2);

  expect(image).toEqual({ width: 20, height: 22 });
  expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  expect(ctx.filled).toEqual([MinimapStyle.chevronColor()]);
});
