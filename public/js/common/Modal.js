/**
 * Thin wrapper over a native <dialog> that adds an intentional, drag-safe click-outside-to-close and focus
 * restoration (#4375, fixes #4374).
 *
 * The native element already provides the hard parts — focus trap, Esc-to-close, ::backdrop, and background
 * inertness — and its backdrop does NOT close on outside-click by default. This class closes on a backdrop click
 * only when BOTH the pointerdown and the click landed outside the dialog's content box, so a text-selection drag
 * that starts inside the dialog and releases outside can never dismiss it.
 *
 * Lifecycle events dispatched on the <dialog> element (all bubble): `ps:modal:show` (about to open),
 * `ps:modal:shown` (opened), `ps:modal:hidden` (closed).
 */
class Modal {
  #dialog;

  #opener = null;

  #pressStartedOutside = false;

  /**
   * @param {HTMLDialogElement} dialog - The <dialog> element to manage.
   */
  constructor(dialog) {
    this.#dialog = dialog;

    // Track where the press began so a drag out of the dialog can't count as a backdrop click.
    dialog.addEventListener('pointerdown', (e) => {
      this.#pressStartedOutside = this.#isOutsideContent(e);
    });
    dialog.addEventListener('click', (e) => {
      if (this.#pressStartedOutside && this.#isOutsideContent(e)) this.close();
    });

    // Fires on every close path (close(), Esc/cancel, form method=dialog), so cleanup lives here.
    dialog.addEventListener('close', () => {
      dialog.dispatchEvent(new CustomEvent('ps:modal:hidden', { bubbles: true }));
      this.#opener?.focus?.();
      this.#opener = null;
    });
  }

  /**
   * Opens the dialog modally, remembering the trigger element so focus can return to it on close.
   */
  open() {
    if (this.#dialog.open) return;
    this.#opener = document.activeElement;
    this.#dialog.dispatchEvent(new CustomEvent('ps:modal:show', { bubbles: true }));
    this.#dialog.showModal();
    this.#dialog.dispatchEvent(new CustomEvent('ps:modal:shown', { bubbles: true }));
  }

  /**
   * Closes the dialog (no-op if it isn't open).
   */
  close() {
    if (this.#dialog.open) this.#dialog.close();
  }

  /**
   * @returns {HTMLDialogElement} The managed <dialog> element.
   */
  get element() {
    return this.#dialog;
  }

  /**
   * True when a pointer event landed on the backdrop rather than the dialog's content box. Backdrop clicks report
   * the <dialog> itself as the target, so the content-box test is what distinguishes padding from backdrop.
   *
   * @param {MouseEvent} e - The pointer/click event to test.
   * @returns {boolean} Whether the event coordinates fall outside the dialog's bounding box.
   */
  #isOutsideContent(e) {
    if (e.target !== this.#dialog) return false;
    const rect = this.#dialog.getBoundingClientRect();
    return e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
  }
}
window.PsModal = Modal;
