/**
 * The colors of an important place's marker (#5311), shared by every map that draws places so a school on a red block
 * reads the same in the AccessScore tool and the neighborhood report. A marker is a disc in the score color of its
 * nearest street, binned as AccessScore's histogram bins scores, so a marker matches the bar it would fall under; a
 * place with no scored street wears the unaudited-street gray. Its glyph is white or the marker ink, whichever
 * contrasts better: the ramp's yellow middle would swallow a white glyph.
 *
 * Kept free of any map library, so the report (MapLibre) and AccessScore (Mapbox) can both import it.
 */

import { ScoreRamp } from './scoreRamp.js';

export class PlaceMarkerColors {
  /** The no-score disc per surface: the map's unaudited-street color, so it reads as that street, not a low score. */
  static #NONE_TOKENS = Object.freeze({ light: '--color-neutral-700', dark: '--color-neutral-400' });

  /**
   * WCAG 2 relative luminance of a `#rrggbb` color.
   * @param {string} hex - The color.
   * @returns {number} Luminance in [0, 1].
   */
  static luminance(hex) {
    const h = hex.trim().replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /**
   * Which of two inks contrasts more with a disc, by WCAG contrast ratio.
   * @param {string} fill - The disc color, `#rrggbb`.
   * @param {string} light - The light ink (white).
   * @param {string} dark - The dark ink.
   * @returns {string} `light` or `dark`.
   */
  static glyphColorFor(fill, light, dark) {
    const contrast = (a, b) => {
      const [hi, lo] = [PlaceMarkerColors.luminance(a), PlaceMarkerColors.luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    return contrast(fill, light) >= contrast(fill, dark) ? light : dark;
  }

  /**
   * The disc colors per score bin, worst first, then the no-score disc. Each bin takes the ramp at its center, so a
   * marker sits between the colors of the streets at the bin's edges rather than at one of them.
   * @param {number} bins - How many score bins.
   * @param {boolean} dark - Whether the basemap is dark.
   * @returns {Array<string>} `bins + 1` hex colors.
   */
  static discColors(bins, dark) {
    const mode = dark ? 'dark' : 'light';
    const ramp = Array.from({ length: bins }, (_, i) => ScoreRamp.at((i + 0.5) / bins, { mode }));
    return [...ramp, PlaceMarkerColors.#token(PlaceMarkerColors.#NONE_TOKENS[mode])];
  }

  /**
   * One marker's colors, for a map that draws markers one at a time rather than per bin.
   * @param {?number} score - The nearest street's score in [0, 1], or null when it has none.
   * @param {number} bins - How many score bins, AccessScore's histogram's.
   * @returns {{fill: string, glyph: string, halo: string}} The disc, the glyph's ink, and the ring around the disc.
   */
  static forScore(score, bins) {
    const fills = PlaceMarkerColors.discColors(bins, false);
    const fill = score === null || score === undefined || !Number.isFinite(score)
      ? fills[bins]
      : fills[Math.min(bins - 1, Math.max(0, Math.floor(score * bins)))];
    const glyph = PlaceMarkerColors.glyphColorFor(
      fill, PlaceMarkerColors.#token('--color-neutral-white'), PlaceMarkerColors.#token('--color-place-marker'),
    );
    return { fill, glyph, halo: PlaceMarkerColors.#token('--color-place-marker-halo') };
  }

  /** A main.css color token's value. */
  static #token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
}
