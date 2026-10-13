/**
 * Which label type is armed ('Walk' when none is). The ribbon's buttons and the keyboard both switch through here, and
 * what follows a switch subscribes to onModeChanged. Switching is the `switching` gate: a pop-up and a description
 * being typed hold it; the tutorial holds it and lets one type through at a time (enableMode).
 */

import { Gate } from '../../common/Gate.js';
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class LabelModes {
  #tracker;

  /** @type {string} 'Walk' or a label type. */
  #mode = 'Walk';

  /**
   * Whether a mode may be switched to at all. The ribbon's buttons dim while it is held.
   * @type {Gate}
   */
  switching = new Gate();

  /**
   * The modes let through while switching is held. 'OuterOther' is the ribbon's Other button as opposed to the
   * Other entry in its menu, which the tutorial enables separately.
   * @type {Set<string>}
   */
  #enabledWhileHeld = new Set();

  /** @type {Array<(mode: string) => void>} */
  #modeChangedListeners = [];

  /** @type {Array<() => void>} */
  #availabilityChangedListeners = [];

  /**
   * @param {Tracker} tracker - Logs each switch.
   */
  constructor(tracker) {
    this.#tracker = tracker;
    // Holding or releasing the gate changes every mode's availability; so does each exception made under it.
    this.switching.onChanged((held) => {
      if (!held) this.#enabledWhileHeld.clear();
      this.#availabilityChangedListeners.forEach((listener) => listener());
    });
  }

  /**
   * Told when the mode switches, with the new mode: 'Walk' or a label type.
   * @param {(mode: string) => void} listener
   * @returns {() => void} Stops telling it; the tutorial listens for one step at a time.
   */
  onModeChanged(listener) {
    this.#modeChangedListeners.push(listener);
    return () => {
      this.#modeChangedListeners = this.#modeChangedListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Told when which modes are usable changes (isUsable), so the ribbon can dim and undim its buttons.
   * @param {() => void} listener
   */
  onAvailabilityChanged(listener) {
    this.#availabilityChangedListeners.push(listener);
  }

  /** @returns {string} 'Walk' or the armed label type. */
  getMode() {
    return this.#mode;
  }

  /** @returns {string|undefined} The armed label type, or undefined in Walk mode. */
  getSelectedLabelType() {
    return this.#mode === 'Walk' ? undefined : this.#mode;
  }

  /**
   * Whether a mode may be switched to now.
   * @param {string} mode - 'Walk', a label type, or 'OuterOther' for the ribbon's Other button.
   * @returns {boolean}
   */
  isUsable(mode) {
    return !this.switching.isHeld() || this.#enabledWhileHeld.has(mode);
  }

  /**
   * Switches the mode, if it is usable. Logged either way, since the attempt says what the labeler wanted.
   * @param {string} mode - 'Walk' or a label type.
   */
  switchTo(mode) {
    this.#tracker.push(`ModeSwitch_${mode}`);
    if (!this.isUsable(mode)) return;
    this.#mode = mode;
    this.#modeChangedListeners.forEach((listener) => listener(mode));
  }

  /** Disarms the label type. */
  backToWalk() {
    this.switchTo('Walk');
  }

  /**
   * Lets a mode through while switching is held (the tutorial, one step at a time).
   * @param {string} labelType - A label type, 'Walk', or 'Other' for the ribbon's Other button.
   * @param {string} [subLabelType] - An entry in the Other menu to let through with it.
   */
  enableMode(labelType, subLabelType) {
    this.#enabledWhileHeld.add(labelType === 'Other' ? 'OuterOther' : labelType);
    if (subLabelType) this.#enabledWhileHeld.add(subLabelType);
    this.#availabilityChangedListeners.forEach((listener) => listener());
  }

  /**
   * Stops letting a mode through while switching is held.
   * @param {string} labelType - As for enableMode.
   * @param {string} [subLabelType]
   */
  disableMode(labelType, subLabelType) {
    this.#enabledWhileHeld.delete(labelType === 'Other' ? 'OuterOther' : labelType);
    if (subLabelType) this.#enabledWhileHeld.delete(subLabelType);
    this.#availabilityChangedListeners.forEach((listener) => listener());
  }
}
