/**
 * The AccessScore model's "Adjust the weights" panel: one slider per scored label type, each with its helps/hurts tag
 * and a bar for the type's average effect per street, folded behind its heading. Shared by the AccessScore tool and
 * the neighborhood report, so the two read as one control (#5876); the markup around it is
 * `views/common/accessScoreWeights.scala.html`.
 *
 * Rows come from the engine config (`/v3/api/accessScoreConfig`), so no type, default or ceiling is re-declared here.
 * The panel knows nothing of scores: it reports what moved, in the shape of an `AccessScoreModel` state partial, and
 * the host decides what a change does. A drag fires continuously with `final: false` and once on release with
 * `final: true`, which is the one to log.
 *
 * @typedef {object} AccessScoreWeightsChange
 * @property {string} kind - `Weight`, `GradeWeight`, `Reset` or `Section`.
 * @property {boolean} final - False for a slider mid-drag.
 * @property {string} [value] - What the change set, for the log.
 */

import i18next from 'i18next';
import { util } from '../common/utilities.js';
import '../common/utilitiesSidewalk.js';
import '../../css/components/ps-weights.css';
/** @typedef {import('./AccessScoreModel.js').AccessScoreConfig} AccessScoreConfig */

export class AccessScoreWeightsPanel {
  /**
   * Slider ceiling for a weight magnitude, at least this and always above the engine's largest default (see
   * `#maxWeight`), so a range input can never clamp a default it is asked to show. The server holds a link's weights
   * to the same ceiling (`AccessScoreWeights.TypeWeightMax`).
   */
  static MAX_WEIGHT = 3;

  /** @type {AccessScoreConfig} */ #config;
  /** @type {Record<string, {root: HTMLElement, input: HTMLInputElement, output: HTMLElement, bar: ?HTMLElement,
   *   barLabel: ?HTMLElement}>} */
  #rows = {};
  /** @type {?{root: HTMLElement, input: HTMLInputElement, output: HTMLElement}} */ #gradeRow = null;
  #els;
  /** @type {Array<(partial: ?Record<string, any>, meta: AccessScoreWeightsChange) => void>} */ #listeners = [];

