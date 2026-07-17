/**
 * StoryComposer — dialog controller for submitting a lived-experience story (#4054).
 *
 * Owns the `.story-composer` <dialog> rendered by labelDetail.scala.html: text + counter, optional photo with an
 * optional description (doubles as alt text), the anonymous/username display choice, and the multipart POST
 * to /userapi/stories (with the same mint-anon-session-and-retry behavior as LabelDetail's JSON posts, so the
 * signed-out /label/:id share page can submit too). Scoped to the elements it's given — the partial can render
 * multiple times per page, so radio-group names and the labelling id are made instance-unique here.
 */
class StoryComposer {
  static #instances = 0;
  // A signed-out viewer can sign in mid-compose without losing work: the draft is stashed in IndexedDB (keyed by
  // label) before the /signIn bounce and restored on return (#4054). IndexedDB, not localStorage, because the photo
  // is kept as a Blob — which localStorage can't hold.
  static #DRAFT_DB = 'ps-story-drafts';
  static #DRAFT_STORE = 'drafts';

  #dialog;
  #els = {};
  #labelId = null;
  #maxLength = null; // Server-provided via open() (sourced from /stories payload, never hardcoded here).
  #onSubmitted;
  #username;
  #objectUrl = null;
  #busy = false;
  // Edit mode (#4054): non-null while editing an existing story. The existing photo is previewed from its signed URL
  // (it can't be loaded into the file input). #existingMedia holds the still-shown existing photo (nulled once a
  // replacement is picked or it's removed); #editHadMedia records whether the story had a photo when editing opened,
  // so a removal is detectable at submit even after a replacement was picked and then cleared.
  #editStoryId = null;
  #existingMedia = null;
  #editHadMedia = false;
  #editSnapshot = null;

