/**
 * The AccessScore map's own legend (#5217), a Mapbox control beside the zoom buttons: the ramp between its numeric
 * ends, the pole words, the no-score swatch for the active unit, and a caret at the hovered or selected score.
 * The dock's histogram is the fuller legend; this one keeps the ramp's meaning on screen when the dock is collapsed
 * or scrolled off a phone's viewport.
 *
 * While the streets are colored by slope (#5223) the ramp gives way to the slope classes, each a swatch beside the
 * grades it spans; the score ramp returns with the score coloring, and under the regions unit, which has no slope.
 *
 * The two blocks are exposed differently on purpose. The score ramp is one picture with one name (`role="img"`): a
 * gradient has no parts to read. The slope classes are a list, because `role="img"` would prune its children from
 * the accessibility tree, and the class rows are the only place a reader who cannot tell two close blues apart, or
 * cannot see the map at all, finds which grades a color stands for without hovering a street.
 */
class AccessScoreMapLegend {
  #container = null;
  #scoreBlock = null;
  #gradeBlock = null;
  #gradeBreaks;
  #grade = false;
  #unit = 'streets';
  #bar = null;
  #caret = null;
  #swatch = null;
  #swatchLabel = null;
  #mode = 'light';

  /**
   * @param {object} [options] - What the legend can show besides the score.
   * @param {?number[]} [options.gradeBreaks=null] - The ascending grades the slope classes break at, or null where
   *                                                 the map has no slope coloring.
   */
  constructor({ gradeBreaks = null } = {}) {
    this.#gradeBreaks = gradeBreaks;
  }

  /**
   * Mapbox `IControl` hook: builds the legend's DOM.
   * @returns {HTMLElement} The control's root, which Mapbox places in the chosen corner.
   */
  onAdd() {
    const root = document.createElement('div');
    root.className = 'mapboxgl-ctrl acs-map-legend';
    root.innerHTML = `
      <div class="acs-map-legend__score" role="img" aria-label="${i18next.t('accessscore:legend')}">
        <div class="acs-map-legend__row">
          <span class="acs-map-legend__end">0</span>
          <span class="acs-map-legend__bar"><span class="acs-map-legend__caret" hidden></span></span>
          <span class="acs-map-legend__end">100</span>
        </div>
        <div class="acs-map-legend__poles">
          <span>${i18next.t('accessscore:legend-low')}</span>
          <span>${i18next.t('accessscore:legend-high')}</span>
        </div>
        <div class="acs-map-legend__none">
          <span class="acs-map-legend__swatch"></span><span class="acs-map-legend__none-label"></span>
        </div>
      </div>
      <div class="acs-map-legend__grade" role="group" aria-labelledby="acs-map-legend-grade-title" hidden></div>`;
    this.#container = root;
    this.#scoreBlock = root.querySelector('.acs-map-legend__score');
    this.#gradeBlock = root.querySelector('.acs-map-legend__grade');
    this.#bar = root.querySelector('.acs-map-legend__bar');
    this.#caret = root.querySelector('.acs-map-legend__caret');
    this.#swatch = root.querySelector('.acs-map-legend__swatch');
    this.#swatchLabel = root.querySelector('.acs-map-legend__none-label');
    // The ramp is data, not styling: read from the tokens at build time, like every other ramp consumer.
    this.#bar.style.background = ScoreRamp.cssGradient({ mode: this.#mode });
    this.#renderGrade();
    this.#showActiveBlock();
    return root;
  }

  onRemove() {
    this.#container?.remove();
    this.#container = null;
  }

  /**
   * Repaints the ramp for the basemap the map is on, so the legend shows the colors the streets actually wear.
   * @param {boolean} dark - True on the dark basemap.
   */
  setDark(dark) {
    this.#mode = dark ? 'dark' : 'light';
    if (this.#bar) this.#bar.style.background = ScoreRamp.cssGradient({ mode: this.#mode });
    this.#renderGrade();
  }

  /**
   * Shows the slope classes in place of the score ramp, or the ramp again.
   * @param {boolean} grade - True while the streets are colored by slope.
   */
  setGrade(grade) {
    this.#grade = grade && this.#gradeBreaks !== null;
    this.#showActiveBlock();
  }

  /** The slope classes stand in for the ramp only where slope is what the map shows: the streets unit. */
  #showActiveBlock() {
    if (!this.#container) return;
    const grade = this.#grade && this.#unit === 'streets';
    this.#scoreBlock.hidden = grade;
    this.#gradeBlock.hidden = !grade;
  }

  /** Builds the slope classes' rows: a swatch and the grades it spans, gentlest first, then the no-data swatch. */
  #renderGrade() {
    if (!this.#gradeBlock || this.#gradeBreaks === null) return;
    const percent = AccessScoreGradeRamp.percent;
    const range = ({ from, to }) => {
      const options = { interpolation: { escapeValue: true } };
      if (from === null) return i18next.t('accessscore:grade-class-under', { to: percent(to), ...options });
      if (to === null) return i18next.t('accessscore:grade-class-over', { from: percent(from), ...options });
      return i18next.t('accessscore:grade-class-between', { from: percent(from), to: percent(to), ...options });
    };
    const classes = AccessScoreGradeRamp.classes(this.#gradeBreaks, this.#mode);
    const rows = classes.map((c) => `
      <li class="acs-map-legend__class">
        <span class="acs-map-legend__class-swatch" aria-hidden="true"></span><span>${range(c)}</span>
      </li>`).join('');
    // `role="list"`: the rows are styled without markers, and Safari drops list semantics from such a list.
    this.#gradeBlock.innerHTML = `
      <div class="acs-map-legend__title" id="acs-map-legend-grade-title">${
  i18next.t('accessscore:grade-legend-title')}</div>
      <ul class="acs-map-legend__classes" role="list">
        ${rows}
        <li class="acs-map-legend__none">
          <span class="acs-map-legend__swatch acs-map-legend__swatch--no-grade" aria-hidden="true"></span>
          <span>${i18next.t('accessscore:grade-legend-none')}</span>
        </li>
      </ul>`;
    // The dark basemap's steepest classes are near-white, which the legend's white card would swallow.
    this.#gradeBlock.classList.toggle('acs-map-legend__grade--dark', this.#mode === 'dark');
    // The colors are data read from the tokens, set as properties like the score bar's gradient above.
    this.#gradeBlock.querySelectorAll('.acs-map-legend__class-swatch').forEach((swatch, i) => {
      /** @type {HTMLElement} */ (swatch).style.background = classes[i].color;
    });
  }

  /**
   * Swaps the no-score swatch for the unit: a thin grey line for an unaudited street, the hatch for a region
   * under the completion floor.
   * @param {string} unit - 'streets' or 'regions'.
   */
  setUnit(unit) {
    this.#unit = unit;
    if (!this.#container) return;
    this.#showActiveBlock();
    const regions = unit === 'regions';
    this.#swatch.classList.toggle('acs-map-legend__swatch--hatch', regions);
    this.#swatch.classList.toggle('acs-map-legend__swatch--unaudited', !regions);
    const key = regions ? 'accessscore:legend-insufficient' : 'accessscore:legend-unaudited';
    this.#swatchLabel.textContent = i18next.t(key);
  }

  /**
   * Moves the caret to a score, or hides it.
   * @param {?number} score - A score in [0, 1], or null for none.
   */
  mark(score) {
    if (!this.#caret) return;
    const show = typeof score === 'number' && Number.isFinite(score);
    this.#caret.hidden = !show;
    if (show) this.#caret.style.left = `${Math.min(100, Math.max(0, score * 100))}%`;
  }
}
