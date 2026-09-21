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
 *
 * Each class row is also a button that brushes the map on that class (#5223), through the same brush the dock's
 * histogram sets, so only one of the two is ever in force. The grammar is the histogram's, which these rows sit
 * beside: a plain click or Enter selects one class (and clears it when it is already the only one), Ctrl / Cmd
 * toggles one in or out, Shift extends a contiguous run, and Escape clears.
 */
class AccessScoreMapLegend {
  #container = null;
  #scoreBlock = null;
  #gradeBlock = null;
  #gradeBreaks;
  #grade = false;
  #gradeStatistic = 'max_grade';
  #unit = 'streets';
  #bar = null;
  #caret = null;
  #swatch = null;
  #swatchLabel = null;
  #mode = 'light';
  #onGradeClasses;
  /** @type {number[]} The class indices currently brushed, gentlest first; empty for none. */
  #selection = [];
  /** Which class row holds the tab stop, as the histogram's bins do. */
  #focused = 0;

  /**
   * @param {object} [options] - What the legend can show besides the score.
   * @param {?number[]} [options.gradeBreaks=null] - The ascending grades the slope classes break at, or null where
   *                                                 the map has no slope coloring.
   * @param {Function} [options.onGradeClasses] - Called with the selected class indices (empty to clear).
   */
  constructor({ gradeBreaks = null, onGradeClasses = () => {} } = {}) {
    this.#gradeBreaks = gradeBreaks;
    this.#onGradeClasses = onGradeClasses;
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
   * @param {string} [statistic] - The slope statistic the classes describe, named in the block's title so the
   *   legend cannot claim to class a street by a grade the score is not using.
   */
  setGrade(grade, statistic = this.#gradeStatistic) {
    this.#grade = grade && this.#gradeBreaks !== null;
    const restatement = statistic !== this.#gradeStatistic;
    this.#gradeStatistic = statistic;
    if (restatement) this.#renderGrade();
    this.#showActiveBlock();
  }

  /**
   * Marks the classes a brush is on, without emitting: the legend is told, not asked, when a selection came from a
   * link, the dock's Clear, or a score brush taking over.
   * @param {number[]} classes - Class indices, empty for none.
   */
  setSelection(classes) {
    this.#selection = [...classes].sort((a, b) => a - b);
    this.#reflectSelection();
  }

  /** The slope classes stand in for the ramp only where slope is what the map shows: the streets unit. */
  #showActiveBlock() {
    if (!this.#container) return;
    const grade = this.#grade && this.#unit === 'streets';
    this.#scoreBlock.hidden = grade;
    this.#gradeBlock.hidden = !grade;
  }

  /** Builds the slope classes' rows: a swatch and the grades it spans, gentlest first, then the no-data row. */
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
    const row = (index, swatchClass, label) => `
      <li>
        <button type="button" class="acs-map-legend__class" data-class="${index}" aria-pressed="false" tabindex="-1">
          <span class="${swatchClass}" aria-hidden="true"></span><span>${label}</span>
        </button>
      </li>`;
    const rows = classes.map((c, i) => row(i, 'acs-map-legend__class-swatch', range(c))).join('');
    const statisticKey = `accessscore:slope-statistic-${this.#gradeStatistic.replaceAll('_', '-')}`;
    const title = i18next.exists(statisticKey)
      ? i18next.t('accessscore:grade-legend-title-by',
          { statistic: i18next.t(statisticKey), interpolation: { escapeValue: true } })
      : i18next.t('accessscore:grade-legend-title');
    // `role="list"`: the rows are styled without markers, and Safari drops list semantics from such a list.
    this.#gradeBlock.innerHTML = `
      <div class="acs-map-legend__title" id="acs-map-legend-grade-title">${title}</div>
      <ul class="acs-map-legend__classes" role="list">
        ${rows}
        ${row(AccessScoreGradeRamp.NO_GRADE, 'acs-map-legend__swatch acs-map-legend__swatch--no-grade',
          i18next.t('accessscore:grade-legend-none'))}
      </ul>
      <p class="acs-map-legend__hint">${i18next.t('accessscore:grade-legend-hint')}</p>`;
    // The dark basemap's steepest classes are near-white, which the legend's white card would swallow.
    this.#gradeBlock.classList.toggle('acs-map-legend__grade--dark', this.#mode === 'dark');
    // The colors are data read from the tokens, set as properties like the score bar's gradient above.
    this.#gradeBlock.querySelectorAll('.acs-map-legend__class-swatch').forEach((swatch, i) => {
      /** @type {HTMLElement} */ (swatch).style.background = classes[i].color;
    });
    this.#bindGrade();
    this.#reflectSelection();
  }

  /** The class rows' pointer and keyboard handling; the class comment has the grammar. */
  #bindGrade() {
    const buttons = this.#classButtons();
    for (const [i, button] of buttons.entries()) {
      // A legend click must not also reach the map underneath, where it would deselect the open street.
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.#focused = i;
        this.#choose(Number(button.dataset.class), { toggle: e.ctrlKey || e.metaKey, extend: e.shiftKey });
      });
      button.addEventListener('keydown', (e) => {
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (step !== undefined) {
          e.preventDefault();
          this.#focus(Math.min(buttons.length - 1, Math.max(0, i + step)));
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          this.#focus(e.key === 'Home' ? 0 : buttons.length - 1);
        } else if (e.key === 'Escape' && this.#selection.length > 0) {
          e.preventDefault();
          this.#emitSelection([]);
        }
      });
    }
  }

  /** @returns {HTMLButtonElement[]} The class rows in order, the no-grade row last. */
  #classButtons() {
    return /** @type {HTMLButtonElement[]} */ ([...this.#gradeBlock.querySelectorAll('.acs-map-legend__class')]);
  }

  /** Moves the roving tab stop and the focus together. */
  #focus(i) {
    const buttons = this.#classButtons();
    if (!buttons[i]) return;
    this.#focused = i;
    for (const [k, b] of buttons.entries()) b.tabIndex = k === i ? 0 : -1;
    buttons[i].focus();
  }

  /**
   * Applies a click or an Enter to the selection.
   * @param {number} index - The class the row stands for.
   * @param {{toggle: boolean, extend: boolean}} modifiers - Ctrl/Cmd, and Shift.
   */
  #choose(index, { toggle, extend }) {
    const has = this.#selection.includes(index);
    if (toggle) {
      this.#emitSelection(has ? this.#selection.filter((c) => c !== index) : [...this.#selection, index]);
    } else if (extend && this.#selection.length > 0) {
      // The no-grade row is not on the scale, so it has no neighbors to run through and joins one at a time.
      const inScale = this.#selection.filter((c) => c !== AccessScoreGradeRamp.NO_GRADE);
      if (index === AccessScoreGradeRamp.NO_GRADE || inScale.length === 0) {
        this.#emitSelection(has ? this.#selection : [...this.#selection, index]);
      } else {
        const from = Math.min(index, ...inScale);
        const to = Math.max(index, ...inScale);
        const run = Array.from({ length: to - from + 1 }, (_, k) => from + k);
        this.#emitSelection(this.#selection.includes(AccessScoreGradeRamp.NO_GRADE)
          ? [...run, AccessScoreGradeRamp.NO_GRADE]
          : run);
      }
    } else {
      // A plain click on the only class selected clears it, so the row that turned the brush on turns it off.
      this.#emitSelection(has && this.#selection.length === 1 ? [] : [index]);
    }
  }

  /** Reports a new selection; the owner decides what the brush then becomes. */
  #emitSelection(classes) {
    this.#selection = [...classes].sort((a, b) => a - b);
    this.#reflectSelection();
    this.#onGradeClasses([...this.#selection]);
  }

  /** Marks the pressed rows, mutes the rest while anything is selected, and keeps one tab stop among them. */
  #reflectSelection() {
    if (!this.#gradeBlock) return;
    const buttons = this.#classButtons();
    const any = this.#selection.length > 0;
    for (const [i, button] of buttons.entries()) {
      const on = this.#selection.includes(Number(button.dataset.class));
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('acs-map-legend__class--out', any && !on);
      button.tabIndex = i === Math.min(this.#focused, buttons.length - 1) ? 0 : -1;
    }
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
