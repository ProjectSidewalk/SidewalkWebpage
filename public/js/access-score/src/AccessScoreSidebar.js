/**
 * The AccessScore tool's sidebar: the unit switch, the stakeholder-lens presets, one weight slider per scored
 * label type, the severity-emphasis slider, the tag toggle, and the per-unit options (#5217).
 *
 * The DOM is rendered from the engine config (`/v3/api/accessScoreConfig`) so the type rows, their order, the
 * presets, and the default magnitudes are never re-declared here. The sidebar reports changes; the page owns the
 * model and decides what to do with them. Slider drags fire `input` continuously (the map follows in real time)
 * and `change` once on release (which is what gets logged).
 */
class AccessScoreSidebar {
  /** Slider ceiling for a weight magnitude; the engine's largest default is 2.0, so this leaves room above it. */
  static MAX_WEIGHT = 3;

  #root;
  #config;
  #listeners = [];
  #els = {};

  /**
   * @param {HTMLElement} root - The `#filter-sidebar` element carrying the tool's section markup.
   * @param {object} config - The `/v3/api/accessScoreConfig` response.
   */
  constructor(root, config) {
    this.#root = root;
    this.#config = config;
    this.#render();
    this.#bind();
  }

  /**
   * Subscribes to changes. The callback receives `(partialState, {kind, final})`: `final` is false for a slider
   * mid-drag and true for a settled value (the one to log).
   * @param {function} callback - The subscriber.
   */
  onChange(callback) {
    this.#listeners.push(callback);
  }

  /**
   * Syncs the controls to a model state without emitting a change (used on load and after a reset).
   * @param {object} state - An `AccessScoreModel` state.
   */
  setState(state) {
    const e = this.#els;
    e.unitInputs.forEach((input) => {
      input.checked = input.value === state.unit;
    });
    e.preset.value = state.preset;
    for (const type of this.#config.scored_types) {
      const row = e.weightRows[type];
      row.input.value = state.weights[type];
      row.output.textContent = AccessScoreSidebar.#format(state.weights[type]);
    }
    e.severity.value = state.severityEmphasis;
    e.severityOutput.textContent = `${Math.round(state.severityEmphasis * 100)}%`;
    e.tags.checked = state.tagsEnabled;
    e.aggregation.value = state.aggregation;
    e.minCompletion.value = Math.round(state.minCompletion * 100);
    e.minCompletionOutput.textContent = `${Math.round(state.minCompletion * 100)}%`;
    e.showUnaudited.checked = state.showUnaudited;
    this.#showUnitOptions(state.unit);
  }

