/**
 * The show/hide-label control, shared by Validate and the label detail card (#2477). Hiding the marker is how
 * someone sees what it covers. This owns the state and the buttons' wording; moving the markers is the host's job.
 */
class LabelVisibilityToggle {
  // Inline rather than image files so each icon takes its button's own colour: one home is a dark overlay pill,
  // the other a light chip (#4726).
  static #ICON_EYE_OFF = `<svg class="hide-label-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1
      12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>`;

  static #ICON_EYE_ON = `<svg class="hide-label-button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;

  /** Class the host puts on a marker to hide it; styled in main.css beside the marker's own rules. */
  static HIDDEN_CLASS = 'label-marker--hidden';

  #buttons;
  #text;
  #onChange;
  #visible = true;

  /**
   * @param {Object} opts
   * @param {HTMLElement[]} opts.buttons - Every button that runs the toggle; they always read the same.
   * @param {{hide: string, show: string, hideTooltip: string, showTooltip: string}} opts.text - Translated
   *     wording for each direction.
   * @param {function(boolean, {viaClick: boolean}): void} opts.onChange - Handed each applied visibility, for the
   *     host to move its markers and log the interaction.
   */
  constructor({ buttons, text, onChange }) {
    this.#buttons = buttons.filter(Boolean);
    this.#text = text;
    this.#onChange = onChange;
    for (const button of this.#buttons) button.addEventListener('click', () => this.toggle({ viaClick: true }));
    this.setVisible(true);
  }

  /** @returns {boolean} True while the label is showing. */
  isVisible() {
    return this.#visible;
  }

  /** @param {{viaClick?: boolean}} [detail] - Forwarded to onChange; see setVisible. */
  toggle(detail) {
    this.setVisible(!this.#visible, detail);
  }

  /**
   * Applies a visibility, relabeling the buttons and notifying the host. Runs even when the value is unchanged:
   * that call is how a host re-asserts the state onto a marker it rebuilt for the next label.
   *
   * @param {boolean} visible - Whether the label should be showing.
   * @param {Object} [detail]
   * @param {boolean} [detail.viaClick] - Came from clicking one of these buttons rather than a keyboard shortcut
   *     or a host re-assert. Hosts log the two differently.
   */
  setVisible(visible, { viaClick = false } = {}) {
    this.#visible = visible;
    const icon = visible ? LabelVisibilityToggle.#ICON_EYE_OFF : LabelVisibilityToggle.#ICON_EYE_ON;
    const text = visible ? this.#text.hide : this.#text.show;
    const tooltip = visible ? this.#text.hideTooltip : this.#text.showTooltip;
    for (const button of this.#buttons) {
      // HTML, not text: Validate's translations underline the keyboard shortcut inline ("<u>H</u>ide Label").
      button.innerHTML = `${icon}<span>${text}</span>`;
      button.setAttribute('data-ps-tooltip', tooltip);
    }
    this.#onChange?.(visible, { viaClick });
  }
}
