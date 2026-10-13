/**
 * Something allowed only while nothing holds it shut (shortcuts, walking, panning, labeling, the tool under a pop-up).
 * Holders are named and the gate opens only once every one has let go: a label finishing its load behind Validate's
 * mission-complete screen must not wake the shortcuts under it (#5752), and one Explore dialog closing under another
 * must not hand the tool back early. Its own object because the holders are built long before the owner, which
 * reacts through onChanged rather than being told by each holder.
 */
export class Gate {
  /** @type {Set<string>} */
  #holds = new Set();

  /** @type {Array<(held: boolean, holder: string) => void>} */
  #listeners = [];

  /**
   * Told whenever the gate goes from open to held or back, with the holder that tipped it.
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
    const wasHeld = this.isHeld();
    this.#holds.add(holder);
    if (!wasHeld) this.#listeners.forEach((listener) => listener(true, holder));
  }

  /**
   * Lets this holder's hold go; the gate opens once no holder is left.
   * @param {string} holder
   */
  release(holder) {
    if (!this.#holds.delete(holder)) return;
    if (!this.isHeld()) this.#listeners.forEach((listener) => listener(false, holder));
  }

  /** @returns {boolean} Whether anything still holds the gate shut. */
  isHeld() {
    return this.#holds.size > 0;
  }

  /**
   * Whether anything but the named holder holds the gate shut: a hold that always lifts on its own (a move in
   * flight) versus one that may not (a modal, the tutorial).
   * @param {string} holder
   * @returns {boolean}
   */
  isHeldExcept(holder) {
    return this.#holds.size > (this.#holds.has(holder) ? 1 : 0);
  }
}
