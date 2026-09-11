/**
 * The AccessScore map's own legend (#5217), a Mapbox control beside the zoom buttons: the ramp between its numeric
 * ends, the pole words, the no-score swatch for the active unit, and a caret at the hovered or selected score.
 * The dock's histogram is the fuller legend; this one keeps the ramp's meaning on screen when the dock is collapsed
 * or scrolled off a phone's viewport.
 */
class AccessScoreMapLegend {
  #container = null;
  #bar = null;
  #caret = null;
  #swatch = null;
  #swatchLabel = null;

  /**
   * Mapbox `IControl` hook: builds the legend's DOM.
   * @returns {HTMLElement} The control's root, which Mapbox places in the chosen corner.
   */
  onAdd() {
    const root = document.createElement('div');
    root.className = 'mapboxgl-ctrl acs-map-legend';
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', i18next.t('accessscore:legend'));
    root.innerHTML = `
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
      </div>`;
    this.#container = root;
    this.#bar = root.querySelector('.acs-map-legend__bar');
    this.#caret = root.querySelector('.acs-map-legend__caret');
    this.#swatch = root.querySelector('.acs-map-legend__swatch');
    this.#swatchLabel = root.querySelector('.acs-map-legend__none-label');
    // The ramp is data, not styling: read from the tokens at build time, like every other ramp consumer.
    this.#bar.style.background = ScoreRamp.cssGradient();
    return root;
  }

  onRemove() {
    this.#container?.remove();
    this.#container = null;
  }

  /**
   * Swaps the no-score swatch for the unit: a thin grey line for an unaudited street, the hatch for a neighborhood
   * under the completion floor.
   * @param {string} unit - 'streets' or 'regions'.
   */
  setUnit(unit) {
    if (!this.#container) return;
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
