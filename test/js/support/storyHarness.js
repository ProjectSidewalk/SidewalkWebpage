/**
 * Shared setup for the story suites (#5840): the composer dialog and the card's stories section as the Twirl partials
 * (views/common/storyComposer.scala.html, labelDetail.scala.html) render them, a confirm whose answer a test picks,
 * and stand-ins for the browser pieces jsdom lacks: modal dialogs, a file picker that can hold a file, object URLs,
 * and the IndexedDB store a signed-out writer's draft waits in during sign-in.
 */

import { mockModule } from '../loader.js';

/** What the discard and delete confirms answer; a test swaps the answer with `mockResolvedValueOnce`. */
export const confirmDialog = vi.fn(async () => true);

mockModule('frontend/js/common/ConfirmDialog.js', () => ({
  ConfirmDialog: { confirm: (opts) => confirmDialog(opts) },
}));

/** @returns {string} The composer dialog, as storyComposer.scala.html renders it with the default id prefix. */
export function composerMarkup() {
  return `
    <dialog class="story-composer" id="story-composer">
      <button type="button" class="story-composer__close" aria-label="Close"><img src="cross.svg" alt=""></button>
      <h3 class="story-composer__title">Write your story</h3>
      <p class="story-composer__intro">Stories help neighbors and city officials understand.</p>
      <label class="story-composer__field" for="story-composer-text">
        <span class="story-composer__field-label">Your story</span>
        <textarea class="story-composer__text" id="story-composer-text" rows="5"></textarea>
      </label>
      <div class="story-composer__counter" aria-hidden="true"></div>
      <div class="story-composer__photo-row">
        <label class="story-composer__photo-attach" for="story-composer-photo">
          <input type="file" id="story-composer-photo" class="story-composer__photo-input sr-only"
                 accept="image/jpeg,image/png">
          <span>Add a photo (optional)</span>
        </label>
        <div class="story-composer__photo-preview" hidden>
          <img class="story-composer__photo-thumb" alt="" width="120" height="90">
          <div class="story-composer__photo-fields">
            <label class="story-composer__field" for="story-composer-alt">
              <input type="text" id="story-composer-alt" class="story-composer__alt-input">
            </label>
            <button type="button" class="story-composer__photo-remove">Remove photo</button>
          </div>
        </div>
      </div>
      <fieldset class="story-composer__post-as">
        <label class="story-composer__check-row" for="story-composer-name-anon">
          <input type="radio" id="story-composer-name-anon" class="story-composer__name-anon" checked>
          <span class="story-composer__name-pill">Anonymous</span>
        </label>
        <label class="story-composer__check-row" for="story-composer-name-username">
          <input type="radio" id="story-composer-name-username" class="story-composer__name-username">
          <span class="story-composer__name-pill story-composer__username-option"></span>
        </label>
      </fieldset>
      <p class="story-composer__signin-cta" hidden>
        <span>Have an account?</span>
        <button type="button" class="story-composer__signin-btn">Sign in to post under your name</button>
      </p>
      <p class="story-composer__privacy">You can review your stories from your dashboard.</p>
      <p class="story-composer__error" role="alert" hidden></p>
      <div class="story-composer__actions">
        <button type="button" class="story-composer__cancel">Cancel</button>
        <button type="button" class="story-composer__submit">Publish story</button>
      </div>
    </dialog>`;
}

/**
 * @returns {string} The card's story pieces from labelDetail.scala.html: the disclosure, the status line, the footer
 *     share pill, the composer and the photo lightbox, in one host root.
 */
export function storiesMarkup() {
  return `
    <div id="root">
      <section class="label-detail__stories" hidden>
        <details class="label-detail__stories-details">
          <summary class="label-detail__stories-summary">
            <span class="label-detail__stories-heading">Community stories</span>
            <span class="label-detail__stories-count" hidden></span>
            <button type="button" class="label-detail__story-share"><span>Write your story</span></button>
          </summary>
          <div class="label-detail__stories-list"></div>
        </details>
      </section>
      <span class="label-detail__story-status sr-only" role="status" aria-live="polite"></span>
      <div class="label-detail__footer">
        <button type="button" class="label-detail__story-share label-detail__story-share--footer" hidden></button>
      </div>
      ${composerMarkup()}
      <dialog class="story-lightbox">
        <button type="button" class="story-lightbox__close" aria-label="Close"></button>
        <figure class="story-lightbox__figure">
          <img class="story-lightbox__img" alt="">
          <figcaption class="story-lightbox__caption"></figcaption>
        </figure>
      </dialog>
    </div>`;
}

