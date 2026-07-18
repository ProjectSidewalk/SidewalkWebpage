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
  // Set while #settle is programmatically closing the dialog, so the resulting queued `close` event knows the close
  // was ours (already settled) and doesn't re-settle a confirmation that was reopened in the same tick.
  static #settling = false;

  /**
   * Shows the confirmation and resolves with the user's choice.
   *
   * @param {Object} opts
   * @param {string} opts.message - The question being confirmed.
   * @param {string} opts.confirmText - Label for the confirming button.
   * @param {string} opts.cancelText - Label for the dismissing button.
   * @param {boolean} [opts.danger=false] - Styles the confirm button red for destructive actions.
   * @param {string} [opts.confirmIconSrc] - URL of a decorative icon shown before the confirm button's text
   *     (e.g. the trash can on deletes). Omit for no icon.
   * @returns {Promise<boolean>} true if confirmed; false on cancel, Esc, or any other dismissal.
   */
  static confirm({ message, confirmText, cancelText, danger = false, confirmIconSrc = null }) {
    const els = ConfirmDialog.#ensureDialog();
    // A prior confirmation is still open (only reachable programmatically — the native modal blocks user-driven
    // double-opens): resolve it false and reset before reusing the shared dialog, so its caller can't hang.
    if (ConfirmDialog.#resolve) ConfirmDialog.#settle(false);
    els.message.textContent = message;
    els.confirmLabel.textContent = confirmText;
    els.cancel.textContent = cancelText;
    els.confirm.classList.toggle('ps-confirm__confirm--danger', danger);
    els.confirmIcon.hidden = !confirmIconSrc;
    if (confirmIconSrc) els.confirmIcon.src = confirmIconSrc;
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
        <button type="button" class="ps-confirm__confirm">
          <img class="ps-confirm__confirm-icon" alt="" hidden>
          <span class="ps-confirm__confirm-label"></span>
        </button>
      </div>
    `;
    document.body.appendChild(dialog);
    const els = {
      message: dialog.querySelector('.ps-confirm__message'),
      cancel: dialog.querySelector('.ps-confirm__cancel'),
      confirm: dialog.querySelector('.ps-confirm__confirm'),
      confirmIcon: dialog.querySelector('.ps-confirm__confirm-icon'),
      confirmLabel: dialog.querySelector('.ps-confirm__confirm-label'),
    };
    els.confirm.addEventListener('click', () => ConfirmDialog.#settle(true));
    els.cancel.addEventListener('click', () => ConfirmDialog.#settle(false));
    // Catches every dismissal the buttons don't (Esc, backdrop): the pending promise settles false. A close that
    // #settle itself triggered is flagged, so its queued close event doesn't re-settle a reopened confirmation.
    dialog.addEventListener('close', () => {
      if (ConfirmDialog.#settling) {
        ConfirmDialog.#settling = false;
        return;
      }
      ConfirmDialog.#settle(false);
    });
    ConfirmDialog.#dialog = dialog;
    ConfirmDialog.#els = els;
    return els;
  }

  /**
   * Resolves the pending promise exactly once and closes the dialog. Flags the programmatic close so its queued
   * `close` event (handled above) doesn't re-settle a confirmation reopened before the event fires.
   * @param {boolean} confirmed
   */
  static #settle(confirmed) {
    const resolve = ConfirmDialog.#resolve;
    ConfirmDialog.#resolve = null;
    if (ConfirmDialog.#dialog.open) {
      ConfirmDialog.#settling = true;
      ConfirmDialog.#dialog.close();
    }
    resolve?.(confirmed);
  }
}
