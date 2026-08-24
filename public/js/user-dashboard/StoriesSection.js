/**
 * StoriesSection — the "Your stories" management list on the user dashboard (#4054).
 *
 * Fetches the signed-in user's lived-experience stories (hidden ones included — the author keeps sight of a
 * quarantined story and the right to retract it) from /userapi/stories/mine and renders one row per story: a
 * thumbnail (the story's photo, else the backend's signed label preview, else an empty placeholder), label
 * type, story text, posted date, the hidden-by-moderators chip, a view-label link (opens the
 * shared label popup when available), and Edit + Delete. Editing (#4656) reuses the card's StoryComposer against
 * the dashboard's own dialog instance, so the two edit paths can't drift. The list re-renders on the page-level
 * `ps:story:changed` signal, so a story saved or retracted through the label popup's own card refreshes it too.
 * Reuses the labelmap:story.* strings the card already loads on this page.
 */
class StoriesSection {
  #container;
  #labelPopup;
  #composer = null;
  #storiesUrl;
  #storyUrlFor;
  #maxTextLength = null; // From the stories endpoint (backend source of truth), passed to the composer.

  /**
   * @param {HTMLElement} container - The #ud-stories element.
   * @param {Object} opts
   * @param {?Object} opts.labelPopup - A LabelPopup instance, or null (links then navigate to /label/:id).
   * @param {?HTMLDialogElement} [opts.composerDialog] - The dashboard's `.story-composer` dialog; without it, rows
   *     render without an Edit control (editing stays available on the label card).
   * @param {string} [opts.currUsername] - The story owner's username, for the composer's post-as options.
   * @param {string} [opts.storiesUrl] - Endpoint listing the stories; defaults to the signed-in user's own.
   * @param {(storyId: number) => string} [opts.storyUrlFor] - URL a story is edited (PUT) and deleted (DELETE) at;
   *     defaults to the owner's own-story routes. An admin's dashboard view points both at the /adminapi routes.
   */
  constructor(container, opts) {
    this.#container = container;
    this.#labelPopup = opts.labelPopup || null;
    this.#storiesUrl = opts.storiesUrl || '/userapi/stories/mine';
    this.#storyUrlFor = opts.storyUrlFor || ((storyId) => `/userapi/stories/${storyId}`);
    if (opts.composerDialog && typeof StoryComposer !== 'undefined') {
      this.#composer = new StoryComposer(opts.composerDialog, {
        currUsername: opts.currUsername,
        omitDashboardLink: true, // The privacy note's "from your dashboard" link would point at this very page.
        updateUrlFor: this.#storyUrlFor,
      });
    }
    // A save can change any rendered field (text, photo, byline) — and can come from the label popup's own
    // composer, not just this list's — so any story change on the page re-fetches rather than patching rows.
    document.addEventListener('ps:story:changed', (e) => this.#onStoryChanged(e));
  }

  /**
   * Re-renders on any story save or retraction on the page, then repairs focus: closing this list's composer
   * returns focus to the row's Edit button, which the re-render just detached (dropping focus to <body>). Only
   * lost focus is repaired, so a save through the label popup's composer keeps focus where the popup put it.
   * @param {CustomEvent} e - The `ps:story:changed` signal; `detail.storyId` is set when an existing story changed.
   */
  async #onStoryChanged(e) {
    await this.render();
    const storyId = e.detail?.storyId ?? null;
    if (storyId === null || document.activeElement !== document.body) return;
    this.#container.querySelector(`.ud-story-row[data-story-id="${storyId}"] .ud-story-edit`)?.focus();
  }

  async render() {
    try {
      const res = await fetch(this.#storiesUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.#maxTextLength = data.max_text_length;
      this.#renderStories(data.stories);
    } catch (err) {
      console.error('Stories section failed to load.', err);
    }
  }

  /**
   * @param {Array<Object>} stories - StoryForOwner payloads, newest first.
   */
  #renderStories(stories) {
    this.#container.replaceChildren();
    if (stories.length === 0) {
      const nudge = document.createElement('div');
      nudge.className = 'ud-nudge';
      nudge.textContent = i18next.t('dashboard:stories.none');
      this.#container.appendChild(nudge);
      return;
    }
    for (const story of stories) {
      this.#container.appendChild(this.#buildRow(story));
    }
  }

  /**
   * @param {Object} story - A StoryForOwner payload.
   * @returns {HTMLElement}
   */
  #buildRow(story) {
    const row = document.createElement('div');
    row.className = 'ud-story-row';
    row.dataset.storyId = story.story_id;
    if (story.hidden) row.classList.add('ud-story-row--hidden');

    // Thumbnail: the story's own photo, else the label preview the backend signed (crop or GSV static), else an
    // empty box so imageless rows stay column-aligned with the rest.
    const imageUrl = story.media?.url ?? story.label_image_url;
    if (imageUrl) {
      const img = document.createElement('img');
      img.className = 'ud-story-thumb';
      img.loading = 'lazy';
      img.src = imageUrl;
      img.alt = story.media?.alt_text || '';
      // A vanished crop file or an expired signed URL degrades to the placeholder, not a broken-image icon.
      img.addEventListener('error', () => img.replaceWith(StoriesSection.#thumbPlaceholder()), { once: true });
      row.appendChild(img);
    } else {
      row.appendChild(StoriesSection.#thumbPlaceholder());
    }

    const body = document.createElement('div');
    body.className = 'ud-story-body';
    const text = document.createElement('p');
    text.className = 'ud-story-text';
    text.textContent = story.text;
    body.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'ud-story-meta';
    const typeName = i18next.t(`common:${camelToKebab(story.label_type)}`);
    const postedDate = moment(new Date(story.created_at)).format('ll');
    const labelLink = document.createElement('a');
    labelLink.href = `/label/${encodeURIComponent(story.label_id)}`;
    labelLink.textContent = typeName;
    labelLink.addEventListener('click', (e) => {
      if (!this.#labelPopup) return; // href fallback: navigate to the public label page.
      e.preventDefault();
      this.#labelPopup.showLabel(story.label_id, 'DashboardStories');
    });
    meta.appendChild(labelLink);
    meta.appendChild(document.createTextNode(` · ${postedDate}`));

    if (story.hidden) {
      const chip = document.createElement('span');
      chip.className = 'ud-story-chip';
      chip.textContent = i18next.t('labelmap:story.hidden-chip');
      meta.appendChild(chip);
    }

    if (this.#composer) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ud-story-edit';
      edit.textContent = i18next.t('labelmap:story.edit');
      // Every row's visible label is just "Edit"/"Delete", so the accessible name says which story (WCAG 2.4.6).
      edit.setAttribute('aria-label', i18next.t('labelmap:story.edit-aria', { labelType: typeName, date: postedDate }));
      edit.addEventListener('click', () => {
        // Problem-vs-feature phrasing comes from the payload's LabelTypeEnum-sourced flag, never derived here.
        this.#composer.setCopyVariant(story.is_access_problem);
        this.#composer.openForEdit(story, this.#maxTextLength);
      });
      meta.appendChild(edit);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ud-story-delete';
    del.textContent = i18next.t('labelmap:story.delete');
    del.setAttribute('aria-label', i18next.t('labelmap:story.delete-aria', { labelType: typeName, date: postedDate }));
    del.addEventListener('click', () => this.#deleteStory(story, row));
    meta.appendChild(del);

    body.appendChild(meta);
    row.appendChild(body);
    return row;
  }

  /**
   * @returns {HTMLElement} The empty thumbnail block shown when a story has no photo and no label preview.
   */
  static #thumbPlaceholder() {
    const ph = document.createElement('span');
    ph.className = 'ud-story-thumb ud-story-thumb--none';
    ph.setAttribute('aria-hidden', 'true');
    return ph;
  }

  /**
   * The retraction path (#4054): a confirmed, permanent delete — the server removes the row and any photo bytes.
   * @param {Object} story
   * @param {HTMLElement} row
   */
  async #deleteStory(story, row) {
    const confirmed = await ConfirmDialog.confirm({
      message: i18next.t('labelmap:story.delete-confirm'),
      confirmText: i18next.t('labelmap:story.delete'),
      cancelText: i18next.t('labelmap:story.cancel'),
      danger: true,
      confirmIconSrc: '/assets/images/icons/delete-white-material.svg',
    });
    if (!confirmed) return;
    window.logWebpageActivity?.(`Click_module=StoryDeleteClient_storyId=${story.story_id}`);
    try {
      const res = await fetch(this.#storyUrlFor(story.story_id), { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      row.remove();
      if (this.#container.childElementCount === 0) this.#renderStories([]);
    } catch (err) {
      console.error('Story delete failed.', err);
    }
  }
}
