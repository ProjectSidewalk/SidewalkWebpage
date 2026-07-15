/**
 * StorySection — the lived-experience stories disclosure on the label-detail card (#4054).
 *
 * Lazily fetches GET /stories?labelId=N when a label is shown (Gallery's host never calls the label-metadata
 * endpoint, so stories can't ride that payload), then renders the collapsed summary (count badge + share CTA) and,
 * on expand, the story list: text, byline (anonymous or username), photo thumbnails that open the enlarge dialog,
 * the author's own-story delete control, and the hidden-by-moderators chip on the author's quarantined story.
 * Scoped to the host root; owns the StoryComposer and the enlarge lightbox rendered by the same partial.
 */
class StorySection {
  #els = {};
  #composer;
  #labelId = null;
  #maxTextLength = null;
  #fetchToken = 0; // Guards against a stale response landing after a newer label was opened.

  /**
   * @param {HTMLElement} root - The host element containing the labelDetail markup.
   * @param {Object} opts
   * @param {string} [opts.currUsername] - The viewer's username, for the composer's show-username option.
   */
  constructor(root, opts) {
    const q = (sel) => root.querySelector(sel);
    this.#els = {
      details: q('.label-detail__stories-details'),
      count: q('.label-detail__stories-count'),
      shareBtn: q('.label-detail__story-share'),
      list: q('.label-detail__stories-list'),
      status: q('.label-detail__story-status'),
      lightbox: q('.story-lightbox'),
      lightboxImg: q('.story-lightbox__img'),
      lightboxCaption: q('.story-lightbox__caption'),
      lightboxClose: q('.story-lightbox__close'),
    };

    this.#composer = new StoryComposer(q('.story-composer'), {
      currUsername: opts.currUsername,
      onSubmitted: () => {
        this.#announce(i18next.t('labelmap:story.submitted'));
        this.#els.details.open = true;
        this.refresh();
      },
    });

    // The CTA lives inside the <summary>; stop the click from also toggling the disclosure.
    this.#els.shareBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.#composer.open(this.#labelId, this.#maxTextLength);
    });
    this.#els.details.addEventListener('toggle', () => {
      if (this.#els.details.open) {
        window.logWebpageActivity?.(`Click_module=StorySectionExpand_labelId=${this.#labelId}`);
      }
    });
    this.#els.lightboxClose.addEventListener('click', () => this.#els.lightbox.close());
  }

  /**
   * Points the section at a new label: collapses the disclosure, clears the list, and fetches its stories.
   * @param {number} labelId
   */
  setLabel(labelId) {
    this.#labelId = labelId;
    this.#els.details.open = false;
    this.#els.list.replaceChildren();
    this.#els.count.hidden = true;
    this.refresh();
  }

  /** Re-fetches and re-renders the current label's stories. */
  async refresh() {
    if (this.#labelId === null) return;
    const token = ++this.#fetchToken;
    try {
      const res = await fetch(`/stories?labelId=${this.#labelId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (token !== this.#fetchToken) return;
      this.#maxTextLength = data.max_text_length;
      this.#render(data.stories);
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * @param {Array<Object>} stories - StoryForView payloads, newest first.
   */
  #render(stories) {
    const els = this.#els;

    els.count.textContent = String(stories.length);
    els.count.hidden = stories.length === 0;
    els.shareBtn.textContent = i18next.t(
      stories.length === 0 ? 'labelmap:story.share-first' : 'labelmap:story.share-yours',
    );
    // One story per user per label (server-enforced): once yours exists, delete-and-repost is the edit path.
    els.shareBtn.hidden = stories.some((s) => s.is_own);

    els.list.replaceChildren();
    for (const story of stories) {
      els.list.appendChild(this.#buildStoryRow(story));
    }
  }

  /**
   * @param {Object} story - A StoryForView payload.
   * @returns {HTMLElement}
   */
  #buildStoryRow(story) {
    const row = document.createElement('div');
    row.className = 'label-detail__story';
    if (story.hidden) row.classList.add('label-detail__story--hidden');

    if (story.media) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'label-detail__story-photo-btn';
      const enlarge = i18next.t('labelmap:story.enlarge-photo');
      btn.setAttribute('aria-label', story.media.alt_text ? `${enlarge}: ${story.media.alt_text}` : enlarge);
      const img = document.createElement('img');
      img.className = 'label-detail__story-thumb';
      img.src = story.media.url;
      img.alt = story.media.alt_text || '';
      btn.appendChild(img);
      btn.addEventListener('click', () => this.#openLightbox(story.media));
      row.appendChild(btn);
    }

    const body = document.createElement('div');
    body.className = 'label-detail__story-body';

    const text = document.createElement('p');
    text.className = 'label-detail__story-text';
    text.textContent = story.text; // textContent escapes — no HTML injection.
    body.appendChild(text);

    const byline = document.createElement('div');
    byline.className = 'label-detail__story-byline';
    const who = document.createElement('span');
    who.className = 'label-detail__story-who';
    who.textContent = story.display_name || i18next.t('labelmap:story.anonymous');
    byline.appendChild(who);
    byline.appendChild(document.createTextNode(` · ${moment(new Date(story.created_at)).format('ll')}`));

    if (story.is_own) {
      const chip = document.createElement('span');
      chip.className = 'label-detail__story-chip label-detail__story-chip--own';
      chip.textContent = i18next.t('labelmap:story.your-story-chip');
      byline.appendChild(chip);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'label-detail__story-delete';
      del.textContent = i18next.t('labelmap:story.delete');
      del.addEventListener('click', () => this.#deleteStory(story.story_id));
      byline.appendChild(del);
    }
    if (story.hidden) {
      const chip = document.createElement('span');
      chip.className = 'label-detail__story-chip label-detail__story-chip--hidden';
      chip.textContent = i18next.t('labelmap:story.hidden-chip');
      byline.appendChild(chip);
    }

    body.appendChild(byline);
    row.appendChild(body);
    return row;
  }

  /**
   * The author's retraction from the card: a confirmed, permanent delete (row + photo bytes on the server).
   * @param {number} storyId
   */
  async #deleteStory(storyId) {
    if (!window.confirm(i18next.t('labelmap:story.delete-confirm'))) return;
    window.logWebpageActivity?.(`Click_module=StoryDeleteClient_storyId=${storyId}`);
    try {
      const res = await fetch(`/userapi/stories/${storyId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#announce(i18next.t('labelmap:story.deleted'));
      this.refresh();
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * @param {Object} media - The story's media payload; alt text doubles as the visible caption.
   */
  #openLightbox(media) {
    const els = this.#els;
    els.lightboxImg.src = media.url;
    els.lightboxImg.alt = media.alt_text || '';
    els.lightboxCaption.textContent = media.alt_text || i18next.t('labelmap:story.no-photo-description');
    els.lightbox.showModal();
  }

  /** @param {string} message - Announced via the section's aria-live region. */
  #announce(message) {
    this.#els.status.textContent = message;
    setTimeout(() => {
      this.#els.status.textContent = '';
    }, 4000);
  }
}
