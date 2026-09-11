/**
 * The Settings page's change-password form (#2285), posted apart from the page's "Save changes" button. Submitting and
 * error display are AuthModal.js's `wireAsyncSubmit`, which also clears the current password after a wrong one (401);
 * this adds what happens on success, since the user stays on the page. AuthModal.js also wires the show-password
 * buttons and new-password checklist. CSRF is added by the global fetch wrapper (AppManager).
 */
class ChangePasswordForm {
  #form;

  #status;

  /**
   * @param {HTMLFormElement} form - The #set-password-form element.
   */
  constructor(form) {
    this.#form = form;
    this.#status = form.querySelector('[role="status"]');
    // Registered before wireAsyncSubmit's listener, so an old "changed" message is gone before the next reply lands.
    form.addEventListener('submit', () => this.#setStatus('', false));
    wireAsyncSubmit(form, { onSuccess: (data) => this.#onChanged(data) });
  }

  /**
   * Empties the password fields and says the password changed. Clearing a field from code doesn't count as typing
   * in it, so this nudges the new-password checklist and "passwords match" line, or they'd describe the old text.
   *
   * @param {{message: string}} data - The server's reply.
   */
  #onChanged(data) {
    this.#form.reset();
    this.#form.querySelectorAll('.au-pw, .au-pw-confirm').forEach((el) => el.dispatchEvent(new Event('input')));
    this.#setStatus(data.message, true);
  }

  /**
   * @param {string} text - Message to show beside the button; empty to clear it.
   * @param {boolean} ok - Whether to style it as a success.
   */
  #setStatus(text, ok) {
    if (!this.#status) return;
    this.#status.textContent = text;
    this.#status.classList.toggle('ud-save-ok', ok);
  }
}
