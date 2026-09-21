/**
 * What the sidebar reports with a change, which the page applies, logs, and hands the dock.
 * @typedef {object} AccessScoreChangeMeta
 * @property {string} kind - `Unit`, `Weight`, `ShowUnaudited`, `ShowClusters`, `ShowGrade`, `PlaceCategory`,
 *   `PlaceCategoryOnly`, `PlaceCategorySelectAll`, `PlaceCategoryDeselectAll`, `Section` or `Reset`; the slope panel's
 *   `SlopeWeight`, `SlopeStat`, `SlopeThreshold`, `SlopeBarrier`, `SlopeApproximate` and `SlopeReset`; and the
 *   page adds `ResetAll`.
 * @property {boolean} final - False for a slider mid-drag, true for a settled value (the one to log).
 * @property {string|boolean} [value] - What the change set, for the log.
 */

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
  /** @type {AccessScoreConfig} */
  #config;
  /** @type {Array<(partial: ?Partial<AccessScoreState>, meta: AccessScoreChangeMeta) => void>} */
  #listeners = [];
  #els = {};
  /** @type {AccessScoreSlopePanel} */
  #slope;

  /** The change kinds each section's "Updated" line answers for. */
  static #WEIGHT_KINDS = ['Weight', 'Preset', 'ResetAll'];
  static #SLOPE_KINDS = ['SlopeWeight', 'SlopeStat', 'SlopeThreshold', 'SlopeBarrier', 'SlopeApproximate',
    'SlopeReset', 'ResetAll'];

  /**
   * @param {HTMLElement} root - The `#filter-sidebar` element carrying the tool's section markup.
   * @param {AccessScoreConfig} config - The `/v3/api/accessScoreConfig` response.
   * @param {() => {reached: number, full: number, barriers: number, scored: number}} [slopeImpact] - The model's
   *   `slopeImpact`, for the line under the slope slider.
   */
  constructor(root, config, slopeImpact = () => null) {
    this.#root = root;
    this.#config = config;
    this.#render();
    this.#bind();
    // The slope section keeps its own controls and reports through the same channel as everything else here.
    this.#slope = new AccessScoreSlopePanel(root, config, (partial, meta) => this.#emit(partial, meta), slopeImpact);
  }

  /**
   * Says that the map has answered a control, once the model has recomputed. The recompute and the repaint carry no
   * motion, so without this a reader adjusting a weight has nothing telling them the map is live.
   * @param {AccessScoreChangeMeta} meta - The change; a drag's intermediate ticks do not flash.
   * @param {number} changed - How many scored streets the recompute moved.
   */
  afterRecompute(meta, changed) {
    if (AccessScoreSidebar.#SLOPE_KINDS.includes(meta.kind)) {
      this.#slope.refreshImpact();
      if (meta.final !== false) this.#flash(this.#slope.flashElement, changed);
    }
    if (AccessScoreSidebar.#WEIGHT_KINDS.includes(meta.kind) && meta.final !== false) {
      this.#flash(this.#els.weightsFlash, changed);
    }
  }

  /**
   * Fills a section's "Updated" line and restarts its fade.
   * @param {?HTMLElement} el - The line, absent in a layout that has none.
   * @param {number} changed - How many scored streets moved.
   */
  #flash(el, changed) {
    if (!el) return;
    el.textContent = i18next.t('accessscore:recalculated', { count: changed });
    el.classList.remove('acs-flash--on');
    // Reading back the layout restarts the animation on a change that lands while the last one is still fading.
    void el.offsetWidth;
    el.classList.add('acs-flash--on');
  }

  /** The Slope section, for the page to fold open when a link carries custom slope settings. */
  get slope() {
    return this.#slope;
  }

  /**
   * Subscribes to changes. The callback receives the partial state the change sets — null for a reset, which the
   * page resolves against the engine's defaults — and the change's meta, which says what moved and whether it settled.
   * @param {(partial: ?Partial<AccessScoreState>, meta: AccessScoreChangeMeta) => void} callback - The subscriber.
   */
  onChange(callback) {
    this.#listeners.push(callback);
  }

  /**
   * Syncs the controls to a model state without emitting a change (used on load and after a reset).
   * @param {AccessScoreState} state - An `AccessScoreModel` state.
   */
  setState(state) {
    const e = this.#els;
    e.unitInputs.forEach((input) => {
      input.checked = input.value === state.unit;
    });
    for (const type of this.#config.scored_types) {
      const row = e.weightRows[type];
      row.input.value = state.weights[type];
      AccessScoreSidebar.#showWeight(row, state.weights[type]);
    }
    e.showUnaudited.checked = state.showUnaudited;
    e.showGrade.checked = state.showGrade;
    this.#showGradeOptions(state.showGrade);
    e.showClusters.checked = state.showClusters;
    for (const [category, row] of Object.entries(e.placeRows)) {
      row.input.checked = state.placeCategories === null || state.placeCategories.includes(category);
    }
    this.#slope.setState(state);
    this.#showUnitOptions(state.unit);
    this.#updateWeightsSummary();
    this.#updatePlacesAction();
  }

  /** @param {Record<string, number>} counts - Places per category id, once the feed has arrived. */
  setPlaceCounts(counts) {
    const format = new Intl.NumberFormat(i18next.language);
    for (const [category, row] of Object.entries(this.#els.placeRows)) {
      row.count.textContent = format.format(counts[category] ?? 0);
    }
  }

  setPlacesUnavailable() {
    this.setPlacesOpen(false);
    this.#els.placesToggle.disabled = true;
    this.#els.placesToggleAll.hidden = true;
    this.#els.placesSummary.textContent = '';
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
      // "Only" is the shared filter sidebar's exclusive select; its visible text gets the row's name for a screen
      // reader, since the button swaps in for the count on hover and focus and reads as a bare "Only" otherwise.
      return `
        <div class="acs-check-row acs-place-row" data-category="${category}">
          <label class="acs-check acs-place" for="acs-place-${category}">
            <input type="checkbox" id="acs-place-${category}" data-category="${category}" checked>
            <span class="acs-place__icon" aria-hidden="true"><img src="${icon}" alt=""></span>
            <span class="acs-place__name">${name}</span>
          </label>
          <span class="acs-place__slot">
            <span class="acs-place__count"></span>
            <button type="button" class="filter-sidebar__only" data-category="${category}"
                    aria-label="${i18next.t('common:only')}: ${name}">${i18next.t('common:only')}</button>
          </span>
        </div>`;
    }).join('');

    this.#els = {
      unitInputs: Array.from(root.querySelectorAll('input[name="acs-unit"]')),
      weightRows: Object.fromEntries(this.#config.scored_types.map((type) => {
        const row = weights.querySelector(`.acs-weight[data-type="${type}"]`);
        return [type, {
          root: row,
          input: row.querySelector('input'),
          output: row.querySelector('output'),
          bar: row.querySelector('.acs-weight__bar'),
          barLabel: row.querySelector('.acs-weight__bar-label'),
        }];
      })),
      weightsFlash: root.querySelector('#acs-weights-flash'),
      showUnaudited: root.querySelector('#acs-show-unaudited'),
      showGrade: root.querySelector('#acs-show-grade'),
      gradeOption: root.querySelector('#acs-grade-option'),
      showClusters: root.querySelector('#acs-show-clusters'),
      placeRows: Object.fromEntries(categories.map((category) => {
        const row = placeRows.querySelector(`.acs-place-row[data-category="${category}"]`);
        return [category, {
          input: row.querySelector('input'),
          count: row.querySelector('.acs-place__count'),
          only: row.querySelector('.filter-sidebar__only'),
        }];
      })),
      placesToggleAll: root.querySelector('#acs-places-toggle-all'),
      placesToggle: root.querySelector('#acs-places-toggle'),
      placesSummary: root.querySelector('#acs-places-summary'),
      placeCategories: placeRows,
      placesUnavailable: root.querySelector('#acs-places-unavailable'),
      reset: root.querySelector('#acs-reset'),
      weightsToggle: root.querySelector('#acs-weights-toggle'),
      weights: root.querySelector('#acs-weights'),
      weightsSummary: root.querySelector('#acs-weights-summary'),
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
        AccessScoreSidebar.#showWeight(row, value());
        this.#updateWeightsSummary();
        emitWeight(false);
      });
      row.input.addEventListener('change', () => emitWeight(true));
    }
    e.showUnaudited.addEventListener('change', () =>
      this.#emit({ showUnaudited: e.showUnaudited.checked },
        { kind: 'ShowUnaudited', value: e.showUnaudited.checked, final: true }));
    e.showGrade.addEventListener('change', () => {
      this.#showGradeOptions(e.showGrade.checked);
      this.#emit({ showGrade: e.showGrade.checked }, { kind: 'ShowGrade', value: e.showGrade.checked, final: true });
    });
    e.showClusters.addEventListener('change', () => this.#emit({ showClusters: e.showClusters.checked },
      { kind: 'ShowClusters', value: e.showClusters.checked, final: true }));
    // The shared filter sidebar's section action: it offers whichever of the two has the most left to give, so
    // after one "Only" click it reads "Select all" rather than clearing the one row left.
    e.placesToggleAll.addEventListener('click', () => {
      const checked = this.#checkedPlaceCategories() !== null;
      for (const row of Object.values(e.placeRows)) row.input.checked = checked;
      this.#emitPlaceCategories({ kind: checked ? 'PlaceCategorySelectAll' : 'PlaceCategoryDeselectAll' });
    });
    for (const [category, row] of Object.entries(e.placeRows)) {
      row.input.addEventListener('change', () => this.#emitPlaceCategories(
        { kind: 'PlaceCategory', value: `${category}_value=${row.input.checked}` }));
      row.only.addEventListener('click', () => {
        for (const [other, otherRow] of Object.entries(e.placeRows)) otherRow.input.checked = other === category;
        this.#emitPlaceCategories({ kind: 'PlaceCategoryOnly', value: category });
      });
    }
    e.reset.addEventListener('click', () => this.#emit(null, { kind: 'Reset', final: true }));
    // Opening a fold is worth knowing about: it says whether people reach for the weights or the places at all.
    e.weightsToggle.addEventListener('click', () => {
      const open = this.setWeightsOpen(!this.weightsOpen);
      this.#emit(null, { kind: 'Section', value: `weights_open=${open}`, final: true });
    });
    e.placesToggle.addEventListener('click', () => {
      const open = this.setPlacesOpen(!this.placesOpen);
      this.#emit(null, { kind: 'Section', value: `places_open=${open}`, final: true });
    });
  }

  /** @returns {boolean} Whether the weights section is unfolded. */
  get weightsOpen() {
    return this.#els.weightsToggle.getAttribute('aria-expanded') === 'true';
  }

  /**
   * Folds or unfolds the weights section without emitting a change; the page opens it for a link with custom weights.
   * @param {boolean} open - True to show the sliders.
   * @returns {boolean} The state now in force.
   */
  setWeightsOpen(open) {
    return AccessScoreSidebar.#setFold(this.#els.weightsToggle, this.#els.weights, open);
  }

  /** @returns {boolean} Whether the places section is unfolded. */
  get placesOpen() {
    return this.#els.placesToggle.getAttribute('aria-expanded') === 'true';
  }

  /**
   * Folds or unfolds the places section without emitting a change; the page opens it for a link with places on.
   * @param {boolean} open - True to show the category rows.
   * @returns {boolean} The state now in force.
   */
  setPlacesOpen(open) {
    return AccessScoreSidebar.#setFold(this.#els.placesToggle, this.#els.placeCategories, open);
  }

  /** The accordion mechanics both folds share: the heading button's state, the body, and the chevron. */
  static #setFold(toggle, body, open) {
    toggle.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    const chevron = toggle.querySelector('img');
    chevron.src = open ? chevron.dataset.upSrc : chevron.dataset.downSrc;
    return open;
  }

  /** Reports the category rows as they now stand, after any of the three ways they change. */
  #emitPlaceCategories(meta) {
    this.#updatePlacesAction();
    this.#emit({ placeCategories: this.#checkedPlaceCategories() }, { ...meta, final: true });
  }

  /** The enabled categories as the model states them: null when every row is checked, else the checked ids. */
  #checkedPlaceCategories() {
    const categories = this.#config.place_categories ?? [];
    const checked = categories.filter((category) => this.#els.placeRows[category].input.checked);
    return checked.length === categories.length ? null : checked;
  }

  /**
   * The section action reads as what a click would do: "Deselect all" with every row on, "Select all" otherwise.
   * The hint beside the folded heading counts the rows that are on, since that is what a fold would otherwise hide.
   */
  #updatePlacesAction() {
    const categories = this.#config.place_categories ?? [];
    const on = categories.filter((category) => this.#els.placeRows[category].input.checked).length;
    const allOn = on === categories.length;
    this.#els.placesToggleAll.textContent = i18next.t(allOn ? 'labelmap:deselect-all' : 'labelmap:select-all');
    this.#els.placesSummary.textContent = on === 0
      ? ''
      : i18next.t('accessscore:places-summary', { count: on, total: categories.length });
  }

  /** The slider ceiling: `MAX_WEIGHT`, or the next whole number above the largest default if that is higher. */
  #maxWeight() {
    const largest = Math.max(0, ...Object.values(this.#config.presets.default).map((w) => Math.abs(w)));
    return Math.max(AccessScoreSidebar.MAX_WEIGHT, Math.ceil(largest) + 1);
  }

  /**
   * The street-only toggles mean nothing in the regions unit, and the slope toggle nothing in a city whose streets
   * have not been sampled: the config lists the elevation models in use, and an empty list is that city.
   */
  #showUnitOptions(unit) {
    this.#els.streetOptions.hidden = unit !== 'streets';
    const gradient = this.#config.gradient;
    const sampled = Boolean(gradient && gradient.sources.length > 0 && gradient.map_class_breaks.length > 0);
    this.#els.gradeOption.hidden = unit !== 'streets' || !sampled;
  }

  /**
   * "Show unaudited streets" decides nothing while the streets are colored by slope, which draws every street with
   * a grade whether or not anyone has audited it. A checkbox that still toggled, reached the URL and was logged
   * while changing nothing on the map would read as broken, so it is disabled for as long as that holds (its help
   * says why) and keeps its value for when the score coloring returns.
   * @param {boolean} showGrade - Whether the streets are colored by slope.
   */
  #showGradeOptions(showGrade) {
    this.#els.showUnaudited.disabled = showGrade;
    this.#els.streetOptions.classList.toggle('acs-check-row--disabled', showGrade);
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

  /**
   * Writes a weight into its row's output. At 0 the type is out of the score entirely, which "×0.00" states only
   * to a reader who does the arithmetic, so the row says "Off" and mutes.
   * @param {{root: HTMLElement, output: HTMLElement}} row - The weight row.
   * @param {number} value - The weight in force.
   */
  static #showWeight(row, value) {
    const off = Number(value) === 0;
    row.output.textContent = off ? i18next.t('accessscore:weight-off') : AccessScoreSidebar.#format(value);
    row.root.classList.toggle('acs-weight--off', off);
  }

  /**
   * "Reset weights" only appears once a slider has moved; at the defaults there is nothing to reset. The hint
   * beside the folded heading says the same thing for a reader who cannot see the sliders.
   */
  #updateWeightsSummary() {
    const atDefault = this.#slidersAtDefault();
    this.#els.reset.hidden = atDefault;
    this.#els.weightsSummary.textContent = atDefault ? '' : i18next.t('accessscore:weights-custom');
  }
}
