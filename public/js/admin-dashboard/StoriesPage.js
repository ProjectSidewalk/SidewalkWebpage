/**
 * StoriesPage — the /admin/stories moderation queue for lived-experience stories (#4054).
 *
 * Fetches every recent story (hidden ones included) from /adminapi/stories and renders an act-on-items queue:
 * author (account username plus what the public sees), story text, photo thumbnail, label link (opens the admin
 * label popup inline when available), and the two moderation actions — Hide/Unhide (reversible quarantine) and
 * Delete permanently (row + photo bytes). Admin-only page, English-only by convention.
 */
class StoriesPage {
  #feedUrl;
  #labelPopup = null;
  #statusEl;
  #queueEl;

  /**
   * @param {Object} opts
   * @param {string} opts.feedUrl - The /adminapi/stories endpoint (with any ?n= cap baked in).
   */
  constructor(opts) {
    this.#feedUrl = opts.feedUrl;
    this.#statusEl = document.getElementById('stories-status');
    this.#queueEl = document.getElementById('stories-queue');
  }

  init() {
    this.#load();
  }

  /**
   * @param {{showLabel: function(number, string): Promise}} popup - A LabelPopup instance.
   */
  setLabelPopup(popup) {
    this.#labelPopup = popup;
  }

  async #load() {
    this.#setStatus('Loading stories…');
    try {
      const res = await fetch(this.#feedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.#render(data.stories);
    } catch (err) {
      console.error('Stories page: feed failed to load.', err);
      this.#setStatus('Failed to load stories — try reloading the page.');
    }
  }

  /**
   * @param {Array<Object>} stories - StoryForAdmin payloads, newest first.
   */
  #render(stories) {
    const hiddenCount = stories.filter((s) => s.hidden).length;
    const summary = stories.length === 0
      ? 'No stories yet.'
      : `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} · ${hiddenCount} hidden · newest first`;
    this.#setStatus(summary);

    this.#queueEl.replaceChildren();
    for (const story of stories) {
      this.#queueEl.appendChild(this.#buildRow(story));
    }
  }

  /**
   * @param {Object} story - A StoryForAdmin payload.
   * @returns {HTMLElement}
   */
  #buildRow(story) {
    const row = document.createElement('div');
    row.className = 'stories-queue-row';

    // Who: the account username (linked), plus what the public actually sees.
    const who = document.createElement('div');
    who.className = 'stories-queue-who';
    const userLink = document.createElement('a');
    userLink.href = `/admin/user/${encodeURIComponent(story.username)}`;
    userLink.textContent = story.username;
    who.appendChild(userLink);
    const publicAs = document.createElement('span');
    publicAs.className = 'stories-queue-public-as';
    publicAs.textContent
      = `shows publicly as: ${story.display_name_mode === 'username' ? story.username : 'Anonymous'}`;
    who.appendChild(publicAs);

    // What: the story text, plus label link and timestamps.
    const what = document.createElement('div');
    what.className = 'stories-queue-what';
    const text = document.createElement('p');
    text.className = 'stories-queue-text';
    text.textContent = story.text; // textContent escapes — story text is untrusted user content.
    what.appendChild(text);
    const meta = document.createElement('div');
    meta.className = 'stories-queue-meta';
    const labelLink = document.createElement('a');
    labelLink.href = `/admin/label/${encodeURIComponent(story.label_id)}`;
    labelLink.textContent = `${story.label_type} #${story.label_id}`;
    labelLink.addEventListener('click', (e) => {
      if (!this.#labelPopup) return; // href fallback: navigate to the label page.
      e.preventDefault();
      this.#labelPopup.showLabel(story.label_id, 'AdminStories');
    });
    meta.appendChild(labelLink);
    meta.appendChild(document.createTextNode(` · ${new Date(story.created_at).toLocaleString()}`));
    if (story.moderated_at) {
      meta.appendChild(document.createTextNode(
        ` · last moderated ${new Date(story.moderated_at).toLocaleString()}`,
      ));
    }
    const hiddenChip = document.createElement('span');
    hiddenChip.className = 'stories-queue-chip';
    hiddenChip.textContent = 'Hidden';
    meta.appendChild(hiddenChip);
    what.appendChild(meta);

    // Photo thumbnail (signed URL), when the story has one.
    const media = document.createElement('div');
    media.className = 'stories-queue-media';
    if (story.media) {
      const img = document.createElement('img');
      img.className = 'stories-queue-thumb';
      img.loading = 'lazy';
      img.src = story.media.url;
      img.alt = story.media.alt_text || 'Story photo (no description provided)';
      media.appendChild(img);
    }

    // Actions.
    const actions = document.createElement('div');
    actions.className = 'stories-queue-actions';
    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'stories-queue-btn';
    hideBtn.addEventListener('click', () => this.#toggleVisibility(story, row, hideBtn));
    actions.appendChild(hideBtn);
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'stories-queue-btn stories-queue-btn--danger';
    deleteBtn.textContent = 'Delete permanently';
    deleteBtn.addEventListener('click', () => this.#deleteStory(story, row));
    actions.appendChild(deleteBtn);

    row.append(who, what, media, actions);
    this.#applyVisibilityState(story, row, hideBtn);
    return row;
  }

  /** Syncs a row's quarantine styling, chip, and Hide/Unhide button label with the story's hidden state. */
  #applyVisibilityState(story, row, hideBtn) {
    row.classList.toggle('stories-queue-row--hidden', story.hidden);
    row.querySelector('.stories-queue-chip').hidden = !story.hidden;
    hideBtn.textContent = story.hidden ? 'Unhide' : 'Hide';
  }

  async #toggleVisibility(story, row, hideBtn) {
    const hide = !story.hidden;
    hideBtn.disabled = true;
    try {
      const res = await fetch(`/adminapi/stories/${story.story_id}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ hidden: hide }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      story.hidden = hide;
      this.#applyVisibilityState(story, row, hideBtn);
    } catch (err) {
      console.error('Stories page: visibility change failed.', err);
    } finally {
      hideBtn.disabled = false;
    }
  }

  async #deleteStory(story, row) {
    const ok = window.confirm(
      'Permanently delete this story (and its photo, if any)? This cannot be undone — '
      + 'use Hide instead if the content may be needed as evidence.',
    );
    if (!ok) return;
    try {
      const res = await fetch(`/adminapi/stories/${story.story_id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      row.remove();
    } catch (err) {
      console.error('Stories page: delete failed.', err);
    }
  }

  /** @param {string} message */
  #setStatus(message) {
    this.#statusEl.textContent = message;
  }
}
