/**
 * A Settings form that acts on the account: change password (#2285) or sign out of other devices (#5305). Submitting
 * and error display are AuthModal.js's `wireAsyncSubmit`; this adds what happens on success, since the user stays on
 * the page.
 */
class AccountForm {
  #form;

  #status;

  /**
   * @param {HTMLFormElement} form - The form, with a `role="status"` element for the success message.
   */
  constructor(form) {
    this.#form = form;
    this.#status = form.querySelector('[role="status"]');
    // Added before wireAsyncSubmit's listener, so a stale success message clears as soon as the next submit starts.
    form.addEventListener('submit', () => this.#setStatus('', false));
    wireAsyncSubmit(form, { onSuccess: (data) => this.#onChanged(/** @type {{message: string}} */ (data)) });
  }

  /**
   * Empties the fields and shows the server's message. The input events refresh the new-password checklist, which
   * only watches for typing.
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
