/**
 * Sign-in / sign-up behavior (#4375), shared by the navbar <dialog>, the full-page /signIn·/signUp fallback, and
 * the reset-password page: show-password toggles, live password/username validation, and async submits with inline
 * errors.
 *
 * Validation rules are NOT declared here — the Twirl template injects them from the backend's PasswordPolicy /
 * UsernamePolicy as data-* attributes (CLAUDE.md: backend is the source of truth), the breach-check endpoint
 * included; this file just compiles and applies them. The `AuthModal` class adds the dialog-only concerns
 * (open/close, panel switching, trigger buttons) and is exposed as `window.psAuthModal` with
 * `.open('signIn'|'signUp')`.
 */

/**
 * The `.au-icon` span the auth stylesheet masks its glyph onto; the context class picks the shape and tint.
 *
 * @returns {HTMLSpanElement} A decorative icon span.
 */
const auIcon = () => {
  const icon = document.createElement('span');
  icon.className = 'au-icon';
  icon.setAttribute('aria-hidden', 'true');
  return icon;
};

/**
 * Wires one show/hide-password toggle: flips the input type and swaps the icon + aria state.
 *
 * @param {HTMLButtonElement} btn - An .au-eye button whose data-eye names the input it toggles.
 */
function wireEyeToggle(btn) {
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

/** Long enough that typing a password straight through costs one request rather than one per character. */
const AU_BREACH_DEBOUNCE_MS = 500;

/** A padded range response runs to ~80KB, so the cache below is capped rather than left to grow with typing. */
const AU_BREACH_RANGE_CACHE_MAX = 8;

/**
 * In-flight and settled range requests, keyed by the 5-character hash prefix that fetched them — both already
 * public under k-anonymity. Nothing password-derived may live here: an unsalted SHA-1 of a human-chosen password
 * is the password to anyone with a wordlist, and a top-level `const` in a classic script is readable by name from
 * every other script on the page. Promises rather than text, so two lookups sharing a prefix share one request.
 */
const auBreachRanges = new Map();

/**
 * Fetches one k-anonymity range, reusing an in-flight or recent request for the same prefix.
 *
 * @param {string} prefix - The first five hex characters of a SHA-1.
 * @param {string} rangeUrl - The range endpoint, from PasswordPolicy.
 * @returns {Promise<string>} The response body, or an empty string if the request failed.
 */
function fetchBreachRange(prefix, rangeUrl) {
  const cached = auBreachRanges.get(prefix);
  if (cached) return cached;
  const pending = fetch(rangeUrl + prefix, { headers: { 'Add-Padding': 'true' } })
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))));
  // A failure is dropped rather than cached: only a real answer is worth keeping.
  pending.catch(() => auBreachRanges.delete(prefix));
  if (auBreachRanges.size >= AU_BREACH_RANGE_CACHE_MAX) {
    auBreachRanges.delete(auBreachRanges.keys().next().value);
  }
  auBreachRanges.set(prefix, pending);
  return pending;
}

/**
 * Asks Have I Been Pwned whether a password is in its breach corpus. Only the first five hex characters of the
 * SHA-1 are sent, and `Add-Padding` keeps the response length from hinting at how many hashes share that prefix;
 * the request still carries the user's IP and this instance's Origin, as any cross-origin call does. Fail-open by
 * design (#4492): offline, blocked, or no Web Crypto all report "not breached" rather than standing between a
 * user and their account.
 *
 * @param {string} password - The candidate password.
 * @param {string} rangeUrl - The range endpoint, from PasswordPolicy.
 * @returns {Promise<boolean>} True only if the password was positively found in the corpus.
 */
