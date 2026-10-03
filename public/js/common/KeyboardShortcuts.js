/**
 * @typedef {object} KeyboardShortcut - One row of a shortcut table in Explore's or Validate's KeyboardManager.
 * @property {string[]} keys - Keys that fire it, named as `keyOf` names them.
 * @property {(e: KeyboardEvent) => boolean} [when] - Only fires when this is true.
 * @property {(e: KeyboardEvent) => void} action - What it does.
 */

/** Runs the shortcut tables in Explore's and Validate's KeyboardManagers. */
class KeyboardShortcuts {
  static #NAMED_KEYS = new Set(['Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

  /**
   * Runs every shortcut in the list that the key press matches.
   * @param {KeyboardShortcut[]} shortcuts
   * @param {KeyboardEvent} e
   * @returns {boolean} Whether any shortcut ran.
   */
  static run(shortcuts, e) {
    const key = KeyboardShortcuts.keyOf(e);
    let ran = false;
    for (const shortcut of shortcuts) {
      if (shortcut.keys.includes(key) && (shortcut.when?.(e) ?? true)) {
        shortcut.action(e);
        ran = true;
      }
    }
    return ran;
  }

  /**
   * Names a key press the way shortcut rows do (`KeyA`, `Digit1`, `Enter`). Letters go by what's printed on the key, to
   * match the hints on any layout. Enter, Escape and arrows go by name. Everything else goes by the key's position,
   * which keeps digits and non-Latin keyboards working.
   * @param {KeyboardEvent} e
   * @returns {string}
   */
  static keyOf(e) {
    if (/^[a-z]$/i.test(e.key)) return `Key${e.key.toUpperCase()}`;
    if (e.key === ' ') return 'Space';
    if (KeyboardShortcuts.#NAMED_KEYS.has(e.key)) return e.key;
    return e.code;
  }
}
