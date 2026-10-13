/**
 * Something allowed only while nothing holds it shut (shortcuts, walking, panning, labeling). Holders are named and
 * the gate opens only once all have let go, so a dialog closing under another can't hand the tool back early (#5752).
 */
export class Gate {
  /** @type {Set<string>} */
  #holds = new Set();

  /** @type {Array<(held: boolean, holder: string) => void>} */
  #listeners = [];

  /**
   * Told of each hold taken and let go, with whether the gate is still held: a listener that ignores one holder (the
   * forward crumbs ignore a move's) must still see the others come and go.
   * @param {(held: boolean, holder: string) => void} listener
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
    this.#listeners.forEach((listener) => listener(true, holder));
  }

  /**
   * Lets this holder's hold go; the gate opens once no holder is left.
   * @param {string} holder
   */
  release(holder) {
    if (!this.#holds.delete(holder)) return;
    const held = this.isHeld();
    this.#listeners.forEach((listener) => listener(held, holder));
  }

  /** @returns {boolean} Whether anything still holds the gate shut. */
  isHeld() {
    return this.#holds.size > 0;
  }

  /**
   * Whether anything but the named holder holds the gate shut, telling a hold that lifts on its own from a modal's.
   * @param {string} holder
   * @returns {boolean}
   */
  isHeldExcept(holder) {
    return this.#holds.size > (this.#holds.has(holder) ? 1 : 0);
  }
}
