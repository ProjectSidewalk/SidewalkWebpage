/**
 * The sidebar's Slope section (#5223): how street slope enters the score. A weight, the statistic that drives it,
 * the two thresholds the term ramps between, a switch that scores a very steep block 0 outright, and whether
 * approximate slopes (a coarse elevation model's, or a profile the sampler distrusted) take part.
 *
 * Every default, the list of statistics and the range a threshold may take come from `/v3/api/accessScoreConfig`
 * (`grade_scoring`), so nothing here knows a grade. The hint beside the folded heading says "Custom" once a control has
 * moved off the engine's own settings. The section stays hidden in a city whose streets have not been sampled,
 * where its controls would move nothing.
 *
 * Under the slider it reports what the settings reach, which is what a barely-moving map cannot say: a weight of 0
 * and a threshold no street passes look identical on screen, and only one of them is about the weight.
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
  /** Reports what the settings in force reach, for the line under the slider. */
  #impact;

  /**
   * @param {HTMLElement} root - The sidebar element carrying the `#acs-slope-section` markup.
   * @param {AccessScoreConfig} config - The `/v3/api/accessScoreConfig` response.
   * @param {(partial: ?Partial<AccessScoreState>, meta: AccessScoreChangeMeta) => void} emit - Reports a change, as
   *   the sidebar's other controls do.
   * @param {() => {reached: number, full: number, barriers: number, scored: number}} impact - The model's
   *   `slopeImpact`.
   */
  constructor(root, config, emit, impact = () => null) {
    this.#config = config;
    this.#emit = emit;
    this.#impact = impact;
    this.#settings = AccessScoreModel.slopeDefaults(config);
    const q = (selector) => root.querySelector(selector);
    this.#els = {
      section: q('#acs-slope-section'), toggle: q('#acs-slope-toggle'), body: q('#acs-slope'),
      summary: q('#acs-slope-summary'), reset: q('#acs-slope-reset'), weight: q('#acs-slope-weight'),
      weightOutput: q('#acs-slope-weight-value'), statistic: q('#acs-slope-statistic'), low: q('#acs-slope-low'),
      high: q('#acs-slope-high'), fixedNote: q('#acs-slope-fixed-note'), barrier: q('#acs-slope-barrier'),
      barrierThreshold: q('#acs-slope-barrier-threshold'), approximate: q('#acs-slope-approximate'),
      impact: q('#acs-slope-impact'), flash: q('#acs-slope-flash'), weightRow: q('#acs-slope-weight-row'),
    };
    this.#els.section.hidden = !this.available;
    if (!this.available) return;
    this.#render();
    this.#bind();
  }

  /** Whether the section has anything to control: the engine publishes slope settings and the city has slopes. */
  get available() {
    return Boolean(this.#config.grade_scoring) && (this.#config.grade?.sources ?? []).length > 0;
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
    this.#showWeight(s.weight);
    e.statistic.value = s.statistic;
    e.low.value = AccessScoreSlopePanel.#toPercent(s.lowThreshold);
    e.high.value = AccessScoreSlopePanel.#toPercent(s.highThreshold);
    e.barrier.checked = s.barrierEnabled;
    e.barrierThreshold.value = AccessScoreSlopePanel.#toPercent(s.barrierThreshold);
    e.approximate.checked = s.includeApproximate;
    this.#reflect();
    this.#showImpact();
  }

  /** Fills in what the config decides: the slider's range, the statistics on offer, the thresholds' bounds. */
  #render() {
    const e = this.#els;
    e.weight.max = String(this.#config.grade_scoring.weight_range.max);
    e.statistic.innerHTML = this.#config.grade_scoring.statistics.map((id) => {
      const key = `accessscore:slope-statistic-${id.replaceAll('_', '-')}`;
      const name = i18next.exists(key) ? i18next.t(key) : id;
      return `<option value="${util.escapeHTML(id)}">${util.escapeHTML(name)}</option>`;
    }).join('');
    const { min, max } = this.#config.grade_scoring.threshold_range;
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
      this.#showWeight(weight);
      change({ weight }, 'GradeWeight', weight, false);
    });
    e.weight.addEventListener('change', () => {
      const weight = Number.parseFloat(e.weight.value);
      change({ weight }, 'GradeWeight', weight);
    });
    e.statistic.addEventListener('change', () => change({ statistic: e.statistic.value }, 'GradeStat',
      e.statistic.value));
    // A threshold settles on `change` (blur, Enter, a spinner click), so a half-typed "1" on the way to "12" never
    // reaches the map. An entry that is empty, out of range, or would cross the other threshold snaps back to the
    // value in force: the engine reads crossed thresholds as a step, under which "no penalty up to" and "full
    // penalty from" would both be false labels.
    const threshold = (input, key, label) => input.addEventListener('change', () => {
      const grade = this.#readThreshold(input);
      const crossed = grade !== null && (
        (key === 'lowThreshold' && grade >= this.#settings.highThreshold)
        || (key === 'highThreshold' && grade <= this.#settings.lowThreshold));
      if (grade === null || crossed) {
        input.value = AccessScoreSlopePanel.#toPercent(this.#settings[key]);
        return;
      }
      input.value = AccessScoreSlopePanel.#toPercent(grade);
      change({ [key]: grade }, 'GradeThreshold', `${label}_value=${input.value}`);
    });
    threshold(e.low, 'lowThreshold', 'low');
    threshold(e.high, 'highThreshold', 'high');
    threshold(e.barrierThreshold, 'barrierThreshold', 'barrier');
    // Switching the barrier off returns its grade to the default. A grade with no barrier decides nothing and
    // cannot ride in a link, so keeping it would leave the section saying "Custom" over settings a reload forgets.
    e.barrier.addEventListener('change', () => {
      const patch = { barrierEnabled: e.barrier.checked };
      if (!e.barrier.checked) {
        patch.barrierThreshold = AccessScoreModel.slopeDefaults(this.#config).barrierThreshold;
        e.barrierThreshold.value = AccessScoreSlopePanel.#toPercent(patch.barrierThreshold);
      }
      change(patch, 'GradeBarrier', e.barrier.checked);
    });
    e.approximate.addEventListener('change', () => change({ includeApproximate: e.approximate.checked },
      'GradeApproximate', e.approximate.checked));
    e.reset.addEventListener('click', () => {
      const defaults = AccessScoreModel.slopeDefaults(this.#config);
      this.setState(/** @type {AccessScoreState} */ ({ slope: defaults }));
      this.#emit({ slope: defaults }, { kind: 'GradeReset', final: true });
    });
    e.toggle.addEventListener('click', () => {
      const open = this.setOpen(!this.open);
      this.#emit(null, { kind: 'Section', value: `grade_open=${open}`, final: true });
    });
  }

  /**
   * A threshold input's value as a grade, or null where it is not a number inside the range the config allows.
   * Rounded to the tenth of a percent the input shows, so the grade in force is the one on screen: "8.33" held in
   * full but shown as "8.3" would quietly become 8.3 the next time the field was touched.
   * @param {HTMLInputElement} input - One of the three threshold inputs.
   * @returns {?number}
   */
  #readThreshold(input) {
    const percent = Number.parseFloat(input.value);
    if (!Number.isFinite(percent)) return null;
    const grade = Math.round(percent * 10) / 1000;
    const { min, max } = this.#config.grade_scoring.threshold_range;
    return grade >= min && grade <= max ? grade : null;
  }

  /**
   * Shows what the settings in force imply: which controls apply, and whether there is anything to reset. The
   * thresholds are disabled under the over-limit statistic, and the barrier's grade until the barrier is on.
   *
   * A disabled input leaves the tab order, so the reason cannot hang off the inputs alone: it is written into a
   * status region, which announces it when the statistic changes, and the fieldset is described by that region, so
   * it is also read on the way into the group. The two limits in it are the config's, formatted for the reader.
   */
  #reflect() {
    const e = this.#els;
    const fixed = this.#settings.statistic === AccessScoreSlopePanel.#FIXED_LIMITS_STATISTIC;
    e.low.disabled = fixed;
    e.high.disabled = fixed;
    const limits = this.#config.grade;
    e.fixedNote.textContent = fixed
      ? i18next.t('accessscore:slope-fixed-note', {
          low: AccessScoreGradeRamp.percent(limits.walking_surface_limit),
          high: AccessScoreGradeRamp.percent(limits.ramp_limit),
        })
      : '';
    e.barrierThreshold.disabled = !this.#settings.barrierEnabled;
    const atDefault = AccessScoreModel.slopeMatchesDefaults(this.#config, this.#settings);
    e.reset.hidden = atDefault;
    e.summary.textContent = atDefault ? '' : i18next.t('accessscore:weights-custom');
  }

  /**
   * Re-reads what the settings reach. Called by the sidebar once the model has recomputed, not from the handlers
   * above, which run before it.
   */
  refreshImpact() {
    if (this.available) this.#showImpact();
  }

  /**
   * The line under the slider. A barrier count joins it only while the barrier is on, where "scores 0 outright" is
   * a different claim from "takes the whole weight".
   */
  #showImpact() {
    const impact = this.#impact();
    if (!this.#els.impact || !impact) return;
    const key = this.#settings.barrierEnabled ? 'slope-impact-barriers' : 'slope-impact';
    this.#els.impact.textContent = i18next.t(`accessscore:${key}`, impact);
  }

  /** The section's "Updated" line, which the sidebar fills so both sections say it the same way. */
  get flashElement() {
    return this.#els.flash;
  }

  /** The weight as the output shows it, with the row muted at 0, where the term is off rather than merely small. */
  #showWeight(value) {
    const off = Number(value) === 0;
    this.#els.weightOutput.textContent = off
      ? i18next.t('accessscore:weight-off')
      : AccessScoreSlopePanel.#formatWeight(value);
    this.#els.weightRow?.classList.toggle('acs-weight--off', off);
  }

  /** A grade as the percentage an input holds, to one decimal ("8.3"). */
  static #toPercent(grade) {
    return String(Math.round(grade * 1000) / 10);
  }

  static #formatWeight(value) {
    return `×${Number(value).toFixed(2)}`;
  }
}
