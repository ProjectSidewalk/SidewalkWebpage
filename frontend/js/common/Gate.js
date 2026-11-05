/**
 * Something allowed only while nothing holds it shut (shortcuts, walking, panning, labeling). Holders are named and
 * the gate opens only once all have let go, so a dialog closing under another can't hand the tool back early (#5752).
 */
export class Gate {
  /** @type {Set<string>} */
  #holds = new Set();

  /** @type {Array<(held: boolean) => void>} */
  #listeners = [];

  /**
   * Told when the gate shuts or opens; a second hold, or a release that leaves another, changes nothing.
   * @param {(held: boolean) => void} listener
   */
  onChanged(listener) {
    this.#listeners.push(listener);
  }

  /**
   * Holds the gate shut until the same holder releases it. Taking a hold twice is one hold.
   * @param {string} holder - What needs it shut.
   */
  hold(holder) {
    if (this.#holds.has(holder)) return;
    this.#holds.add(holder);
    if (this.#holds.size === 1) this.#listeners.forEach((listener) => listener(true));
  }

  /**
   * Lets this holder's hold go; the gate opens once no holder is left.
   * @param {string} holder
   */
  release(holder) {
    if (!this.#holds.delete(holder)) return;
    if (!this.isHeld()) this.#listeners.forEach((listener) => listener(false));
  }

  /** @returns {boolean} Whether anything still holds the gate shut. */
  isHeld() {
    return this.#holds.size > 0;
  }
}
