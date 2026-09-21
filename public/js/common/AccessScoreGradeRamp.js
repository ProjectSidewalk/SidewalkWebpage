/**
 * The street-slope color ramp (#5223), read from the `--color-grade-ramp-*` tokens in main.css so the map's lines,
 * the legend's swatches and the elevation profile's threshold lines agree on what a color means.
 *
 * Unlike the score ramp this one is classed, not interpolated: the breaks between classes are limits a reader can
 * look up (1:20, 1:12), so a street is on one side of a limit or the other and the color says which. The breaks come
 * from `/v3/api/accessScoreConfig` (`gradient.map_class_breaks`); nothing here knows a grade.
 */
class AccessScoreGradeRamp {
  /** How many color tokens main.css defines per surface, gentlest first. */
  static #STEPS = 5;

  /**
   * One color per class, gentlest first. With fewer classes than tokens the picks are spread over the whole ramp,
   * so the steepest class is always the ramp's last color.
   * @param {number} classCount - How many classes the breaks make (breaks + 1).
   * @param {string} [mode='light'] - 'light' or 'dark', the basemap the colors are stepped for.
   * @returns {string[]} A hex color per class.
   */
  static colors(classCount, mode = 'light') {
    // More classes than tokens would hand two neighbors one color, on a scale whose colors exist to tell a street's
    // class apart. The breaks are the backend's, so this can only happen by adding one there without a token here.
    if (classCount > AccessScoreGradeRamp.#STEPS) {
      console.warn(`AccessScoreGradeRamp: ${classCount} slope classes share ${AccessScoreGradeRamp.#STEPS} colors`);
    }
    const style = getComputedStyle(document.documentElement);
    const last = AccessScoreGradeRamp.#STEPS - 1;
    return Array.from({ length: classCount }, (_, i) => {
      const step = classCount === 1 ? last : Math.round((i * last) / (classCount - 1));
      return style.getPropertyValue(`--color-grade-ramp${mode === 'dark' ? '-dark' : ''}-${step + 1}`).trim();
    });
  }

  /**
   * A Mapbox paint expression that colors a feature by its grade, with a fallback for a feature that has none.
   * @param {Array} valueExpr - An expression yielding the grade, with "no grade" already coalesced to a negative.
   * @param {number[]} breaks - The ascending class breaks.
   * @param {{noneColor: string, mode?: string}} options - The fallback color, and the basemap.
   * @returns {Array} A `case`/`step` expression usable as `line-color`.
   */
  static expression(valueExpr, breaks, { noneColor, mode = 'light' }) {
    const colors = AccessScoreGradeRamp.colors(breaks.length + 1, mode);
    // A street exactly at a limit is within it ("not steeper than 1:20"), but `step` puts a value equal to a stop in
    // the class above. The smallest representable nudge moves each stop just past its limit.
    const stops = breaks.flatMap((b, i) => [b + Number.EPSILON, colors[i + 1]]);
    // Mapbox rejects a `step` with no stops; with no breaks there is one class and one color.
    const graded = stops.length > 0 ? ['step', valueExpr, colors[0], ...stops] : colors[0];
    return ['case', ['<', valueExpr, 0], noneColor, graded];
  }

  /**
   * The classes as the legend lists them.
   * @param {number[]} breaks - The ascending class breaks.
   * @param {string} [mode='light'] - The basemap.
   * @returns {Array<{from: ?number, to: ?number, color: string}>} Gentlest first; `from` is null on the first class
   *   and `to` on the last.
   */
  static classes(breaks, mode = 'light') {
    const colors = AccessScoreGradeRamp.colors(breaks.length + 1, mode);
    return colors.map((color, i) => ({
      from: i === 0 ? null : breaks[i - 1], to: i === breaks.length ? null : breaks[i], color,
    }));
  }

  /** The class index for a street the ramp has no grade for, so a legend can offer it as a class too. */
  static NO_GRADE = -1;

  /**
   * Which class a grade falls in, matching [[expression]]'s coloring exactly: a street at a break is *within* the
   * gentler class ("not steeper than 1:20"), which is what the same `Number.EPSILON` nudge buys there.
   * @param {?number} grade - A grade as a fraction, or null/negative where the street has none.
   * @param {number[]} breaks - The ascending class breaks.
   * @returns {number} An index into [[classes]], or [[NO_GRADE]].
   */
  static classIndexOf(grade, breaks) {
    if (typeof grade !== 'number' || !Number.isFinite(grade) || grade < 0) return AccessScoreGradeRamp.NO_GRADE;
    let i = 0;
    while (i < breaks.length && grade >= breaks[i] + Number.EPSILON) i += 1;
    return i;
  }

  /**
   * A grade as the percentage people read, to one decimal where it has one ("8.3%", "5%").
   * @param {number} grade - A grade as a fraction.
   * @returns {string}
   */
  static percent(grade) {
    return new Intl.NumberFormat(i18next.language, { style: 'percent', maximumFractionDigits: 1 }).format(grade);
  }
}
