/**
 * Tests for `util.math.floorTo` and `util.math.ceilTo` in public/js/common/utilitiesMath.js.
 *
 * Distance display rounds away from claiming a badge the user hasn't earned (#4404): progress toward a threshold is
 * truncated, and the remainder still to go is rounded up. Both directions need the same guard, because scaling by a
 * power of ten misses the intended integer for values binary floating point can't hold exactly — a naive floor turns
 * 0.29 into 0.28, and a naive ceiling turns 1.1 into 1.11.
 *
 * Runs under jsdom (jest.config.js); utilitiesMath.js is a global script assigning onto `window.util`.
 */

const fs = require('fs');
const path = require('path');

const MATH_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/utilitiesMath.js');

/** Load utilitiesMath.js (a global script hanging helpers off `window.util`) and return its rounding helpers. */
function loadMath() {
  global.window = global;
  global.util = {};
  (0, eval)(fs.readFileSync(MATH_PATH, 'utf8'));
  return global.util.math;
}

function loadFloorTo() {
  return loadMath().floorTo;
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

describe('util.math.ceilTo', () => {
  let ceilTo;

  beforeEach(() => {
    ceilTo = loadMath().ceilTo;
  });

  it('rounds a remainder up so it never reads as nothing left', () => {
    // What the dashboard's "N more miles until your next achievement" shows while the badge is still locked.
    expect(ceilTo(0.004, 2)).toBe(0.01);
    expect(ceilTo(1.002, 2)).toBe(1.01);
  });

  it('leaves values that need no rounding alone', () => {
    expect(ceilTo(1.3, 2)).toBe(1.3);
    expect(ceilTo(1, 2)).toBe(1);
    expect(ceilTo(3, 2)).toBe(3);
    expect(ceilTo(0, 2)).toBe(0);
  });

  it('is not fooled by values binary floating point cannot hold exactly', () => {
    // 1.1 * 100 is 110.00000000000001; a naive Math.ceil would report 1.11.
    expect(ceilTo(1.1, 2)).toBe(1.1);
    expect(ceilTo(2.9, 1)).toBe(2.9);
    expect(ceilTo(8.7, 1)).toBe(8.7);
  });
});