  /**
   * Draws each type's mean contribution as a small bar beside its slider, so the effect of a weight is visible in
   * the panel itself and not only on the map.
   * @param {Object<string, number>} means - Mean term per type (from `AccessScoreModel#contributions`).
   */
  setContributions(means) {
    const max = Math.max(0.05, ...Object.values(means).map((v) => Math.abs(v)));
    for (const type of this.#config.scored_types) {
      const row = this.#els.weightRows[type];
      const value = means[type] ?? 0;
      row.bar.style.width = `${Math.round((Math.abs(value) / max) * 100)}%`;
      row.bar.classList.toggle('acs-weight__bar--feature', value > 0);
      row.bar.classList.toggle('acs-weight__bar--problem', value < 0);
      row.barLabel.textContent = (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(2);
    }
  }

  /** Builds the config-driven parts of the panel: preset options and the weight rows. */
  #render() {
    const root = this.#root;
    const preset = root.querySelector('#acs-preset');
    preset.innerHTML = [...this.#config.preset_order, 'custom'].map((id) =>
      `<option value="${id}">${i18next.t(`accessscore:preset-${id.replace(/_/g, '-')}`)}</option>`).join('');

    const weights = root.querySelector('#acs-weights');
    weights.innerHTML = this.#config.scored_types.map((type) => {
      const sign = this.#config.type_weights[type].base_weight < 0 ? '−' : '+';
      const name = i18next.t(`common:${AccessScoreSidebar.#typeKey(type)}`);
      const signLabel = i18next.t(sign === '+' ? 'accessscore:weight-feature' : 'accessscore:weight-problem');
      return `
        <div class="acs-weight" data-type="${type}">
          <div class="acs-weight__head">
            <span class="acs-weight__swatch" style="background-color: ${util.misc.getLabelColors(type)};"></span>
            <label class="acs-weight__label" for="acs-weight-${type}">${name}</label>
            <span class="acs-weight__sign acs-weight__sign--${sign === '+' ? 'feature' : 'problem'}"
                  title="${signLabel}" aria-label="${signLabel}">${sign}</span>
            <output class="acs-weight__value" for="acs-weight-${type}"></output>
          </div>
          <input type="range" class="acs-range" id="acs-weight-${type}" min="0" max="${AccessScoreSidebar.MAX_WEIGHT}"
                 step="0.05" data-type="${type}">
          <div class="acs-weight__contrib" aria-hidden="true">
            <span class="acs-weight__bar"></span><span class="acs-weight__bar-label"></span>
          </div>
        </div>`;
    }).join('');

    this.#els = {
      unitInputs: Array.from(root.querySelectorAll('input[name="acs-unit"]')),
      preset,
      weightRows: Object.fromEntries(this.#config.scored_types.map((type) => {
        const row = weights.querySelector(`.acs-weight[data-type="${type}"]`);
        return [type, {
          input: row.querySelector('input'),
          output: row.querySelector('output'),
          bar: row.querySelector('.acs-weight__bar'),
          barLabel: row.querySelector('.acs-weight__bar-label'),
        }];
      })),
      severity: root.querySelector('#acs-severity'),
      severityOutput: root.querySelector('#acs-severity-value'),
      tags: root.querySelector('#acs-tags'),
      aggregation: root.querySelector('#acs-aggregation'),
      minCompletion: root.querySelector('#acs-min-completion'),
      minCompletionOutput: root.querySelector('#acs-min-completion-value'),
      showUnaudited: root.querySelector('#acs-show-unaudited'),
      reset: root.querySelector('#acs-reset'),
      regionOptions: root.querySelector('#acs-region-options'),
      streetOptions: root.querySelector('#acs-street-options'),
    };
  }

  #bind() {
    const e = this.#els;
    e.unitInputs.forEach((input) => input.addEventListener('change', () => {
      if (!input.checked) return;
      this.#showUnitOptions(input.value);
      this.#emit({ unit: input.value }, { kind: 'Unit', value: input.value, final: true });
    }));
    e.preset.addEventListener('change', () => {
      if (e.preset.value === 'custom') return; // Custom is a state the sliders put you in, not one you pick.
      this.#emit({ preset: e.preset.value }, { kind: 'Preset', value: e.preset.value, final: true });
    });
    for (const [type, row] of Object.entries(e.weightRows)) {
      const value = () => Number.parseFloat(row.input.value);
      const emitWeight = (final) =>
        this.#emit({ weights: { [type]: value() } }, { kind: 'Weight', value: `${type}_value=${value()}`, final });
      row.input.addEventListener('input', () => {
        row.output.textContent = AccessScoreSidebar.#format(value());
        e.preset.value = this.#matchingPreset() ?? 'custom';
        emitWeight(false);
      });
      row.input.addEventListener('change', () => emitWeight(true));
    }
    const severity = (final) => {
      const v = Number.parseFloat(e.severity.value);
      e.severityOutput.textContent = `${Math.round(v * 100)}%`;
      this.#emit({ severityEmphasis: v }, { kind: 'SeverityEmphasis', value: v, final });
    };
    e.severity.addEventListener('input', () => severity(false));
    e.severity.addEventListener('change', () => severity(true));
    e.tags.addEventListener('change', () =>
      this.#emit({ tagsEnabled: e.tags.checked }, { kind: 'Tags', value: e.tags.checked, final: true }));
    e.aggregation.addEventListener('change', () => this.#emit({ aggregation: e.aggregation.value },
      { kind: 'Aggregation', value: e.aggregation.value, final: true }));
    const floor = (final) => {
      const v = Number.parseInt(e.minCompletion.value, 10);
      e.minCompletionOutput.textContent = `${v}%`;
      this.#emit({ minCompletion: v / 100 }, { kind: 'MinCompletion', value: v, final });
    };
    e.minCompletion.addEventListener('input', () => floor(false));
    e.minCompletion.addEventListener('change', () => floor(true));
    e.showUnaudited.addEventListener('change', () =>
      this.#emit({ showUnaudited: e.showUnaudited.checked },
        { kind: 'ShowUnaudited', value: e.showUnaudited.checked, final: true }));
    e.reset.addEventListener('click', () => this.#emit(null, { kind: 'Reset', final: true }));
  }

  #showUnitOptions(unit) {
    this.#els.regionOptions.hidden = unit !== 'regions';
    this.#els.streetOptions.hidden = unit !== 'streets';
  }

  /** The preset whose magnitudes the sliders currently show, if any. */
  #matchingPreset() {
    const current = Object.fromEntries(Object.entries(this.#els.weightRows)
      .map(([type, row]) => [type, Number.parseFloat(row.input.value)]));
    for (const [id, preset] of Object.entries(this.#config.presets)) {
      if (this.#config.scored_types.every((t) => Math.abs(preset[t] - current[t]) < 1e-9)) return id;
    }
    return null;
  }

  #emit(partial, meta) {
    for (const listener of this.#listeners) listener(partial, meta);
  }

  /** The common-namespace key for a label type's display name ("NoCurbRamp" → "no-curb-ramp"). */
  static #typeKey(type) {
    return type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  static #format(value) {
    return Number(value).toFixed(2);
  }
}
