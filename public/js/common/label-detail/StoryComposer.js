/**
 * StoryComposer — dialog controller for submitting a lived-experience story (#4054).
 *
 * Owns the `.story-composer` <dialog> rendered by labelDetail.scala.html: text + counter, optional photo with a
 * required-or-explicitly-skipped description (WCAG), the anonymous/username display choice, and the multipart POST
 * to /userapi/stories (with the same mint-anon-session-and-retry behavior as LabelDetail's JSON posts, so the
 * signed-out /label/:id share page can submit too). Scoped to the elements it's given — the partial can render
 * multiple times per page, so radio-group names and the labelling id are made instance-unique here.
 */
class StoryComposer {
  static #instances = 0;

  #dialog;
  #els = {};
  #labelId = null;
  #maxLength = null; // Server-provided via open() (sourced from /stories payload, never hardcoded here).
  #onSubmitted;
  #username;
  #objectUrl = null;
  #busy = false;

  /**
   * @param {HTMLDialogElement} dialog - The `.story-composer` dialog element.
   * @param {Object} opts
   * @param {string} [opts.currUsername] - The viewer's username; empty/absent hides the show-username option.
   * @param {() => void} [opts.onSubmitted] - Fired after a successful submission (hosts refresh the story list).
   */
  constructor(dialog, opts) {
    this.#dialog = dialog;
    this.#username = opts.currUsername || '';
    this.#onSubmitted = opts.onSubmitted;

    const q = (sel) => dialog.querySelector(sel);
    this.#els = {
      title: q('.story-composer__title'),
      text: q('.story-composer__text'),
      counter: q('.story-composer__counter'),
      photoAttach: q('.story-composer__photo-attach'),
      photoInput: q('.story-composer__photo-input'),
      photoPreview: q('.story-composer__photo-preview'),
      photoThumb: q('.story-composer__photo-thumb'),
      photoRemove: q('.story-composer__photo-remove'),
      altInput: q('.story-composer__alt-input'),
      altSkip: q('.story-composer__alt-skip'),
      nameAnon: q('.story-composer__name-anon'),
      nameUser: q('.story-composer__name-username'),
      usernameOption: q('.story-composer__username-option'),
      privacy: q('.story-composer__privacy'),
      error: q('.story-composer__error'),
      cancel: q('.story-composer__cancel'),
      submit: q('.story-composer__submit'),
    };

    // Instance-unique wiring: radio-group name and the dialog's accessible name.
    StoryComposer.#instances += 1;
    const n = StoryComposer.#instances;
    this.#els.nameAnon.name = `story-display-name-${n}`;
    this.#els.nameUser.name = `story-display-name-${n}`;
    this.#els.title.id = `story-composer-title-${n}`;
    dialog.setAttribute('aria-labelledby', this.#els.title.id);

    // The privacy note embeds the dashboard link, so the translated string carries markup — innerHTML by design.
    // Safe: the string comes from our own locale files, never from user input.
    this.#els.privacy.innerHTML = i18next.t('labelmap:story.privacy-note');

    this.#wireHandlers();
  }

  /**
   * Opens the composer for a label, resetting all fields.
   * @param {number} labelId - The label the story will attach to.
   * @param {?number} maxTextLength - Character cap from the /stories payload (backend source of truth).
   */
  open(labelId, maxTextLength) {
    this.#labelId = labelId;
    if (maxTextLength) {
      this.#maxLength = maxTextLength;
      this.#els.text.maxLength = maxTextLength;
    }
    this.#reset();
    this.#dialog.showModal();
    this.#els.text.focus();
    window.logWebpageActivity?.(`Click_module=StoryComposerOpen_labelId=${labelId}`);
  }

  #wireHandlers() {
    const els = this.#els;

