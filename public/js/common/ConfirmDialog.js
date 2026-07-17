/**
 * ConfirmDialog — a promise-based, app-styled replacement for window.confirm().
 *
 * window.confirm() renders browser chrome ("localhost:9000 says…") that can't be styled or translated
 * consistently, so in-app confirmations use this instead. A single shared <dialog class="ps-confirm"> is built
 * lazily on first use and reused for every confirmation on the page; the native element supplies the focus trap,
 * Esc-to-dismiss, and ::backdrop. Esc and every other dismissal path resolve false. The cancel button takes
 * initial focus so a stray Enter can't trigger a destructive action. Styles live in css/label-detail.css.
 */
class ConfirmDialog {
  static #dialog = null;
  static #els = null;
  static #resolve = null;

  /**
   * Shows the confirmation and resolves with the user's choice.
   *
   * @param {Object} opts
   * @param {string} opts.message - The question being confirmed.
   * @param {string} opts.confirmText - Label for the confirming button.
   * @param {string} opts.cancelText - Label for the dismissing button.
   * @param {boolean} [opts.danger=false] - Styles the confirm button red for destructive actions.
   * @returns {Promise<boolean>} true if confirmed; false on cancel, Esc, or any other dismissal.
   */
  static confirm({ message, confirmText, cancelText, danger = false }) {
    const els = ConfirmDialog.#ensureDialog();
    els.message.textContent = message;
    els.confirm.textContent = confirmText;
    els.cancel.textContent = cancelText;
    els.confirm.classList.toggle('ps-confirm__confirm--danger', danger);
    return new Promise((resolve) => {
      ConfirmDialog.#resolve = resolve;
      ConfirmDialog.#dialog.showModal();
      els.cancel.focus();
    });
  }

  /**
   * Builds the shared dialog on first use.
   * @returns {Object} The message/cancel/confirm elements.
   */
  static #ensureDialog() {
    if (ConfirmDialog.#els) return ConfirmDialog.#els;
    const dialog = document.createElement('dialog');
    dialog.className = 'ps-confirm';
    dialog.setAttribute('aria-labelledby', 'ps-confirm-message');
    dialog.innerHTML = `
      <p class="ps-confirm__message" id="ps-confirm-message"></p>
      <div class="ps-confirm__actions">
        <button type="button" class="ps-confirm__cancel"></button>
        <button type="button" class="ps-confirm__confirm"></button>
      </div>
    `;
    document.body.appendChild(dialog);
    const els = {
      message: dialog.querySelector('.ps-confirm__message'),
      cancel: dialog.querySelector('.ps-confirm__cancel'),
      confirm: dialog.querySelector('.ps-confirm__confirm'),
    };
    els.confirm.addEventListener('click', () => ConfirmDialog.#settle(true));
    els.cancel.addEventListener('click', () => ConfirmDialog.#settle(false));
    // Catches every dismissal the buttons don't (Esc, programmatic close): the pending promise settles false.
    dialog.addEventListener('close', () => ConfirmDialog.#settle(false));
    ConfirmDialog.#dialog = dialog;
    ConfirmDialog.#els = els;
    return els;
  }

  /**
   * Resolves the pending promise exactly once and closes the dialog. The close event re-enters here with the
   * resolver already cleared, so the double call is harmless.
   * @param {boolean} confirmed
   */
  static #settle(confirmed) {
    const resolve = ConfirmDialog.#resolve;
    ConfirmDialog.#resolve = null;
    if (ConfirmDialog.#dialog.open) ConfirmDialog.#dialog.close();
    resolve?.(confirmed);
  }
}
