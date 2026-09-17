/**
 * The AccessScore tool's sidebar: the unit switch, one weight slider per scored label type, the options block
 * that gathers the view toggles in one place (#5217), and the places section with one row per category (#5311).
 *
 * The DOM is rendered from the engine config (`/v3/api/accessScoreConfig`) so the type rows, the place categories,
 * their order, and the default magnitudes are never re-declared here. The sidebar reports changes; the page owns
 * the model and decides what to do with them. Slider drags fire `input` continuously (the map follows in real time)
 * and `change` once on release (which is what gets logged).
 *
 * Explanations live in `data-ps-tooltip` info buttons in the Twirl markup rather than in paragraphs here: a panel
 * of seven sliders is unreadable with a paragraph between every control.
 */
class AccessScoreSidebar {
  /**
   * Slider ceiling for a weight magnitude, at least this and always above the engine's largest default (see
   * `#maxWeight`), so a range input can never clamp a default it is asked to show.
   */
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
   * @param {Function} callback - The subscriber.
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
    for (const type of this.#config.scored_types) {
      const row = e.weightRows[type];
      row.input.value = state.weights[type];
      row.output.textContent = AccessScoreSidebar.#format(state.weights[type]);
    }
    e.showUnaudited.checked = state.showUnaudited;
    e.showClusters.checked = state.showClusters;
    e.showPlaces.checked = state.showPlaces;
    for (const [category, row] of Object.entries(e.placeRows)) {
      row.input.checked = state.placeCategories === null || state.placeCategories.includes(category);
      row.input.disabled = !state.showPlaces;
    }
    this.#showUnitOptions(state.unit);
    this.#updateWeightsSummary();
  }

  /** @param {Record<string, number>} counts - Places per category id, once the feed has arrived. */
  setPlaceCounts(counts) {
    const format = new Intl.NumberFormat(i18next.language);
    for (const [category, row] of Object.entries(this.#els.placeRows)) {
      row.count.textContent = format.format(counts[category] ?? 0);
    }
  }

  /** @param {boolean} show - True while the map sits below every enabled category's zoom. */
  setPlacesZoomHint(show) {
    this.#els.placesZoomHint.hidden = !show;
  }

  setPlacesUnavailable() {
    this.#els.placesControls.hidden = true;
    this.#els.placesZoomHint.hidden = true;
    this.#els.placesUnavailable.hidden = false;
  }

  /**
   * Draws each type's mean contribution as a small bar beside its slider, so the effect of a weight is visible in
   * the panel itself and not only on the map.
   * @param {Record<string, number>} means - Mean term per type (from `AccessScoreModel#contributions`).
   */
  setContributions(means) {
    const max = Math.max(0.05, ...Object.values(means).map((v) => Math.abs(v)));
    for (const type of this.#config.scored_types) {
      const row = this.#els.weightRows[type];
      const value = means[type] ?? 0;
      row.bar.style.width = `${Math.round((Math.abs(value) / max) * 100)}%`;
      row.bar.classList.toggle('acs-weight__bar--feature', value > 0);
      row.bar.classList.toggle('acs-weight__bar--problem', value < 0);
      row.barLabel.textContent = i18next.t('accessscore:row-avg',
        { value: (value >= 0 ? '+' : '−') + Math.abs(value).toFixed(2) });
    }
  }

  #render() {
    const root = this.#root;
    const weights = root.querySelector('#acs-weights');
    weights.innerHTML = this.#config.scored_types.map((type) => {
      const problem = this.#config.type_weights[type].base_weight < 0;
      const name = AccessScoreChart.typeName(type);
      const role = i18next.t(problem ? 'accessscore:row-hurts' : 'accessscore:row-helps');
      const roleTitle = i18next.t(problem ? 'accessscore:weight-problem' : 'accessscore:weight-feature');
      return `
        <div class="acs-weight" data-type="${type}">
          <div class="acs-weight__head">
            <img class="acs-weight__icon" src="${util.misc.getIconImagePaths(type).iconImagePath}" alt="">
            <label class="acs-weight__label" for="acs-weight-${type}">${name}</label>
            <span class="acs-weight__role acs-weight__role--${problem ? 'problem' : 'feature'}"
                  title="${roleTitle}">${role}</span>
            <output class="acs-weight__value" for="acs-weight-${type}"></output>
          </div>
          <input type="range" class="acs-range" id="acs-weight-${type}" min="0" max="${this.#maxWeight()}"
                 step="0.05" data-type="${type}">
          <div class="acs-weight__contrib" aria-hidden="true">
            <span class="acs-weight__bar"></span><span class="acs-weight__bar-label"></span>
          </div>
        </div>`;
    }).join('');

    const categories = this.#config.place_categories ?? [];
    const placeRows = root.querySelector('#acs-place-categories');
    placeRows.innerHTML = categories.map((category) => {
      const key = `accessscore:place-${category}`;
      const name = i18next.exists(key) ? i18next.t(key) : category;
      const icon = util.assetPath(`images/icons/${AccessScorePlacesLayer.presentation(category).icon}`);
      return `
        <div class="acs-check-row acs-place-row" data-category="${category}">
          <label class="acs-check acs-place" for="acs-place-${category}">
            <input type="checkbox" id="acs-place-${category}" data-category="${category}" checked>
            <span class="acs-place__icon" aria-hidden="true"><img src="${icon}" alt=""></span>
            <span class="acs-place__name">${name}</span>
            <span class="acs-place__count"></span>
          </label>
        </div>`;
    }).join('');

    this.#els = {
      unitInputs: Array.from(root.querySelectorAll('input[name="acs-unit"]')),
      weightRows: Object.fromEntries(this.#config.scored_types.map((type) => {
        const row = weights.querySelector(`.acs-weight[data-type="${type}"]`);
        return [type, {
          input: row.querySelector('input'),
          output: row.querySelector('output'),
          bar: row.querySelector('.acs-weight__bar'),
          barLabel: row.querySelector('.acs-weight__bar-label'),
        }];
      })),
      showUnaudited: root.querySelector('#acs-show-unaudited'),
      showClusters: root.querySelector('#acs-show-clusters'),
      showPlaces: root.querySelector('#acs-show-places'),
      placeRows: Object.fromEntries(categories.map((category) => {
        const row = placeRows.querySelector(`.acs-place-row[data-category="${category}"]`);
        return [category, { input: row.querySelector('input'), count: row.querySelector('.acs-place__count') }];
      })),
      placesControls: root.querySelector('#acs-places-controls'),
      placesZoomHint: root.querySelector('#acs-places-zoom-hint'),
      placesUnavailable: root.querySelector('#acs-places-unavailable'),
      reset: root.querySelector('#acs-reset'),
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
    for (const [type, row] of Object.entries(e.weightRows)) {
      const value = () => Number.parseFloat(row.input.value);
      const emitWeight = (final) =>
        this.#emit({ weights: { [type]: value() } }, { kind: 'Weight', value: `${type}_value=${value()}`, final });
      row.input.addEventListener('input', () => {
        row.output.textContent = AccessScoreSidebar.#format(value());
        this.#updateWeightsSummary();
        emitWeight(false);
      });
      row.input.addEventListener('change', () => emitWeight(true));
    }
    e.showUnaudited.addEventListener('change', () =>
      this.#emit({ showUnaudited: e.showUnaudited.checked },
        { kind: 'ShowUnaudited', value: e.showUnaudited.checked, final: true }));
    e.showClusters.addEventListener('change', () => this.#emit({ showClusters: e.showClusters.checked },
      { kind: 'ShowClusters', value: e.showClusters.checked, final: true }));
    e.showPlaces.addEventListener('change', () => {
      for (const row of Object.values(e.placeRows)) row.input.disabled = !e.showPlaces.checked;
      this.#emit({ showPlaces: e.showPlaces.checked },
        { kind: 'ShowPlaces', value: e.showPlaces.checked, final: true });
    });
    for (const [category, row] of Object.entries(e.placeRows)) {
      row.input.addEventListener('change', () => this.#emit({ placeCategories: this.#checkedPlaceCategories() },
        { kind: 'PlaceCategory', value: `${category}_value=${row.input.checked}`, final: true }));
    }
    e.reset.addEventListener('click', () => this.#emit(null, { kind: 'Reset', final: true }));
  }

  /** The enabled categories as the model states them: null when every row is checked, else the checked ids. */
  #checkedPlaceCategories() {
    const categories = this.#config.place_categories ?? [];
    const checked = categories.filter((category) => this.#els.placeRows[category].input.checked);
    return checked.length === categories.length ? null : checked;
  }

  /** The slider ceiling: `MAX_WEIGHT`, or the next whole number above the largest default if that is higher. */
  #maxWeight() {
    const largest = Math.max(0, ...Object.values(this.#config.presets.default).map((w) => Math.abs(w)));
    return Math.max(AccessScoreSidebar.MAX_WEIGHT, Math.ceil(largest) + 1);
  }

  /** The unaudited-streets toggle only means something in the streets unit. */
  #showUnitOptions(unit) {
    this.#els.streetOptions.hidden = unit !== 'streets';
  }

  /** Whether every slider sits on the engine's default magnitude. */
  #slidersAtDefault() {
    const defaults = this.#config.presets.default;
    return this.#config.scored_types.every((t) =>
      Math.abs(defaults[t] - Number.parseFloat(this.#els.weightRows[t].input.value)) < 1e-9);
  }

  #emit(partial, meta) {
    for (const listener of this.#listeners) listener(partial, meta);
  }

  static #format(value) {
    return `×${Number(value).toFixed(2)}`;
  }

  /** "Reset weights" only appears once a slider has moved; at the defaults there is nothing to reset. */
  #updateWeightsSummary() {
    this.#els.reset.hidden = this.#slidersAtDefault();
  }
}
