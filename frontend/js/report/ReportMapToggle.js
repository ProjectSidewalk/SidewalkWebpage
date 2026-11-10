/**
 * A switch in a report map's corner, as a MapLibre control: a reader turns a layer on or off on the map they're looking
 * at, not in a sidebar away from it, and each map has its own since a neighborhood map and a block map needn't agree.
 * The "Places" switch (#5900) and the aligned-labels switch (#5888) are two of these.
 */

export class ReportMapToggle {
  static #nextId = 0;

  /** @type {?HTMLElement} */ #root = null;
  /** @type {?HTMLInputElement} */ #input = null;
  /** @type {?HTMLElement} */ #noteElement = null;
  #text;
  /** @type {?string} */ #note;
  #checked;
  /** @type {(shown: boolean) => void} */ #onChange;

  /**
   * @param {object} options
   * @param {string} options.text - The switch's label, already translated.
   * @param {?string} [options.note=null] - A caveat shown under the switch while it is on, and read with it always.
   * @param {boolean} [options.checked=true] - Whether it starts on.
   * @param {(shown: boolean) => void} options.onChange - Called with the new state when the reader flips it.
   */
  constructor({ text, note = null, checked = true, onChange }) {
    this.#text = text;
    this.#note = note;
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
    text.textContent = this.#text;
    label.append(input, text);
    root.append(label);
    if (this.#note) {
      const note = document.createElement('span');
      note.className = 'report-map-toggle__note';
      note.id = `report-map-toggle-note-${ReportMapToggle.#nextId++}`;
      note.textContent = this.#note;
      // Described whether or not it shows: a screen reader hears the caveat before turning it on, a sighted reader
      // once it matters.
      input.setAttribute('aria-describedby', note.id);
      note.hidden = !this.#checked;
      root.append(note);
      this.#noteElement = note;
    }
    input.addEventListener('change', () => {
      this.#checked = input.checked;
      if (this.#noteElement) this.#noteElement.hidden = !input.checked;
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
    this.#noteElement = null;
  }

  /** @returns {import('maplibre-gl').ControlPosition} Where the map puts it: clear of the zoom buttons and legend. */
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
    if (this.#noteElement) this.#noteElement.hidden = !checked;
  }
}