  /**
   * @param {HTMLDialogElement} dialog - The `.story-composer` dialog element.
   * @param {Object} opts
   * @param {string} [opts.currUsername] - The viewer's username; empty/absent hides the show-username option.
   * @param {(edited: boolean) => void} [opts.onSubmitted] - Fired after a successful submission or in-place edit
   *     (hosts refresh the story list); `edited` distinguishes the two for the announcement.
   */
  constructor(dialog, opts) {
    this.#dialog = dialog;
    this.#username = opts.currUsername || '';
    this.#onSubmitted = opts.onSubmitted;

    const q = (sel) => dialog.querySelector(sel);
    this.#els = {
      title: q('.story-composer__title'),
      intro: q('.story-composer__intro'),
      text: q('.story-composer__text'),
      counter: q('.story-composer__counter'),
      photoAttach: q('.story-composer__photo-attach'),
      photoInput: q('.story-composer__photo-input'),
      photoPreview: q('.story-composer__photo-preview'),
      photoThumb: q('.story-composer__photo-thumb'),
      photoRemove: q('.story-composer__photo-remove'),
      altInput: q('.story-composer__alt-input'),
      nameAnon: q('.story-composer__name-anon'),
      nameUser: q('.story-composer__name-username'),
      usernameOption: q('.story-composer__username-option'),
      privacy: q('.story-composer__privacy'),
      signinCta: q('.story-composer__signin-cta'),
      signinBtn: q('.story-composer__signin-btn'),
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
   * Switches the intro and textarea placeholder between problem and positive-feature phrasing, per the label type's
   * backend-sourced `is_access_problem` flag (see /stories). Anything but an explicit false — including null while
   * the flag is still unknown — keeps the default problem copy. Safe to call while the dialog is open: the host
   * re-applies it when a late /stories response lands.
   * @param {?boolean} isAccessProblem
   */
  setCopyVariant(isAccessProblem) {
    const positive = isAccessProblem === false;
    this.#els.intro.textContent
      = i18next.t(positive ? 'labelmap:story.composer-intro-positive' : 'labelmap:story.composer-intro');
    this.#els.text.placeholder
      = i18next.t(positive ? 'labelmap:story.text-placeholder-positive' : 'labelmap:story.text-placeholder');
  }

  /**
   * Opens the composer for a label, resetting all fields.
   * @param {number} labelId - The label the story will attach to.
   * @param {?number} maxTextLength - Character cap from the /stories payload (backend source of truth).
   */
  async open(labelId, maxTextLength) {
    this.#labelId = labelId;
    this.#editStoryId = null;
    this.#existingMedia = null;
    this.#editHadMedia = false;
    this.#editSnapshot = null;
    if (maxTextLength) {
      this.#maxLength = maxTextLength;
      this.#els.text.maxLength = maxTextLength;
    }
    this.#reset();
    this.#dialog.showModal();
    this.#els.text.focus();
    window.logWebpageActivity?.(`Click_module=StoryComposerOpen_labelId=${labelId}`);
    // Restore a draft stashed before a sign-in redirect (#4054) so no in-progress work is lost. Best-effort: an
    // absent or unreadable draft just leaves the freshly reset composer.
    await this.#restoreDraft(labelId);
  }

  /**
   * Opens the composer prefilled with an existing story for in-place editing. Submitting PUTs the changes to the
   * story instead of creating a new one; no sign-in CTA or stashed-draft restore applies (only the author gets
   * here, and prefilled content isn't a draft).
   * @param {Object} story - The StoryForView payload being edited (must be the viewer's own).
   * @param {?number} maxTextLength - Character cap from the /stories payload (backend source of truth).
   */
  openForEdit(story, maxTextLength) {
    this.#labelId = story.label_id;
    this.#editStoryId = story.story_id;
    this.#existingMedia = null;
    this.#editHadMedia = false;
    if (maxTextLength) {
      this.#maxLength = maxTextLength;
      this.#els.text.maxLength = maxTextLength;
    }
    this.#reset();
    const els = this.#els;
    els.text.value = story.text;
    this.#renderCounter();
    if (story.display_name && this.#username) {
      els.nameUser.checked = true;
      els.nameAnon.checked = false;
    }
    if (story.media) {
      this.#existingMedia = story.media;
      this.#editHadMedia = true;
      this.#revokeObjectUrl();
      els.photoThumb.src = story.media.url;
      els.photoPreview.hidden = false;
      els.photoAttach.hidden = true;
      els.altInput.value = story.media.alt_text || '';
    }
    els.signinCta.hidden = true;
    this.#editSnapshot = this.#snapshot();
    this.#dialog.showModal();
    els.text.focus();
    window.logWebpageActivity?.(`Click_module=StoryEditOpen_storyId=${story.story_id}`);
  }

  /**
   * Captures the user-editable state for the edit-mode dirty check, so an untouched edit session can close without
   * a discard prompt.
   * @returns {string}
   */
  #snapshot() {
    const file = this.#els.photoInput.files[0];
    let photoKey = 'none';
    if (file) photoKey = `file:${file.name}:${file.size}`;
    else if (this.#existingMedia) photoKey = `media:${this.#existingMedia.story_media_id}`;
    return JSON.stringify({
      text: this.#els.text.value,
      alt: this.#els.altInput.value,
      useUsername: this.#els.nameUser.checked,
      photoKey,
    });
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
      // A newly picked file supersedes an existing photo being edited (the server treats it as a replacement).
      this.#existingMedia = null;
      this.#renderPhotoPreview(file);
      this.#clearError();
      els.altInput.focus();
    });

    els.photoRemove.addEventListener('click', () => {
      // Removal intent is derived at submit from #editHadMedia, so clearing the shown photo is all that's needed here
      // — this stays correct even after a replacement was picked (which already nulled #existingMedia).
      this.#existingMedia = null;
      this.#clearPhoto();
      els.photoInput.focus();
    });

