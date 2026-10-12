/**
 * The pause on Validate's keyboard shortcuts, read by KeyboardManager before it runs one.
 *
 * Each thing that needs the shortcuts paused (a modal, the tutorial, a loading label, the sign-in dialog) holds it
 * under its own name, and the shortcuts stay off until every holder has let go: the next mission's first label
 * finishes loading behind the mission-complete screen, and that must not wake them under it (#5752). A separate
 * object rather than a flag on the manager because the modals are built long before the manager can be, and because
 * the phone has modals but no shortcuts: there the holds are taken and nothing reads them.
 */
export class KeyboardLock {
  /** @type {Set<string>} */
  #holds = new Set();

  /**
   * Pauses the shortcuts until the same holder releases them. Taking a hold twice is one hold.
   * @param {string} holder - What needs them paused.
   */
  hold(holder) {
    this.#holds.add(holder);
  }

  /**
   * Lets this holder's pause go; the shortcuts resume once no holder is left.
   * @param {string} holder
   */
  release(holder) {
    this.#holds.delete(holder);
  }

  /** @returns {boolean} Whether anything still holds the shortcuts paused. */
  isDisabled() {
    return this.#holds.size > 0;
  }
}
