/**
 * Controller for the sign-in / sign-up dialog (#4375): panel switching, async submits with inline errors, live
 * password/username validation, and show-password toggles.
 *
 * Validation rules are NOT declared here — the Twirl template injects them from the backend's PasswordPolicy /
 * UsernamePolicy as data-rule-regex attributes (CLAUDE.md: backend is the source of truth), and this class just
 * compiles and applies them. Exposes a `window.psAuthModal` singleton with `.open('signIn'|'signUp')` for other
 * modules (navbar, Explore's PopUpMessage) and no-ops gracefully on pages without the dialog.
 */
class AuthModal {
  #modal;

  #dialog;

  /**
   * @param {HTMLDialogElement} dialog - The #sign-in-modal-container <dialog>.
   */
  constructor(dialog) {
    this.#dialog = dialog;
    this.#modal = new window.PsModal(dialog);

    dialog.querySelectorAll('.au-close').forEach((btn) => btn.addEventListener('click', () => this.#modal.close()));
    dialog.querySelectorAll('.au-eye').forEach((btn) => this.#wireEyeToggle(btn));
    this.#wireOpeners();
    this.#wirePanelLinks();
    this.#wireLiveValidation();
    this.#wireSubmit(document.getElementById('sign-in-form'));
    this.#wireSubmit(document.getElementById('sign-up-form'));
  }

  /**
   * Opens the dialog on the requested panel.
   *
   * @param {string} [panel] - 'signIn' or 'signUp'.
   */
  open(panel = 'signIn') {
    this.#showPanel(panel === 'signUp' ? 'sign-up-modal' : 'sign-in-modal');
    this.#modal.open();
    this.#focusFirstField();
  }

  /** Closes the dialog. */
  close() {
    this.#modal.close();
  }

  /**
   * @returns {HTMLDialogElement} The dialog element (for event listeners like ps:modal:show).
   */
  get element() {
    return this.#dialog;
  }

  /**
   * Binds every declared opener; pages without the dialog never construct this class, so openers stay inert there.
   */
  #wireOpeners() {
    document.querySelectorAll('[data-au-open]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.open(el.dataset.auOpen === 'signUp' ? 'signUp' : 'signIn');
      });
    });
  }

  /** The "Create an account" / "Sign in" footer links swap panels in place. */
  #wirePanelLinks() {
    document.getElementById('form-open-sign-up')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.#showPanel('sign-up-modal');
      this.#focusFirstField();
    });
    document.getElementById('form-open-sign-in')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.#showPanel('sign-in-modal');
      this.#focusFirstField();
    });
  }

  /**
   * @param {string} panelId - Element id of the panel to show; the sibling panel is hidden.
   */
  #showPanel(panelId) {
    ['sign-in-modal', 'sign-up-modal'].forEach((id) => {
      document.getElementById(id)?.classList.toggle('ps-hidden', id !== panelId);
    });
    this.#dialog.setAttribute('aria-labelledby', panelId === 'sign-up-modal' ? 'sign-up-label' : 'sign-in-label');
  }

  /** Moves focus to the first text input of the visible panel (what showModal would do for a single panel). */
  #focusFirstField() {
    this.#dialog.querySelector('.au-panel:not(.ps-hidden) .au-input')?.focus();
  }

  /**
   * @param {HTMLButtonElement} btn - An .au-eye button whose data-eye names the input it toggles.
   */
  #wireEyeToggle(btn) {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.eye);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? btn.dataset.labelHide : btn.dataset.labelShow);
      btn.querySelector('.au-eye-on')?.classList.toggle('ps-hidden', show);
      btn.querySelector('.au-eye-off')?.classList.toggle('ps-hidden', !show);
    });
  }

  /**
   * Live checklist, strength slabs, match indicator, and username rule — all driven by backend-injected
   * data-rule-regex attributes.
   */
  #wireLiveValidation() {
    const pw = document.getElementById('sign-up-password');
    const pw2 = document.getElementById('sign-up-password-confirm');
    const username = document.getElementById('sign-up-username');
    if (!pw) return;

    const rules = [...document.querySelectorAll('#sign-up-pw-rules li[data-rule-regex]')]
      .map((li) => ({ li, regex: new RegExp(li.dataset.ruleRegex) }));
    const slabs = [...document.querySelectorAll('#sign-up-pw-strength span')];
    const strengthWord = document.getElementById('sign-up-pw-strength-word');
    const match = document.getElementById('sign-up-pw-match');
    const matchText = document.getElementById('sign-up-pw-match-text');

    const update = () => {
      let met = 0;
      rules.forEach(({ li, regex }) => {
        const ok = regex.test(pw.value);
        li.classList.toggle('met', ok);
        if (ok) met++;
      });
      slabs.forEach((slab, i) => slab.classList.toggle('paved', i < met));
      if (strengthWord) {
        strengthWord.textContent = pw.value ? strengthWord.dataset[`word${met}`] || '' : '';
      }
      if (match && matchText) {
        const same = pw.value.length > 0 && pw.value === pw2.value;
        match.classList.toggle('met', same);
        match.classList.toggle('unmet', pw2.value.length > 0 && !same);
        matchText.textContent = pw2.value && !same ? match.dataset.labelNoMatch : match.dataset.labelMatch;
      }
    };
    pw.addEventListener('input', update);
    pw2?.addEventListener('input', update);

    if (username?.dataset.ruleRegex) {
      const usernameRegex = new RegExp(username.dataset.ruleRegex);
      const rule = document.getElementById('sign-up-username-rule');
      username.addEventListener('input', () => {
        const ok = usernameRegex.test(username.value);
        rule?.classList.toggle('met', ok);
        rule?.classList.toggle('unmet', username.value.length > 0 && !ok);
      });
    }
  }

  /**
   * Intercepts a form submit and posts it via fetch, rendering JSON errors inline instead of navigating away.
   * Browsers without JS (or if this listener never binds) fall back to the regular full-page POST.
   *
   * @param {HTMLFormElement} form - The sign-in or sign-up form.
   */
  #wireSubmit(form) {
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      this.#clearErrors(form);
      const submitBtn = form.querySelector('.au-submit');
      submitBtn?.setAttribute('disabled', 'disabled');
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams(new FormData(form)),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.redirect) {
          window.location.assign(data.redirect);
          return; // Keep the button disabled while the browser navigates.
        }
        this.#renderErrors(form, data.errors || { _summary: form.dataset.errorGeneric });
        if (res.status === 401) {
          const pwField = form.querySelector('input[type="password"]');
          if (pwField) pwField.value = '';
          form.querySelector('.au-input')?.focus();
        }
      } catch {
        this.#renderErrors(form, { _summary: form.dataset.errorGeneric });
      }
      submitBtn?.removeAttribute('disabled');
    });
  }

  /**
   * @param {HTMLFormElement} form - Form whose previous inline errors should be removed.
   */
  #clearErrors(form) {
    form.closest('.au-panel')?.querySelector('.au-summary')?.remove();
    form.querySelectorAll('.au-field-error').forEach((el) => el.remove());
    form.querySelectorAll('.au-input--error').forEach((el) => {
      el.classList.remove('au-input--error');
      el.removeAttribute('aria-invalid');
    });
  }

  /**
   * Renders the async error contract: `_summary` becomes the banner, any other key attaches to its field.
   *
   * @param {HTMLFormElement} form - The form the errors belong to.
   * @param {Object<string, string>} errors - Field name (or `_summary`) to localized message.
   */
  #renderErrors(form, errors) {
    const alertIcon = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
             aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>`;
    Object.entries(errors).forEach(([field, message]) => {
      if (field === '_summary') {
        const banner = document.createElement('div');
        banner.className = 'au-summary';
        banner.setAttribute('role', 'alert');
        banner.innerHTML = `${alertIcon}<p></p>`;
        banner.querySelector('p').textContent = message;
        form.parentElement.insertBefore(banner, form);
        return;
      }
      const input = form.querySelector(`[name="${field}"]`);
      if (!input) return;
      input.classList.add('au-input--error');
      input.setAttribute('aria-invalid', 'true');
      const msg = document.createElement('p');
      msg.className = 'au-field-error';
      msg.setAttribute('role', 'alert');
      msg.innerHTML = alertIcon;
      msg.appendChild(document.createTextNode(` ${message}`));
      (input.closest('.au-input-wrap') || input).insertAdjacentElement('afterend', msg);
    });
    const firstBad = form.querySelector('.au-input--error');
    if (firstBad) firstBad.focus();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('sign-in-modal-container');
  if (dialog instanceof HTMLDialogElement) window.psAuthModal = new AuthModal(dialog);
});
