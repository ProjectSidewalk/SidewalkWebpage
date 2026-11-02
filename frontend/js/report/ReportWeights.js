/**
 * The sidebar's weight sliders: one per scored label type, plus the grade's where the city has slope data. It knows
 * nothing of scores; a host hears what moved. The engine's config supplies every type, sign-free default and range.
 *
 * @typedef {object} ReportWeightValues
 * @property {Record<string, number>} weights - By label type.
 * @property {number} slopeWeight
 */

import i18next from 'i18next';
import { util } from '../common/utilities.js';
import '../common/utilitiesSidewalk.js';

export class ReportWeights {
  // A slider this fine can land on any weight a link from the tool names.
  static #STEP = 0.05;

  /** @type {Array<{type: ?string, input: HTMLInputElement, output: HTMLOutputElement, fallback: number}>} */
  #rows = [];
  /** @type {HTMLButtonElement} */ #reset;
  /** @type {(values: ReportWeightValues, event: {kind: string, value?: string, final: boolean}) => void} */ #onChange;

  /**
   * @param {HTMLElement} root - The control, holding `#report-weights` and `#report-weights-reset`.
   * @param {Record<string, any>} config - `/v3/api/accessScoreConfig`'s answer.
   * @param {(values: ReportWeightValues, event: {kind: string, value?: string, final: boolean}) => void} onChange
   */
  constructor(root, config, onChange) {
    this.#onChange = onChange;
    const list = root.querySelector('#report-weights');
    this.#reset = root.querySelector('#report-weights-reset');
    const defaults = config.presets.default;
    const largest = Math.max(0, ...Object.values(defaults).map((w) => Math.abs(Number(w))));
    const max = Math.max(3, Math.ceil(largest) + 1);
    for (const type of config.scored_types) {
      const fallback = Math.abs(defaults[type] ?? 0);
      list.append(this.#row(util.misc.labelTypeName(type), type, fallback, max));
    }
    const hasSlope = (config.grade?.sources ?? []).length > 0 && config.grade_scoring;
    if (hasSlope) {
      list.append(this.#row(i18next.t('accessscore:slope-weight'), null, config.grade_scoring.defaults.weight,
        config.grade_scoring.weight_range.max));
    }
    this.#reset.addEventListener('click', () => {
      for (const row of this.#rows) this.#write(row, row.fallback);
      this.#reset.hidden = true;
      this.#onChange(this.values, { kind: 'WeightsReset', final: true });
    });
  }

  /**
   * @param {string} name - What the slider is for, as text.
   * @param {?string} type - The label type; null for the grade.
   * @param {number} fallback - The engine's default.
   * @param {number} max
   * @returns {HTMLElement} The slider's row.
   */
  #row(name, type, fallback, max) {
    const id = `report-weight-${type ?? 'grade'}`;
    const row = document.createElement('div');
    row.className = 'report-weight';
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = name;
    const output = document.createElement('output');
    output.htmlFor.add(id);
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'ps-range';
    input.id = id;
    input.min = '0';
    input.max = String(max);
    input.step = String(ReportWeights.#STEP);
    row.append(label, output, input);

    const entry = { type, input, output, fallback };
    this.#rows.push(entry);
    this.#write(entry, fallback);
    const emit = (final) => {
      this.#show(entry);
      this.#reset.hidden = this.isDefault;
      this.#onChange(this.values, {
        kind: type ? 'Weight' : 'GradeWeight',
        value: `${type ? `Type=${type}_` : ''}Value=${input.value}`,
        final,
      });
    };
    input.addEventListener('input', () => emit(false));
    input.addEventListener('change', () => emit(true));
    return row;
  }

  /**
   * @param {{input: HTMLInputElement, output: HTMLOutputElement}} row
   * @param {number} value
   */
  #write(row, value) {
    row.input.value = String(value);
    this.#show(row);
  }

  /** @param {{input: HTMLInputElement, output: HTMLOutputElement}} row */
  #show({ input, output }) {
    const value = Number(input.value);
    output.value = value === 0 ? i18next.t('accessscore:weight-off') : `×${value.toFixed(2)}`;
  }

  /** @returns {ReportWeightValues} What the sliders say. */
  get values() {
    const weights = {};
    let slopeWeight = 0;
    for (const { type, input } of this.#rows) {
      if (type) weights[type] = Number(input.value);
      else slopeWeight = Number(input.value);
    }
    return { weights, slopeWeight };
  }

  /** @returns {boolean} Whether every slider sits on the engine's default. */
  get isDefault() {
    return this.#rows.every(({ input, fallback }) => Math.abs(Number(input.value) - fallback) < 1e-9);
  }

  /**
   * Puts the sliders where a shared link left them, without announcing it: the link's own numbers are already what the
   * host is applying.
   * @param {Partial<ReportWeightValues>} values
   */
  show({ weights = {}, slopeWeight }) {
    for (const row of this.#rows) {
      const value = row.type ? weights[row.type] : slopeWeight;
      if (value !== undefined) this.#write(row, value);
    }
    this.#reset.hidden = this.isDefault;
  }
}
