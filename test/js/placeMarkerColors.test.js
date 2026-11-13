/**
 * Tests for PlaceMarkerColors (frontend/js/common/PlaceMarkerColors.js, #5311): the colors an important place's
 * marker wears on every map that draws places, AccessScore's and the neighborhood report's (#5876), so one place reads
 * the same on both. Tokens are set on the root element, as main.css sets them in the browser.
 */

import { loadModules } from './loader.js';

const { PlaceMarkerColors } = await loadModules('frontend/js/common/PlaceMarkerColors.js');

const RAMP = ['#a74d32', '#eb724e', '#c2c2c2', '#62c0ac', '#5f9e7b'];
const TOKENS = {
  '--color-neutral-white': '#ffffff',
  '--color-place-marker': '#2b2b2b',
  '--color-place-marker-halo': '#ffffff',
  '--color-neutral-700': '#6b6b6b',
  '--color-neutral-400': '#c2c2c2',
};

describe('PlaceMarkerColors', () => {
  beforeAll(() => {
    RAMP.forEach((hex, i) => document.documentElement.style.setProperty(`--color-score-ramp-${i + 1}`, hex));
    Object.entries(TOKENS).forEach(([name, hex]) => document.documentElement.style.setProperty(name, hex));
  });

  it('colors a marker by its street score\'s bin, as the AccessScore histogram bins it', () => {
    const discs = PlaceMarkerColors.discColors(10, false);
    expect(PlaceMarkerColors.forScore(0.07, 10).fill).toBe(discs[0]);
    expect(PlaceMarkerColors.forScore(0.55, 10).fill).toBe(discs[5]);
    // A perfect score falls in the top bin, not one past it.
    expect(PlaceMarkerColors.forScore(1, 10).fill).toBe(discs[9]);
  });

  it('gives a place with no scored street the unaudited gray, not a low score\'s color', () => {
    expect(PlaceMarkerColors.forScore(null, 10).fill).toBe(TOKENS['--color-neutral-700']);
    expect(PlaceMarkerColors.discColors(10, true).at(-1)).toBe(TOKENS['--color-neutral-400']);
  });

  it('inks the glyph white on a dark disc and dark on a light one', () => {
    expect(PlaceMarkerColors.glyphColorFor('#a74d32', '#ffffff', '#2b2b2b')).toBe('#ffffff');
    expect(PlaceMarkerColors.glyphColorFor('#c2c2c2', '#ffffff', '#2b2b2b')).toBe('#2b2b2b');
    expect(PlaceMarkerColors.forScore(0.5, 10).halo).toBe('#ffffff');
  });

  it('measures luminance the WCAG way, near-black steps and three-digit colors included', () => {
    expect(PlaceMarkerColors.luminance('#fff')).toBeCloseTo(1, 10);
    expect(PlaceMarkerColors.luminance('#000000')).toBe(0);
    // A channel this dark sits on the curve's straight foot: 8/255 / 12.92, weighted for green.
    expect(PlaceMarkerColors.luminance('#000800')).toBeCloseTo(0.7152 * (8 / 255 / 12.92), 10);
  });
});
