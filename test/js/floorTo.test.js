/**
 * Tests for `util.math.floorTo` in public/js/common/utilitiesMath.js.
 *
 * Progress toward a badge is displayed truncated, not rounded, so a total never reads as a threshold the user hasn't
 * crossed — the Explore sidebar's audited distance and its badge progress row are the same number and must agree
 * (#4404). These pin the truncation itself and the binary-floating-point guard: scaling by a power of ten lands just
 * under the intended integer for many decimals, so a naive floor turns 0.29 into 0.28.
 *
 * Runs under jsdom (jest.config.js); utilitiesMath.js is a global script assigning onto `window.util`.
 */

const fs = require('fs');
const path = require('path');

const MATH_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/utilitiesMath.js');

/** Load utilitiesMath.js (a global script hanging helpers off `window.util`) and return `util.math.floorTo`. */
function loadFloorTo() {
  global.window = global;
  global.util = {};
  (0, eval)(fs.readFileSync(MATH_PATH, 'utf8'));
  return global.util.math.floorTo;
}

describe('util.math.floorTo', () => {
  let floorTo;

  beforeEach(() => {
    floorTo = loadFloorTo();
  });

  it('truncates rather than rounding, so a total never overstates progress', () => {
    // The case that made the sidebar disagree with itself: rounding showed 16.5 beside a 16.4 badge row.
    expect(floorTo(16.45, 1)).toBe(16.4);
    expect(floorTo(16.99, 1)).toBe(16.9);
    expect(floorTo(16.449, 2)).toBe(16.44);
  });

  it('leaves values that need no truncation alone', () => {
    expect(floorTo(16.5, 1)).toBe(16.5);
    expect(floorTo(17.7, 1)).toBe(17.7);
    expect(floorTo(0, 1)).toBe(0);
    expect(floorTo(12, 0)).toBe(12);
  });

  it('is not fooled by values binary floating point cannot hold exactly', () => {
    // 0.29 * 100 is 28.999999999999996; a naive Math.floor would report 0.28.
    expect(floorTo(0.29, 2)).toBe(0.29);
    expect(floorTo(1.005, 2)).toBe(1);
    expect(floorTo(8.7, 1)).toBe(8.7);
  });

  // The same total is floored here and by CommonUtils.floorTo on the server, so the two must land on the same value
  // for every input, not just the ones far from a boundary. Mirrored in test/models/utils/FloorToSpec.scala.
  it('truncates a value just shy of a boundary rather than absorbing it', () => {
    expect(floorTo(1.999999999, 1)).toBe(1.9);
    expect(floorTo(1.9999999, 1)).toBe(1.9);
  });
});