    els.text.addEventListener('input', () => {
      this.#renderCounter();
      this.#clearError();
    });
    // First Escape only blurs the textarea; the second closes the dialog (mirrors the card's comment input).
    els.text.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    els.text.addEventListener('keyup', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        els.text.blur();
      }
    });

    els.photoInput.addEventListener('change', () => {
      const file = els.photoInput.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        this.#showError(i18next.t('labelmap:story.error.photo-invalid'));
        els.photoInput.value = '';
        return;
      }
      this.#revokeObjectUrl();
      this.#objectUrl = URL.createObjectURL(file);
      els.photoThumb.src = this.#objectUrl;
      els.photoPreview.hidden = false;
      els.photoAttach.hidden = true;
      this.#clearError();
      els.altInput.focus();
    });

    els.photoRemove.addEventListener('click', () => {
      this.#clearPhoto();
      els.photoInput.focus();
    });

    els.altSkip.addEventListener('change', () => {
      els.altInput.disabled = els.altSkip.checked;
      this.#clearError();
    });
    els.altInput.addEventListener('input', () => this.#clearError());

    els.cancel.addEventListener('click', () => this.#dialog.close());

    // Esc with typed content: confirm before discarding a personal story.
    this.#dialog.addEventListener('cancel', (e) => {
      if (this.#dirty && !window.confirm(i18next.t('labelmap:story.discard-confirm'))) e.preventDefault();
    });
    this.#dialog.addEventListener('close', () => this.#revokeObjectUrl());

    els.submit.addEventListener('click', () => this.#submit());
  }

  get #dirty() {
    return this.#els.text.value.trim().length > 0 || this.#els.photoInput.files.length > 0;
  }

  /**
   * Client-side pre-validation, then the multipart POST. Server rejections arrive as {error: i18nKey, message}; the
   * key is translated when we have it, with the server's English message as the fallback.
   */
  async #submit() {
    if (this.#busy) return;
    const els = this.#els;
    const text = els.text.value.trim();
    const photo = els.photoInput.files[0];

    if (!text) {
      this.#showError(i18next.t('labelmap:story.error.text-missing'));
      els.text.focus();
      return;
    }
    if (photo && !els.altSkip.checked && !els.altInput.value.trim()) {
      this.#showError(i18next.t('labelmap:story.photo-alt-required'));
      els.altInput.focus();
      return;
    }

    const formData = new FormData();
    formData.append('label_id', String(this.#labelId));
    formData.append('text', text);
    formData.append(
      'display_name_mode',
      els.nameUser.checked && this.#username ? 'username' : 'anonymous',
    );
    if (photo) {
      formData.append('photo', photo);
      if (!els.altSkip.checked) formData.append('alt_text', els.altInput.value.trim());
    }

    this.#busy = true;
    els.submit.disabled = true;
    els.submit.textContent = i18next.t('labelmap:story.submitting');
    try {
      const res = await this.#postForm('/userapi/stories', formData);
      if (res.ok) {
        window.logWebpageActivity?.(`Click_module=StorySubmitClient_labelId=${this.#labelId}_hasPhoto=${!!photo}`);
        this.#dialog.close();
        if (typeof this.#onSubmitted === 'function') this.#onSubmitted();
      } else {
        let body = null;
        try {
          body = await res.json();
        } catch {
          // Non-JSON error body (e.g. Play's body-parser cutoff or a proxy error page); handled by status below.
        }
        const key = body && body.error ? `labelmap:${body.error}` : null;
        let message;
        if (key && i18next.exists(key)) {
          // The server rides the real limit along on text-too-long (body.max); #maxLength is only the fallback
          // since it's null until the /stories fetch lands.
          message = i18next.t(key, { max: (body && body.max) || this.#maxLength });
        } else if (res.status === 413) {
          // Play's parser rejected the body before our controller saw it, so there's no JSON to translate from.
          message = i18next.t('labelmap:story.error.photo-too-large');
        } else {
          message = (body && body.message) || i18next.t('labelmap:story.error.generic');
        }
        this.#showError(message);
      }
    } catch {
      this.#showError(i18next.t('labelmap:story.error.generic'));
    } finally {
      this.#busy = false;
      els.submit.disabled = false;
      els.submit.textContent = i18next.t('labelmap:story.submit');
    }
  }

  /**
   * POSTs multipart form data, minting the shared anonymous session and retrying once — but only when the failure
   * looks auth-shaped (401/403/redirect). That's deliberately narrower than LabelDetail's #postJson, which retries
   * on any non-OK response: a story rejection (409 duplicate, 429 rate-limited) must surface, not be re-posted.
   * No Content-Type header: the browser sets the multipart boundary itself.
   * @param {string} url
   * @param {FormData} formData
   * @returns {Promise<Response>}
   */
  async #postForm(url, formData) {
    const post = () => fetch(url, { method: 'POST', body: formData });
    let res = await post();
    if (!res.ok && (res.status === 401 || res.status === 403 || res.type === 'opaqueredirect' || res.redirected)) {
      await fetch('/anonSignUp?url=%2F', { redirect: 'manual' });
      res = await post();
    }
    return res;
  }

  #reset() {
    const els = this.#els;
    els.text.value = '';
    this.#renderCounter();
    this.#clearPhoto();
    els.nameAnon.checked = true;
    els.nameUser.checked = false;
    this.#clearError();
    // The show-username option only makes sense when we know the account; it interpolates the actual username so
    // the choice is concrete ("Show my username, jonf").
    const userRow = els.nameUser.closest('.story-composer__check-row');
    if (this.#username) {
      userRow.hidden = false;
      els.usernameOption.textContent = i18next.t('labelmap:story.post-username', { username: this.#username });
    } else {
      userRow.hidden = true;
    }
  }

  #clearPhoto() {
    const els = this.#els;
    els.photoInput.value = '';
    this.#revokeObjectUrl();
    els.photoThumb.removeAttribute('src');
    els.photoPreview.hidden = true;
    els.photoAttach.hidden = false;
    els.altInput.value = '';
    els.altInput.disabled = false;
    els.altSkip.checked = false;
  }

  #revokeObjectUrl() {
    if (this.#objectUrl) {
      URL.revokeObjectURL(this.#objectUrl);
      this.#objectUrl = null;
    }
  }

  #renderCounter() {
    const len = this.#els.text.value.length;
    this.#els.counter.textContent = this.#maxLength ? `${len} / ${this.#maxLength}` : String(len);
  }

  /** @param {string} message */
  #showError(message) {
    this.#els.error.textContent = message;
    this.#els.error.hidden = false;
  }

  #clearError() {
    this.#els.error.hidden = true;
  }
}
