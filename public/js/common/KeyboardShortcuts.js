/**
 * @typedef {object} KeyboardShortcut - One row of a shortcut table in Explore's or Validate's KeyboardManager.
 * @property {string[]} keys - Any of these fires it, named as `KeyboardShortcuts.keyOf` names a key press.
 * @property {(e: KeyboardEvent) => boolean} [when] - Only fires when this is true.
 * @property {(e: KeyboardEvent) => void} action - What it does.
 */

/**
 * Matches key presses against the shortcut tables in Explore's and Validate's KeyboardManagers.
 */
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
   * Which key a press counts as, in `KeyboardEvent.code` terms (`KeyA`, `Digit1`, `Enter`). A Latin letter goes by the
   * letter printed on the key, since that's what the UI's hints show, so an AZERTY A is `KeyA`. Enter, Escape and the
   * arrows go by name, so the numpad's arrows with NumLock off still count. Anything else goes by where the key sits,
   * which keeps the digit row working on AZERTY and the letter shortcuts working on non-Latin layouts and IMEs.
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
