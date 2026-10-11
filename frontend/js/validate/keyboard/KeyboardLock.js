/**
 * The on/off switch for Validate's keyboard shortcuts.
 *
 * Shared by everything that needs the shortcuts paused — a modal while it is up, a label while its pano loads, the
 * sign-in dialog — and read by KeyboardManager before it runs one. A separate object rather than a flag on the
 * manager because the modals are built long before the manager can be (its shortcuts act on the whole tool), and
 * because the mobile page has modals but no shortcuts at all: there the switch is flipped and nothing reads it.
 */
export class KeyboardLock {
  #disabled = false;

  /** Pauses the shortcuts. */
  disableKeyboard() {
    this.#disabled = true;
  }

  /** Resumes the shortcuts. */
  enableKeyboard() {
    this.#disabled = false;
  }

  /** @returns {boolean} Whether the shortcuts are paused. */
  isDisabled() {
    return this.#disabled;
  }
}