  /**
   * @param {ParentNode} root - Holds the shared markup: `#acs-weights-toggle`, `#acs-weights`, `#acs-reset`,
   *   `#acs-weights-summary` and `#acs-weights-flash`.
   * @param {AccessScoreConfig} config - The engine config.
   * @param {object} [options]
   * @param {boolean} [options.gradeRow=false] - Adds a grade-weight row after the types, for a host with no slope
   *   section of its own. Shown only where the config has a sampled grade to weigh.
   */
  constructor(root, config, { gradeRow = false } = {}) {
    this.#config = config;
    const q = (selector) => /** @type {HTMLElement} */ (root.querySelector(selector));
    this.#els = {
      toggle: q('#acs-weights-toggle'),
      list: q('#acs-weights'),
      reset: q('#acs-reset'),
      summary: q('#acs-weights-summary'),
      flash: q('#acs-weights-flash'),
    };
    this.#render(gradeRow && AccessScoreWeightsPanel.hasGrade(config));
    this.#bind();
  }

  /**
   * @param {AccessScoreConfig} config
   * @returns {boolean} Whether the city has a sampled grade the model can weigh.
   */
  static hasGrade(config) {
    return Boolean(config.grade_scoring && (config.grade?.sources ?? []).length > 0);
  }

  /** @param {(partial: ?Record<string, any>, meta: AccessScoreWeightsChange) => void} callback */
  onChange(callback) {
    this.#listeners.push(callback);
  }

  /**
   * Puts the sliders on these weights without announcing it.
   * @param {Record<string, number>} weights - Magnitude per scored type.
   * @param {number} [gradeWeight] - For the grade row, where there is one.
   */
  setWeights(weights, gradeWeight) {
    for (const [type, row] of Object.entries(this.#rows)) {
      row.input.value = String(weights[type]);
      AccessScoreWeightsPanel.#showWeight(row, weights[type]);
    }
    if (this.#gradeRow && gradeWeight !== undefined) {
      this.#gradeRow.input.value = String(gradeWeight);
      AccessScoreWeightsPanel.#showWeight(this.#gradeRow, gradeWeight);
    }
    this.#updateSummary();
  }

  /**
   * Draws each type's mean contribution as a small bar beside its slider, so the effect of a weight is visible in
   * the panel itself and not only on the map.
   * @param {Record<string, number>} means - Mean term per type.
   */
  setContributions(means) {
    const max = Math.max(0.05, ...Object.values(means).map((v) => Math.abs(v)));
    for (const [type, row] of Object.entries(this.#rows)) {
      const value = means[type] ?? 0;
      row.bar.style.width = `${Math.round((Math.abs(value) / max) * 100)}%`;
      row.bar.classList.toggle('ps-weight__bar--feature', value > 0);
      row.bar.classList.toggle('ps-weight__bar--problem', value < 0);
      row.barLabel.textContent = i18next.t('accessscore:row-avg',
        { value: (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(2) });
    }
  }

  /**
   * Fills the "Updated" line and restarts its fade.
   * @param {number} changed - How many scored streets the recompute moved.
   */
  flash(changed) {
    const el = this.#els.flash;
    if (!el) return;
    el.textContent = i18next.t('accessscore:recalculated', { count: changed });
    el.classList.remove('ps-flash--on');
    // Reading back the layout restarts the animation on a change that lands while the last one is still fading.
    void el.offsetWidth;
    el.classList.add('ps-flash--on');
  }

  /** @returns {boolean} Whether the sliders are unfolded. */
  get open() {
    return this.#els.toggle.getAttribute('aria-expanded') === 'true';
  }

  /**
   * Folds or unfolds the sliders without emitting a change; a host opens it for a link with custom weights.
   * @param {boolean} open
   * @returns {boolean} The state now in force.
   */
  setOpen(open) {
    return AccessScoreWeightsPanel.setFold(this.#els.toggle, this.#els.list, open);
  }

  /** @returns {boolean} Whether every slider sits on the engine's default. */
  get isDefault() {
    const defaults = this.#config.presets.default;
    const near = (a, b) => Math.abs(a - b) < 1e-9;
    const typesAtDefault = Object.entries(this.#rows)
      .every(([type, row]) => near(defaults[type], Number.parseFloat(row.input.value)));
    const grade = this.#gradeRow;
    return typesAtDefault
      && (!grade || near(this.#config.grade_scoring.defaults.weight, Number.parseFloat(grade.input.value)));
  }

  /** @returns {{weights: Record<string, number>, gradeWeight: ?number}} What the sliders say. */
  get values() {
    const weights = Object.fromEntries(Object.entries(this.#rows)
      .map(([type, row]) => [type, Number.parseFloat(row.input.value)]));
    return { weights, gradeWeight: this.#gradeRow ? Number.parseFloat(this.#gradeRow.input.value) : null };
  }

  /**
   * The accordion mechanics a fold shares: the heading button's state, the body, and the chevron.
   * @param {HTMLElement} toggle - The heading's button, carrying the chevron's two sources.
   * @param {HTMLElement} body - What it folds.
   * @param {boolean} open
   * @returns {boolean} The state now in force.
   */
  static setFold(toggle, body, open) {
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    const chevron = toggle.querySelector('img');
    chevron.src = open ? chevron.dataset.upSrc : chevron.dataset.downSrc;
    return open;
  }

  /** @param {boolean} withGrade - Whether to add the grade row. */
  #render(withGrade) {
    const config = this.#config;
    const max = this.#maxWeight();
    const rows = config.scored_types.map((type) => {
      const problem = config.type_weights[type].base_weight < 0;
      const typeAttr = util.escapeHTML(type);
      return `
        <div class="ps-weight" data-type="${typeAttr}">
          <div class="ps-weight__head">
            <img class="ps-weight__icon" src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">
            <label class="ps-weight__label" for="acs-weight-${typeAttr}">${util.misc.labelTypeName(type)}</label>
            ${AccessScoreWeightsPanel.#role(problem)}
            <output class="ps-weight__value" for="acs-weight-${typeAttr}"></output>
          </div>
          <input type="range" class="ps-range" id="acs-weight-${typeAttr}" min="0" max="${max}"
                 step="0.05" data-type="${typeAttr}">
          <div class="ps-weight__contrib" aria-hidden="true">
            <span class="ps-weight__bar"></span><span class="ps-weight__bar-label"></span>
          </div>
        </div>`;
    });
    // The grade has no label type and so no icon or average bar, as in the tool's own Street grade section.
    if (withGrade) {
      const gradeMax = Number(config.grade_scoring.weight_range.max);
      rows.push(`
        <div class="ps-weight" data-grade>
          <div class="ps-weight__head">
            <label class="ps-weight__label" for="acs-weight-grade">${i18next.t('accessscore:slope-weight')}</label>
            ${AccessScoreWeightsPanel.#role(true)}
            <output class="ps-weight__value" for="acs-weight-grade"></output>
          </div>
          <input type="range" class="ps-range" id="acs-weight-grade" min="0"
                 max="${gradeMax}" step="0.05">
        </div>`);
    }
    this.#els.list.innerHTML = rows.join('');

    for (const type of config.scored_types) {
      const root = /** @type {HTMLElement} */ (this.#els.list.querySelector(`.ps-weight[data-type="${type}"]`));
      this.#rows[type] = {
        root,
        input: root.querySelector('input'),
        output: root.querySelector('output'),
        bar: root.querySelector('.ps-weight__bar'),
        barLabel: root.querySelector('.ps-weight__bar-label'),
      };
    }
    const grade = /** @type {?HTMLElement} */ (this.#els.list.querySelector('.ps-weight[data-grade]'));
    if (grade) {
      this.#gradeRow = { root: grade, input: grade.querySelector('input'), output: grade.querySelector('output') };
    }
  }

  /**
   * @param {boolean} problem - Whether the factor counts against a street.
   * @returns {string} The "helps" / "hurts" tag, with the longer reading in its tooltip.
   */
  static #role(problem) {
    const title = i18next.t(problem ? 'accessscore:weight-problem' : 'accessscore:weight-feature');
    return `<span class="ps-weight__role ps-weight__role--${problem ? 'problem' : 'feature'}" tabindex="0"
      data-ps-tooltip="${title}">${i18next.t(problem ? 'accessscore:row-hurts' : 'accessscore:row-helps')}</span>`;
  }

  #bind() {
    for (const [type, row] of Object.entries(this.#rows)) {
      this.#bindRow(row, (value) => ({ weights: { [type]: value } }), 'Weight', `${type}_value=`);
    }
    if (this.#gradeRow) {
      this.#bindRow(this.#gradeRow, (value) => ({ slope: { weight: value } }), 'GradeWeight', 'value=');
    }
    this.#els.reset.addEventListener('click', () => this.#emit(null, { kind: 'Reset', final: true }));
    // Opening the fold is worth knowing about: it says whether people reach for the weights at all.
    this.#els.toggle.addEventListener('click', () => {
      const open = this.setOpen(!this.open);
      this.#emit(null, { kind: 'Section', value: `weights_open=${open}`, final: true });
    });
  }

  /**
   * @param {{root: HTMLElement, input: HTMLInputElement, output: HTMLElement}} row
   * @param {(value: number) => Record<string, any>} partial - The state the row's value sets.
   * @param {string} kind
   * @param {string} logPrefix - What precedes the value in the log.
   */
  #bindRow(row, partial, kind, logPrefix) {
    const value = () => Number.parseFloat(row.input.value);
    const emit = (final) => this.#emit(partial(value()), { kind, value: `${logPrefix}${value()}`, final });
    row.input.addEventListener('input', () => {
      AccessScoreWeightsPanel.#showWeight(row, value());
      this.#updateSummary();
      emit(false);
    });
    row.input.addEventListener('change', () => emit(true));
  }

  #emit(partial, meta) {
    for (const listener of this.#listeners) listener(partial, meta);
  }

  /** The slider ceiling: `MAX_WEIGHT`, or the next whole number above the largest default if that is higher. */
  #maxWeight() {
    const largest = Math.max(0, ...Object.values(this.#config.presets.default).map((w) => Math.abs(w)));
    return Math.max(AccessScoreWeightsPanel.MAX_WEIGHT, Math.ceil(largest) + 1);
  }

  /**
   * Writes a weight into its row's output. At 0 the factor is out of the score entirely, which "×0.00" states only
   * to a reader who does the arithmetic, so the row says "Off" and mutes.
   * @param {{root: HTMLElement, output: HTMLElement}} row
   * @param {number} value
   */
  static #showWeight(row, value) {
    const off = Number(value) === 0;
    row.output.textContent = off ? i18next.t('accessscore:weight-off') : `×${Number(value).toFixed(2)}`;
    row.root.classList.toggle('ps-weight--off', off);
  }

  /**
   * "Reset weights" only appears once a slider has moved; at the defaults there is nothing to reset. The hint
   * beside the folded heading says the same thing for a reader who cannot see the sliders.
   */
  #updateSummary() {
    const atDefault = this.isDefault;
    this.#els.reset.hidden = atDefault;
    this.#els.summary.textContent = atDefault ? '' : i18next.t('accessscore:weights-custom');
  }
}