async function isBreachedPassword(password, rangeUrl) {
  try {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const range = await fetchBreachRange(hash.slice(0, 5), rangeUrl);
    const suffix = hash.slice(5);
    // Padding entries are real-looking suffixes with a count of 0, so only a positive count is a hit.
    return range.split('\n').some((line) => {
      const [lineSuffix, count] = line.trim().split(':');
      return lineSuffix === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

/**
 * Wires the live feedback for one new-password pair, from the group's backend-injected data-* attributes.
 *
 * @param {HTMLElement} group - An .au-pw-group rendered by common/authPasswordFields.scala.html.
 */
function wirePasswordGroup(group) {
  const pw = group.querySelector('.au-pw');
  const pw2 = group.querySelector('.au-pw-confirm');
  if (!pw) return;

  const rules = [...group.querySelectorAll('.au-checklist li[data-rule-regex]')]
    .map((li) => ({ li, regex: new RegExp(li.dataset.ruleRegex) }));
  const slabs = [...group.querySelectorAll('.au-pw-slabs span')];
  const strengthWord = group.querySelector('.au-pw-strength-word');
  const match = group.querySelector('.au-pw-match');
  const matchText = group.querySelector('.au-match-text');
  const breachUrl = group.dataset.breachUrl;
  const breachMessage = group.dataset.breachWarning;
  let breachTimer;
  let breachWarning = null;
  /**
   * Verdicts for values this field has already judged, so backspacing into one does not flash a full-strength
   * meter for the debounce's length before the warning comes back. Closure-scoped and never exported: the values
   * are the ones already sitting in `pw.value`, so this reaches no further than the input element itself.
   */
  const verdicts = new Map();

  /**
   * Inserts and drops the warning node rather than hiding it: a hidden live region is not in the accessibility
   * tree, so revealing it announces nothing, and one left in the markup would be read as part of the field's
   * description before there is anything to say (docs/accessibility.md → "Announcing what was injected").
   *
   * @param {boolean} show - Whether the current password is known-breached.
   */
  const renderBreachWarning = (show) => {
    if (show === !!breachWarning) return;
    if (!show) {
      breachWarning.remove();
      breachWarning = null;
      return;
    }
    breachWarning = document.createElement('p');
    breachWarning.className = 'au-warning';
    breachWarning.setAttribute('role', 'status');
    breachWarning.append(auIcon(), ` ${breachMessage}`);
    (group.querySelector('.au-strength') || pw).insertAdjacentElement('afterend', breachWarning);
  };

  /** @returns {number} How many composition rules the current password meets. */
  const update = () => {
    let met = 0;
    rules.forEach(({ li, regex }) => {
      const ok = regex.test(pw.value);
      li.classList.toggle('met', ok);
      if (ok) met++;
    });
    // A password in a breach corpus is weak however many composition rules it passes, so the meter says so too.
    const breached = verdicts.get(pw.value) === true;
    const shown = breached ? Math.min(met, 1) : met;
    renderBreachWarning(breached);
    slabs.forEach((slab, i) => slab.classList.toggle('paved', i < shown));
    if (strengthWord) {
      strengthWord.textContent = pw.value ? strengthWord.dataset[`word${shown}`] || '' : '';
    }
    if (match && matchText && pw2) {
      const same = pw.value.length > 0 && pw.value === pw2.value;
      match.classList.toggle('met', same);
      match.classList.toggle('unmet', pw2.value.length > 0 && !same);
      matchText.textContent = pw2.value && !same ? match.dataset.labelNoMatch : match.dataset.labelMatch;
    }
    return met;
  };

  /**
   * Schedules the breach lookup for the current value, once typing pauses. Only a password that already satisfies
   * the composition rules is looked up; a half-typed one would spend a request to say what the checklist says. A
   * group with no checklist has no notion of "half-typed", so it never reaches the network.
   *
   * @param {boolean} allRulesMet - Whether the current value satisfies every composition rule.
   */
  const scheduleBreachCheck = (allRulesMet) => {
    clearTimeout(breachTimer);
    const value = pw.value;
    if (!breachUrl || !breachMessage || !window.crypto?.subtle || !allRulesMet) return;
    if (verdicts.has(value)) return;
    breachTimer = setTimeout(async () => {
      const breached = await isBreachedPassword(value, breachUrl);
      verdicts.set(value, breached);
      if (pw.value === value) update();
    }, AU_BREACH_DEBOUNCE_MS);
  };

  pw.addEventListener('input', () => {
    const met = update();
    scheduleBreachCheck(rules.length > 0 && met === rules.length);
  });
  pw2?.addEventListener('input', update);
}

/**
 * Wires every new-password group on the page plus the username-rule indicator, all from backend-injected
 * data-rule-regex attributes. No-ops on surfaces without those fields (e.g. the sign-in-only ones).
 */
function wireLiveValidation() {
  document.querySelectorAll('.au-pw-group').forEach(wirePasswordGroup);

  const username = document.getElementById('sign-up-username');
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
 * Removes any inline errors from a previous submit of this form.
 *
 * @param {HTMLFormElement} form - The form to reset.
 */
function clearAuthErrors(form) {
  form.parentElement.querySelectorAll(':scope > .au-summary:not(.au-summary--info)').forEach((el) => el.remove());
  form.querySelectorAll('.au-field-error').forEach((el) => el.remove());
  form.querySelectorAll('.au-input--error').forEach((el) => {
    el.classList.remove('au-input--error');
    el.removeAttribute('aria-invalid');
  });
}

/**
 * Renders the async error contract: `_summary` becomes a banner above the form, any other key attaches to its field.
 * Each error dismisses itself once the user starts fixing it — a field error clears when its own field is edited, and
 * the `_summary` banner clears on the next edit to any field (#4532), so a stale error can't linger after it's fixed.
 *
 * @param {HTMLFormElement} form - The form the errors belong to.
 * @param {Object<string, string>} errors - Field name (or `_summary`) to localized message.
 */
function renderAuthErrors(form, errors) {
  Object.entries(errors).forEach(([field, message]) => {
    if (field === '_summary') {
      const banner = document.createElement('div');
      banner.className = 'au-summary';
      banner.setAttribute('role', 'alert');
      const text = document.createElement('p');
      text.textContent = message;
      banner.append(auIcon(), text);
      form.parentElement.insertBefore(banner, form);
      form.addEventListener('input', () => banner.remove(), { once: true });
      return;
    }
    const input = form.querySelector(`[name="${field}"]`);
    if (!input) return;
    input.classList.add('au-input--error');
    input.setAttribute('aria-invalid', 'true');
    const msg = document.createElement('p');
    msg.className = 'au-field-error';
    msg.setAttribute('role', 'alert');
    msg.append(auIcon(), ` ${message}`);
    (input.closest('.au-input-wrap') || input).insertAdjacentElement('afterend', msg);
    input.addEventListener('input', () => {
      input.classList.remove('au-input--error');
      input.removeAttribute('aria-invalid');
      msg.remove();
    }, { once: true });
  });
  const firstBad = form.querySelector('.au-input--error');
  if (firstBad) firstBad.focus();
}

/**
 * Intercepts a form submit and posts it via fetch, rendering JSON errors inline instead of navigating away. Browsers
 * without JS (or if this listener never binds) fall back to the regular full-page POST, so the flow always works.
 *
 * @param {HTMLFormElement} [form] - The sign-in or sign-up form; a no-op if absent.
 */
function wireAsyncSubmit(form) {
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAuthErrors(form);
    const submitBtn = form.querySelector('.au-submit');
    submitBtn?.setAttribute('disabled', 'disabled');
    submitBtn?.classList.add('is-loading');
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
      renderAuthErrors(form, data.errors || { _summary: form.dataset.errorGeneric });
      if (res.status === 401) {
        const pwField = form.querySelector('input[type="password"]');
        if (pwField) pwField.value = '';
        form.querySelector('.au-input')?.focus();
      }
    } catch {
      renderAuthErrors(form, { _summary: form.dataset.errorGeneric });
    }
    submitBtn?.removeAttribute('disabled');
    submitBtn?.classList.remove('is-loading');
  });
}

/**
 * Applies the show-password toggles, live validation, and async submit to every auth form on the page.
 *
 * Document-wide rather than scoped to the dialog, because a page can carry auth fields of its own *and* the navbar
 * dialog — reset-password does. Pages rendering the full-page sign-in/sign-up forms suppress the dialog via
 * navbar's renderAuthDialog, so the shared ids still resolve to one element each.
 *
 * @param {ParentNode} root - The subtree to enhance; the whole document in production.
 */
function enhanceAuthForms() {
  document.querySelectorAll('.au-eye').forEach(wireEyeToggle);
  wireLiveValidation();
  wireAsyncSubmit(document.getElementById('sign-in-form'));
  wireAsyncSubmit(document.getElementById('sign-up-form'));
}

/**
 * Controller for the navbar sign-in / sign-up <dialog>: open/close, sign-in↔sign-up panel switching, and trigger
 * buttons only. The forms inside it are enhanced by `enhanceAuthForms(document)`, like every other auth form.
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
    this.#wireOpeners();
    this.#wirePanelLinks();
  }

  /**
   * Opens the dialog on the requested panel.
   *
   * @param {string} [panel] - 'signIn' or 'signUp'.
   */
  open(panel = 'signIn') {
    const signUp = panel === 'signUp';
    // The dialog keeps the user on the page, so no Visit_* event marks auth intent — the open itself is the
    // analytics event, whichever trigger requested it (docs/logged-events.md, #4889).
    window.logWebpageActivity?.(`ModalAuth_Show=${signUp ? 'SignUp' : 'SignIn'}`);
    this.#showPanel(signUp ? 'sign-up-modal' : 'sign-in-modal');
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
}

window.addEventListener('DOMContentLoaded', () => {
  enhanceAuthForms();
  const dialog = document.getElementById('sign-in-modal-container');
  if (dialog instanceof HTMLDialogElement) {
    window.psAuthModal = new AuthModal(dialog);
  }
});
