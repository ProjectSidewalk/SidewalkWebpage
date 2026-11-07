/**
 * The "Places" switch in a report map's corner (#5900), a MapLibre control: a reader turns the places off on the map
 * they're looking at, not in a sidebar away from it, and each map has its own since a neighborhood map and a block map
 * needn't agree.
 */

import i18next from 'i18next';

export class ReportPlacesToggle {
  /** @type {?HTMLElement} */ #root = null;
  /** @type {?HTMLInputElement} */ #input = null;
  #checked;
  /** @type {(shown: boolean) => void} */ #onChange;

  /**
   * @param {object} options
   * @param {boolean} [options.checked=true] - Whether the places start shown.
   * @param {(shown: boolean) => void} options.onChange - Called with the new state when the reader flips it.
   */
  constructor({ checked = true, onChange }) {
    this.#checked = checked;
    this.#onChange = onChange;
  }

  /**
   * MapLibre `IControl` hook: builds the switch.
   * @returns {HTMLElement} The control's root, which the map places in its corner.
   */
  onAdd() {
    const root = document.createElement('div');
    root.className = 'maplibregl-ctrl report-map-toggle';
    const label = document.createElement('label');
    label.className = 'report-map-toggle__label';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'report-map-toggle__input';
    input.checked = this.#checked;
    const text = document.createElement('span');
    // The AccessScore tool's own word for them, so the two read as one control.
    text.textContent = i18next.t('accessscore:places');
    label.append(input, text);
    root.append(label);
    input.addEventListener('change', () => {
      this.#checked = input.checked;
      this.#onChange(input.checked);
    });
    this.#root = root;
    this.#input = input;
    return root;
  }

  /** MapLibre `IControl` hook: takes the switch down with the map. */
  onRemove() {
    this.#root?.remove();
    this.#root = null;
    this.#input = null;
  }

  /**
   * @returns {import('maplibre-gl').ControlPosition} Where the map puts it: away from the zoom buttons and the legend.
   */
  getDefaultPosition() {
    return 'top-left';
  }

  /**
   * Shows a state set from outside, without reporting it back as a change.
   * @param {boolean} checked
   */
  setChecked(checked) {
    this.#checked = checked;
    if (this.#input) this.#input.checked = checked;
  }
}
