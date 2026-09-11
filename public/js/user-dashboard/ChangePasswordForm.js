/**
 * The Settings page's change-password form (#2285), posted apart from the page's "Save changes" button. Errors are
 * drawn with AuthModal.js's `clearAuthErrors`/`renderAuthErrors`; AuthModal.js also wires this form's show-password
 * buttons and new-password checklist. CSRF is added by the global fetch wrapper (AppManager).
 */
class ChangePasswordForm {
  #form;

  #submitBtn;

  #status;

  /**
   * @param {HTMLFormElement} form - The #set-password-form element.
   */
  constructor(form) {
    this.#form = form;
    this.#submitBtn = form.querySelector('button[type="submit"]');
    this.#status = form.querySelector('[role="status"]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#submit();
    });
  }

  /**
   * Posts the form, then either empties it and says the password changed, or shows what went wrong.
   *
   * @returns {Promise<boolean>} Whether the password was changed.
   */
  async #submit() {
    clearAuthErrors(this.#form);
    this.#setStatus('', false);
    this.#submitBtn.disabled = true;
    try {
      const res = await fetch(this.#form.action, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
        body: new URLSearchParams(new FormData(this.#form)),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        this.#clearFields();
        this.#setStatus(data.message, true);
        return true;
      }
      // A wrong current password is almost always a typo, so clear it for a clean retype.
      if (data.errors?.currentPassword) this.#form.elements.currentPassword.value = '';
      renderAuthErrors(this.#form, data.errors || { _summary: this.#form.dataset.errorGeneric });
      return false;
    } catch {
      renderAuthErrors(this.#form, { _summary: this.#form.dataset.errorGeneric });
      return false;
    } finally {
      this.#submitBtn.disabled = false;
    }
  }

  /**
   * Empties the password fields. Clearing a field from code doesn't count as typing in it, so this nudges the
   * new-password checklist and "passwords match" line to update, or they'd keep describing the old text.
   */
  #clearFields() {
    this.#form.reset();
    this.#form.querySelectorAll('.au-pw, .au-pw-confirm').forEach((el) => el.dispatchEvent(new Event('input')));
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
