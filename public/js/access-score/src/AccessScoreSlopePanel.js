/**
 * The sidebar's Slope section (#5223): how street slope enters the score. A weight, the statistic that drives it,
 * the two thresholds the term ramps between, a switch that scores very steep streets 0 outright, and whether
 * slopes from a coarse elevation model take part.
 *
 * Every default, the list of statistics and the range a threshold may take come from `/v3/api/accessScoreConfig`
 * (`slope`), so nothing here knows a grade. The engine's own weight is 0: the section changes nothing until a reader
 * moves the slider, and the hint beside its folded heading says "Custom" once one has. The section stays hidden in a
 * city whose streets have not been sampled, where its controls would move nothing.
 *
 * Thresholds are edited as percentages, the way a grade is spoken, and held as fractions, the way the API states it.
 */
class AccessScoreSlopePanel {
  /** The statistic whose lengths were measured against the two fixed limits, so the thresholds do not apply to it. */
  static #FIXED_LIMITS_STATISTIC = 'meters_over_limit';

  /** @type {AccessScoreConfig} */
  #config;
  #emit;
  #els;
  /** @type {AccessScoreSlopeSettings} */
  #settings;

  /**
   * @param {HTMLElement} root - The sidebar element carrying the `#acs-slope-section` markup.
   * @param {AccessScoreConfig} config - The `/v3/api/accessScoreConfig` response.
   * @param {number} maxWeight - The top of the weight slider, the label-type sliders' own.
   * @param {(partial: ?Partial<AccessScoreState>, meta: AccessScoreChangeMeta) => void} emit - Reports a change, as
   *   the sidebar's other controls do.
   */
  constructor(root, config, maxWeight, emit) {
    this.#config = config;
    this.#emit = emit;
    this.#settings = AccessScoreModel.slopeDefaults(config);
    const q = (selector) => root.querySelector(selector);
    this.#els = {
      section: q('#acs-slope-section'), toggle: q('#acs-slope-toggle'), body: q('#acs-slope'),
      summary: q('#acs-slope-summary'), reset: q('#acs-slope-reset'), weight: q('#acs-slope-weight'),
      weightOutput: q('#acs-slope-weight-value'), statistic: q('#acs-slope-statistic'), low: q('#acs-slope-low'),
      high: q('#acs-slope-high'), fixedNote: q('#acs-slope-fixed-note'), barrier: q('#acs-slope-barrier'),
      barrierThreshold: q('#acs-slope-barrier-threshold'), lowConfidence: q('#acs-slope-low-confidence'),
    };
    this.#els.section.hidden = !this.available;
    if (!this.available) return;
    this.#render(maxWeight);
    this.#bind();
  }

  /** Whether the section has anything to control: the engine publishes slope settings and the city has slopes. */
  get available() {
    return Boolean(this.#config.slope) && (this.#config.gradient?.sources ?? []).length > 0;
  }

  /** @returns {boolean} Whether the section is unfolded. */
  get open() {
    return this.#els.toggle.getAttribute('aria-expanded') === 'true';
  }

  /**
   * Folds or unfolds the section without emitting a change; the page opens it for a link with custom slope settings.
   * @param {boolean} open - True to show the controls.
   * @returns {boolean} The state now in force.
   */
  setOpen(open) {
    this.#els.toggle.setAttribute('aria-expanded', String(open));
    this.#els.body.hidden = !open;
    const chevron = this.#els.toggle.querySelector('img');
    chevron.src = open ? chevron.dataset.upSrc : chevron.dataset.downSrc;
    return open;
  }

  /**
   * Syncs the controls to a model state without emitting a change.
   * @param {AccessScoreState} state - An `AccessScoreModel` state.
   */
  setState(state) {
    if (!this.available) return;
    this.#settings = { ...state.slope };
    const e = this.#els;
    const s = this.#settings;
    e.weight.value = String(s.weight);
    e.weightOutput.textContent = AccessScoreSlopePanel.#formatWeight(s.weight);
    e.statistic.value = s.statistic;
    e.low.value = AccessScoreSlopePanel.#toPercent(s.lowThreshold);
    e.high.value = AccessScoreSlopePanel.#toPercent(s.highThreshold);
    e.barrier.checked = s.barrierEnabled;
    e.barrierThreshold.value = AccessScoreSlopePanel.#toPercent(s.barrierThreshold);
    e.lowConfidence.checked = s.includeLowConfidence;
    this.#reflect();
  }

  /** Fills in what the config decides: the slider's range, the statistics on offer, the thresholds' bounds. */
  #render(maxWeight) {
    const e = this.#els;
    e.weight.max = String(maxWeight);
    e.statistic.innerHTML = this.#config.slope.statistics.map((id) => {
      const key = `accessscore:slope-statistic-${id.replaceAll('_', '-')}`;
      const name = i18next.exists(key) ? i18next.t(key) : id;
      return `<option value="${util.escapeHTML(id)}">${util.escapeHTML(name)}</option>`;
    }).join('');
    const { min, max } = this.#config.slope.threshold_range;
    for (const input of [e.low, e.high, e.barrierThreshold]) {
      input.min = AccessScoreSlopePanel.#toPercent(min);
      input.max = AccessScoreSlopePanel.#toPercent(max);
    }
  }

  #bind() {
    const e = this.#els;
    const change = (patch, kind, value, final = true) => {
      this.#settings = { ...this.#settings, ...patch };
      this.#reflect();
      this.#emit({ slope: patch }, { kind, value, final });
    };
    e.weight.addEventListener('input', () => {
      const weight = Number.parseFloat(e.weight.value);
      e.weightOutput.textContent = AccessScoreSlopePanel.#formatWeight(weight);
      change({ weight }, 'SlopeWeight', weight, false);
    });
    e.weight.addEventListener('change', () => {
      const weight = Number.parseFloat(e.weight.value);
      change({ weight }, 'SlopeWeight', weight);
    });
    e.statistic.addEventListener('change', () => change({ statistic: e.statistic.value }, 'SlopeStat',
      e.statistic.value));
    // A threshold settles on `change` (blur, Enter, a spinner click), so a half-typed "1" on the way to "12" never
    // reaches the map. An empty or out-of-range entry snaps back to the value in force.
    const threshold = (input, key, label) => input.addEventListener('change', () => {
      const grade = this.#readThreshold(input);
      if (grade === null) {
        input.value = AccessScoreSlopePanel.#toPercent(this.#settings[key]);
        return;
      }
      input.value = AccessScoreSlopePanel.#toPercent(grade);
      change({ [key]: grade }, 'SlopeThreshold', `${label}_value=${input.value}`);
    });
    threshold(e.low, 'lowThreshold', 'low');
    threshold(e.high, 'highThreshold', 'high');
    threshold(e.barrierThreshold, 'barrierThreshold', 'barrier');
    e.barrier.addEventListener('change', () => change({ barrierEnabled: e.barrier.checked }, 'SlopeBarrier',
      e.barrier.checked));
    e.lowConfidence.addEventListener('change', () => change({ includeLowConfidence: e.lowConfidence.checked },
      'SlopeLowConfidence', e.lowConfidence.checked));
    e.reset.addEventListener('click', () => {
      const defaults = AccessScoreModel.slopeDefaults(this.#config);
      this.setState(/** @type {AccessScoreState} */ ({ slope: defaults }));
      this.#emit({ slope: defaults }, { kind: 'SlopeReset', final: true });
    });
    e.toggle.addEventListener('click', () => {
      const open = this.setOpen(!this.open);
      this.#emit(null, { kind: 'Section', value: `slope_open=${open}`, final: true });
    });
  }

  /**
   * A threshold input's value as a grade, or null where it is not a number inside the range the config allows.
   * @param {HTMLInputElement} input - One of the three threshold inputs.
   * @returns {?number}
   */
  #readThreshold(input) {
    const percent = Number.parseFloat(input.value);
    if (!Number.isFinite(percent)) return null;
    const grade = percent / 100;
    const { min, max } = this.#config.slope.threshold_range;
    return grade >= min && grade <= max ? grade : null;
  }

  /**
   * Shows what the settings in force imply: which controls apply, and whether there is anything to reset. The
   * thresholds are disabled (with the reason beside them) under the over-limit statistic, and the barrier's grade
   * until the barrier is on.
   */
  #reflect() {
    const e = this.#els;
    const fixed = this.#settings.statistic === AccessScoreSlopePanel.#FIXED_LIMITS_STATISTIC;
    e.low.disabled = fixed;
    e.high.disabled = fixed;
    e.fixedNote.hidden = !fixed;
    e.barrierThreshold.disabled = !this.#settings.barrierEnabled;
    const defaults = AccessScoreModel.slopeDefaults(this.#config);
    const atDefault = Object.keys(defaults).every((k) => (typeof defaults[k] === 'number'
      ? Math.abs(defaults[k] - this.#settings[k]) < 1e-9
      : defaults[k] === this.#settings[k]));
    e.reset.hidden = atDefault;
    e.summary.textContent = atDefault ? '' : i18next.t('accessscore:weights-custom');
  }

  /** A grade as the percentage an input holds, to one decimal ("8.3"). */
  static #toPercent(grade) {
    return String(Math.round(grade * 1000) / 10);
  }

  static #formatWeight(value) {
    return `×${Number(value).toFixed(2)}`;
  }
}