/**
 * Gives jsdom's dialogs the open/close a browser has: `showModal` opens, and `close` shuts and fires `close`, which
 * the composer listens for to free its photo preview.
 */
export function installDialogs() {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = function showModal() { this.setAttribute('open', ''); };
  proto.close = function close() {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

/**
 * Makes a file input able to hold a picked file. jsdom has no way for a page or a test to put a file in one: no file
 * chooser, and no DataTransfer to build the list the composer assigns when it restores a draft's photo.
 * @param {HTMLInputElement} input - The composer's file input.
 * @returns {{pick: (file: ?File) => void}} `pick` chooses a file (null for a cancelled chooser) and fires `change`.
 */
export function fakeFilePicker(input) {
  let files = [];
  Object.defineProperty(input, 'files', {
    configurable: true,
    get: () => files,
    set: (list) => { files = [...list]; },
  });
  // Clearing the value is how a page empties a file input; any other value is refused, as in a browser.
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => (files.length ? `C:\\fakepath\\${files[0].name}` : ''),
    set: (value) => { if (value === '') files = []; },
  });
  vi.stubGlobal('DataTransfer', class {
    files = [];
    items = { add: (file) => this.files.push(file) };
  });
  return {
    pick(file) {
      files = file ? [file] : [];
      input.dispatchEvent(new Event('change'));
    },
  };
}

/**
 * Stands in for the object URLs a photo preview shows (jsdom has none), recording which are still live.
 * @returns {{live: Set<string>}} The URLs made and not yet revoked.
 */
export function fakeObjectUrls() {
  const live = new Set();
  let next = 0;
  URL.createObjectURL = vi.fn(() => {
    next += 1;
    const url = `blob:http://localhost/photo-${next}`;
    live.add(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url) => live.delete(url));
  return { live };
}

/**
 * An in-memory IndexedDB holding the composer's one store of drafts, answering a turn later like the real one.
 * @returns {{drafts: Map<number, object>, failing: Set<string>}} The stored drafts by label id, and the steps
 *     ('open', 'get', 'put', 'delete') that should fail.
 */
export function fakeDraftStore() {
  const drafts = new Map();
  const failing = new Set();
  let created = false;
  const later = (fn) => setTimeout(fn, 0);

  /**
   * Settles a request a turn later, through `onerror` if that step is set to fail.
   * @param {object} target - The request or transaction whose handlers fire.
   * @param {string} step - Which step this is, checked against `failing`.
   * @param {() => void} work - Applies the step and sets any `result`.
   * @param {string} done - The success handler's name.
   */
  const settle = (target, step, work, done) => later(() => {
    if (failing.has(step)) {
      target.error = new Error(`${step} failed`);
      target.onerror();
    } else {
      work();
      target[done]();
    }
  });

  const db = {
    createObjectStore: () => { created = true; },
    close: () => {},
    transaction: () => {
      const tx = {};
      tx.objectStore = () => ({
        put: (draft) => settle(tx, 'put', () => drafts.set(draft.labelId, draft), 'oncomplete'),
        delete: (labelId) => settle(tx, 'delete', () => drafts.delete(labelId), 'oncomplete'),
        get: (labelId) => {
          const req = {};
          settle(req, 'get', () => { req.result = drafts.get(labelId); }, 'onsuccess');
          return req;
        },
      });
      return tx;
    },
  };

  vi.stubGlobal('indexedDB', {
    open: () => {
      const req = {};
      settle(req, 'open', () => {
        req.result = db;
        if (!created) req.onupgradeneeded();
      }, 'onsuccess');
      return req;
    },
  });
  return { drafts, failing };
}

/**
 * @param {string} [name] - The file's name.
 * @param {string} [type] - Its media type.
 * @returns {File} A photo as the file picker hands it over.
 */
export const photoFile = (name = 'curb.jpg', type = 'image/jpeg') => new File(['jpeg bytes'], name, { type });
