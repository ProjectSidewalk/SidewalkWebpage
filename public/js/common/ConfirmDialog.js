/**
 * ConfirmDialog — a promise-based, app-styled replacement for window.confirm().
 *
 * window.confirm() renders browser chrome ("localhost:9000 says…") that can't be styled or translated, so in-app
 * confirmations use this instead. One shared <dialog class="ps-confirm"> is built lazily and reused, for the focus
 * trap, Esc-to-dismiss, and ::backdrop the native element brings. Every dismissal path resolves to the dismissal
 * value, and the safest button takes initial focus so a stray Enter can't do something lossy.
 * Styles: css/components/confirm-dialog.css.
 */
class ConfirmDialog {
  // The design system has no destructive variant, so 'danger' is a primary button the dialog's stylesheet re-tints.
  static #BUTTON_CLASSES = {
    secondary: 'button-ps button--medium button--secondary',
    primary: 'button-ps button--medium button--primary',
    danger: 'button-ps button--medium button--primary ps-confirm__btn--danger',
  };

  static #dialog = null;
  static #els = null;
  static #resolve = null;
  static #dismissValue = null;
  // Set while #settle closes the dialog, so the queued `close` event knows the close was ours and doesn't
  // re-settle a prompt that was reopened in the same tick.
  static #settling = false;

  /**
   * Shows a yes/no confirmation and resolves with the user's choice.
   *
   * @param {Object} opts
   * @param {string} opts.message - The question being confirmed.
   * @param {string} opts.confirmText - Label for the confirming button.
   * @param {string} opts.cancelText - Label for the dismissing button.
   * @param {boolean} [opts.danger=false] - Styles the confirm button red for destructive actions.
   * @param {string} [opts.confirmIconSrc] - URL of a decorative icon shown before the confirm button's text.
   * @returns {Promise<boolean>} true if confirmed; false on cancel, Esc, or any other dismissal.
   */
  static confirm({ message, confirmText, cancelText, danger = false, confirmIconSrc = null }) {
    return ConfirmDialog.choose({
      message,
      buttons: [
        { id: 'cancel', text: cancelText },
        { id: 'confirm', text: confirmText, style: danger ? 'danger' : 'primary', iconSrc: confirmIconSrc },
      ],
      dismissValue: 'cancel',
    }).then((choice) => choice === 'confirm');
  }

  /**
   * Shows a prompt with an arbitrary set of buttons and resolves with the id of the one the user picked.
   *
   * @param {Object} opts
   * @param {string} opts.message - The question being asked.
   * @param {Object[]} opts.buttons - The choices left to right, each `{ id, text, style, iconSrc }` with `style`
   *     'secondary' (the default), 'primary', or 'danger'.
   * @param {*} [opts.dismissValue=null] - Resolved on Esc or a backdrop click.
   * @param {string} [opts.focusId] - Button to focus. Defaults to the first that changes nothing.
   * @returns {Promise<*>} The chosen button's id, or `dismissValue`.
   */
  static choose({ message, buttons, dismissValue = null, focusId = null }) {
    const els = ConfirmDialog.#ensureDialog();
    // A prior prompt is still open (only reachable programmatically): settle it as a dismissal before reusing the
    // shared dialog, so its caller can't hang.
    if (ConfirmDialog.#resolve) ConfirmDialog.#settle(ConfirmDialog.#dismissValue);
    els.message.textContent = message;
    els.actions.replaceChildren(...buttons.map((button) => ConfirmDialog.#buildButton(button)));
    // Fall back through: the named button, else the first that changes nothing, else the first button there is.
    const candidates = [
      buttons.findIndex((button) => button.id === focusId),
      buttons.findIndex((button) => (button.style ?? 'secondary') === 'secondary'),
      0,
    ];
    const focusIdx = candidates.find((idx) => idx >= 0);
    return new Promise((resolve) => {
      ConfirmDialog.#resolve = resolve;
      ConfirmDialog.#dismissValue = dismissValue;
      ConfirmDialog.#dialog.showModal();
      els.actions.children[focusIdx]?.focus();
    });
  }

  /** @returns {HTMLButtonElement} A `buttons` entry as a button, wired to settle the pending promise with its id. */
  static #buildButton({ id, text, style = 'secondary', iconSrc = null }) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `ps-confirm__btn ${ConfirmDialog.#BUTTON_CLASSES[style]}`;
    if (iconSrc) {
      const icon = document.createElement('img');
      icon.className = 'ps-confirm__btn-icon';
      icon.src = iconSrc;
      icon.alt = '';
      el.appendChild(icon);
    }
    el.appendChild(document.createTextNode(text));
    el.addEventListener('click', () => ConfirmDialog.#settle(id));
    return el;
  }

  /**
   * Builds the shared dialog on first use.
   * @returns {Object} The message element and the container the buttons are rebuilt into.
   */
  static #ensureDialog() {
    if (ConfirmDialog.#els) return ConfirmDialog.#els;
    const dialog = document.createElement('dialog');
    dialog.className = 'ps-confirm';
    dialog.setAttribute('aria-labelledby', 'ps-confirm-message');
    dialog.innerHTML = `
      <p class="ps-confirm__message" id="ps-confirm-message"></p>
      <div class="ps-confirm__actions"></div>
    `;
    document.body.appendChild(dialog);
    // Catches every dismissal the buttons don't (Esc, backdrop). A close #settle triggered is flagged, so its
    // queued close event doesn't re-settle a prompt reopened before the event fires.
    dialog.addEventListener('close', () => {
      if (ConfirmDialog.#settling) {
        ConfirmDialog.#settling = false;
        return;
      }
      ConfirmDialog.#settle(ConfirmDialog.#dismissValue);
    });
    ConfirmDialog.#dialog = dialog;
    ConfirmDialog.#els = {
      message: dialog.querySelector('.ps-confirm__message'),
      actions: dialog.querySelector('.ps-confirm__actions'),
    };
    return ConfirmDialog.#els;
  }

  /** Resolves the pending promise exactly once and closes the dialog. @param {*} choice - Id, or dismissal value. */
  static #settle(choice) {
    const resolve = ConfirmDialog.#resolve;
    ConfirmDialog.#resolve = null;
    if (ConfirmDialog.#dialog.open) {
      ConfirmDialog.#settling = true;
      ConfirmDialog.#dialog.close();
    }
    resolve?.(choice);
  }
}