    els.altInput.addEventListener('input', () => this.#clearError());

    els.cancel.addEventListener('click', () => this.#requestClose());

    // Esc goes through the same discard guard as the Cancel button; preventDefault always, because the
    // confirmation is async and the cancel event can't wait on it.
    this.#dialog.addEventListener('cancel', (e) => {
      if (!this.#dirty) return;
      e.preventDefault();
      this.#requestClose();
    });
    this.#dialog.addEventListener('close', () => this.#revokeObjectUrl());

    els.submit.addEventListener('click', () => this.#submit());
    els.signinBtn.addEventListener('click', () => this.#signInWithDraft());
  }

  get #dirty() {
    // Editing: dirty means changed from the prefilled story, so an untouched session closes silently.
    if (this.#editStoryId !== null) return this.#snapshot() !== this.#editSnapshot;
    return this.#els.text.value.trim().length > 0 || this.#els.photoInput.files.length > 0;
  }

  /** Closes immediately when pristine; typed content gets a discard confirmation first (it's a personal story). */
  async #requestClose() {
    if (this.#dirty) {
      const editing = this.#editStoryId !== null;
      const confirmed = await ConfirmDialog.confirm({
        message: i18next.t(editing ? 'labelmap:story.discard-changes-confirm' : 'labelmap:story.discard-confirm'),
        confirmText: i18next.t('labelmap:story.discard'),
        cancelText: i18next.t('labelmap:story.keep-writing'),
        danger: true,
      });
      if (!confirmed) return;
    }
    this.#dialog.close();
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
    const editing = this.#editStoryId !== null;

    if (!text) {
      this.#showError(i18next.t('labelmap:story.error.text-missing'));
      els.text.focus();
      return;
    }

    const formData = new FormData();
    if (!editing) formData.append('label_id', String(this.#labelId));
    formData.append('text', text);
    formData.append(
      'display_name_mode',
      els.nameUser.checked && this.#username ? 'username' : 'anonymous',
    );
    if (photo) {
      formData.append('photo', photo);
      const altText = els.altInput.value.trim();
      if (altText) formData.append('alt_text', altText);
    } else if (editing) {
      // No new file. If the existing photo is still shown, keep it and re-apply its (possibly edited) description; if
      // the story had a photo at open and none is shown now, the author removed it.
      if (this.#existingMedia) {
        const altText = els.altInput.value.trim();
        if (altText) formData.append('alt_text', altText);
      } else if (this.#editHadMedia) {
        formData.append('remove_photo', 'true');
      }
    }

    this.#busy = true;
    els.submit.disabled = true;
    els.submit.textContent = i18next.t(editing ? 'labelmap:story.saving' : 'labelmap:story.submitting');
    try {
      const res = editing
        ? await this.#postForm(`/userapi/stories/${this.#editStoryId}`, formData, 'PUT')
        : await this.#postForm('/userapi/stories', formData);
      if (res.ok) {
        if (editing) {
          window.logWebpageActivity?.(`Click_module=StoryUpdateClient_storyId=${this.#editStoryId}`);
        } else {
          window.logWebpageActivity?.(`Click_module=StorySubmitClient_labelId=${this.#labelId}_hasPhoto=${!!photo}`);
        }
        this.#dialog.close();
        if (typeof this.#onSubmitted === 'function') this.#onSubmitted(editing);
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
      els.submit.textContent = i18next.t(editing ? 'labelmap:story.save' : 'labelmap:story.submit');
    }
  }

  /**
   * POSTs multipart form data, minting the shared anonymous session and retrying once — but only when the failure
   * looks auth-shaped (401/403/redirect). That's deliberately narrower than LabelDetail's #postJson, which retries
   * on any non-OK response: a story rejection (409 duplicate, 429 rate-limited) must surface, not be re-posted.
   * No Content-Type header: the browser sets the multipart boundary itself.
   * @param {string} url
   * @param {FormData} formData
   * @param {string} [method='POST'] - 'PUT' for in-place story edits.
   * @returns {Promise<Response>}
   */
  async #postForm(url, formData, method = 'POST') {
    const post = () => fetch(url, { method, body: formData });
    let res = await post();
    if (!res.ok && (res.status === 401 || res.status === 403 || res.type === 'opaqueredirect' || res.redirected)) {
      await fetch('/anonSignUp?url=%2F', { redirect: 'manual' });
      res = await post();
    }
    return res;
  }

  #reset() {
    const els = this.#els;
    const editing = this.#editStoryId !== null;
    els.title.textContent
      = i18next.t(editing ? 'labelmap:story.composer-title-edit' : 'labelmap:story.composer-title');
    els.submit.textContent = i18next.t(editing ? 'labelmap:story.save' : 'labelmap:story.submit');
    els.text.value = '';
    this.#renderCounter();
    this.#clearPhoto();
    els.nameAnon.checked = true;
    els.nameUser.checked = false;
    this.#clearError();
    // The show-username option only makes sense when we know the account; its pill carries the actual username so
    // the choice is concrete and mirrors the anonymous row's shape.
    const userRow = els.nameUser.closest('.story-composer__check-row');
    if (this.#username) {
      userRow.hidden = false;
      els.usernameOption.textContent = this.#username;
    } else {
      userRow.hidden = true;
    }
    // Anonymous-session viewers get the sign-in CTA; it disappears once they have an account (a username).
    els.signinCta.hidden = Boolean(this.#username);
  }

  #clearPhoto() {
    const els = this.#els;
    els.photoInput.value = '';
    this.#revokeObjectUrl();
    els.photoThumb.removeAttribute('src');
    els.photoPreview.hidden = true;
    els.photoAttach.hidden = false;
    els.altInput.value = '';
  }

  #revokeObjectUrl() {
    if (this.#objectUrl) {
      URL.revokeObjectURL(this.#objectUrl);
      this.#objectUrl = null;
    }
  }

  /**
   * Renders the photo thumbnail and swaps the attach button for the preview. Shared by the file-input change
   * handler and draft restore.
   * @param {File} file
   */
  #renderPhotoPreview(file) {
    const els = this.#els;
    this.#revokeObjectUrl();
    this.#objectUrl = URL.createObjectURL(file);
    els.photoThumb.src = this.#objectUrl;
    els.photoPreview.hidden = false;
    els.photoAttach.hidden = true;
  }

  /**
   * Loads a File into the (read-only-to-users) file input via DataTransfer, then renders its preview. Used when
   * restoring a photo from a stashed draft, where there was no user file-picker interaction to populate the input.
   * @param {File} file
   */
  #setPhoto(file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    this.#els.photoInput.files = dt.files;
    this.#renderPhotoPreview(file);
  }

  #openDraftDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(StoryComposer.#DRAFT_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(StoryComposer.#DRAFT_STORE, { keyPath: 'labelId' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** @param {Object} draft - The stashed draft, keyed by its `labelId`. */
  async #putDraft(draft) {
    const db = await this.#openDraftDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(StoryComposer.#DRAFT_STORE, 'readwrite');
        tx.objectStore(StoryComposer.#DRAFT_STORE).put(draft);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  /**
   * Reads the draft for a label without removing it. The delete is a separate step (#deleteDraft) so a restore only
   * consumes the draft once it has committed to applying it — a stale-label bail must not destroy the stash.
   * @param {number} labelId
   * @returns {Promise<?Object>} The draft, or null if none is stored.
   */
  async #readDraft(labelId) {
    const db = await this.#openDraftDb();
    try {
      const store = StoryComposer.#DRAFT_STORE;
      return await new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(labelId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  /**
   * Removes the stashed draft for a label (one-shot: a restore consumes it so a later reload doesn't refill).
   * @param {number} labelId
   */
  async #deleteDraft(labelId) {
    const db = await this.#openDraftDb();
    try {
      const store = StoryComposer.#DRAFT_STORE;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(labelId);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  /**
   * Stashes the in-progress draft and redirects to sign-in, returning to this page with ?resumeStory=<labelId> so
   * the composer reopens fully restored. Best-effort: if the stash fails (e.g. private-mode IndexedDB), we still
   * proceed to sign-in rather than trap the user.
   */
  async #signInWithDraft() {
    const els = this.#els;
    const photo = els.photoInput.files[0];
    window.logWebpageActivity?.(`Click_module=StorySignInCta_labelId=${this.#labelId}`);
    try {
      await this.#putDraft({
        labelId: this.#labelId,
        text: els.text.value,
        altText: els.altInput.value,
        useUsername: els.nameUser.checked,
        photoBlob: photo || null,
        photoName: photo ? photo.name : null,
        photoType: photo ? photo.type : null,
      });
    } catch (err) {
      console.error('Could not stash story draft before sign-in:', err);
    }
    const back = new URL(window.location.href);
    back.searchParams.set('resumeStory', String(this.#labelId));
    window.location.assign(`/signIn?url=${encodeURIComponent(back.pathname + back.search + back.hash)}`);
  }

  /**
   * Repopulates the composer from a stashed draft, if one exists for this label. Consumes the draft.
   * @param {number} labelId
   */
  async #restoreDraft(labelId) {
    let draft;
    try {
      draft = await this.#readDraft(labelId);
    } catch (err) {
      console.error('Could not read stashed story draft:', err);
      return;
    }
    // Bail if nothing stashed, or the shown label changed while we were reading (don't clobber the new composer). The
    // read didn't delete, so bailing here leaves the draft intact for the correct label's next open.
    if (!draft || this.#labelId !== labelId) return;
    // Committed to restoring: consume the draft now so a later reload doesn't refill. Fire-and-forget — we already
    // hold it in memory, and a failed delete only means it may reappear on the next open, never lost work.
    this.#deleteDraft(labelId).catch((err) => console.error('Could not clear stashed story draft:', err));
    const els = this.#els;
    els.text.value = draft.text || '';
    this.#renderCounter();
    if (draft.useUsername && this.#username) {
      els.nameUser.checked = true;
      els.nameAnon.checked = false;
    }
    if (draft.photoBlob) {
      const type = draft.photoType || draft.photoBlob.type;
      this.#setPhoto(new File([draft.photoBlob], draft.photoName || 'photo', { type }));
      els.altInput.value = draft.altText || '';
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
