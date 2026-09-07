/**
 * The AccessScore color ramp, read from the design tokens in main.css so every consumer — the api-docs preview maps,
 * the AccessScore tool's map layers, its histogram and legend — paints a given score the same color.
 *
 * The ramp is diverging: `--color-score-ramp-1` is the worst score, the middle step is the neutral 0.5 (a street
 * whose problems and features balance), and the last step is the best. The tokens carry the actual colors; this
 * file only reads them and interpolates, so a palette change is a one-line edit in main.css.
 *
 * Interpolation matches Mapbox GL's default `interpolate` (linear in sRGB), so a histogram bar colored with `at()`
 * agrees with the map feature it summarizes. Loaded as a plain script; the api-docs layout includes it directly and
 * the AccessScore bundle concatenates it.
 */
window.ScoreRamp = (function () {
  const TOKENS = [1, 2, 3, 4, 5].map((i) => `--color-score-ramp-${i}`);

  /** Parses a `#rrggbb` (or `#rgb`) color into [r, g, b] components 0–255. */
  function parseHex(hex) {
    const h = hex.trim().replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }

  /** Formats [r, g, b] components as `#rrggbb`. */
  function toHex([r, g, b]) {
    return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  }

  /**
   * Resolves a token to the hex it holds. Tokens alias other tokens (`var(--color-orange-600)`), and getComputedStyle
   * returns the resolved value, so the result is always a literal color.
   *
   * @param {string} token - Custom property name.
   * @returns {string} The color as written in main.css (a hex).
   */
  function readToken(token) {
    return getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  }

  /**
   * The ramp's colors, low score first.
   *
   * @returns {Array<string>} Five hex colors.
   */
  function colors() {
    return TOKENS.map(readToken);
  }

  /**
   * The color a score maps to, interpolated between the ramp's steps.
   *
   * @param {number} score - A score in [min, max]; values outside are clamped.
   * @param {object} [options] - Domain.
   * @param {number} [options.min=0] - Score mapped to the first color.
   * @param {number} [options.max=1] - Score mapped to the last color.
   * @returns {string} A hex color.
   */
  function at(score, options = {}) {
    const { min = 0, max = 1 } = options;
    const ramp = colors().map(parseHex);
    const span = max > min ? max - min : 1;
    const t = Math.min(1, Math.max(0, (score - min) / span)) * (ramp.length - 1);
    const i = Math.min(ramp.length - 2, Math.floor(t));
    const f = t - i;
    return toHex(ramp[i].map((c, k) => c + (ramp[i + 1][k] - c) * f));
  }

  /**
   * The `[value, color, value, color, …]` stop list Mapbox's `interpolate` takes, spread evenly over the domain.
   *
   * @param {object} [options] - Domain, as for `at`.
   * @returns {Array} Alternating stop values and colors.
   */
  function stops(options = {}) {
    const { min = 0, max = 1 } = options;
    const ramp = colors();
    const span = max > min ? max - min : 1;
    return ramp.flatMap((color, i) => [min + (span * i) / (ramp.length - 1), color]);
  }

  /**
   * A Mapbox paint expression that colors a feature by a score expression, with a fallback for features that have
   * no score (a null would make `interpolate` throw, so the caller's expression must already coalesce nulls to a
   * value at or below `noneAtOrBelow`).
   *
   * @param {Array} valueExpr - A Mapbox expression yielding the score, e.g. `['feature-state', 'score']` or
   *                            `['coalesce', ['get', 'score'], -1]`.
   * @param {object} options - Fallback and domain.
   * @param {string} options.noneColor - Color for features whose value is at or below `noneAtOrBelow`.
   * @param {number} [options.noneAtOrBelow=-1] - The sentinel threshold.
   * @param {number} [options.min=0] - Score mapped to the first color.
   * @param {number} [options.max=1] - Score mapped to the last color.
   * @returns {Array} A `case`/`interpolate` expression usable as `line-color` / `fill-color`.
   */
  function expression(valueExpr, options) {
    const { noneColor, noneAtOrBelow = -1, min = 0, max = 1 } = options;
    return [
      'case',
      ['<=', valueExpr, noneAtOrBelow], noneColor,
      ['interpolate', ['linear'], valueExpr, ...stops({ min, max })],
    ];
  }

  /**
   * A CSS gradient of the ramp for legends.
   *
   * @returns {string} A `linear-gradient(to right, …)` value.
   */
  function cssGradient() {
    return `linear-gradient(to right, ${colors().join(', ')})`;
  }

  return { colors, at, stops, expression, cssGradient };
})();
