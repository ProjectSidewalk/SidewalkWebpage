/**
 * StoriesSection — the "Your stories" management list on the user dashboard (#4054).
 *
 * Fetches the signed-in user's lived-experience stories (hidden ones included — the author keeps sight of a
 * quarantined story and the right to retract it) from /userapi/stories/mine and renders one row per story: label
 * type, story text, photo thumbnail, posted date, the hidden-by-moderators chip, a view-label link (opens the
 * shared label popup when available), and the permanent Delete. Reuses the labelmap:story.* strings the card
 * already loads on this page.
 */
class StoriesSection {
  #container;
  #labelPopup;

  /**
   * @param {HTMLElement} container - The #ud-stories element.
   * @param {Object} opts
   * @param {?Object} opts.labelPopup - A LabelPopup instance, or null (links then navigate to /label/:id).
   */
  constructor(container, opts) {
    this.#container = container;
    this.#labelPopup = opts.labelPopup || null;
  }

  async render() {
    try {
      const res = await fetch('/userapi/stories/mine');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
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
    if (story.hidden) row.classList.add('ud-story-row--hidden');

    if (story.media) {
      const img = document.createElement('img');
      img.className = 'ud-story-thumb';
      img.loading = 'lazy';
      img.src = story.media.url;
      img.alt = story.media.alt_text || '';
      row.appendChild(img);
    }

    const body = document.createElement('div');
    body.className = 'ud-story-body';
    const text = document.createElement('p');
    text.className = 'ud-story-text';
    text.textContent = story.text;
    body.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'ud-story-meta';
    const labelLink = document.createElement('a');
    labelLink.href = `/label/${encodeURIComponent(story.label_id)}`;
    labelLink.textContent = i18next.t(`common:${camelToKebab(story.label_type)}`);
    labelLink.addEventListener('click', (e) => {
      if (!this.#labelPopup) return; // href fallback: navigate to the public label page.
      e.preventDefault();
      this.#labelPopup.showLabel(story.label_id, 'DashboardStories');
    });
    meta.appendChild(labelLink);
    meta.appendChild(document.createTextNode(` · ${moment(new Date(story.created_at)).format('ll')}`));

    if (story.hidden) {
      const chip = document.createElement('span');
      chip.className = 'ud-story-chip';
      chip.textContent = i18next.t('labelmap:story.hidden-chip');
      meta.appendChild(chip);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ud-story-delete';
    del.textContent = i18next.t('labelmap:story.delete');
    del.addEventListener('click', () => this.#deleteStory(story, row));
    meta.appendChild(del);

    body.appendChild(meta);
    row.appendChild(body);
    return row;
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
    });
    if (!confirmed) return;
    window.logWebpageActivity?.(`Click_module=StoryDeleteClient_storyId=${story.story_id}`);
    try {
      const res = await fetch(`/userapi/stories/${story.story_id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      row.remove();
      if (this.#container.childElementCount === 0) this.#renderStories([]);
    } catch (err) {
      console.error('Story delete failed.', err);
    }
  }
}
