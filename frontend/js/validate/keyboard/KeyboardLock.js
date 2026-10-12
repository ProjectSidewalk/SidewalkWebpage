/**
 * The pause on Validate's keyboard shortcuts, read by KeyboardManager before it runs one.
 *
 * Everything that needs the shortcuts paused holds it under its own name: a modal while it is up, a label while its
 * pano loads, the sign-in dialog. The shortcuts stay off until every holder has let go, because the holds overlap:
 * the next mission's first label loads and lands behind the mission-complete screen, and the end of that load must
 * not switch the shortcuts back on under the screen (#5752). A separate object rather than a flag on the manager
 * because the modals are built long before the manager can be (its shortcuts act on the whole tool), and because the
 * mobile page has modals but no shortcuts at all: there the holds are taken and nothing reads them.
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
